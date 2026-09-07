-- Sala de Compra Dona Antonia - nucleo transacional v1
alter table public.products add column if not exists sales_category text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='products_sales_category_check') then
    alter table public.products add constraint products_sales_category_check check (sales_category is null or sales_category in ('mercearia','limpeza_lavanderia','higiene_beleza','casa_pet'));
  end if;
end $$;

create or replace function public.infer_sales_category(p_category text, p_whatsapp_category text default null)
returns text language sql immutable set search_path='' as $$
  select case
    when upper(coalesce(p_whatsapp_category,p_category,'')) ~ '(LIMPEZA|LAVANDERIA|DETERGENTE|DESINFETANTE|SABAO|SABÃO|AMACIANTE)' then 'limpeza_lavanderia'
    when upper(coalesce(p_whatsapp_category,p_category,'')) ~ '(HIGIENE|BELEZA|BEBE|BEBÊ|CREME|SHAMPOO|SABONETE|DESODORANTE)' then 'higiene_beleza'
    when upper(coalesce(p_whatsapp_category,p_category,'')) ~ '(PET|CASA|UTILIDADE|VASSOURA|RODO|BALDE)' then 'casa_pet'
    else 'mercearia' end
$$;
update public.products set sales_category=public.infer_sales_category(category,whatsapp_category) where sales_category is null;
create index if not exists idx_products_room_catalog on public.products(sales_category,sort_order,name) where physically_verified=true and is_active=true;

alter table public.conversations add column if not exists sales_pressure_level smallint not null default 1;
alter table public.conversations add column if not exists proactive_offer_count integer not null default 0;
alter table public.conversations add column if not exists upsell_declined boolean not null default false;
alter table public.conversations add column if not exists fast_checkout boolean not null default false;
alter table public.conversations add column if not exists last_offer_at timestamptz;
alter table public.conversations add column if not exists room_last_active_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='conversations_sales_pressure_check') then
    alter table public.conversations add constraint conversations_sales_pressure_check check (sales_pressure_level between 0 and 3);
  end if;
end $$;

alter table public.catalog_sessions add column if not exists experience text not null default 'shopping_room';
alter table public.catalog_sessions add column if not exists last_activity_at timestamptz not null default now();
alter table public.catalog_sessions add column if not exists checkout_started_at timestamptz;
alter table public.catalog_sessions add column if not exists completed_at timestamptz;
alter table public.catalog_sessions add column if not exists current_view text not null default 'home';
do $$ begin
  if not exists (select 1 from pg_constraint where conname='catalog_sessions_experience_check') then
    alter table public.catalog_sessions add constraint catalog_sessions_experience_check check (experience in ('shopping_room','legacy_catalog'));
  end if;
end $$;
update public.catalog_sessions set experience='shopping_room' where experience is distinct from 'shopping_room';

