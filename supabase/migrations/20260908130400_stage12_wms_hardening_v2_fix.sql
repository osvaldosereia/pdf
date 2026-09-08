begin;

create or replace function public.create_fulfillment_from_order_v2(p_order_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  cfg public.fulfillment_runtime_config%rowtype;
  o public.orders%rowtype;
  existing uuid;
  f_id uuid;
  item_row record;
  loc record;
  fefo jsonb;
  allocation_line jsonb;
  created_items integer:=0;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;
  if not cfg.enabled or not cfg.order_creation_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','fulfillment_creation_disabled','side_effect_performed',false,'external_side_effect',false);
  end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 then
    return jsonb_build_object('ok',false,'error','invalid_idempotency_key','side_effect_performed',false);
  end if;
  select id into existing from public.fulfillment_orders where order_id=p_order_id or idempotency_key=trim(p_idempotency_key) limit 1;
  if found then return jsonb_build_object('ok',true,'replay',true,'fulfillment_order_id',existing,'side_effect_performed',false,'external_side_effect',false); end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found','side_effect_performed',false); end if;
  if o.status not in ('confirmed','sent_to_bling','processing') then
    return jsonb_build_object('ok',false,'error','order_not_eligible','order_status',o.status,'side_effect_performed',false);
  end if;
  if cfg.fefo_enforced then
    for item_row in select src.product_id,src.quantity from public.order_items src where src.order_id=o.id and src.product_id is not null and src.quantity>0 loop
      fefo:=public.preview_fefo_allocation_v1(item_row.product_id,item_row.quantity,(now() at time zone 'America/Cuiaba')::date,0);
      if coalesce((fefo->>'sufficient')::boolean,false)=false then
        return jsonb_build_object('ok',false,'error','fefo_shortage','product_id',item_row.product_id,'shortage',fefo->'shortage','side_effect_performed',false,'external_side_effect',false);
      end if;
    end loop;
  end if;
  insert into public.fulfillment_orders(order_id,idempotency_key) values(o.id,trim(p_idempotency_key)) returning id into f_id;
  for item_row in
    select src.*,p.gtin product_gtin,p.sku product_sku,p.name product_name
    from public.order_items src join public.products p on p.id=src.product_id
    where src.order_id=o.id and src.quantity>0 order by src.id
  loop
    select * into loc from public.product_pick_location_v2 where product_id=item_row.product_id;
    if cfg.barcode_required and nullif(trim(coalesce(item_row.product_gtin,'')),'') is null then raise exception 'barcode_missing_for_product:%',item_row.product_id; end if;
    if loc.location_source='missing' then raise exception 'location_missing_for_product:%',item_row.product_id; end if;
    if cfg.fefo_enforced then
      fefo:=public.preview_fefo_allocation_v1(item_row.product_id,item_row.quantity,(now() at time zone 'America/Cuiaba')::date,0);
      for allocation_line in select value from jsonb_array_elements(coalesce(fefo->'lines','[]'::jsonb)) loop
        insert into public.fulfillment_items(fulfillment_order_id,order_item_id,product_id,expected_quantity,expected_gtin,sku_snapshot,name_snapshot,location_id,location_snapshot,lot_id,lot_snapshot,pick_sequence)
        values(f_id,item_row.id,item_row.product_id,(allocation_line->>'quantity')::numeric,item_row.product_gtin,coalesce(item_row.sku_snapshot,item_row.product_sku),coalesce(item_row.name_snapshot,item_row.product_name),loc.location_id,jsonb_build_object('code',loc.location_code,'gondola',loc.gondola_code,'shelf',loc.shelf_code,'source',loc.location_source),(allocation_line->>'lot_id')::uuid,jsonb_build_object('lot_code',allocation_line->>'lot_code','expires_at',allocation_line->>'expires_at'),loc.pick_sequence);
        created_items:=created_items+1;
      end loop;
    else
      insert into public.fulfillment_items(fulfillment_order_id,order_item_id,product_id,expected_quantity,expected_gtin,sku_snapshot,name_snapshot,location_id,location_snapshot,pick_sequence)
      values(f_id,item_row.id,item_row.product_id,item_row.quantity,item_row.product_gtin,coalesce(item_row.sku_snapshot,item_row.product_sku),coalesce(item_row.name_snapshot,item_row.product_name),loc.location_id,jsonb_build_object('code',loc.location_code,'gondola',loc.gondola_code,'shelf',loc.shelf_code,'source',loc.location_source),loc.pick_sequence);
      created_items:=created_items+1;
    end if;
  end loop;
  if created_items=0 then raise exception 'fulfillment_order_without_items'; end if;
  insert into public.fulfillment_events(fulfillment_order_id,event_type,payload) values(f_id,'FULFILLMENT_CREATED',jsonb_build_object('items',created_items,'fefo_enforced',cfg.fefo_enforced));
  return jsonb_build_object('ok',true,'replay',false,'fulfillment_order_id',f_id,'items',created_items,'side_effect_performed',true,'external_side_effect',false);
end;$$;

revoke all on function public.create_fulfillment_from_order_v2(uuid,text) from public,anon,authenticated;
grant execute on function public.create_fulfillment_from_order_v2(uuid,text) to service_role;

commit;
