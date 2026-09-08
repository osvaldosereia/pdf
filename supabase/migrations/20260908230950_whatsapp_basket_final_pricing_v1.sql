-- Alinha o valor final do pedido com a cesta comercial já recalculada pela vitrine.
-- Mantém o preço original apenas como referência; o total final usa base_commercial_price + adicionais.

create or replace function public.finalize_whatsapp_basket_order_request_v1(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  c public.conversations%rowtype;
  bs public.catalog_sessions%rowtype;
  es public.catalog_sessions%rowtype;
  b public.basket_templates%rowtype;
  cart_row public.carts%rowtype;
  customer_status jsonb;
  promise jsonb;
  basket_items jsonb:='[]'::jsonb;
  extras jsonb:='[]'::jsonb;
  extras_total numeric:=0;
  basket_adjusted_price numeric:=0;
  total_value numeric:=0;
  req public.whatsapp_basket_order_requests%rowtype;
begin
  select * into c from public.conversations where id=p_conversation_id for update;
  if not found then raise exception 'conversation_not_found'; end if;

  customer_status:=public.confirm_whatsapp_basket_customer_v1(c.id);

  select * into bs from public.catalog_sessions
   where conversation_id=c.id and metadata->>'flow'='basket_basic_v1'
   order by created_at desc limit 1;
  if not found then raise exception 'basket_session_required'; end if;

  select * into b from public.basket_templates where id=(bs.metadata->>'basket_id')::uuid;
  if not found then raise exception 'basket_not_found'; end if;

  if bs.cart_id is not null then
    select * into cart_row from public.carts where id=bs.cart_id;
  end if;
  basket_adjusted_price:=coalesce(cart_row.base_commercial_price,b.base_price,0);

  select * into es from public.catalog_sessions
   where conversation_id=c.id and metadata->>'flow'='basket_extras_v1'
   order by created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',i.product_id,'name',p.name,'quantity',i.quantity,
    'base_quantity',coalesce((i.metadata->>'base_quantity')::numeric,i.quantity),
    'changed',i.quantity is distinct from coalesce((i.metadata->>'base_quantity')::numeric,i.quantity)
  ) order by i.rank),'[]'::jsonb)
  into basket_items
  from public.catalog_session_items i join public.products p on p.id=i.product_id
  where i.catalog_session_id=bs.id;

  if bs.cart_id is not null then
    select coalesce(sum(ci.line_total),0),coalesce(jsonb_agg(jsonb_build_object(
      'product_id',ci.product_id,'name',p.name,'quantity',ci.quantity,'unit_price',ci.unit_price,'line_total',ci.line_total
    ) order by p.name) filter(where ci.id is not null),'[]'::jsonb)
    into extras_total,extras
    from public.cart_items ci join public.products p on p.id=ci.product_id
    where ci.cart_id=bs.cart_id and ci.source='addon' and ci.quantity>0;
  end if;

  total_value:=basket_adjusted_price+coalesce(extras_total,0);
  promise:=public.whatsapp_basket_delivery_promise_v1(now());

  insert into public.whatsapp_basket_order_requests(
    conversation_id,customer_id,basket_session_id,extras_session_id,basket_id,cart_id,status,
    basket_name_snapshot,basket_base_price,extras_total,total,basket_selection,extras,
    customer_snapshot,address_snapshot,delivery_date,delivery_rule,updated_at
  ) values(
    c.id,c.customer_id,bs.id,es.id,b.id,bs.cart_id,'ready_for_human',
    b.name,basket_adjusted_price,extras_total,total_value,basket_items,extras,
    coalesce(customer_status->'customer','{}'::jsonb),coalesce(customer_status->'address','{}'::jsonb),
    (promise->>'delivery_date')::date,coalesce(promise->>'rule','delivery_rule'),now()
  )
  on conflict(basket_session_id) do update set
    customer_id=excluded.customer_id,extras_session_id=excluded.extras_session_id,cart_id=excluded.cart_id,
    status='ready_for_human',basket_name_snapshot=excluded.basket_name_snapshot,basket_base_price=excluded.basket_base_price,
    extras_total=excluded.extras_total,total=excluded.total,basket_selection=excluded.basket_selection,extras=excluded.extras,
    customer_snapshot=excluded.customer_snapshot,address_snapshot=excluded.address_snapshot,
    delivery_date=excluded.delivery_date,delivery_rule=excluded.delivery_rule,updated_at=now()
  returning * into req;

  return jsonb_build_object(
    'request_id',req.id,'basket_name',req.basket_name_snapshot,
    'basket_original_price',b.base_price,'basket_price',req.basket_base_price,
    'extras_total',req.extras_total,'total',req.total,'delivery_date',req.delivery_date,
    'delivery_rule',req.delivery_rule,'delivery_fee',0,'basket_customized',exists(
      select 1 from jsonb_array_elements(req.basket_selection) x where coalesce((x->>'changed')::boolean,false)
    ),'customer',req.customer_snapshot,'address',req.address_snapshot
  );
end $function$;