create or replace function public.ensure_shopping_room_cart(p_public_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.catalog_sessions%rowtype; v_cart public.carts%rowtype;
begin
  select * into v_session from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now() for update;
  if not found then raise exception 'room_unavailable'; end if;
  if v_session.cart_id is not null then
    select * into v_cart from public.carts where id=v_session.cart_id;
    if found and v_cart.status='draft' then update public.catalog_sessions set last_activity_at=now() where id=v_session.id; return jsonb_build_object('cart_id',v_cart.id,'total',v_cart.total,'version',v_cart.version); end if;
  end if;
  if v_session.conversation_id is null then raise exception 'room_requires_conversation'; end if;
  select * into v_cart from public.carts where conversation_id=v_session.conversation_id and status='draft' order by updated_at desc limit 1 for update;
  if not found then insert into public.carts(conversation_id,customer_id,status,base_commercial_price,total,expires_at) values(v_session.conversation_id,v_session.customer_id,'draft',0,0,now()+interval '24 hours') returning * into v_cart; end if;
  update public.catalog_sessions set cart_id=v_cart.id,last_activity_at=now() where id=v_session.id;
  return jsonb_build_object('cart_id',v_cart.id,'total',v_cart.total,'version',v_cart.version);
end; $$;

create or replace function public.set_cart_addon_quantity(p_cart_id uuid, p_product_id uuid, p_quantity numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_price numeric;
begin
  if p_quantity is null or p_quantity<0 or p_quantity>999 then raise exception 'invalid_quantity'; end if;
  perform 1 from public.carts where id=p_cart_id and status='draft'; if not found then raise exception 'cart_not_editable'; end if;
  select price into v_price from public.products where id=p_product_id and physically_verified=true and is_active=true and is_whatsapp_active=true and coalesce(stock,0)>0;
  if not found then raise exception 'product_not_available'; end if;
  delete from public.cart_items where cart_id=p_cart_id and product_id=p_product_id and source='addon';
  if p_quantity>0 then insert into public.cart_items(cart_id,product_id,source,quantity,unit_price,line_total,commercial_unit_price,metadata) values(p_cart_id,p_product_id,'addon',p_quantity,coalesce(v_price,0),p_quantity*coalesce(v_price,0),coalesce(v_price,0),jsonb_build_object('pricing_source','product_price','source','shopping_room')); end if;
  return public.recalculate_cart(p_cart_id);
end; $$;

create or replace function public.room_set_product_quantity(p_public_token text,p_product_id uuid,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.catalog_sessions%rowtype; v_cart_id uuid; v_old numeric:=0; v_rank integer; v_cart jsonb;
begin
  if p_quantity is null or p_quantity<0 or p_quantity>999 then raise exception 'invalid_quantity'; end if;
  select * into v_session from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now() for update; if not found then raise exception 'room_unavailable'; end if;
  perform 1 from public.products where id=p_product_id and physically_verified=true and is_active=true and is_whatsapp_active=true and coalesce(stock,0)>0; if not found then raise exception 'product_not_available'; end if;
  v_cart_id := nullif(public.ensure_shopping_room_cart(p_public_token)->>'cart_id','')::uuid;
  select quantity into v_old from public.catalog_session_items where catalog_session_id=v_session.id and product_id=p_product_id;
  if not found then select coalesce(max(rank),0)+1 into v_rank from public.catalog_session_items where catalog_session_id=v_session.id; insert into public.catalog_session_items(catalog_session_id,product_id,rank,reason,recommendation_score,quantity) values(v_session.id,p_product_id,v_rank,'Escolhido na Sala de Compra',0,0); v_old:=0; end if;
  v_cart:=public.set_cart_addon_quantity(v_cart_id,p_product_id,p_quantity);
  update public.catalog_session_items set quantity=p_quantity,added_at=case when p_quantity>0 then coalesce(added_at,now()) else null end,updated_at=now() where catalog_session_id=v_session.id and product_id=p_product_id;
  insert into public.catalog_events(catalog_session_id,customer_id,product_id,event_type,event_data) values(v_session.id,v_session.customer_id,p_product_id,case when p_quantity>v_old then 'catalog_add' else 'catalog_remove' end,jsonb_build_object('from',v_old,'to',p_quantity,'source','shopping_room'));
  update public.catalog_sessions set last_activity_at=now(),current_view='products' where id=v_session.id; update public.conversations set room_last_active_at=now(),updated_at=now() where id=v_session.conversation_id;
  return jsonb_build_object('ok',true,'quantity',p_quantity,'cart',v_cart);
end; $$;

create or replace function public.room_start_basket(p_public_token text,p_basket_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.catalog_sessions%rowtype; v_cart_id uuid; v_result jsonb; v_name text;
begin
  select * into v_session from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now() for update; if not found then raise exception 'room_unavailable'; end if;
  if v_session.conversation_id is null then raise exception 'room_requires_conversation'; end if;
  select name into v_name from public.basket_templates where id=p_basket_id and is_active=true and is_whatsapp_active=true; if not found then raise exception 'basket_not_available'; end if;
  v_result:=public.start_basket_cart(v_session.conversation_id,p_basket_id); select id into v_cart_id from public.carts where conversation_id=v_session.conversation_id and status='draft' order by updated_at desc limit 1;
  update public.catalog_sessions set cart_id=v_cart_id,kind='basket',title=v_name,last_activity_at=now(),current_view='basket' where id=v_session.id;
  insert into public.catalog_events(catalog_session_id,customer_id,event_type,event_data) values(v_session.id,v_session.customer_id,'catalog_add',jsonb_build_object('source','shopping_room','basket_id',p_basket_id));
  return v_result||jsonb_build_object('cart_id',v_cart_id,'basket_id',p_basket_id,'basket_name',v_name);
end; $$;

create or replace function public.room_set_basket_quantity(p_public_token text,p_product_id uuid,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.catalog_sessions%rowtype; v_result jsonb;
begin
  select * into v_session from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now(); if not found or v_session.cart_id is null then raise exception 'room_cart_unavailable'; end if;
  v_result:=public.set_basket_cart_item_quantity(v_session.cart_id,p_product_id,p_quantity); update public.catalog_sessions set last_activity_at=now(),current_view='basket' where id=v_session.id; return v_result;
end; $$;

create or replace function public.room_checkout_preview(p_public_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.catalog_sessions%rowtype; v_cart public.carts%rowtype; v_customer public.customers%rowtype; v_items jsonb; v_addresses jsonb; v_basket jsonb;
begin
  select * into v_session from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now(); if not found then raise exception 'room_unavailable'; end if; if v_session.cart_id is null then raise exception 'room_cart_unavailable'; end if;
  perform public.recalculate_cart(v_session.cart_id); select * into v_cart from public.carts where id=v_session.cart_id and status='draft'; if not found then raise exception 'cart_not_editable'; end if;
  if v_session.customer_id is not null then select * into v_customer from public.customers where id=v_session.customer_id; end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'name',p.name,'image_url',p.image_url,'quantity',ci.quantity,'unit_price',case when ci.source='basket' then null else coalesce(p.price,ci.unit_price,0) end,'line_total',case when ci.source='basket' then null else ci.quantity*coalesce(p.price,ci.unit_price,0) end,'source',ci.source,'removable',coalesce((ci.metadata->>'removable')::boolean,true),'quantity_editable',coalesce((ci.metadata->>'quantity_editable')::boolean,true)) order by ci.created_at),'[]'::jsonb) into v_items from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=v_cart.id and ci.quantity>0;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'label',a.label,'street',a.street,'number',a.number,'complement',a.complement,'neighborhood',a.neighborhood,'city',a.city,'state',a.state,'postal_code',a.postal_code,'reference',a.reference,'is_default',a.is_default) order by a.is_default desc,a.updated_at desc),'[]'::jsonb) into v_addresses from public.customer_addresses a where a.customer_id=v_session.customer_id and a.is_active=true;
  select case when b.id is null then null else jsonb_build_object('id',b.id,'name',b.name,'image_url',b.image_url,'commercial_price',b.base_price) end into v_basket from public.basket_templates b where b.id=v_cart.basket_id;
  update public.catalog_sessions set checkout_started_at=coalesce(checkout_started_at,now()),last_activity_at=now(),current_view='checkout' where id=v_session.id;
  return jsonb_build_object('cart',jsonb_build_object('id',v_cart.id,'total',v_cart.total,'fiscal_subtotal',v_cart.fiscal_subtotal,'other_expenses',v_cart.other_expenses,'discount',v_cart.discount,'version',v_cart.version),'basket',v_basket,'items',v_items,'customer',case when v_session.customer_id is null then null else jsonb_build_object('id',v_customer.id,'name',v_customer.name,'phone',v_customer.primary_whatsapp_e164) end,'addresses',v_addresses);
