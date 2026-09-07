alter table public.customers
  add column if not exists inbound_text_count integer not null default 0,
  add column if not exists inbound_audio_count integer not null default 0,
  add column if not exists inbound_image_count integer not null default 0,
  add column if not exists last_inbound_message_type text;

create or replace function public.track_customer_message_preference()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_customer uuid;
begin
  if new.direction<>'inbound' then return new; end if;
  select customer_id into v_customer from public.conversations where id=new.conversation_id;
  if v_customer is null then return new; end if;
  update public.customers
     set inbound_text_count=inbound_text_count+case when new.message_type='text' then 1 else 0 end,
         inbound_audio_count=inbound_audio_count+case when new.message_type='audio' then 1 else 0 end,
         inbound_image_count=inbound_image_count+case when new.message_type='image' then 1 else 0 end,
         last_inbound_message_type=new.message_type,updated_at=now()
   where id=v_customer;
  return new;
end$$;
drop trigger if exists trg_messages_customer_preference on public.messages;
create trigger trg_messages_customer_preference after insert on public.messages for each row execute function public.track_customer_message_preference();

create or replace function public.resolve_customer_reply_mode(p_customer_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when c.preferred_reply in ('text','audio') then c.preferred_reply when c.inbound_audio_count>=2 and c.inbound_audio_count>=greatest(1,c.inbound_text_count/2) then 'audio' else 'text' end
  from public.customers c where c.id=p_customer_id
$$;

create or replace function public.build_customer_sales_context(p_customer_id uuid,p_recommendation_limit integer default 15)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_customer jsonb;v_bought jsonb;v_recs jsonb;v_mode text;v_reply text;
begin
  select jsonb_build_object('id',c.id,'name',c.name,'order_count',c.order_count,'lifetime_value',c.lifetime_value,'last_order_at',c.last_order_at,'catalog_skill_score',c.catalog_skill_score,'catalog_open_count',c.catalog_open_count,'catalog_success_count',c.catalog_success_count,'preferred_reply',c.preferred_reply,'inbound_audio_count',c.inbound_audio_count,'inbound_text_count',c.inbound_text_count,'last_inbound_message_type',c.last_inbound_message_type)
    into v_customer from public.customers c where c.id=p_customer_id;
  if v_customer is null then return null; end if;
  v_mode:=public.resolve_customer_shopping_mode(p_customer_id);v_reply:=public.resolve_customer_reply_mode(p_customer_id);
  select coalesce(jsonb_agg(jsonb_build_object('product_id',x.product_id,'name',x.name,'purchase_count',x.purchase_count,'total_quantity',x.total_quantity,'last_purchase_at',x.last_purchase_at,'category',x.category) order by x.purchase_count desc,x.last_purchase_at desc),'[]'::jsonb)
    into v_bought from(select s.product_id,p.name,s.purchase_count,s.total_quantity,s.last_purchase_at,p.category from public.customer_product_stats s join public.products p on p.id=s.product_id where s.customer_id=p_customer_id order by s.purchase_count desc,s.last_purchase_at desc limit 20)x;
  select coalesce(jsonb_agg(jsonb_build_object('product_id',r.product_id,'name',r.name,'price',r.price,'category',r.category,'score',r.score,'reason',r.reason,'bought_before',r.bought_before) order by r.score desc),'[]'::jsonb)
    into v_recs from public.get_customer_recommendations(p_customer_id,greatest(1,least(coalesce(p_recommendation_limit,15),30)),'personalized')r;
  return jsonb_build_object('customer',v_customer,'shopping_mode',coalesce(v_mode,'whatsapp_only'),'reply_mode',coalesce(v_reply,'text'),'seller_audio_candidate',(coalesce(v_reply,'text')='audio' or coalesce((v_customer->>'inbound_audio_count')::int,0)>0),'bought_products',v_bought,'recommendations',v_recs);
end$$;

revoke all on function public.resolve_customer_reply_mode(uuid),public.build_customer_sales_context(uuid,integer) from public,anon,authenticated;
grant execute on function public.resolve_customer_reply_mode(uuid),public.build_customer_sales_context(uuid,integer) to service_role;
