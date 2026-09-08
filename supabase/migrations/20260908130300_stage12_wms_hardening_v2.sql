begin;

-- Stage 12 WMS hardening v2.
-- Additive over stage12_commercial_truth_foundation_v1 + stage12_wms_fulfillment_v1.
-- No runtime is activated and no existing business data is mutated.

alter table public.fulfillment_runtime_config
  add column if not exists order_creation_enabled boolean not null default false,
  add column if not exists barcode_required boolean not null default true,
  add column if not exists lot_reservation_enabled boolean not null default false,
  add column if not exists lot_consumption_enabled boolean not null default false;

alter table public.warehouse_staff
  add column if not exists can_pick boolean not null default false,
  add column if not exists can_check boolean not null default false,
  add column if not exists can_pack boolean not null default false,
  add column if not exists can_load boolean not null default false,
  add column if not exists can_resolve_exceptions boolean not null default false;

alter table public.warehouse_locations
  add column if not exists barcode text null;
create unique index if not exists warehouse_locations_barcode_unique_idx on public.warehouse_locations(barcode) where barcode is not null;

alter table public.fulfillment_orders
  add column if not exists packer_id uuid null references public.warehouse_staff(id) on delete set null,
  add column if not exists idempotency_key text null;
create unique index if not exists fulfillment_orders_idempotency_unique_idx on public.fulfillment_orders(idempotency_key) where idempotency_key is not null;

alter table public.fulfillment_items
  add column if not exists sku_snapshot text null,
  add column if not exists name_snapshot text null,
  add column if not exists location_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists lot_snapshot jsonb not null default '{}'::jsonb;

alter table public.fulfillment_items drop constraint if exists fulfillment_items_fulfillment_order_id_order_item_id_key;
create unique index if not exists fulfillment_item_no_lot_unique_idx on public.fulfillment_items(fulfillment_order_id,order_item_id) where lot_id is null;
create unique index if not exists fulfillment_item_lot_unique_idx on public.fulfillment_items(fulfillment_order_id,order_item_id,lot_id) where lot_id is not null;

alter table public.fulfillment_items drop constraint if exists fulfillment_items_status_check;
alter table public.fulfillment_items add constraint fulfillment_items_status_check check(status in ('pending','picking','picked','checking','checked','short','wrong_item','exception','cancelled'));

alter table public.fulfillment_scan_events
  add column if not exists quantity numeric(14,3) not null default 1 check(quantity>0),
  add column if not exists device_id text null;

alter table public.fulfillment_scan_events drop constraint if exists fulfillment_scan_events_phase_check;
alter table public.fulfillment_scan_events add constraint fulfillment_scan_events_phase_check check(phase in ('picking','checking','packing','loading'));
alter table public.fulfillment_scan_events drop constraint if exists fulfillment_scan_events_result_check;
alter table public.fulfillment_scan_events add constraint fulfillment_scan_events_result_check check(result in ('accepted','wrong_item','excess','unknown','manual_override','blocked'));