end; $$;

create or replace function public.room_confirm_order(p_public_token text,p_delivery_address jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_session public.catalog_sessions%rowtype; v_address jsonb; v_result jsonb;
begin
  select * into v_session from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now() for update; if not found then raise exception 'room_unavailable'; end if; if v_session.cart_id is null then raise exception 'room_cart_unavailable'; end if;
  if not exists(select 1 from public.cart_items where cart_id=v_session.cart_id and quantity>0) then raise exception 'empty_cart'; end if;
  v_address:=coalesce(p_delivery_address,'{}'::jsonb); if v_address='{}'::jsonb and v_session.customer_id is not null then select to_jsonb(a)-'customer_id'-'created_at'-'updated_at' into v_address from public.customer_addresses a where a.customer_id=v_session.customer_id and a.is_active=true order by a.is_default desc,a.updated_at desc limit 1; end if;
  if coalesce(v_address->>'street','')='' or coalesce(v_address->>'number','')='' or coalesce(v_address->>'city','')='' then raise exception 'delivery_address_required'; end if;
  v_result:=public.confirm_cart_order(v_session.cart_id,v_address); update public.catalog_sessions set status='closed',closed_at=now(),completed_at=now(),last_activity_at=now(),current_view='success' where id=v_session.id;
  insert into public.catalog_events(catalog_session_id,customer_id,event_type,event_data) values(v_session.id,v_session.customer_id,'catalog_checkout_return',jsonb_build_object('source','shopping_room','order_id',v_result->>'order_id'));
  insert into public.customer_behavior_events(customer_id,conversation_id,event_type,event_data) values(v_session.customer_id,v_session.conversation_id,'room_order_confirmed',jsonb_build_object('order_id',v_result->>'order_id'));
  update public.conversations set stage='order_confirmed',status='waiting_customer',updated_at=now() where id=v_session.conversation_id; return v_result||jsonb_build_object('delivery_address',v_address);
end; $$;

create or replace function public.build_bling_order_draft(p_order_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('order_id',o.id,'bling_order_id',o.bling_order_id,'status',o.status,'customer',o.customer_snapshot,'delivery_address',o.delivery_address,'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',oi.product_id,'bling_product_id',p.bling_product_id,'sku',oi.sku_snapshot,'name',oi.name_snapshot,'quantity',oi.quantity,'unit_price',oi.unit_price,'line_total',oi.line_total) order by oi.created_at) from public.order_items oi left join public.products p on p.id=oi.product_id where oi.order_id=o.id),'[]'::jsonb),'fiscal_subtotal',o.fiscal_subtotal,'other_expenses',o.other_expenses,'discount',o.discount,'total',o.total,'currency',o.currency) from public.orders o where o.id=p_order_id
$$;

