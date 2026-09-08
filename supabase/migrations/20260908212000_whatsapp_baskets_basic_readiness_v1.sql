begin;

-- Dona Antônia — fluxo simples de venda de cestas pelo WhatsApp.
-- Regra central: a cesta é um produto comercial com preço próprio. Componentes
-- não exibem preço individual e alterações de composição ficam registradas para
-- conferência humana. Produtos extras usam preço/estoque do contador conferido.

create table if not exists public.whatsapp_basket_order_requests (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  basket_session_id uuid not null references public.catalog_sessions(id) on delete restrict,
  extras_session_id uuid references public.catalog_sessions(id) on delete set null,
  basket_id uuid not null references public.basket_templates(id) on delete restrict,
  cart_id uuid references public.carts(id) on delete set null,
  status text not null default 'ready_for_human' check(status in ('ready_for_human','accepted','cancelled','sent_bling')),
  basket_name_snapshot text not null,
  basket_base_price numeric not null,
  extras_total numeric not null default 0,
  total numeric not null,
  basket_selection jsonb not null default '[]'::jsonb,
  extras jsonb not null default '[]'::jsonb,
  customer_snapshot jsonb not null default '{}'::jsonb,
  address_snapshot jsonb not null default '{}'::jsonb,
  delivery_date date not null,
  delivery_rule text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists whatsapp_basket_order_requests_session_uidx
  on public.whatsapp_basket_order_requests(basket_session_id);
create index if not exists whatsapp_basket_order_requests_status_idx
  on public.whatsapp_basket_order_requests(status,created_at desc);
alter table public.whatsapp_basket_order_requests enable row level security;
revoke all on public.whatsapp_basket_order_requests from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_basket_order_requests to service_role;

create or replace function public.whatsapp_basket_section_v1(p_category text,p_name text)
returns text language sql immutable set search_path='' as $$
  select case
    when upper(coalesce(p_category,''))='LAVANDERIA' then 'lavanderia'
    when upper(coalesce(p_category,''))='LIMPEZA'
      and upper(coalesce(p_name,'')) ~ '(VASSOURA|RODO|BALDE|PANO|ESPONJA|BUCHA|SACO|LIXO|PA DE LIXO|PÁ DE LIXO)' then 'casa'
    when upper(coalesce(p_category,''))='LIMPEZA' then 'limpeza'
    when upper(coalesce(p_category,'')) in ('HIGIENE','SABONETE','BEBÊ','BEBE') then 'higiene'
    when upper(coalesce(p_category,'')) in ('BELEZA','SHAMPOO E CONDICIONADOR') then 'beleza'
    when upper(coalesce(p_category,''))='PETS' then null
    else 'mercearia'
  end
$$;

create or replace function public.get_whatsapp_simple_baskets_v1()
returns table(id uuid,name text,display_name text,base_price numeric,image_url text,sort_order integer)
language sql stable security definer set search_path='' as $$
  select b.id,b.name,
    case when lower(b.name)='economica bonini' then 'Econômica' else b.name end,
    b.base_price,b.image_url,b.sort_order
  from public.basket_templates b
  where b.is_active=true and b.is_whatsapp_active=true
  order by b.sort_order,b.name
$$;

create or replace function public.create_whatsapp_basket_session_v1(p_conversation_id uuid,p_basket_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.conversations%rowtype;
  b public.basket_templates%rowtype;
  k public.carts%rowtype;
  s public.catalog_sessions%rowtype;
  item_count integer:=0;
begin
  select * into c from public.conversations where id=p_conversation_id and status<>'closed' for update;
  if not found then raise exception 'conversation_not_found'; end if;
  if c.mode='human' or c.human_required then raise exception 'conversation_requires_human'; end if;
  select * into b from public.basket_templates where id=p_basket_id and is_active=true and is_whatsapp_active=true;
  if not found then raise exception 'basket_not_available'; end if;

  select * into k from public.carts where conversation_id=c.id and status='draft' order by updated_at desc limit 1 for update;
  if not found then
    insert into public.carts(conversation_id,customer_id,basket_id,status,base_commercial_price,total,expires_at)
    values(c.id,c.customer_id,b.id,'draft',b.base_price,b.base_price,now()+interval '24 hours') returning * into k;
  else
    delete from public.cart_items where cart_id=k.id and source in ('basket','substitution');
    update public.carts set customer_id=c.customer_id,basket_id=b.id,base_commercial_price=b.base_price,updated_at=now() where id=k.id returning * into k;
    perform public.recalculate_cart(k.id);
    select * into k from public.carts where id=k.id;
  end if;

  update public.catalog_sessions set status='closed',closed_at=now(),last_activity_at=now()
   where conversation_id=c.id and status='open' and metadata->>'flow' in ('basket_basic_v1','basket_extras_v1');

  insert into public.catalog_sessions(customer_id,conversation_id,cart_id,kind,title,status,expires_at,metadata,experience,current_view,last_activity_at)
  values(c.customer_id,c.id,k.id,'basket',b.name,'open',now()+interval '24 hours',
    jsonb_build_object('flow','basket_basic_v1','basket_id',b.id,'basket_name',b.name,'basket_price',b.base_price,'basket_customized',false),
    'shopping_room','basket',now()) returning * into s;

  insert into public.catalog_session_items(catalog_session_id,product_id,rank,reason,recommendation_score,quantity,metadata)
  select s.id,bi.product_id,row_number() over(order by bi.sort_order,bi.created_at)::integer,
    'Item da cesta',0,bi.quantity,
    jsonb_build_object('item_type','basket_component','base_quantity',bi.quantity,'removable',bi.removable,'quantity_editable',bi.quantity_editable,
      'min_quantity',coalesce(bi.min_quantity,case when bi.removable then 0 else bi.quantity end),
      'max_quantity',coalesce(bi.max_quantity,greatest(bi.quantity,20)))
  from public.basket_template_items bi where bi.basket_id=b.id;
  get diagnostics item_count=row_count;

  update public.conversations set stage='basket_selected',updated_at=now() where id=c.id;
  return jsonb_build_object('session_id',s.id,'token',s.public_token,'basket_id',b.id,'basket_name',b.name,
    'basket_price',b.base_price,'image_url',b.image_url,'item_count',item_count,'cart_id',k.id,
    'url','https://donaantonia.com.br/cesta/?t='||s.public_token);
end $$;

create or replace function public.set_whatsapp_basket_component_quantity_v1(p_public_token text,p_product_id uuid,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s public.catalog_sessions%rowtype;
  bi public.basket_template_items%rowtype;
  base_qty numeric;
  min_qty numeric;
  max_qty numeric;
  changed boolean;
begin
  if p_quantity is null or p_quantity<0 or p_quantity>99 or trunc(p_quantity)<>p_quantity then raise exception 'invalid_quantity'; end if;
  select * into s from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now() and metadata->>'flow'='basket_basic_v1' for update;
  if not found then raise exception 'basket_session_unavailable'; end if;
  select * into bi from public.basket_template_items where basket_id=(s.metadata->>'basket_id')::uuid and product_id=p_product_id;
  if not found then raise exception 'basket_component_not_found'; end if;
  base_qty:=bi.quantity;
  min_qty:=coalesce(bi.min_quantity,case when bi.removable then 0 else bi.quantity end);
  max_qty:=coalesce(bi.max_quantity,greatest(bi.quantity,20));
  if p_quantity=0 and not bi.removable then raise exception 'item_not_removable'; end if;
  if p_quantity<>base_qty and not bi.quantity_editable then raise exception 'quantity_not_editable'; end if;
  if p_quantity<min_qty or p_quantity>max_qty then raise exception 'quantity_out_of_range'; end if;

  update public.catalog_session_items set quantity=p_quantity,updated_at=now()
   where catalog_session_id=s.id and product_id=p_product_id;
  select exists(select 1 from public.catalog_session_items i where i.catalog_session_id=s.id and i.quantity<>coalesce((i.metadata->>'base_quantity')::numeric,i.quantity)) into changed;
  update public.catalog_sessions set metadata=jsonb_set(metadata,'{basket_customized}',to_jsonb(changed),true),last_activity_at=now() where id=s.id;
  return jsonb_build_object('ok',true,'product_id',p_product_id,'quantity',p_quantity,'basket_customized',changed,'commercial_price_unchanged',true);
end $$;

create or replace function public.create_whatsapp_basket_extras_session_v1(p_conversation_id uuid,p_sections text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.conversations%rowtype;
  base_s public.catalog_sessions%rowtype;
  extra_s public.catalog_sessions%rowtype;
  valid_sections text[]:=array['mercearia','limpeza','lavanderia','higiene','beleza','casa'];
  normalized text[]:='{}'::text[];
  sec text;
  cnt integer:=0;
begin
  select * into c from public.conversations where id=p_conversation_id and status<>'closed'; if not found then raise exception 'conversation_not_found'; end if;
  select * into base_s from public.catalog_sessions where conversation_id=c.id and metadata->>'flow'='basket_basic_v1'
    order by created_at desc limit 1;
  if not found or base_s.cart_id is null then raise exception 'basket_session_required'; end if;
  foreach sec in array coalesce(p_sections,'{}'::text[]) loop
    sec:=lower(trim(sec));
    if sec=any(valid_sections) and not sec=any(normalized) then normalized:=array_append(normalized,sec); end if;
  end loop;
  if cardinality(normalized)=0 then raise exception 'sections_required'; end if;

  update public.catalog_sessions set status='closed',closed_at=now(),last_activity_at=now()
    where conversation_id=c.id and status='open' and metadata->>'flow'='basket_extras_v1';
  insert into public.catalog_sessions(customer_id,conversation_id,cart_id,kind,title,status,expires_at,metadata,experience,current_view,last_activity_at)
  values(c.customer_id,c.id,base_s.cart_id,'browse','Adicionar produtos','open',now()+interval '24 hours',
    jsonb_build_object('flow','basket_extras_v1','parent_basket_session_id',base_s.id,'sections',to_jsonb(normalized)),
    'shopping_room','products',now()) returning * into extra_s;

  insert into public.catalog_session_items(catalog_session_id,product_id,rank,reason,recommendation_score,quantity,metadata)
  select extra_s.id,p.id,row_number() over(order by public.whatsapp_basket_section_v1(p.category,p.name),p.sort_order nulls last,p.name)::integer,
    initcap(public.whatsapp_basket_section_v1(p.category,p.name)),0,coalesce(ci.quantity,0),
    jsonb_build_object('item_type','extra','section',public.whatsapp_basket_section_v1(p.category,p.name))
  from public.products p
  left join public.cart_items ci on ci.cart_id=base_s.cart_id and ci.product_id=p.id and ci.source='addon'
  where p.physically_verified=true and p.is_active=true and p.price is not null and p.price>=0 and coalesce(p.stock,0)>0
    and public.whatsapp_basket_section_v1(p.category,p.name)=any(normalized)
  order by public.whatsapp_basket_section_v1(p.category,p.name),p.sort_order nulls last,p.name
  limit 250;
  get diagnostics cnt=row_count;
  return jsonb_build_object('session_id',extra_s.id,'token',extra_s.public_token,'item_count',cnt,'sections',to_jsonb(normalized),
    'url','https://donaantonia.com.br/cesta/?t='||extra_s.public_token);
end $$;

create or replace function public.set_whatsapp_basket_extra_quantity_v1(p_public_token text,p_product_id uuid,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s public.catalog_sessions%rowtype;
  p public.products%rowtype;
  result jsonb;
begin
  if p_quantity is null or p_quantity<0 or p_quantity>999 or trunc(p_quantity)<>p_quantity then raise exception 'invalid_quantity'; end if;
  select * into s from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now() and metadata->>'flow'='basket_extras_v1' for update;
  if not found or s.cart_id is null then raise exception 'extras_session_unavailable'; end if;
  if not exists(select 1 from public.catalog_session_items where catalog_session_id=s.id and product_id=p_product_id) then raise exception 'product_not_in_extras_catalog'; end if;
  select * into p from public.products where id=p_product_id and physically_verified=true and is_active=true and price is not null and price>=0 and coalesce(stock,0)>0;
  if not found then raise exception 'product_not_available'; end if;
  if p_quantity>coalesce(p.stock,0) then raise exception 'insufficient_stock'; end if;
  delete from public.cart_items where cart_id=s.cart_id and product_id=p.id and source='addon';
  if p_quantity>0 then
    insert into public.cart_items(cart_id,product_id,source,quantity,unit_price,line_total,commercial_unit_price,metadata)
    values(s.cart_id,p.id,'addon',p_quantity,p.price,p_quantity*p.price,p.price,jsonb_build_object('source','basket_extras_v1','pricing_source','counter_verified'));
  end if;
  result:=public.recalculate_cart(s.cart_id);
  update public.catalog_session_items set quantity=p_quantity,added_at=case when p_quantity>0 then coalesce(added_at,now()) else null end,updated_at=now()
   where catalog_session_id=s.id and product_id=p.id;
  update public.catalog_sessions set last_activity_at=now() where id=s.id;
  return jsonb_build_object('ok',true,'product_id',p.id,'quantity',p_quantity,'cart',result);
end $$;

create or replace function public.mark_whatsapp_basket_return_v1(p_public_token text,p_intent text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.catalog_sessions%rowtype; intent text:=lower(trim(coalesce(p_intent,'')));
begin
  if intent not in ('order','extras','extras_done') then raise exception 'invalid_return_intent'; end if;
  select * into s from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now() for update;
  if not found or s.metadata->>'flow' not in ('basket_basic_v1','basket_extras_v1') then raise exception 'catalog_session_unavailable'; end if;
  update public.catalog_sessions set metadata=metadata||jsonb_build_object('return_intent',intent,'returned_at',now()),last_activity_at=now(),current_view='returning' where id=s.id returning * into s;
  return jsonb_build_object('ok',true,'session_id',s.id,'conversation_id',s.conversation_id,'intent',intent);
end $$;

create or replace function public.get_whatsapp_basket_customer_status_v1(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.conversations%rowtype; u public.customers%rowtype; a public.customer_addresses%rowtype; registered boolean:=false;
begin
  select * into c from public.conversations where id=p_conversation_id; if not found then raise exception 'conversation_not_found'; end if;
  if c.customer_id is not null then select * into u from public.customers where id=c.customer_id; end if;
  if u.id is not null then select * into a from public.customer_addresses where customer_id=u.id and is_active=true order by is_default desc,updated_at desc limit 1; end if;
  registered:=u.id is not null and nullif(trim(coalesce(u.name,'')),'') is not null and a.id is not null
    and nullif(trim(coalesce(a.street,'')),'') is not null and nullif(trim(coalesce(a.number,'')),'') is not null
    and nullif(trim(coalesce(a.neighborhood,'')),'') is not null;
  return jsonb_build_object('registered',registered,
    'customer',case when u.id is null then null else jsonb_build_object('id',u.id,'name',u.name,'phone',u.primary_whatsapp_e164,'bling_contact_id',u.bling_contact_id) end,
    'address',case when a.id is null then null else jsonb_build_object('id',a.id,'street',a.street,'block',a.complement,'house',a.number,'neighborhood',a.neighborhood,'locator',a.reference,'city',a.city,'state',a.state) end);
end $$;

create or replace function public.save_whatsapp_basket_customer_v1(
  p_conversation_id uuid,p_name text,p_street text,p_block text,p_house text,p_neighborhood text,p_locator text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.conversations%rowtype; u public.customers%rowtype; a public.customer_addresses%rowtype; phone text;
begin
  if nullif(trim(coalesce(p_name,'')),'') is null or nullif(trim(coalesce(p_street,'')),'') is null
     or nullif(trim(coalesce(p_house,'')),'') is null or nullif(trim(coalesce(p_neighborhood,'')),'') is null
     or nullif(trim(coalesce(p_locator,'')),'') is null then raise exception 'customer_data_incomplete'; end if;
  select * into c from public.conversations where id=p_conversation_id for update; if not found then raise exception 'conversation_not_found'; end if;
  phone:=c.wa_contact_e164;
  if c.customer_id is not null then select * into u from public.customers where id=c.customer_id for update; end if;
  if u.id is null then
    select * into u from public.customers where primary_whatsapp_e164=phone for update;
  end if;
  if u.id is null then
    insert into public.customers(name,primary_whatsapp_e164,is_active) values(trim(p_name),phone,true) returning * into u;
  else
    update public.customers set name=trim(p_name),primary_whatsapp_e164=coalesce(primary_whatsapp_e164,phone),is_active=true,updated_at=now() where id=u.id returning * into u;
  end if;
  update public.conversations set customer_id=u.id,updated_at=now() where id=c.id;
  select * into a from public.customer_addresses where customer_id=u.id and is_active=true order by is_default desc,updated_at desc limit 1 for update;
  if a.id is null then
    insert into public.customer_addresses(customer_id,label,street,number,complement,neighborhood,state,reference,is_default,is_active,last_confirmed_at)
    values(u.id,'Entrega',trim(p_street),trim(p_house),nullif(trim(coalesce(p_block,'')),''),trim(p_neighborhood),'MT',trim(p_locator),true,true,now()) returning * into a;
  else
    update public.customer_addresses set street=trim(p_street),number=trim(p_house),complement=nullif(trim(coalesce(p_block,'')),''),
      neighborhood=trim(p_neighborhood),state=coalesce(state,'MT'),reference=trim(p_locator),is_default=true,is_active=true,last_confirmed_at=now(),updated_at=now()
    where id=a.id returning * into a;
  end if;
  return public.get_whatsapp_basket_customer_status_v1(c.id);
end $$;

create or replace function public.confirm_whatsapp_basket_customer_v1(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare st jsonb; aid uuid;
begin
  st:=public.get_whatsapp_basket_customer_status_v1(p_conversation_id);
  if coalesce((st->>'registered')::boolean,false) is not true then raise exception 'customer_data_incomplete'; end if;
  aid:=nullif(st->'address'->>'id','')::uuid;
  if aid is not null then update public.customer_addresses set last_confirmed_at=now(),updated_at=now() where id=aid; end if;
  return st;
end $$;

create or replace function public.whatsapp_basket_delivery_promise_v1(p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare local_ts timestamp:=p_at at time zone 'America/Cuiaba'; d date; same_day boolean; dow integer;
begin
  same_day:=(local_ts::time<=time '11:00');
  if same_day then d:=local_ts::date;
  else
    d:=local_ts::date+1;
    loop dow:=extract(isodow from d); exit when dow between 1 and 5; d:=d+1; end loop;
  end if;
  return jsonb_build_object('timezone','America/Cuiaba','cutoff','11:00','ordered_local_at',local_ts,'same_day',same_day,'delivery_date',d,
    'rule',case when same_day then 'same_day_until_11_cuiaba' else 'next_business_day_after_11_cuiaba' end);
end $$;

create or replace function public.get_whatsapp_basket_flow_state_v1(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base_s public.catalog_sessions%rowtype; extra_s public.catalog_sessions%rowtype; pending_s public.catalog_sessions%rowtype; b public.basket_templates%rowtype; k public.carts%rowtype; cust jsonb;
begin
  select * into base_s from public.catalog_sessions where conversation_id=p_conversation_id and metadata->>'flow'='basket_basic_v1' order by created_at desc limit 1;
  if base_s.id is not null then select * into b from public.basket_templates where id=nullif(base_s.metadata->>'basket_id','')::uuid; end if;
  select * into extra_s from public.catalog_sessions where conversation_id=p_conversation_id and metadata->>'flow'='basket_extras_v1' order by created_at desc limit 1;
  select * into pending_s from public.catalog_sessions where conversation_id=p_conversation_id and coalesce(metadata->>'return_intent','')<>'' order by last_activity_at desc,created_at desc limit 1;
  if base_s.cart_id is not null then select * into k from public.carts where id=base_s.cart_id; end if;
  cust:=public.get_whatsapp_basket_customer_status_v1(p_conversation_id);
  return jsonb_build_object(
    'active',base_s.id is not null,
    'basket_session',case when base_s.id is null then null else jsonb_build_object('id',base_s.id,'token',base_s.public_token,'status',base_s.status,'metadata',base_s.metadata) end,
    'basket',case when b.id is null then null else jsonb_build_object('id',b.id,'name',b.name,'base_price',b.base_price,'image_url',b.image_url) end,
    'extras_session',case when extra_s.id is null then null else jsonb_build_object('id',extra_s.id,'token',extra_s.public_token,'status',extra_s.status,'metadata',extra_s.metadata) end,
    'pending_return',case when pending_s.id is null then null else jsonb_build_object('session_id',pending_s.id,'intent',pending_s.metadata->>'return_intent','flow',pending_s.metadata->>'flow') end,
    'cart',case when k.id is null then null else jsonb_build_object('id',k.id,'total',k.total,'base_commercial_price',k.base_commercial_price,'basket_id',k.basket_id) end,
    'customer_status',cust
  );
end $$;

create or replace function public.consume_whatsapp_basket_return_v1(p_session_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.catalog_sessions set metadata=(metadata-'return_intent')||jsonb_build_object('return_consumed_at',now()),last_activity_at=now() where id=p_session_id;
end $$;

create or replace function public.prepare_whatsapp_basket_handoff_v1(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  flow jsonb; cust jsonb; base_id uuid; extra_id uuid; bid uuid; cart_id uuid;
  b public.basket_templates%rowtype; k public.carts%rowtype; basket_items jsonb; extras jsonb;
  extras_total numeric:=0; promise jsonb; req public.whatsapp_basket_order_requests%rowtype;
begin
  flow:=public.get_whatsapp_basket_flow_state_v1(p_conversation_id);
  if coalesce((flow->>'active')::boolean,false) is not true then raise exception 'basket_flow_not_found'; end if;
  cust:=flow->'customer_status'; if coalesce((cust->>'registered')::boolean,false) is not true then raise exception 'customer_data_required'; end if;
  base_id:=nullif(flow->'basket_session'->>'id','')::uuid; extra_id:=nullif(flow->'extras_session'->>'id','')::uuid;
  bid:=nullif(flow->'basket'->>'id','')::uuid; cart_id:=nullif(flow->'cart'->>'id','')::uuid;
  select * into b from public.basket_templates where id=bid; if not found then raise exception 'basket_not_found'; end if;
  select * into k from public.carts where id=cart_id; if not found then raise exception 'cart_not_found'; end if;
  perform public.recalculate_cart(k.id); select * into k from public.carts where id=k.id;

  select coalesce(jsonb_agg(jsonb_build_object('product_id',i.product_id,'name',p.name,'quantity',i.quantity,
    'base_quantity',coalesce((i.metadata->>'base_quantity')::numeric,i.quantity),'changed',i.quantity<>coalesce((i.metadata->>'base_quantity')::numeric,i.quantity)) order by i.rank),'[]'::jsonb)
  into basket_items from public.catalog_session_items i join public.products p on p.id=i.product_id where i.catalog_session_id=base_id;

  select coalesce(jsonb_agg(jsonb_build_object('product_id',ci.product_id,'name',p.name,'quantity',ci.quantity,'unit_price',ci.unit_price,'line_total',ci.line_total) order by p.name),'[]'::jsonb),
    coalesce(sum(ci.line_total),0)
  into extras,extras_total from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=k.id and ci.source='addon' and ci.quantity>0;
  promise:=public.whatsapp_basket_delivery_promise_v1(now());

  insert into public.whatsapp_basket_order_requests(conversation_id,customer_id,basket_session_id,extras_session_id,basket_id,cart_id,status,
    basket_name_snapshot,basket_base_price,extras_total,total,basket_selection,extras,customer_snapshot,address_snapshot,delivery_date,delivery_rule)
  values(p_conversation_id,nullif(cust->'customer'->>'id','')::uuid,base_id,extra_id,b.id,k.id,'ready_for_human',b.name,b.base_price,extras_total,k.total,
    basket_items,extras,coalesce(cust->'customer','{}'::jsonb),coalesce(cust->'address','{}'::jsonb),(promise->>'delivery_date')::date,promise->>'rule')
  on conflict(basket_session_id) do update set extras_session_id=excluded.extras_session_id,cart_id=excluded.cart_id,status='ready_for_human',
    basket_name_snapshot=excluded.basket_name_snapshot,basket_base_price=excluded.basket_base_price,extras_total=excluded.extras_total,total=excluded.total,
    basket_selection=excluded.basket_selection,extras=excluded.extras,customer_snapshot=excluded.customer_snapshot,address_snapshot=excluded.address_snapshot,
    delivery_date=excluded.delivery_date,delivery_rule=excluded.delivery_rule,updated_at=now()
  returning * into req;
  return jsonb_build_object('request_id',req.id,'basket_name',req.basket_name_snapshot,'basket_base_price',req.basket_base_price,'extras_total',req.extras_total,
    'total',req.total,'basket_selection',req.basket_selection,'extras',req.extras,'customer',req.customer_snapshot,'address',req.address_snapshot,
    'delivery_date',req.delivery_date,'delivery_rule',req.delivery_rule,'status',req.status);
end $$;

-- Regras de atendimento do fluxo simples.
update public.service_guidance_rules set title='Cestas: fluxo simples',instruction='Quando o cliente falar de cesta básica de qualquer forma, mostre imediatamente as 9 cestas com preços para seleção. Depois da escolha, envie o link do catálogo externo da cesta. Não exponha preços individuais dos componentes.',behavior_tags=array['mvp_whatsapp','basket','simple_flow'],channel_scope=array['whatsapp'],priority=100,status='published',updated_at=now() where rule_key='basket_simple_sales_flow';
insert into public.service_guidance_rules(rule_key,title,instruction,behavior_tags,channel_scope,intent_scope,stage_scope,priority,status)
select 'basket_simple_sales_flow','Cestas: fluxo simples','Quando o cliente falar de cesta básica de qualquer forma, mostre imediatamente as 9 cestas com preços para seleção. Depois da escolha, envie o link do catálogo externo da cesta. Não exponha preços individuais dos componentes.',array['mvp_whatsapp','basket','simple_flow'],array['whatsapp'],array[]::text[],array[]::text[],100,'published'
where not exists(select 1 from public.service_guidance_rules where rule_key='basket_simple_sales_flow');

update public.service_guidance_rules set title='Entrega das cestas',instruction='Pedidos de cesta enviados até 11:00 no horário de Cuiabá têm previsão para o mesmo dia. Após 11:00, a previsão é o próximo dia útil. Nunca use outro fuso horário.',behavior_tags=array['mvp_whatsapp','basket','delivery'],channel_scope=array['whatsapp'],priority=100,status='published',updated_at=now() where rule_key='basket_delivery_cutoff_cuiaba';
insert into public.service_guidance_rules(rule_key,title,instruction,behavior_tags,channel_scope,intent_scope,stage_scope,priority,status)
select 'basket_delivery_cutoff_cuiaba','Entrega das cestas','Pedidos de cesta enviados até 11:00 no horário de Cuiabá têm previsão para o mesmo dia. Após 11:00, a previsão é o próximo dia útil. Nunca use outro fuso horário.',array['mvp_whatsapp','basket','delivery'],array['whatsapp'],array[]::text[],array[]::text[],100,'published'
where not exists(select 1 from public.service_guidance_rules where rule_key='basket_delivery_cutoff_cuiaba');

revoke all on function public.whatsapp_basket_section_v1(text,text) from public,anon,authenticated;
revoke all on function public.get_whatsapp_simple_baskets_v1() from public,anon,authenticated;
revoke all on function public.create_whatsapp_basket_session_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.set_whatsapp_basket_component_quantity_v1(text,uuid,numeric) from public,anon,authenticated;
revoke all on function public.create_whatsapp_basket_extras_session_v1(uuid,text[]) from public,anon,authenticated;
revoke all on function public.set_whatsapp_basket_extra_quantity_v1(text,uuid,numeric) from public,anon,authenticated;
revoke all on function public.mark_whatsapp_basket_return_v1(text,text) from public,anon,authenticated;
revoke all on function public.get_whatsapp_basket_customer_status_v1(uuid) from public,anon,authenticated;
revoke all on function public.save_whatsapp_basket_customer_v1(uuid,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.confirm_whatsapp_basket_customer_v1(uuid) from public,anon,authenticated;
revoke all on function public.whatsapp_basket_delivery_promise_v1(timestamptz) from public,anon,authenticated;
revoke all on function public.get_whatsapp_basket_flow_state_v1(uuid) from public,anon,authenticated;
revoke all on function public.consume_whatsapp_basket_return_v1(uuid) from public,anon,authenticated;
revoke all on function public.prepare_whatsapp_basket_handoff_v1(uuid) from public,anon,authenticated;
grant execute on function public.whatsapp_basket_section_v1(text,text) to service_role;
grant execute on function public.get_whatsapp_simple_baskets_v1() to service_role;
grant execute on function public.create_whatsapp_basket_session_v1(uuid,uuid) to service_role;
grant execute on function public.set_whatsapp_basket_component_quantity_v1(text,uuid,numeric) to service_role;
grant execute on function public.create_whatsapp_basket_extras_session_v1(uuid,text[]) to service_role;
grant execute on function public.set_whatsapp_basket_extra_quantity_v1(text,uuid,numeric) to service_role;
grant execute on function public.mark_whatsapp_basket_return_v1(text,text) to service_role;
grant execute on function public.get_whatsapp_basket_customer_status_v1(uuid) to service_role;
grant execute on function public.save_whatsapp_basket_customer_v1(uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.confirm_whatsapp_basket_customer_v1(uuid) to service_role;
grant execute on function public.whatsapp_basket_delivery_promise_v1(timestamptz) to service_role;
grant execute on function public.get_whatsapp_basket_flow_state_v1(uuid) to service_role;
grant execute on function public.consume_whatsapp_basket_return_v1(uuid) to service_role;
grant execute on function public.prepare_whatsapp_basket_handoff_v1(uuid) to service_role;

commit;