create table if not exists public.fulfillment_exceptions (
  id uuid primary key default gen_random_uuid(),
  fulfillment_order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  fulfillment_item_id uuid null references public.fulfillment_items(id) on delete set null,
  type text not null check(type in ('shortage','wrong_item','excess','lot_shortage','lot_expired','location_missing','barcode_missing','checker_conflict','package_mismatch','route_mismatch','other')),
  status text not null default 'open' check(status in ('open','resolved','cancelled')),
  detail jsonb not null default '{}'::jsonb,
  opened_by uuid null references public.warehouse_staff(id) on delete set null,
  resolved_by uuid null references public.warehouse_staff(id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz null
);
alter table public.fulfillment_exceptions enable row level security;
create index if not exists fulfillment_exceptions_open_idx on public.fulfillment_exceptions(fulfillment_order_id,status,opened_at);

create table if not exists public.fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  fulfillment_order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  event_type text not null,
  staff_id uuid null references public.warehouse_staff(id) on delete set null,
  client_event_id text null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.fulfillment_events enable row level security;

alter table public.order_packages
  add column if not exists packed_by uuid null references public.warehouse_staff(id) on delete set null,
  add column if not exists packed_at timestamptz null,
  add column if not exists loaded_route_id uuid null references public.delivery_routes(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();
alter table public.order_packages drop constraint if exists order_packages_status_check;
alter table public.order_packages add constraint order_packages_status_check check(status in ('packed','loaded','delivered','returned','cancelled'));

create or replace view public.product_pick_location_v2 as
select p.id product_id,p.sku,p.gtin,p.name,
       wl.id location_id,
       coalesce(wl.code,nullif(concat_ws('-',nullif(trim(p.gondola),''),nullif(trim(p.shelf),'')),'')) location_code,
       coalesce(wl.gondola_code,nullif(trim(p.gondola),'')) gondola_code,
       coalesce(wl.shelf_code,nullif(trim(p.shelf),'')) shelf_code,
       coalesce(wl.pick_sequence,100000) pick_sequence,
       case when pla.id is not null then 'normalized_assignment'
            when nullif(trim(p.gondola),'') is not null or nullif(trim(p.shelf),'') is not null then 'legacy_product_fields'
            else 'missing' end location_source
from public.products p
left join public.product_location_assignments pla on pla.product_id=p.id and pla.active and pla.is_primary
left join public.warehouse_locations wl on wl.id=pla.location_id and wl.active;

create or replace function public.warehouse_staff_context_v1(p_auth_user_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
select case when s.id is null then jsonb_build_object('ok',false,'error','staff_not_found')
 else jsonb_build_object('ok',true,'staff_id',s.id,'display_name',s.display_name,'role',s.role,'status',s.status,'can_pick',s.can_pick,'can_check',s.can_check,'can_pack',s.can_pack,'can_load',s.can_load,'can_resolve_exceptions',s.can_resolve_exceptions) end
from (select 1) x left join public.warehouse_staff s on s.auth_user_id=p_auth_user_id;
$$;

create or replace function public.reserve_inventory_lot_v1(p_lot_id uuid,p_quantity numeric,p_reference_type text,p_reference_id text,p_idempotency_key text,p_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.commercial_truth_runtime_config%rowtype; l public.inventory_lots%rowtype; prior uuid;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if not cfg.enabled or not cfg.lot_tracking_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','lot_tracking_disabled','side_effect_performed',false,'external_side_effect',false); end if;
  if p_quantity is null or p_quantity<=0 or length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_reservation_payload','side_effect_performed',false); end if;
  select id into prior from public.inventory_lot_movements where idempotency_key=trim(p_idempotency_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'movement_id',prior,'side_effect_performed',false,'external_side_effect',false); end if;
  select * into l from public.inventory_lots where id=p_lot_id for update;
  if not found then return jsonb_build_object('ok',false,'error','lot_not_found','side_effect_performed',false); end if;
  if l.status<>'available' or not l.physically_verified then return jsonb_build_object('ok',false,'error','lot_not_reservable','lot_status',l.status,'side_effect_performed',false); end if;
  if l.expires_at is not null and l.expires_at<(now() at time zone 'America/Cuiaba')::date then return jsonb_build_object('ok',false,'error','lot_expired','side_effect_performed',false); end if;
  if (l.quantity_available-l.quantity_reserved)<p_quantity then return jsonb_build_object('ok',false,'error','lot_insufficient_free_quantity','free_quantity',l.quantity_available-l.quantity_reserved,'side_effect_performed',false); end if;
  update public.inventory_lots set quantity_reserved=quantity_reserved+p_quantity,updated_at=now() where id=l.id;
  insert into public.inventory_lot_movements(lot_id,product_id,movement_type,quantity,reference_type,reference_id,idempotency_key,actor_type,actor_id)
  values(l.id,l.product_id,'reserve',p_quantity,nullif(trim(coalesce(p_reference_type,'')),''),nullif(trim(coalesce(p_reference_id,'')),''),trim(p_idempotency_key),'warehouse',p_actor_id) returning id into prior;
  return jsonb_build_object('ok',true,'replay',false,'movement_id',prior,'lot_id',l.id,'reserved_quantity',p_quantity,'side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.release_inventory_lot_v1(p_lot_id uuid,p_quantity numeric,p_reference_type text,p_reference_id text,p_idempotency_key text,p_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.commercial_truth_runtime_config%rowtype; l public.inventory_lots%rowtype; prior uuid;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if not cfg.enabled or not cfg.lot_tracking_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','lot_tracking_disabled','side_effect_performed',false,'external_side_effect',false); end if;
  if p_quantity is null or p_quantity<=0 or length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_release_payload','side_effect_performed',false); end if;
  select id into prior from public.inventory_lot_movements where idempotency_key=trim(p_idempotency_key);if found then return jsonb_build_object('ok',true,'replay',true,'movement_id',prior,'side_effect_performed',false,'external_side_effect',false); end if;
  select * into l from public.inventory_lots where id=p_lot_id for update;if not found then return jsonb_build_object('ok',false,'error','lot_not_found','side_effect_performed',false); end if;
  if l.quantity_reserved<p_quantity then return jsonb_build_object('ok',false,'error','release_exceeds_reserved','reserved_quantity',l.quantity_reserved,'side_effect_performed',false); end if;
  update public.inventory_lots set quantity_reserved=quantity_reserved-p_quantity,updated_at=now() where id=l.id;
  insert into public.inventory_lot_movements(lot_id,product_id,movement_type,quantity,reference_type,reference_id,idempotency_key,actor_type,actor_id) values(l.id,l.product_id,'release',p_quantity,nullif(trim(coalesce(p_reference_type,'')),''),nullif(trim(coalesce(p_reference_id,'')),''),trim(p_idempotency_key),'warehouse',p_actor_id) returning id into prior;
  return jsonb_build_object('ok',true,'replay',false,'movement_id',prior,'lot_id',l.id,'released_quantity',p_quantity,'side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.consume_inventory_lot_v1(p_lot_id uuid,p_quantity numeric,p_reference_type text,p_reference_id text,p_idempotency_key text,p_actor_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.commercial_truth_runtime_config%rowtype; fcfg public.fulfillment_runtime_config%rowtype; l public.inventory_lots%rowtype; prior uuid;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;select * into fcfg from public.fulfillment_runtime_config where id=1;
  if not cfg.enabled or not cfg.lot_tracking_enabled or cfg.execution_mode not in ('homologation','canary','live') or not fcfg.lot_consumption_enabled then return jsonb_build_object('ok',false,'error','lot_consumption_disabled','side_effect_performed',false,'external_side_effect',false); end if;
  if p_quantity is null or p_quantity<=0 or length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_consume_payload','side_effect_performed',false); end if;
  select id into prior from public.inventory_lot_movements where idempotency_key=trim(p_idempotency_key);if found then return jsonb_build_object('ok',true,'replay',true,'movement_id',prior,'side_effect_performed',false,'external_side_effect',false); end if;
  select * into l from public.inventory_lots where id=p_lot_id for update;if not found then return jsonb_build_object('ok',false,'error','lot_not_found','side_effect_performed',false); end if;
  if l.quantity_reserved<p_quantity or l.quantity_available<p_quantity then return jsonb_build_object('ok',false,'error','consume_exceeds_reserved_or_available','side_effect_performed',false); end if;
  update public.inventory_lots set quantity_reserved=quantity_reserved-p_quantity,quantity_available=quantity_available-p_quantity,status=case when quantity_available-p_quantity=0 then 'depleted' else status end,updated_at=now() where id=l.id;
  insert into public.inventory_lot_movements(lot_id,product_id,movement_type,quantity,reference_type,reference_id,idempotency_key,actor_type,actor_id) values(l.id,l.product_id,'consume',p_quantity,nullif(trim(coalesce(p_reference_type,'')),''),nullif(trim(coalesce(p_reference_id,'')),''),trim(p_idempotency_key),'warehouse',p_actor_id) returning id into prior;
  return jsonb_build_object('ok',true,'replay',false,'movement_id',prior,'lot_id',l.id,'consumed_quantity',p_quantity,'side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.preview_fulfillment_from_order_v2(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.orders%rowtype; lines integer; missing_barcode integer; missing_location integer; fefo_shortages integer:=0; rec record; f jsonb;
begin
  select * into o from public.orders where id=p_order_id;if not found then return jsonb_build_object('ok',false,'error','order_not_found','external_side_effect',false); end if;
  if o.status not in ('confirmed','sent_to_bling','processing') then return jsonb_build_object('ok',false,'error','order_not_eligible','order_status',o.status,'external_side_effect',false); end if;
  select count(*) into lines from public.order_items where order_id=o.id and product_id is not null and quantity>0;
  select count(*) into missing_barcode from public.order_items oi join public.products p on p.id=oi.product_id where oi.order_id=o.id and nullif(trim(coalesce(p.gtin,'')),'') is null;
  select count(*) into missing_location from public.order_items oi join public.product_pick_location_v2 l on l.product_id=oi.product_id where oi.order_id=o.id and l.location_source='missing';
  for rec in select product_id,quantity from public.order_items where order_id=o.id and product_id is not null and quantity>0 loop f:=public.preview_fefo_allocation_v1(rec.product_id,rec.quantity,(now() at time zone 'America/Cuiaba')::date,0);if coalesce((f->>'sufficient')::boolean,false)=false then fefo_shortages:=fefo_shortages+1;end if;end loop;
  return jsonb_build_object('ok',lines>0,'order_id',o.id,'line_count',lines,'missing_barcode_lines',missing_barcode,'missing_location_lines',missing_location,'fefo_shortage_lines',fefo_shortages,'requires_review',(lines=0 or missing_barcode>0 or missing_location>0),'external_side_effect',false);
end;$$;

create or replace function public.create_fulfillment_from_order_v2(p_order_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; o public.orders%rowtype; existing uuid; f_id uuid; oi record; loc record; fefo jsonb; line jsonb; created_items integer:=0;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;
  if not cfg.enabled or not cfg.order_creation_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','fulfillment_creation_disabled','side_effect_performed',false,'external_side_effect',false); end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','side_effect_performed',false); end if;
  select id into existing from public.fulfillment_orders where order_id=p_order_id or idempotency_key=trim(p_idempotency_key) limit 1;if found then return jsonb_build_object('ok',true,'replay',true,'fulfillment_order_id',existing,'side_effect_performed',false,'external_side_effect',false); end if;
  select * into o from public.orders where id=p_order_id for update;if not found then return jsonb_build_object('ok',false,'error','order_not_found','side_effect_performed',false);end if;
  if o.status not in ('confirmed','sent_to_bling','processing') then return jsonb_build_object('ok',false,'error','order_not_eligible','order_status',o.status,'side_effect_performed',false);end if;
  if cfg.fefo_enforced then for oi in select product_id,quantity from public.order_items where order_id=o.id and product_id is not null and quantity>0 loop fefo:=public.preview_fefo_allocation_v1(oi.product_id,oi.quantity,(now() at time zone 'America/Cuiaba')::date,0);if coalesce((fefo->>'sufficient')::boolean,false)=false then return jsonb_build_object('ok',false,'error','fefo_shortage','product_id',oi.product_id,'shortage',fefo->'shortage','side_effect_performed',false,'external_side_effect',false);end if;end loop;end if;
  insert into public.fulfillment_orders(order_id,idempotency_key) values(o.id,trim(p_idempotency_key)) returning id into f_id;
  for oi in select oi.*,p.gtin,p.sku,p.name from public.order_items oi join public.products p on p.id=oi.product_id where oi.order_id=o.id and oi.quantity>0 order by oi.id loop
    select * into loc from public.product_pick_location_v2 where product_id=oi.product_id;
    if cfg.barcode_required and nullif(trim(coalesce(oi.gtin,'')),'') is null then raise exception 'barcode_missing_for_product:%',oi.product_id; end if;
    if loc.location_source='missing' then raise exception 'location_missing_for_product:%',oi.product_id; end if;
    if cfg.fefo_enforced then fefo:=public.preview_fefo_allocation_v1(oi.product_id,oi.quantity,(now() at time zone 'America/Cuiaba')::date,0);for line in select value from jsonb_array_elements(coalesce(fefo->'lines','[]'::jsonb)) loop insert into public.fulfillment_items(fulfillment_order_id,order_item_id,product_id,expected_quantity,expected_gtin,sku_snapshot,name_snapshot,location_id,location_snapshot,lot_id,lot_snapshot,pick_sequence) values(f_id,oi.id,oi.product_id,(line->>'quantity')::numeric,oi.gtin,coalesce(oi.sku_snapshot,oi.sku),coalesce(oi.name_snapshot,oi.name),loc.location_id,jsonb_build_object('code',loc.location_code,'gondola',loc.gondola_code,'shelf',loc.shelf_code,'source',loc.location_source),(line->>'lot_id')::uuid,jsonb_build_object('lot_code',line->>'lot_code','expires_at',line->>'expires_at'),loc.pick_sequence);created_items:=created_items+1;end loop;
    else insert into public.fulfillment_items(fulfillment_order_id,order_item_id,product_id,expected_quantity,expected_gtin,sku_snapshot,name_snapshot,location_id,location_snapshot,pick_sequence) values(f_id,oi.id,oi.product_id,oi.quantity,oi.gtin,coalesce(oi.sku_snapshot,oi.sku),coalesce(oi.name_snapshot,oi.name),loc.location_id,jsonb_build_object('code',loc.location_code,'gondola',loc.gondola_code,'shelf',loc.shelf_code,'source',loc.location_source),loc.pick_sequence);created_items:=created_items+1;end if;
  end loop;
  if created_items=0 then raise exception 'fulfillment_order_without_items';end if;
  insert into public.fulfillment_events(fulfillment_order_id,event_type,payload) values(f_id,'FULFILLMENT_CREATED',jsonb_build_object('items',created_items,'fefo_enforced',cfg.fefo_enforced));
  return jsonb_build_object('ok',true,'replay',false,'fulfillment_order_id',f_id,'items',created_items,'side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.start_fulfillment_picking_v2(p_fulfillment_order_id uuid,p_staff_id uuid,p_client_event_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; f public.fulfillment_orders%rowtype; s public.warehouse_staff%rowtype;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;if not cfg.enabled or not cfg.picking_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','picking_disabled','side_effect_performed',false);end if;
  select * into s from public.warehouse_staff where id=p_staff_id and status in ('available','busy') and can_pick=true;if not found then return jsonb_build_object('ok',false,'error','picker_not_authorized','side_effect_performed',false);end if;
  select * into f from public.fulfillment_orders where id=p_fulfillment_order_id for update;if not found then return jsonb_build_object('ok',false,'error','fulfillment_order_not_found','side_effect_performed',false);end if;
  if f.status='picking' and f.picker_id=p_staff_id then return jsonb_build_object('ok',true,'replay',true,'status','picking','side_effect_performed',false);end if;if f.status<>'pending' then return jsonb_build_object('ok',false,'error','invalid_fulfillment_state','status',f.status,'side_effect_performed',false);end if;
  update public.fulfillment_orders set status='picking',picker_id=p_staff_id,started_picking_at=now(),updated_at=now() where id=f.id;update public.warehouse_staff set status='busy',updated_at=now() where id=s.id;insert into public.fulfillment_events(fulfillment_order_id,event_type,staff_id,client_event_id) values(f.id,'PICKING_STARTED',s.id,p_client_event_id) on conflict(client_event_id) do nothing;return jsonb_build_object('ok',true,'status','picking','side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.scan_fulfillment_item_v2(p_fulfillment_order_id uuid,p_staff_id uuid,p_phase text,p_barcode text,p_quantity numeric,p_client_event_id text,p_device_id text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; f public.fulfillment_orders%rowtype; s public.warehouse_staff%rowtype; i public.fulfillment_items%rowtype; prior uuid; phase text:=lower(trim(coalesce(p_phase,''))); code text:=trim(coalesce(p_barcode,'')); qty numeric:=coalesce(p_quantity,1); new_qty numeric;
begin
  if phase not in ('picking','checking') or code='' or qty<=0 or length(trim(coalesce(p_client_event_id,'')))<8 then return jsonb_build_object('ok',false,'error','invalid_scan_payload','side_effect_performed',false);end if;select id into prior from public.fulfillment_scan_events where client_event_id=p_client_event_id;if found then return jsonb_build_object('ok',true,'replay',true,'event_id',prior,'side_effect_performed',false);end if;
  select * into cfg from public.fulfillment_runtime_config where id=1;if not cfg.enabled or cfg.execution_mode not in ('homologation','canary','live') or (phase='picking' and not cfg.picking_enabled) or (phase='checking' and not cfg.checking_enabled) then return jsonb_build_object('ok',false,'error','scan_phase_disabled','side_effect_performed',false);end if;
  select * into s from public.warehouse_staff where id=p_staff_id and status in ('available','busy');if not found or (phase='picking' and not s.can_pick) or (phase='checking' and not s.can_check) then return jsonb_build_object('ok',false,'error','staff_not_authorized_for_phase','side_effect_performed',false);end if;
  select * into f from public.fulfillment_orders where id=p_fulfillment_order_id for update;if not found then return jsonb_build_object('ok',false,'error','fulfillment_order_not_found','side_effect_performed',false);end if;if phase='picking' and (f.status<>'picking' or f.picker_id is distinct from s.id) then return jsonb_build_object('ok',false,'error','picker_not_owner','side_effect_performed',false);end if;if phase='checking' and f.status not in ('picked','checking') then return jsonb_build_object('ok',false,'error','checking_not_available','side_effect_performed',false);end if;if phase='checking' and cfg.require_independent_checker and f.picker_id=s.id then return jsonb_build_object('ok',false,'error','independent_checker_required','side_effect_performed',false);end if;
  select fi.* into i from public.fulfillment_items fi join public.products p on p.id=fi.product_id where fi.fulfillment_order_id=f.id and (coalesce(fi.expected_gtin,'')=code or coalesce(p.gtin,'')=code or p.sku=code) and (case when phase='picking' then fi.picked_quantity<fi.expected_quantity else fi.checked_quantity<fi.expected_quantity end) order by fi.pick_sequence,fi.id limit 1 for update of fi;
  if not found then insert into public.fulfillment_scan_events(fulfillment_order_id,staff_id,phase,barcode,quantity,result,client_event_id,device_id) values(f.id,s.id,phase,code,qty,'wrong_item',p_client_event_id,p_device_id) returning id into prior;insert into public.fulfillment_exceptions(fulfillment_order_id,type,detail,opened_by) values(f.id,'wrong_item',jsonb_build_object('barcode',code,'phase',phase),s.id);return jsonb_build_object('ok',false,'error','wrong_item','event_id',prior,'side_effect_performed',true,'external_side_effect',false);end if;
  new_qty:=case when phase='picking' then i.picked_quantity+qty else i.checked_quantity+qty end;if new_qty>i.expected_quantity then insert into public.fulfillment_scan_events(fulfillment_order_id,fulfillment_item_id,staff_id,phase,barcode,quantity,result,client_event_id,device_id) values(f.id,i.id,s.id,phase,code,qty,'excess',p_client_event_id,p_device_id) returning id into prior;insert into public.fulfillment_exceptions(fulfillment_order_id,fulfillment_item_id,type,detail,opened_by) values(f.id,i.id,'excess',jsonb_build_object('barcode',code,'phase',phase,'quantity',qty),s.id);return jsonb_build_object('ok',false,'error','quantity_exceeded','event_id',prior,'side_effect_performed',true,'external_side_effect',false);end if;
  if phase='picking' then update public.fulfillment_items set picked_quantity=new_qty,status=case when new_qty=expected_quantity then 'picked' else 'picking' end,updated_at=now() where id=i.id;else if i.picked_quantity<>i.expected_quantity then return jsonb_build_object('ok',false,'error','item_not_fully_picked','side_effect_performed',false);end if;update public.fulfillment_items set checked_quantity=new_qty,status=case when new_qty=expected_quantity then 'checked' else 'checking' end,updated_at=now() where id=i.id;update public.fulfillment_orders set status='checking',checker_id=coalesce(checker_id,s.id),checking_started_at=coalesce(checking_started_at,now()),updated_at=now() where id=f.id;end if;
  insert into public.fulfillment_scan_events(fulfillment_order_id,fulfillment_item_id,staff_id,phase,barcode,quantity,result,client_event_id,device_id) values(f.id,i.id,s.id,phase,code,qty,'accepted',p_client_event_id,p_device_id) returning id into prior;return jsonb_build_object('ok',true,'replay',false,'event_id',prior,'fulfillment_item_id',i.id,'quantity_progress',new_qty,'expected_quantity',i.expected_quantity,'item_complete',new_qty=i.expected_quantity,'side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.finalize_fulfillment_phase_v2(p_fulfillment_order_id uuid,p_staff_id uuid,p_phase text,p_client_event_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; f public.fulfillment_orders%rowtype; missing integer; open_ex integer; phase text:=lower(trim(coalesce(p_phase,'')));
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;select * into f from public.fulfillment_orders where id=p_fulfillment_order_id for update;if not found then return jsonb_build_object('ok',false,'error','fulfillment_order_not_found','side_effect_performed',false);end if;select count(*) into open_ex from public.fulfillment_exceptions where fulfillment_order_id=f.id and status='open';if open_ex>0 then return jsonb_build_object('ok',false,'error','open_fulfillment_exceptions','count',open_ex,'side_effect_performed',false);end if;
  if phase='picking' then if not cfg.enabled or not cfg.picking_enabled or f.status<>'picking' or f.picker_id is distinct from p_staff_id then return jsonb_build_object('ok',false,'error','picking_completion_not_allowed','side_effect_performed',false);end if;select count(*) into missing from public.fulfillment_items where fulfillment_order_id=f.id and picked_quantity<>expected_quantity;if missing>0 then return jsonb_build_object('ok',false,'error','picking_incomplete','missing_items',missing,'side_effect_performed',false);end if;update public.fulfillment_orders set status='picked',picked_at=now(),updated_at=now() where id=f.id;update public.warehouse_staff set status='available',updated_at=now() where id=p_staff_id;insert into public.fulfillment_events(fulfillment_order_id,event_type,staff_id,client_event_id) values(f.id,'PICKING_COMPLETED',p_staff_id,p_client_event_id) on conflict(client_event_id) do nothing;return jsonb_build_object('ok',true,'status','picked','side_effect_performed',true,'external_side_effect',false);
  elsif phase='checking' then if not cfg.enabled or not cfg.checking_enabled or f.status<>'checking' or f.checker_id is distinct from p_staff_id then return jsonb_build_object('ok',false,'error','checking_completion_not_allowed','side_effect_performed',false);end if;if cfg.require_independent_checker and f.picker_id=p_staff_id then return jsonb_build_object('ok',false,'error','independent_checker_required','side_effect_performed',false);end if;select count(*) into missing from public.fulfillment_items where fulfillment_order_id=f.id and checked_quantity<>expected_quantity;if missing>0 then return jsonb_build_object('ok',false,'error','checking_incomplete','missing_items',missing,'side_effect_performed',false);end if;update public.fulfillment_orders set status='checked',checked_at=now(),updated_at=now() where id=f.id;update public.warehouse_staff set status='available',updated_at=now() where id=p_staff_id;insert into public.fulfillment_events(fulfillment_order_id,event_type,staff_id,client_event_id) values(f.id,'CHECKING_COMPLETED',p_staff_id,p_client_event_id) on conflict(client_event_id) do nothing;return jsonb_build_object('ok',true,'status','checked','side_effect_performed',true,'external_side_effect',false);end if;return jsonb_build_object('ok',false,'error','invalid_phase','side_effect_performed',false);
end;$$;

create or replace function public.pack_fulfillment_order_v2(p_fulfillment_order_id uuid,p_staff_id uuid,p_package_no integer,p_package_count integer,p_barcode text,p_client_event_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; f public.fulfillment_orders%rowtype; s public.warehouse_staff%rowtype; pid uuid;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;if not cfg.enabled or not cfg.packing_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','packing_disabled','side_effect_performed',false);end if;select * into s from public.warehouse_staff where id=p_staff_id and status in ('available','busy') and can_pack=true;if not found then return jsonb_build_object('ok',false,'error','packer_not_authorized','side_effect_performed',false);end if;select * into f from public.fulfillment_orders where id=p_fulfillment_order_id for update;if not found or f.status not in ('checked','packing','packed') then return jsonb_build_object('ok',false,'error','order_not_checked','side_effect_performed',false);end if;if p_package_no<=0 or p_package_count<=0 or p_package_no>p_package_count or length(trim(coalesce(p_barcode,'')))<6 then return jsonb_build_object('ok',false,'error','invalid_package_payload','side_effect_performed',false);end if;
  insert into public.order_packages(fulfillment_order_id,package_no,package_count,barcode,status,packed_by,packed_at) values(f.id,p_package_no,p_package_count,trim(p_barcode),'packed',s.id,now()) on conflict(fulfillment_order_id,package_no) do update set package_count=excluded.package_count,barcode=excluded.barcode,status='packed',packed_by=excluded.packed_by,packed_at=excluded.packed_at,updated_at=now() returning id into pid;update public.fulfillment_orders set status='packed',packer_id=s.id,packed_at=now(),updated_at=now() where id=f.id;insert into public.fulfillment_events(fulfillment_order_id,event_type,staff_id,client_event_id,payload) values(f.id,'PACKAGE_SEALED',s.id,p_client_event_id,jsonb_build_object('package_id',pid,'package_no',p_package_no,'package_count',p_package_count)) on conflict(client_event_id) do nothing;return jsonb_build_object('ok',true,'package_id',pid,'status','packed','side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.release_fulfillment_ready_v2(p_fulfillment_order_id uuid,p_staff_id uuid,p_client_event_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; f public.fulfillment_orders%rowtype; incomplete integer; open_ex integer; pkg integer; pkg_expected integer; order_status text;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;if not cfg.enabled or not cfg.ready_release_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','ready_release_disabled','side_effect_performed',false,'external_side_effect',false);end if;select * into f from public.fulfillment_orders where id=p_fulfillment_order_id for update;if not found then return jsonb_build_object('ok',false,'error','fulfillment_order_not_found','side_effect_performed',false);end if;select count(*) into incomplete from public.fulfillment_items where fulfillment_order_id=f.id and (picked_quantity<>expected_quantity or checked_quantity<>expected_quantity);select count(*) into open_ex from public.fulfillment_exceptions where fulfillment_order_id=f.id and status='open';select count(*),coalesce(max(package_count),0) into pkg,pkg_expected from public.order_packages where fulfillment_order_id=f.id and status='packed';if f.status<>'packed' or incomplete>0 or open_ex>0 or pkg=0 or pkg<>pkg_expected then return jsonb_build_object('ok',false,'error','fulfillment_not_ready','status',f.status,'incomplete_items',incomplete,'open_exceptions',open_ex,'packed_packages',pkg,'expected_packages',pkg_expected,'side_effect_performed',false,'external_side_effect',false);end if;select status into order_status from public.orders where id=f.order_id for update;if order_status not in ('confirmed','sent_to_bling','processing') then return jsonb_build_object('ok',false,'error','commercial_order_state_changed','order_status',order_status,'side_effect_performed',false);end if;update public.fulfillment_orders set status='ready',ready_at=now(),updated_at=now() where id=f.id;update public.orders set status='ready',updated_at=now() where id=f.order_id;insert into public.fulfillment_events(fulfillment_order_id,event_type,staff_id,client_event_id,payload) values(f.id,'ORDER_RELEASED_READY',p_staff_id,p_client_event_id,jsonb_build_object('packages',pkg)) on conflict(client_event_id) do nothing;return jsonb_build_object('ok',true,'status','ready','order_status','ready','packages',pkg,'side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.load_order_package_to_route_v1(p_route_id uuid,p_package_barcode text,p_staff_id uuid,p_client_event_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; lcfg public.logistics_runtime_config%rowtype; s public.warehouse_staff%rowtype; r public.delivery_routes%rowtype; pkg public.order_packages%rowtype; fo public.fulfillment_orders%rowtype; dj public.delivery_jobs%rowtype; stop_count integer; prior uuid; remaining integer;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;select * into lcfg from public.logistics_runtime_config where id=1;
  if not cfg.enabled or not cfg.loading_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','loading_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  if not lcfg.enabled or lcfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','logistics_runtime_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  select id into prior from public.fulfillment_scan_events where client_event_id=p_client_event_id;if found then return jsonb_build_object('ok',true,'replay',true,'event_id',prior,'side_effect_performed',false);end if;
  select * into s from public.warehouse_staff where id=p_staff_id and status in ('available','busy') and can_load=true;if not found then return jsonb_build_object('ok',false,'error','loader_not_authorized','side_effect_performed',false);end if;
  select * into r from public.delivery_routes where id=p_route_id for update;if not found or r.status not in ('published','active') then return jsonb_build_object('ok',false,'error','route_not_loadable','side_effect_performed',false);end if;
  select * into pkg from public.order_packages where barcode=trim(coalesce(p_package_barcode,'')) for update;if not found then return jsonb_build_object('ok',false,'error','package_not_found','side_effect_performed',false);end if;
  select * into fo from public.fulfillment_orders where id=pkg.fulfillment_order_id for update;if fo.status not in ('ready','loading','loaded') then return jsonb_build_object('ok',false,'error','fulfillment_not_ready_for_loading','status',fo.status,'side_effect_performed',false);end if;
  select * into dj from public.delivery_jobs where order_id=fo.order_id and status in ('waiting_route','planned','assigned','out_for_delivery') order by attempt_no desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','delivery_job_missing','side_effect_performed',false);end if;
  select count(*) into stop_count from public.delivery_stops where route_id=r.id and delivery_job_id=dj.id;if stop_count<>1 then insert into public.fulfillment_exceptions(fulfillment_order_id,type,detail,opened_by) values(fo.id,'route_mismatch',jsonb_build_object('route_id',r.id,'delivery_job_id',dj.id,'matching_stops',stop_count),s.id);return jsonb_build_object('ok',false,'error','package_route_mismatch','side_effect_performed',true,'external_side_effect',false);end if;
  update public.order_packages set status='loaded',loaded_at=now(),loaded_route_id=r.id,updated_at=now() where id=pkg.id;update public.fulfillment_orders set status='loading',loader_id=s.id,updated_at=now() where id=fo.id;
  insert into public.fulfillment_scan_events(fulfillment_order_id,staff_id,phase,barcode,quantity,result,client_event_id) values(fo.id,s.id,'loading',pkg.barcode,1,'accepted',p_client_event_id) returning id into prior;
  select count(*) into remaining from public.order_packages where fulfillment_order_id=fo.id and status='packed';if remaining=0 then update public.fulfillment_orders set status='loaded',loaded_at=now(),updated_at=now() where id=fo.id;insert into public.fulfillment_events(fulfillment_order_id,event_type,staff_id,payload) values(fo.id,'ORDER_LOADED',s.id,jsonb_build_object('route_id',r.id));end if;
  return jsonb_build_object('ok',true,'event_id',prior,'package_id',pkg.id,'route_id',r.id,'order_loaded',remaining=0,'side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.fulfillment_snapshot_v2(p_fulfillment_order_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
select jsonb_build_object('order',(select to_jsonb(f) from public.fulfillment_orders f where f.id=p_fulfillment_order_id),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.pick_sequence,i.id) from public.fulfillment_items i where i.fulfillment_order_id=p_fulfillment_order_id),'[]'::jsonb),'packages',coalesce((select jsonb_agg(to_jsonb(p) order by p.package_no) from public.order_packages p where p.fulfillment_order_id=p_fulfillment_order_id),'[]'::jsonb),'open_exceptions',coalesce((select jsonb_agg(to_jsonb(e) order by e.opened_at) from public.fulfillment_exceptions e where e.fulfillment_order_id=p_fulfillment_order_id and e.status='open'),'[]'::jsonb));$$;

create or replace function public.preview_legacy_location_drafts_v1()
returns jsonb language sql security definer set search_path=public,pg_temp as $$
select jsonb_build_object('ok',true,'draft_only',true,'external_side_effect',false,'locations',coalesce(jsonb_agg(x order by (x->>'gondola'),(x->>'shelf')),'[]'::jsonb)) from (
 select distinct jsonb_build_object('code',concat_ws('-',nullif(trim(gondola),''),nullif(trim(shelf),'')),'gondola',nullif(trim(gondola),''),'shelf',nullif(trim(shelf),''),'active',false) x
 from public.products where nullif(trim(gondola),'') is not null or nullif(trim(shelf),'') is not null
) q;$$;

-- All new/extended WMS objects remain server-only.
revoke all on table public.fulfillment_exceptions,public.fulfillment_events from public,anon,authenticated;
grant select,insert,update,delete on table public.fulfillment_exceptions,public.fulfillment_events to service_role;
revoke all on public.product_pick_location_v2 from public,anon,authenticated;grant select on public.product_pick_location_v2 to service_role;

revoke all on function public.warehouse_staff_context_v1(uuid) from public,anon,authenticated;
revoke all on function public.reserve_inventory_lot_v1(uuid,numeric,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.release_inventory_lot_v1(uuid,numeric,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.consume_inventory_lot_v1(uuid,numeric,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.preview_fulfillment_from_order_v2(uuid) from public,anon,authenticated;
revoke all on function public.create_fulfillment_from_order_v2(uuid,text) from public,anon,authenticated;
revoke all on function public.start_fulfillment_picking_v2(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.scan_fulfillment_item_v2(uuid,uuid,text,text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.finalize_fulfillment_phase_v2(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.pack_fulfillment_order_v2(uuid,uuid,integer,integer,text,text) from public,anon,authenticated;
revoke all on function public.release_fulfillment_ready_v2(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.load_order_package_to_route_v1(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.fulfillment_snapshot_v2(uuid) from public,anon,authenticated;
revoke all on function public.preview_legacy_location_drafts_v1() from public,anon,authenticated;

grant execute on function public.warehouse_staff_context_v1(uuid),public.reserve_inventory_lot_v1(uuid,numeric,text,text,text,uuid),public.release_inventory_lot_v1(uuid,numeric,text,text,text,uuid),public.consume_inventory_lot_v1(uuid,numeric,text,text,text,uuid),public.preview_fulfillment_from_order_v2(uuid),public.create_fulfillment_from_order_v2(uuid,text),public.start_fulfillment_picking_v2(uuid,uuid,text),public.scan_fulfillment_item_v2(uuid,uuid,text,text,numeric,text,text),public.finalize_fulfillment_phase_v2(uuid,uuid,text,text),public.pack_fulfillment_order_v2(uuid,uuid,integer,integer,text,text),public.release_fulfillment_ready_v2(uuid,uuid,text),public.load_order_package_to_route_v1(uuid,text,uuid,text),public.fulfillment_snapshot_v2(uuid),public.preview_legacy_location_drafts_v1() to service_role;

commit;