revoke execute on function public.apply_catalog_behavior_event() from public,anon,authenticated;
revoke execute on function public.refresh_purchase_profile_from_order() from public,anon,authenticated;
revoke execute on function public.refresh_purchase_profile_from_order_item() from public,anon,authenticated;
revoke execute on function public.track_customer_message_preference() from public,anon,authenticated;
revoke execute on function public.ensure_shopping_room_cart(text) from public,anon,authenticated;
revoke execute on function public.room_set_product_quantity(text,uuid,numeric) from public,anon,authenticated;
revoke execute on function public.room_start_basket(text,uuid) from public,anon,authenticated;
revoke execute on function public.room_set_basket_quantity(text,uuid,numeric) from public,anon,authenticated;
revoke execute on function public.room_checkout_preview(text) from public,anon,authenticated;
revoke execute on function public.room_confirm_order(text,jsonb) from public,anon,authenticated;
revoke execute on function public.build_bling_order_draft(uuid) from public,anon,authenticated;
grant execute on function public.ensure_shopping_room_cart(text) to service_role;
grant execute on function public.room_set_product_quantity(text,uuid,numeric) to service_role;
grant execute on function public.room_start_basket(text,uuid) to service_role;
grant execute on function public.room_set_basket_quantity(text,uuid,numeric) to service_role;
grant execute on function public.room_checkout_preview(text) to service_role;
grant execute on function public.room_confirm_order(text,jsonb) to service_role;
grant execute on function public.build_bling_order_draft(uuid) to service_role;
