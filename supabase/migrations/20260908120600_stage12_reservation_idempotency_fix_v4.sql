begin;

create or replace function public.reserve_inventory_lots_fefo_v1(
  p_order_id uuid,p_product_id uuid,p_quantity numeric,p_reservation_key text,p_delivery_date date default current_date,p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  key text:=nullif(trim(coalesce(p_reservation_key,'')),'');
  preview jsonb;
  item jsonb;
  lot public.inventory_lots%rowtype;
  qty numeric(14,3);
  r_id uuid;
  reservations jsonb:='[]'::jsonb;
  existing_count integer;
  existing_product uuid;
  existing_order uuid;
  existing_quantity numeric;
begin
  if key is null or length(key)>160 then return jsonb_build_object('ok',false,'reason','invalid_reservation_key','side_effect_performed',false); end if;
  if coalesce(p_quantity,0)<=0 then return jsonb_build_object('ok',false,'reason','invalid_quantity','side_effect_performed',false); end if;

  select count(*),coalesce(sum(quantity),0)
    into existing_count,existing_quantity
  from public.inventory_lot_reservations where reservation_key=key;
  if existing_count>0 then
    select product_id,order_id into existing_product,existing_order
      from public.inventory_lot_reservations where reservation_key=key order by created_at,id limit 1;
    if exists(
      select 1 from public.inventory_lot_reservations
      where reservation_key=key
        and (product_id is distinct from existing_product or order_id is distinct from existing_order)
    ) then
      return jsonb_build_object('ok',false,'reason','reservation_key_corrupted','reservation_key',key,'side_effect_performed',false);
    end if;
    if existing_product is distinct from p_product_id or existing_order is distinct from p_order_id or existing_quantity<>p_quantity then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict','reservation_key',key,'side_effect_performed',false);
    end if;
    return jsonb_build_object('ok',true,'replay',true,'reservation_key',key,'reservation_count',existing_count,'reserved_quantity',existing_quantity,'side_effect_performed',false);
  end if;

  select * into cfg from public.commercial_runtime_config where id=1;
  if not cfg.enabled or not cfg.lot_reservations_enabled or not cfg.fefo_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'reason','fefo_reservations_disabled','side_effect_performed',false);
  end if;
  if p_order_id is not null and not exists(select 1 from public.orders where id=p_order_id) then return jsonb_build_object('ok',false,'reason','order_not_found','side_effect_performed',false); end if;
  preview:=public.preview_fefo_allocation_v1(p_product_id,p_quantity,p_delivery_date);
  if not coalesce((preview->>'sufficient')::boolean,false) then return preview||jsonb_build_object('ok',false,'reason','insufficient_fefo_stock'); end if;

  for item in select value from jsonb_array_elements(preview->'allocations')
  loop
    qty:=(item->>'quantity')::numeric;
    select * into lot from public.inventory_lots where id=(item->>'lot_id')::uuid for update;
    if not found or lot.status<>'available' or not lot.physically_verified or lot.expiry_handling='unknown' or lot.quantity_on_hand-lot.quantity_reserved<qty then
      raise exception 'fefo_allocation_race';
    end if;
    if lot.expiry_handling='known' and lot.expires_at<coalesce(p_delivery_date,current_date)+cfg.minimum_delivery_shelf_life_days then
      raise exception 'fefo_expiry_race';
    end if;
    update public.inventory_lots set quantity_reserved=quantity_reserved+qty,updated_at=now() where id=lot.id;
    insert into public.inventory_lot_reservations(order_id,product_id,lot_id,quantity,status,reservation_key,idempotency_key,delivery_date,metadata)
    values(p_order_id,p_product_id,lot.id,qty,'reserved',key,key||':'||lot.id::text,p_delivery_date,jsonb_build_object('strategy','FEFO')) returning id into r_id;
    insert into public.inventory_lot_movements(lot_id,product_id,movement_type,quantity,idempotency_key,reference_type,reference_id,before_quantity,after_quantity,actor_type,actor_id,metadata)
    values(lot.id,p_product_id,'reserve',qty,'reserve:'||r_id::text,'lot_reservation',r_id,lot.quantity_reserved,lot.quantity_reserved+qty,'order',p_actor_id,jsonb_build_object('reservation_key',key));
    reservations:=reservations||jsonb_build_array(jsonb_build_object('reservation_id',r_id,'lot_id',lot.id,'quantity',qty));
  end loop;
  return jsonb_build_object('ok',true,'replay',false,'reservation_key',key,'reservations',reservations,'side_effect_performed',true);
end;
$$;

revoke all on function public.reserve_inventory_lots_fefo_v1(uuid,uuid,numeric,text,date,uuid) from public,anon,authenticated;
grant execute on function public.reserve_inventory_lots_fefo_v1(uuid,uuid,numeric,text,date,uuid) to service_role;

commit;
