-- Histórico de compras, inteligência de cliente e mini catálogo público.
alter table public.customers
  add column if not exists shopping_mode text not null default 'auto',
  add column if not exists catalog_skill_score smallint not null default 0,
  add column if not exists catalog_open_count integer not null default 0,
  add column if not exists catalog_success_count integer not null default 0,
  add column if not exists last_catalog_at timestamptz,
  add column if not exists last_order_at timestamptz,
  add column if not exists order_count integer not null default 0,
  add column if not exists lifetime_value numeric(14,2) not null default 0;
alter table public.customers drop constraint if exists customers_shopping_mode_check;
alter table public.customers add constraint customers_shopping_mode_check check (shopping_mode in ('auto','catalog_first','whatsapp_only','hybrid'));
alter table public.customers drop constraint if exists customers_catalog_skill_score_check;
alter table public.customers add constraint customers_catalog_skill_score_check check (catalog_skill_score between 0 and 100);

create table if not exists public.customer_product_stats (
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  purchase_count integer not null default 0,
  total_quantity numeric(14,3) not null default 0,
  total_spent numeric(14,2) not null default 0,
  first_purchase_at timestamptz,
  last_purchase_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(customer_id,product_id)
);
create table if not exists public.customer_behavior_events (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.customers(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null, event_type text not null,
  event_data jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default now()
);
create table if not exists public.catalog_sessions (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique default (replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','')),
  customer_id uuid references public.customers(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  cart_id uuid references public.carts(id) on delete set null,
  kind text not null default 'personalized', title text, status text not null default 'open',
  expires_at timestamptz not null default(now()+interval '24 hours'), created_by uuid,
  created_at timestamptz not null default now(), last_opened_at timestamptz, closed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint catalog_sessions_kind_check check(kind in ('personalized','offers','browse','basket','manual')),
  constraint catalog_sessions_status_check check(status in ('open','closed','expired'))
);
create table if not exists public.catalog_session_items (
  catalog_session_id uuid not null references public.catalog_sessions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  rank integer not null default 0, reason text, recommendation_score numeric(10,2) not null default 0,
  quantity numeric(10,3) not null default 0, added_at timestamptz, updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb, primary key(catalog_session_id,product_id),
  constraint catalog_session_items_quantity_check check(quantity>=0 and quantity<=999)
);
create table if not exists public.catalog_events (
  id uuid primary key default gen_random_uuid(), catalog_session_id uuid not null references public.catalog_sessions(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null, product_id uuid references public.products(id) on delete set null,
  event_type text not null, event_data jsonb not null default '{}'::jsonb, occurred_at timestamptz not null default now()
);
create index if not exists idx_customer_product_stats_last on public.customer_product_stats(customer_id,last_purchase_at desc);
create index if not exists idx_customer_behavior_events_customer on public.customer_behavior_events(customer_id,occurred_at desc);
create index if not exists idx_catalog_sessions_customer on public.catalog_sessions(customer_id,created_at desc);
create index if not exists idx_catalog_sessions_token_active on public.catalog_sessions(public_token,status,expires_at);
create index if not exists idx_catalog_items_rank on public.catalog_session_items(catalog_session_id,rank);
create index if not exists idx_catalog_events_customer on public.catalog_events(customer_id,occurred_at desc);

alter table public.customer_product_stats enable row level security;
alter table public.customer_behavior_events enable row level security;
alter table public.catalog_sessions enable row level security;
alter table public.catalog_session_items enable row level security;
alter table public.catalog_events enable row level security;
revoke all on public.customer_product_stats,public.customer_behavior_events,public.catalog_sessions,public.catalog_session_items,public.catalog_events from public,anon,authenticated;
grant select,insert,update,delete on public.customer_product_stats,public.customer_behavior_events,public.catalog_sessions,public.catalog_session_items,public.catalog_events to service_role;

create or replace function public.refresh_customer_purchase_profile(p_customer_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_customer_id is null then return; end if;
 delete from public.customer_product_stats where customer_id=p_customer_id;
 insert into public.customer_product_stats(customer_id,product_id,purchase_count,total_quantity,total_spent,first_purchase_at,last_purchase_at,updated_at)
 select p_customer_id,oi.product_id,count(distinct o.id)::int,coalesce(sum(oi.quantity),0),coalesce(sum(oi.line_total),0),min(coalesce(o.confirmed_at,o.created_at)),max(coalesce(o.confirmed_at,o.created_at)),now()
 from public.orders o join public.order_items oi on oi.order_id=o.id
 where o.customer_id=p_customer_id and o.status<>'cancelled' and oi.product_id is not null group by oi.product_id;
 update public.customers c set order_count=x.order_count,lifetime_value=x.lifetime_value,last_order_at=x.last_order_at,updated_at=now()
 from(select count(*)::int order_count,coalesce(sum(total),0)::numeric(14,2) lifetime_value,max(coalesce(confirmed_at,created_at)) last_order_at from public.orders where customer_id=p_customer_id and status<>'cancelled')x where c.id=p_customer_id;
end$$;
create or replace function public.refresh_purchase_profile_from_order_item() returns trigger language plpgsql security definer set search_path='' as $$
declare v_customer uuid; begin
 if tg_op='DELETE' then select customer_id into v_customer from public.orders where id=old.order_id; perform public.refresh_customer_purchase_profile(v_customer); return old;
 elsif tg_op='INSERT' then select customer_id into v_customer from public.orders where id=new.order_id; perform public.refresh_customer_purchase_profile(v_customer); return new;
 else select customer_id into v_customer from public.orders where id=old.order_id; perform public.refresh_customer_purchase_profile(v_customer); if new.order_id is distinct from old.order_id then select customer_id into v_customer from public.orders where id=new.order_id; perform public.refresh_customer_purchase_profile(v_customer); end if; return new; end if;
end$$;
drop trigger if exists trg_order_items_purchase_profile on public.order_items;
create trigger trg_order_items_purchase_profile after insert or update or delete on public.order_items for each row execute function public.refresh_purchase_profile_from_order_item();
create or replace function public.refresh_purchase_profile_from_order() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then perform public.refresh_customer_purchase_profile(old.customer_id); return old;
 elsif tg_op='INSERT' then perform public.refresh_customer_purchase_profile(new.customer_id); return new;
 else perform public.refresh_customer_purchase_profile(old.customer_id); if new.customer_id is distinct from old.customer_id then perform public.refresh_customer_purchase_profile(new.customer_id); end if; return new; end if;
end$$;
drop trigger if exists trg_orders_purchase_profile on public.orders;
create trigger trg_orders_purchase_profile after insert or update of status,total,customer_id,confirmed_at or delete on public.orders for each row execute function public.refresh_purchase_profile_from_order();

create or replace function public.apply_catalog_behavior_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.customer_id is null then return new; end if;
 if new.event_type='catalog_open' then update public.customers set catalog_open_count=catalog_open_count+1,catalog_skill_score=least(100,catalog_skill_score+3),last_catalog_at=new.occurred_at,updated_at=now() where id=new.customer_id;
 elsif new.event_type='catalog_add' then update public.customers set catalog_success_count=catalog_success_count+1,catalog_skill_score=least(100,catalog_skill_score+8),last_catalog_at=new.occurred_at,updated_at=now() where id=new.customer_id;
 elsif new.event_type='catalog_checkout_return' then update public.customers set catalog_skill_score=least(100,catalog_skill_score+10),last_catalog_at=new.occurred_at,updated_at=now() where id=new.customer_id;
 elsif new.event_type='catalog_capable_signal' then update public.customers set catalog_skill_score=least(100,catalog_skill_score+15),updated_at=now() where id=new.customer_id;
 elsif new.event_type='catalog_preferred_explicit' then update public.customers set shopping_mode='catalog_first',catalog_skill_score=greatest(catalog_skill_score,60),updated_at=now() where id=new.customer_id;
 elsif new.event_type='whatsapp_only_explicit' then update public.customers set shopping_mode='whatsapp_only',catalog_skill_score=0,updated_at=now() where id=new.customer_id;
 elsif new.event_type='hybrid_preferred_explicit' then update public.customers set shopping_mode='hybrid',catalog_skill_score=greatest(catalog_skill_score,25),updated_at=now() where id=new.customer_id; end if;
 return new;
end$$;
drop trigger if exists trg_catalog_behavior on public.catalog_events;
create trigger trg_catalog_behavior after insert on public.catalog_events for each row execute function public.apply_catalog_behavior_event();
create or replace function public.resolve_customer_shopping_mode(p_customer_id uuid) returns text language sql stable security definer set search_path='' as $$
 select case when c.shopping_mode<>'auto' then c.shopping_mode when c.catalog_skill_score>=40 and c.catalog_success_count>=2 then 'catalog_first' when c.catalog_skill_score>=15 then 'hybrid' else 'whatsapp_only' end from public.customers c where c.id=p_customer_id
$$;

create or replace function public.get_customer_recommendations(p_customer_id uuid,p_limit integer default 30,p_kind text default 'personalized')
returns table(product_id uuid,name text,price numeric,image_url text,category text,stock numeric,score numeric,reason text,bought_before boolean,last_purchase_at timestamptz,purchase_count integer)
language sql stable security definer set search_path='' as $$
 with cps as(select * from public.customer_product_stats where customer_id=p_customer_id),
 affinity as(select p.category,sum(s.purchase_count)::numeric category_purchases from cps s join public.products p on p.id=s.product_id where p.category is not null group by p.category),
 ranked as(select p.id product_id,p.name,p.price,p.image_url,p.category,p.stock,(case when s.product_id is not null then 55 else 0 end+least(coalesce(s.purchase_count,0)*8,32)+least(coalesce(a.category_purchases,0)*2,20)+case when p.is_offer then 25 else 0 end+case when p.is_upsell then 8 else 0 end+case when s.last_purchase_at>=now()-interval '45 days' then 6 else 0 end)::numeric score,
 case when s.product_id is not null and p.is_offer then 'Você já compra este produto e ele está em oferta' when s.product_id is not null then 'Você já costuma comprar este produto' when p.is_offer and coalesce(a.category_purchases,0)>0 then 'Oferta em uma categoria que você costuma comprar' when p.is_offer then 'Produto em oferta' when coalesce(a.category_purchases,0)>0 then 'Combina com suas compras anteriores' else 'Sugestão da Dona Antônia' end reason,
 (s.product_id is not null)bought_before,s.last_purchase_at,coalesce(s.purchase_count,0)::int purchase_count,p.sort_order
 from public.products p left join cps s on s.product_id=p.id left join affinity a on a.category=p.category
 where p.physically_verified=true and p.is_active=true and p.is_whatsapp_active=true and coalesce(p.stock,0)>0 and(p_kind<>'offers' or p.is_offer=true))
 select product_id,name,price,image_url,category,stock,score,reason,bought_before,last_purchase_at,purchase_count from ranked order by score desc,sort_order asc,name asc limit greatest(1,least(coalesce(p_limit,30),50));
$$;
create or replace function public.set_cart_addon_quantity(p_cart_id uuid,p_product_id uuid,p_quantity numeric) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_price numeric; begin
 if p_quantity is null or p_quantity<0 or p_quantity>999 then raise exception 'invalid_quantity'; end if;
 perform 1 from public.carts where id=p_cart_id and status='draft'; if not found then raise exception 'cart_not_editable'; end if;
 select price into v_price from public.products where id=p_product_id and physically_verified=true and is_active=true and coalesce(stock,0)>0; if not found then raise exception 'product_not_available'; end if;
 delete from public.cart_items where cart_id=p_cart_id and product_id=p_product_id and source='addon';
 if p_quantity>0 then insert into public.cart_items(cart_id,product_id,source,quantity,unit_price,line_total,commercial_unit_price,metadata) values(p_cart_id,p_product_id,'addon',p_quantity,coalesce(v_price,0),p_quantity*coalesce(v_price,0),coalesce(v_price,0),jsonb_build_object('pricing_source','product_price','source','mini_catalog')); end if;
 return public.recalculate_cart(p_cart_id);
end$$;
create or replace function public.create_customer_catalog_session(p_customer_id uuid,p_conversation_id uuid default null,p_cart_id uuid default null,p_kind text default 'personalized',p_limit integer default 30,p_created_by uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.catalog_sessions%rowtype; v_count integer; v_title text; begin
 if p_kind not in('personalized','offers','browse','basket','manual') then raise exception 'invalid_catalog_kind'; end if;
 p_limit:=greatest(1,least(coalesce(p_limit,30),50)); v_title:=case p_kind when 'offers' then 'Ofertas para você' when 'personalized' then 'Sugestões para você' when 'basket' then 'Complete sua cesta' else 'Catálogo Dona Antônia' end;
 insert into public.catalog_sessions(customer_id,conversation_id,cart_id,kind,title,created_by,metadata) values(p_customer_id,p_conversation_id,p_cart_id,p_kind,v_title,p_created_by,jsonb_build_object('shopping_mode',coalesce(public.resolve_customer_shopping_mode(p_customer_id),'whatsapp_only'))) returning * into v_session;
 insert into public.catalog_session_items(catalog_session_id,product_id,rank,reason,recommendation_score) select v_session.id,r.product_id,row_number()over(order by r.score desc,r.name)::int,r.reason,r.score from public.get_customer_recommendations(p_customer_id,p_limit,case when p_kind='offers' then 'offers' else 'personalized' end)r;
 select count(*) into v_count from public.catalog_session_items where catalog_session_id=v_session.id; return jsonb_build_object('id',v_session.id,'token',v_session.public_token,'expires_at',v_session.expires_at,'kind',v_session.kind,'title',v_session.title,'item_count',v_count);
end$$;
create or replace function public.set_catalog_item_quantity(p_public_token text,p_product_id uuid,p_quantity numeric) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.catalog_sessions%rowtype; v_old numeric; v_cart jsonb:=null; begin
 if p_quantity is null or p_quantity<0 or p_quantity>999 then raise exception 'invalid_quantity'; end if;
 select * into v_session from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now() for update; if not found then raise exception 'catalog_session_unavailable'; end if;
 select quantity into v_old from public.catalog_session_items where catalog_session_id=v_session.id and product_id=p_product_id for update; if not found then raise exception 'product_not_in_catalog'; end if;
 if v_session.cart_id is not null then v_cart:=public.set_cart_addon_quantity(v_session.cart_id,p_product_id,p_quantity); end if;
 update public.catalog_session_items set quantity=p_quantity,added_at=case when p_quantity>0 then coalesce(added_at,now()) else null end,updated_at=now() where catalog_session_id=v_session.id and product_id=p_product_id;
 if p_quantity>coalesce(v_old,0) then insert into public.catalog_events(catalog_session_id,customer_id,product_id,event_type,event_data) values(v_session.id,v_session.customer_id,p_product_id,'catalog_add',jsonb_build_object('from',coalesce(v_old,0),'to',p_quantity)); elsif p_quantity<coalesce(v_old,0) then insert into public.catalog_events(catalog_session_id,customer_id,product_id,event_type,event_data) values(v_session.id,v_session.customer_id,p_product_id,'catalog_remove',jsonb_build_object('from',coalesce(v_old,0),'to',p_quantity)); end if;
 return jsonb_build_object('ok',true,'quantity',p_quantity,'cart',v_cart);
end$$;

revoke all on function public.refresh_customer_purchase_profile(uuid),public.resolve_customer_shopping_mode(uuid),public.get_customer_recommendations(uuid,integer,text),public.set_cart_addon_quantity(uuid,uuid,numeric),public.create_customer_catalog_session(uuid,uuid,uuid,text,integer,uuid),public.set_catalog_item_quantity(text,uuid,numeric) from public,anon,authenticated;
grant execute on function public.refresh_customer_purchase_profile(uuid),public.resolve_customer_shopping_mode(uuid),public.get_customer_recommendations(uuid,integer,text),public.set_cart_addon_quantity(uuid,uuid,numeric),public.create_customer_catalog_session(uuid,uuid,uuid,text,integer,uuid),public.set_catalog_item_quantity(text,uuid,numeric) to service_role;
do $$declare r record;begin for r in select id from public.customers loop perform public.refresh_customer_purchase_profile(r.id);end loop;end$$;
