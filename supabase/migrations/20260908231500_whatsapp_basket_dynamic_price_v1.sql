begin;

-- A cesta mantém seu preço comercial original como ponto de partida.
-- Ao aumentar/remover componentes, aplica somente o delta daquele componente.
-- Preço individual nunca é exposto ao cliente.
create or replace function public.set_whatsapp_basket_component_quantity_v1(
  p_public_token text,
  p_product_id uuid,
  p_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.catalog_sessions%rowtype;
  bi public.basket_template_items%rowtype;
  b public.basket_templates%rowtype;
  base_qty numeric;
  min_qty numeric;
  max_qty numeric;
  changed boolean;
  component_delta numeric:=0;
  adjusted_basket_price numeric:=0;
  missing_pricing jsonb:='[]'::jsonb;
  cart_result jsonb:='{}'::jsonb;
begin
  if p_quantity is null or p_quantity<0 or p_quantity>99 or trunc(p_quantity)<>p_quantity then
    raise exception 'invalid_quantity';
  end if;

  select * into s
  from public.catalog_sessions
  where public_token=p_public_token
    and status='open'
    and expires_at>now()
    and metadata->>'flow'='basket_basic_v1'
  for update;
  if not found then raise exception 'basket_session_unavailable'; end if;

  select * into b
  from public.basket_templates
  where id=(s.metadata->>'basket_id')::uuid;
  if not found then raise exception 'basket_not_found'; end if;

  select * into bi
  from public.basket_template_items
  where basket_id=b.id and product_id=p_product_id;
  if not found then raise exception 'basket_component_not_found'; end if;

  base_qty:=bi.quantity;
  min_qty:=coalesce(bi.min_quantity,case when bi.removable then 0 else bi.quantity end);
  max_qty:=coalesce(bi.max_quantity,greatest(bi.quantity,20));
  if p_quantity=0 and not bi.removable then raise exception 'item_not_removable'; end if;
  if p_quantity<>base_qty and not bi.quantity_editable then raise exception 'quantity_not_editable'; end if;
  if p_quantity<min_qty or p_quantity>max_qty then raise exception 'quantity_out_of_range'; end if;

  update public.catalog_session_items
     set quantity=p_quantity,updated_at=now()
   where catalog_session_id=s.id and product_id=p_product_id;

  select exists(
    select 1
    from public.catalog_session_items i
    where i.catalog_session_id=s.id
      and i.quantity<>coalesce((i.metadata->>'base_quantity')::numeric,i.quantity)
  ) into changed;

  with component_pricing as (
    select
      i.product_id,
      p.name,
      i.quantity,
      coalesce((i.metadata->>'base_quantity')::numeric,bi2.quantity) as base_quantity,
      case
        when i.quantity<coalesce((i.metadata->>'base_quantity')::numeric,bi2.quantity)
          then coalesce(bi2.remove_unit_delta,case when p.price is not null then -p.price end)
        when i.quantity>coalesce((i.metadata->>'base_quantity')::numeric,bi2.quantity)
          then coalesce(bi2.add_unit_delta,p.price)
        else 0
      end as unit_delta,
      case
        when i.quantity<coalesce((i.metadata->>'base_quantity')::numeric,bi2.quantity)
          then coalesce(bi2.remove_unit_delta,case when p.price is not null then -p.price end) is null
        when i.quantity>coalesce((i.metadata->>'base_quantity')::numeric,bi2.quantity)
          then coalesce(bi2.add_unit_delta,p.price) is null
        else false
      end as pricing_missing
    from public.catalog_session_items i
    join public.basket_template_items bi2
      on bi2.basket_id=b.id and bi2.product_id=i.product_id
    join public.products p on p.id=i.product_id
    where i.catalog_session_id=s.id
  )
  select
    coalesce(sum(case
      when quantity<base_quantity then (base_quantity-quantity)*coalesce(unit_delta,0)
      when quantity>base_quantity then (quantity-base_quantity)*coalesce(unit_delta,0)
      else 0 end),0),
    coalesce(jsonb_agg(jsonb_build_object('product_id',product_id,'name',name,'reason','component_price_missing'))
      filter(where pricing_missing),'[]'::jsonb)
  into component_delta,missing_pricing
  from component_pricing;

  adjusted_basket_price:=greatest(0,coalesce(b.base_price,0)+component_delta);

  if s.cart_id is not null then
    update public.carts
       set base_commercial_price=adjusted_basket_price,updated_at=now()
     where id=s.cart_id;
    cart_result:=public.recalculate_cart(s.cart_id);
    if jsonb_array_length(missing_pricing)>0 then
      update public.carts
         set pricing_status='needs_review',pricing_issues=missing_pricing,updated_at=now()
       where id=s.cart_id;
      cart_result:=cart_result||jsonb_build_object('pricing_status','needs_review','pricing_issues',missing_pricing);
    end if;
  end if;

  update public.catalog_sessions
     set metadata=jsonb_set(
       jsonb_set(metadata,'{basket_customized}',to_jsonb(changed),true),
       '{basket_adjusted_price}',to_jsonb(adjusted_basket_price),true
     ),
     last_activity_at=now()
   where id=s.id;

  return jsonb_build_object(
    'ok',true,
    'product_id',p_product_id,
    'quantity',p_quantity,
    'basket_customized',changed,
    'basket_base_price',b.base_price,
    'basket_total',adjusted_basket_price,
    'component_delta',component_delta,
    'pricing_complete',jsonb_array_length(missing_pricing)=0,
    'pricing_issues',missing_pricing,
    'cart',cart_result
  );
end $$;

revoke all on function public.set_whatsapp_basket_component_quantity_v1(text,uuid,numeric) from public,anon,authenticated;
grant execute on function public.set_whatsapp_basket_component_quantity_v1(text,uuid,numeric) to service_role;

-- Finalização usa o total comercial atual do carrinho, que já inclui
-- o preço ajustado da cesta + produtos adicionais.
create or replace function public.finalize_whatsapp_basket_order_request_v1(p_conversation_id uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  c public.conversations%rowtype;
  bs public.catalog_sessions%rowtype;
  es public.catalog_sessions%rowtype;
  b public.basket_templates%rowtype;
  k public.carts%rowtype;
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
    select * into k from public.carts where id=bs.cart_id;
    select coalesce(sum(ci.line_total),0),coalesce(jsonb_agg(jsonb_build_object(
      'product_id',ci.product_id,'name',p.name,'quantity',ci.quantity,'unit_price',ci.unit_price,'line_total',ci.line_total
    ) order by p.name) filter(where ci.id is not null),'[]'::jsonb)
    into extras_total,extras
    from public.cart_items ci join public.products p on p.id=ci.product_id
    where ci.cart_id=bs.cart_id and ci.source='addon' and ci.quantity>0;
  end if;

  basket_adjusted_price:=coalesce(k.base_commercial_price,b.base_price,0);
  total_value:=coalesce(k.total,basket_adjusted_price+coalesce(extras_total,0));
  promise:=public.whatsapp_basket_delivery_promise_v1(now());

  insert into public.whatsapp_basket_order_requests(
    conversation_id,customer_id,basket_session_id,extras_session_id,basket_id,cart_id,status,
    basket_name_snapshot,basket_base_price,extras_total,total,basket_selection,extras,
    customer_snapshot,address_snapshot,delivery_date,delivery_rule,updated_at
  ) values(
    c.id,c.customer_id,bs.id,es.id,b.id,bs.cart_id,'ready_for_human',
    b.name,b.base_price,extras_total,total_value,basket_items,extras,
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
    'request_id',req.id,
    'basket_name',req.basket_name_snapshot,
    'basket_base_price',req.basket_base_price,
    'basket_price',basket_adjusted_price,
    'extras_total',req.extras_total,
    'total',req.total,
    'pricing_status',coalesce(k.pricing_status,'ready'),
    'delivery_date',req.delivery_date,
    'delivery_rule',req.delivery_rule,
    'delivery_fee',0,
    'basket_customized',exists(
      select 1 from jsonb_array_elements(req.basket_selection) x where coalesce((x->>'changed')::boolean,false)
    ),
    'customer',req.customer_snapshot,
    'address',req.address_snapshot
  );
end $$;

revoke all on function public.finalize_whatsapp_basket_order_request_v1(uuid) from public,anon,authenticated;
grant execute on function public.finalize_whatsapp_basket_order_request_v1(uuid) to service_role;

commit;
