begin;

create table if not exists public.sales_offer_events(
  id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id) on delete cascade,conversation_id uuid references public.conversations(id) on delete cascade,cart_id uuid references public.carts(id) on delete set null,product_id uuid references public.products(id) on delete set null,event_type text not null check(event_type in ('offered','viewed','added','rejected','ignored','accepted_category','declined_all')),source text not null default 'seller' check(source in ('seller','shopping_room','whatsapp','admin','system')),context jsonb not null default '{}'::jsonb,occurred_at timestamptz not null default now());
create index if not exists sales_offer_events_conversation_idx on public.sales_offer_events(conversation_id,occurred_at desc);
create index if not exists sales_offer_events_customer_product_idx on public.sales_offer_events(customer_id,product_id,occurred_at desc);
alter table public.sales_offer_events enable row level security;
revoke all on public.sales_offer_events from public,anon,authenticated;
grant select,insert,update,delete on public.sales_offer_events to service_role;

create or replace function public.record_sales_offer_event(p_conversation_id uuid,p_event_type text,p_product_id uuid default null,p_source text default 'seller',p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_conv public.conversations%rowtype;v_cart uuid;v_id uuid;
begin
  if p_event_type not in ('offered','viewed','added','rejected','ignored','accepted_category','declined_all') then raise exception 'invalid_sales_offer_event'; end if;
  if p_source not in ('seller','shopping_room','whatsapp','admin','system') then raise exception 'invalid_sales_offer_source'; end if;
  select * into v_conv from public.conversations where id=p_conversation_id for update;if not found then raise exception 'conversation_not_found'; end if;
  select id into v_cart from public.carts where conversation_id=p_conversation_id and status='draft' order by updated_at desc limit 1;
  insert into public.sales_offer_events(customer_id,conversation_id,cart_id,product_id,event_type,source,context) values(v_conv.customer_id,p_conversation_id,v_cart,p_product_id,p_event_type,p_source,coalesce(p_context,'{}'::jsonb)) returning id into v_id;
  if p_event_type='offered' then update public.conversations set proactive_offer_count=proactive_offer_count+1,last_offer_at=now(),updated_at=now() where id=p_conversation_id;
  elsif p_event_type in ('rejected','declined_all') then update public.conversations set sales_pressure_level=case when p_event_type='declined_all' then 0 else greatest(0,sales_pressure_level-1) end,upsell_declined=case when p_event_type='declined_all' then true else upsell_declined end,updated_at=now() where id=p_conversation_id;
  elsif p_event_type in ('added','accepted_category') then update public.conversations set sales_pressure_level=least(3,greatest(1,sales_pressure_level+1)),updated_at=now() where id=p_conversation_id;end if;
  return jsonb_build_object('id',v_id,'event_type',p_event_type);
end;
$$;

create or replace function public.get_cart_aware_recommendations(p_conversation_id uuid,p_limit integer default 6,p_kind text default 'upsell')
returns table(product_id uuid,name text,price numeric,image_url text,sales_category text,stock numeric,score numeric,reason text,bought_before boolean,purchase_count integer,last_purchase_at timestamptz,is_offer boolean)
language sql stable security definer set search_path=''
as $$
  with conv as (select c.customer_id from public.conversations c where c.id=p_conversation_id),
  cart as (select ca.id from public.carts ca where ca.conversation_id=p_conversation_id and ca.status='draft' order by ca.updated_at desc limit 1),
  in_cart as (select ci.product_id from public.cart_items ci join cart ca on ca.id=ci.cart_id where ci.quantity>0),
  stats as (select s.* from public.customer_product_stats s join conv c on c.customer_id=s.customer_id),
  affinity as (select p.sales_category,sum(s.purchase_count)::numeric category_weight from stats s join public.products p on p.id=s.product_id where p.sales_category is not null group by p.sales_category),
  recent_events as (select e.product_id,max(e.occurred_at) filter(where e.event_type='offered') last_offered,max(e.occurred_at) filter(where e.event_type='rejected') last_rejected,count(*) filter(where e.event_type='offered' and e.occurred_at>=now()-interval '7 days') offered_7d from public.sales_offer_events e join conv c on c.customer_id=e.customer_id where e.product_id is not null and e.occurred_at>=now()-interval '30 days' group by e.product_id),
  ranked as (
    select p.id,p.name,p.price,p.image_url,p.sales_category,p.stock,p.is_offer,
      (case when s.product_id is not null then 42 else 0 end+least(coalesce(s.purchase_count,0)*7,28)+least(coalesce(a.category_weight,0)*2,18)+case when p.is_offer then 24 else 0 end+case when p.is_upsell then 10 else 0 end+case when s.last_purchase_at between now()-interval '90 days' and now()-interval '14 days' then 8 else 0 end-least(coalesce(re.offered_7d,0)*12,36))::numeric score,
      case when s.product_id is not null and p.is_offer then 'Você já costuma comprar e está em oferta' when s.product_id is not null then 'Você já costuma comprar este produto' when p.is_offer and coalesce(a.category_weight,0)>0 then 'Oferta em uma categoria que você costuma comprar' when p.is_offer then 'Está em oferta hoje' when coalesce(a.category_weight,0)>0 then 'Combina com suas compras anteriores' when p.is_upsell then 'Complementa esta compra' else 'Sugestão para completar o pedido' end reason,
      (s.product_id is not null) bought_before,coalesce(s.purchase_count,0)::int purchase_count,s.last_purchase_at,p.sort_order
    from public.products p left join stats s on s.product_id=p.id left join affinity a on a.sales_category=p.sales_category left join recent_events re on re.product_id=p.id
    where p.physically_verified=true and p.is_active=true and p.is_whatsapp_active=true and coalesce(p.stock,0)>0 and not exists(select 1 from in_cart x where x.product_id=p.id) and (re.last_rejected is null or re.last_rejected<now()-interval '30 days') and (p_kind<>'offers' or p.is_offer=true)
  )
  select id,name,price,image_url,sales_category,stock,score,reason,bought_before,purchase_count,last_purchase_at,is_offer from ranked order by score desc,sort_order asc,name asc limit greatest(1,least(coalesce(p_limit,6),30))
$$;

create or replace function public.plan_next_sales_move(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare v_conv public.conversations%rowtype;v_customer public.customers%rowtype;v_cart public.carts%rowtype;v_count integer:=0;v_recs jsonb:='[]'::jsonb;v_reply text:='text';v_mode text:='whatsapp_only';v_action text:='none';v_reason text:='';
begin
  select * into v_conv from public.conversations where id=p_conversation_id;if not found then return jsonb_build_object('action','none','reason','conversation_not_found'); end if;
  if v_conv.customer_id is not null then select * into v_customer from public.customers where id=v_conv.customer_id;v_reply:=coalesce(public.resolve_customer_reply_mode(v_conv.customer_id),'text');v_mode:=coalesce(public.resolve_customer_shopping_mode(v_conv.customer_id),'whatsapp_only');end if;
  select * into v_cart from public.carts where conversation_id=p_conversation_id and status='draft' order by updated_at desc limit 1;if found then select count(*) into v_count from public.cart_items where cart_id=v_cart.id and quantity>0;end if;
  if v_conv.fast_checkout then v_action:='checkout';v_reason:='customer_wants_speed';
  elsif v_conv.upsell_declined or v_conv.sales_pressure_level=0 then v_action:='checkout';v_reason:='upsell_declined';
  elsif v_count=0 then v_action:='help_choose';v_reason:='cart_empty';
  elsif v_conv.proactive_offer_count>=2 then v_action:='checkout';v_reason:='proactive_offer_budget_reached';
  else select coalesce(jsonb_agg(to_jsonb(r) order by r.score desc),'[]'::jsonb) into v_recs from public.get_cart_aware_recommendations(p_conversation_id,case when v_conv.sales_pressure_level>=2 then 6 else 4 end,'upsell') r;if jsonb_array_length(v_recs)=0 then v_action:='checkout';v_reason:='no_relevant_recommendations';else v_action:='offer_suggestions';v_reason:='relevant_recommendations_available';end if;end if;
  return jsonb_build_object('action',v_action,'reason',v_reason,'shopping_mode',v_mode,'reply_mode',v_reply,'audio_candidate',(v_reply='audio'),'sales_pressure_level',v_conv.sales_pressure_level,'proactive_offer_count',v_conv.proactive_offer_count,'max_proactive_offers',2,'cart_item_count',v_count,'recommendations',v_recs,'rules',jsonb_build_object('never_repeat_rejected_product',true,'stop_after_decline',true,'checkout_has_no_aggressive_upsell',true,'recommendation_limit',case when v_conv.sales_pressure_level>=2 then 6 else 4 end));
end;
$$;

revoke execute on function public.record_sales_offer_event(uuid,text,uuid,text,jsonb),public.get_cart_aware_recommendations(uuid,integer,text),public.plan_next_sales_move(uuid) from public,anon,authenticated;
grant execute on function public.record_sales_offer_event(uuid,text,uuid,text,jsonb),public.get_cart_aware_recommendations(uuid,integer,text),public.plan_next_sales_move(uuid) to service_role;

commit;
