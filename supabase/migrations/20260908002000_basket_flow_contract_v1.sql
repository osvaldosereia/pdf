-- Dona Antônia — contrato de dados do Flow de personalização de cesta V1
-- Somente leitura/validação. Não envia Flow, não altera carrinho e não toca no Bling.

create or replace function public.build_basket_flow_context_v1(
  p_conversation_id uuid,
  p_basket_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  c public.conversations%rowtype;
  b public.basket_templates%rowtype;
  v_items jsonb;
begin
  select * into c from public.conversations where id=p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  if c.human_required or c.mode='human' then raise exception 'conversation_requires_human'; end if;
  select * into b from public.basket_templates where id=p_basket_id and is_active=true and is_whatsapp_active=true;
  if not found then raise exception 'basket_not_available'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',p.id,
    'name',p.name,
    'image_url',p.image_url,
    'quantity',bi.quantity,
    'removable',bi.removable,
    'quantity_editable',bi.quantity_editable,
    'min_quantity',coalesce(bi.min_quantity,case when bi.removable then 0 else bi.quantity end),
    'max_quantity',coalesce(bi.max_quantity,greatest(bi.quantity,10)),
    'available',(p.is_active and p.physically_verified and p.is_whatsapp_active and coalesce(p.stock,0)>0),
    'sort_order',bi.sort_order
  ) order by bi.sort_order,p.name),'[]'::jsonb)
  into v_items
  from public.basket_template_items bi
  join public.products p on p.id=bi.product_id
  where bi.basket_id=b.id;

  return jsonb_build_object(
    'ok',true,
    'contract','basket_personalization_v1',
    'conversation_id',c.id,
    'basket',jsonb_build_object(
      'id',b.id,
      'name',b.name,
      'description',b.description,
      'image_url',b.image_url,
      'commercial_price',b.base_price,
      'updated_at',b.updated_at
    ),
    'items',v_items,
    'policy',jsonb_build_object(
      'component_prices_visible',false,
      'commercial_price_source','basket_template',
      'component_sum_is_commercial_price',false,
      'requires_backend_validation',true,
      'payment_at_delivery_only',true
    )
  );
end;
$$;

create or replace function public.validate_basket_flow_selection_v1(
  p_basket_id uuid,
  p_selection jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  b public.basket_templates%rowtype;
  x jsonb;
  bi public.basket_template_items%rowtype;
  p public.products%rowtype;
  v_id_text text;
  v_product_id uuid;
  v_qty numeric;
  v_min numeric;
  v_max numeric;
  v_seen uuid[]:='{}'::uuid[];
  v_normalized jsonb:='[]'::jsonb;
  v_issues jsonb:='[]'::jsonb;
  v_expected integer:=0;
begin
  select * into b from public.basket_templates where id=p_basket_id and is_active=true and is_whatsapp_active=true;
  if not found then raise exception 'basket_not_available'; end if;
  if jsonb_typeof(coalesce(p_selection,'null'::jsonb))<>'array' then
    return jsonb_build_object('valid',false,'contract','basket_personalization_v1','normalized','[]'::jsonb,'issues',jsonb_build_array(jsonb_build_object('code','selection_must_be_array')));
  end if;

  select count(*) into v_expected from public.basket_template_items where basket_id=b.id;

  for x in select value from jsonb_array_elements(p_selection)
  loop
    if jsonb_typeof(x)<>'object' then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','item_must_be_object'));
      continue;
    end if;
    v_id_text:=trim(coalesce(x->>'product_id',''));
    if v_id_text!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','invalid_product_id'));
      continue;
    end if;
    v_product_id:=v_id_text::uuid;
    if v_product_id=any(v_seen) then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','duplicate_product','product_id',v_product_id));
      continue;
    end if;
    v_seen:=array_append(v_seen,v_product_id);

    select * into bi from public.basket_template_items where basket_id=b.id and product_id=v_product_id;
    if not found then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','product_not_in_basket','product_id',v_product_id));
      continue;
    end if;
    select * into p from public.products where id=v_product_id;
    if not found then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','product_missing','product_id',v_product_id));
      continue;
    end if;
    if coalesce(x->>'quantity','')!~'^[0-9]+$' then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','invalid_quantity','product_id',v_product_id));
      continue;
    end if;
    v_qty:=(x->>'quantity')::numeric;
    v_min:=coalesce(bi.min_quantity,case when bi.removable then 0 else bi.quantity end);
    v_max:=coalesce(bi.max_quantity,greatest(bi.quantity,10));
    if v_qty<v_min or v_qty>v_max then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','quantity_out_of_range','product_id',v_product_id,'min',v_min,'max',v_max));
      continue;
    end if;
    if not bi.quantity_editable and v_qty<>bi.quantity then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','quantity_not_editable','product_id',v_product_id));
      continue;
    end if;
    if not bi.removable and v_qty=0 then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','product_not_removable','product_id',v_product_id));
      continue;
    end if;
    if not (p.is_active and p.physically_verified and p.is_whatsapp_active and coalesce(p.stock,0)>0) then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','product_unavailable','product_id',v_product_id));
      continue;
    end if;
    v_normalized:=v_normalized||jsonb_build_array(jsonb_build_object(
      'product_id',v_product_id,
      'name',p.name,
      'base_quantity',bi.quantity,
      'quantity',v_qty,
      'changed',v_qty<>bi.quantity,
      'removable',bi.removable,
      'quantity_editable',bi.quantity_editable
    ));
  end loop;

  for bi in select * from public.basket_template_items where basket_id=b.id
  loop
    if not (bi.product_id=any(v_seen)) then
      v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','missing_component','product_id',bi.product_id));
    end if;
  end loop;

  return jsonb_build_object(
    'valid',jsonb_array_length(v_issues)=0 and jsonb_array_length(v_normalized)=v_expected,
    'contract','basket_personalization_v1',
    'basket_id',b.id,
    'normalized',v_normalized,
    'issues',v_issues,
    'policy',jsonb_build_object('component_prices_visible',false,'requires_backend_validation',true)
  );
end;
$$;

create or replace function public.get_flow_contract_readiness_v1()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'basket_personalization_v1',jsonb_build_object(
      'definition_slug','flow-personalizar-cesta-v1',
      'definition_status',d.status,
      'provider_configured',(coalesce(d.provider_id,'')<>''),
      'feature_enabled',f.enabled,
      'rollout_percent',f.rollout_percent,
      'component_prices_visible',false,
      'contract_ready',true,
      'transport_ready',(d.status in ('ready','active') and coalesce(d.provider_id,'')<>'')
    )
  )
  from public.experience_definitions d
  join public.experience_feature_flags f on f.key=d.feature_key
  where d.slug='flow-personalizar-cesta-v1'
$$;

revoke execute on function public.build_basket_flow_context_v1(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.validate_basket_flow_selection_v1(uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.get_flow_contract_readiness_v1() from public,anon,authenticated;
grant execute on function public.build_basket_flow_context_v1(uuid,uuid) to service_role;
grant execute on function public.validate_basket_flow_selection_v1(uuid,jsonb) to service_role;
grant execute on function public.get_flow_contract_readiness_v1() to service_role;
