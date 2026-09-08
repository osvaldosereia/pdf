begin;

-- Stage 12A/12B/12C: lot/expiry truth + lightweight WMS/fulfillment.
-- Everything is server-only and OFF by default. No existing product/order data is mutated.

create table if not exists public.fulfillment_runtime_config (
  id smallint primary key default 1 check (id=1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  order_creation_enabled boolean not null default false,
  picking_enabled boolean not null default false,
  checking_enabled boolean not null default false,
  packaging_enabled boolean not null default false,
  loading_enabled boolean not null default false,
  ready_release_enabled boolean not null default false,
  require_independent_checker boolean not null default true,
  barcode_required boolean not null default true,
  fefo_required boolean not null default true,
  allow_manual_barcode_override boolean not null default false,
  canary_percent smallint not null default 0 check (canary_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid null
);
insert into public.fulfillment_runtime_config(id) values(1) on conflict(id) do nothing;
alter table public.fulfillment_runtime_config enable row level security;

create table if not exists public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  zone_code text null,
  gondola_code text not null,
  shelf_code text not null,
  position_code text null,
  pick_sequence integer not null default 1000,
  is_active boolean not null default false,
  barcode_value text null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(gondola_code,shelf_code,position_code)
);
alter table public.warehouse_locations enable row level security;

create table if not exists public.product_storage_assignments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.warehouse_locations(id) on delete restrict,
  is_primary boolean not null default true,
  pick_priority integer not null default 100,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id,location_id)
);
alter table public.product_storage_assignments enable row level security;
create unique index if not exists product_storage_one_primary_active_idx on public.product_storage_assignments(product_id) where is_primary and active;

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  lot_code text not null,
  expiry_date date null,
  received_at timestamptz null,
  quantity_on_hand numeric(14,3) not null default 0 check(quantity_on_hand>=0),
  quantity_reserved numeric(14,3) not null default 0 check(quantity_reserved>=0),
  location_id uuid null references public.warehouse_locations(id) on delete set null,
  status text not null default 'inactive' check(status in ('inactive','available','quarantine','expired','blocked','depleted')),
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id,lot_code,location_id),
  check(quantity_reserved<=quantity_on_hand)
);
alter table public.inventory_lots enable row level security;
create index if not exists inventory_lots_fefo_idx on public.inventory_lots(product_id,status,expiry_date,received_at,id);

create table if not exists public.fulfillment_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','picking','picked','checking','checked','packaging','packed','ready','cancelled','exception')),
  picker_user_id uuid null,
  checker_user_id uuid null,
  picking_started_at timestamptz null,
  picked_at timestamptz null,
  checking_started_at timestamptz null,
  checked_at timestamptz null,
  packed_at timestamptz null,
  ready_at timestamptz null,
  exception_code text null,
  exception_detail text null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.fulfillment_orders enable row level security;

create table if not exists public.fulfillment_tasks (
  id uuid primary key default gen_random_uuid(),
  fulfillment_order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  order_item_id uuid null references public.order_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  sku_snapshot text null,
  name_snapshot text not null,
  gtin_snapshot text null,
  required_quantity numeric(14,3) not null check(required_quantity>0),
  picked_quantity numeric(14,3) not null default 0 check(picked_quantity>=0),
  checked_quantity numeric(14,3) not null default 0 check(checked_quantity>=0),
  allocated_lot_id uuid null references public.inventory_lots(id) on delete restrict,
  location_id uuid null references public.warehouse_locations(id) on delete set null,
  location_snapshot jsonb not null default '{}'::jsonb,
  pick_sequence integer not null default 100000,
  status text not null default 'pending' check(status in ('pending','picking','picked','checking','checked','short','exception','cancelled')),
  manual_override boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(fulfillment_order_id,order_item_id,product_id)
);
alter table public.fulfillment_tasks enable row level security;
create index if not exists fulfillment_tasks_pick_idx on public.fulfillment_tasks(fulfillment_order_id,pick_sequence,status);

create table if not exists public.fulfillment_scans (
  id uuid primary key default gen_random_uuid(),
  fulfillment_order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  task_id uuid null references public.fulfillment_tasks(id) on delete cascade,
  phase text not null check(phase in ('picking','checking','packaging','loading')),
  barcode_value text not null,
  quantity numeric(14,3) not null default 1 check(quantity>0),
  result text not null check(result in ('accepted','wrong_product','over_quantity','not_expected','manual_override','duplicate_event','blocked')),
  operator_user_id uuid null,
  device_id text null,
  client_event_id text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.fulfillment_scans enable row level security;

create table if not exists public.fulfillment_exceptions (
  id uuid primary key default gen_random_uuid(),
  fulfillment_order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  task_id uuid null references public.fulfillment_tasks(id) on delete set null,
  type text not null check(type in ('shortage','wrong_product','over_quantity','expired_lot','lot_missing','location_missing','barcode_missing','checker_conflict','package_mismatch','other')),
  status text not null default 'open' check(status in ('open','resolved','cancelled')),
  detail jsonb not null default '{}'::jsonb,
  opened_by uuid null,
  resolved_by uuid null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz null
);
alter table public.fulfillment_exceptions enable row level security;

create table if not exists public.fulfillment_packages (
  id uuid primary key default gen_random_uuid(),
  fulfillment_order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  package_no integer not null check(package_no>0),
  package_count integer null check(package_count is null or package_count>0),
  barcode_value text not null unique,
  status text not null default 'open' check(status in ('open','sealed','loaded','delivered','cancelled')),
  sealed_by uuid null,
  sealed_at timestamptz null,
  loaded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(fulfillment_order_id,package_no)
);
alter table public.fulfillment_packages enable row level security;

create table if not exists public.fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  fulfillment_order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid null,
  client_event_id text null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.fulfillment_events enable row level security;

create or replace view public.product_pick_location_v1 as
select p.id as product_id,p.sku,p.gtin,p.name,
       coalesce(w.code, nullif(concat_ws('-',nullif(p.gondola,''),nullif(p.shelf,'')),'')) as location_code,
       coalesce(w.gondola_code,nullif(p.gondola,'')) as gondola_code,
       coalesce(w.shelf_code,nullif(p.shelf,'')) as shelf_code,
       w.id as location_id,
       coalesce(w.pick_sequence,100000) as pick_sequence,
       case when a.id is not null then 'normalized_assignment' when nullif(p.gondola,'') is not null or nullif(p.shelf,'') is not null then 'legacy_product_fields' else 'missing' end as location_source
from public.products p
left join public.product_storage_assignments a on a.product_id=p.id and a.active and a.is_primary
left join public.warehouse_locations w on w.id=a.location_id and w.is_active;

create or replace function public.preview_fefo_for_product_v1(p_product_id uuid,p_quantity numeric,p_delivery_date date default current_date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r record; remaining numeric:=p_quantity; allocations jsonb:='[]'::jsonb; available numeric:=0;
begin
  if p_quantity is null or p_quantity<=0 then return jsonb_build_object('ok',false,'error','invalid_quantity','external_side_effect',false); end if;
  for r in
    select l.id,l.lot_code,l.expiry_date,l.quantity_on_hand-l.quantity_reserved as free_qty,l.location_id
    from public.inventory_lots l
    where l.product_id=p_product_id and l.status='available'
      and (l.expiry_date is null or l.expiry_date>=coalesce(p_delivery_date,current_date))
      and l.quantity_on_hand>l.quantity_reserved
    order by l.expiry_date nulls last,l.received_at nulls last,l.id
  loop
    available:=available+r.free_qty;
    if remaining>0 then
      allocations:=allocations||jsonb_build_array(jsonb_build_object('lot_id',r.id,'lot_code',r.lot_code,'expiry_date',r.expiry_date,'quantity',least(remaining,r.free_qty),'location_id',r.location_id));
      remaining:=greatest(0,remaining-r.free_qty);
    end if;
  end loop;
  return jsonb_build_object('ok',true,'product_id',p_product_id,'requested_quantity',p_quantity,'available_quantity',available,'fully_allocatable',remaining=0,'shortage_quantity',remaining,'allocations',allocations,'external_side_effect',false);
end $$;

create or replace function public.preview_fulfillment_order_v1(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.orders%rowtype; n integer; missing_barcode integer; missing_location integer;
begin
  select * into o from public.orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found','external_side_effect',false); end if;
  if o.status not in ('confirmed','sent_to_bling','processing') then return jsonb_build_object('ok',false,'error','order_not_eligible_for_fulfillment','order_status',o.status,'external_side_effect',false); end if;
  select count(*) into n from public.order_items where order_id=o.id and product_id is not null and quantity>0;
  select count(*) into missing_barcode from public.order_items oi join public.products p on p.id=oi.product_id where oi.order_id=o.id and nullif(trim(coalesce(p.gtin,'')),'') is null;
  select count(*) into missing_location from public.order_items oi join public.product_pick_location_v1 l on l.product_id=oi.product_id where oi.order_id=o.id and l.location_source='missing';
  return jsonb_build_object('ok',n>0,'order_id',o.id,'line_count',n,'missing_barcode_lines',missing_barcode,'missing_location_lines',missing_location,'requires_review',(n=0 or missing_barcode>0 or missing_location>0),'external_side_effect',false);
end $$;

create or replace function public.create_fulfillment_order_v1(p_order_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; prev jsonb; fo_id uuid; existing uuid; oi record; loc record; fefo jsonb; lot_id uuid;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;
  if not cfg.enabled or not cfg.order_creation_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','fulfillment_creation_disabled','side_effect_performed',false,'external_side_effect',false); end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key))<12 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','side_effect_performed',false); end if;
  select id into existing from public.fulfillment_orders where order_id=p_order_id or idempotency_key=trim(p_idempotency_key) limit 1;
  if found then return jsonb_build_object('ok',true,'replay',true,'fulfillment_order_id',existing,'side_effect_performed',false,'external_side_effect',false); end if;
  prev:=public.preview_fulfillment_order_v1(p_order_id);
  if coalesce((prev->>'ok')::boolean,false)=false then return prev||jsonb_build_object('side_effect_performed',false); end if;
  insert into public.fulfillment_orders(order_id,idempotency_key) values(p_order_id,trim(p_idempotency_key)) returning id into fo_id;
  for oi in select oi.*,p.gtin,p.name,p.sku from public.order_items oi join public.products p on p.id=oi.product_id where oi.order_id=p_order_id and oi.quantity>0 order by oi.created_at,oi.id loop
    select * into loc from public.product_pick_location_v1 where product_id=oi.product_id;
    lot_id:=null;
    if cfg.fefo_required then
      fefo:=public.preview_fefo_for_product_v1(oi.product_id,oi.quantity,current_date);
      if coalesce((fefo->>'fully_allocatable')::boolean,false) and jsonb_array_length(fefo->'allocations')=1 then lot_id:=((fefo->'allocations'->0->>'lot_id')::uuid); end if;
    end if;
    insert into public.fulfillment_tasks(fulfillment_order_id,order_item_id,product_id,sku_snapshot,name_snapshot,gtin_snapshot,required_quantity,allocated_lot_id,location_id,location_snapshot,pick_sequence)
    values(fo_id,oi.id,oi.product_id,coalesce(oi.sku_snapshot,oi.sku),coalesce(oi.name_snapshot,oi.name),oi.gtin,oi.quantity,lot_id,loc.location_id,jsonb_build_object('code',loc.location_code,'gondola',loc.gondola_code,'shelf',loc.shelf_code,'source',loc.location_source),coalesce(loc.pick_sequence,100000));
  end loop;
  insert into public.fulfillment_events(fulfillment_order_id,event_type,payload) values(fo_id,'FULFILLMENT_CREATED',jsonb_build_object('preview',prev));
  return jsonb_build_object('ok',true,'replay',false,'fulfillment_order_id',fo_id,'status','pending','side_effect_performed',true,'external_side_effect',false);
end $$;

create or replace function public.start_fulfillment_picking_v1(p_fulfillment_order_id uuid,p_operator_user_id uuid,p_client_event_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; fo public.fulfillment_orders%rowtype;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;
  if not cfg.enabled or not cfg.picking_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','picking_disabled','side_effect_performed',false); end if;
  select * into fo from public.fulfillment_orders where id=p_fulfillment_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','fulfillment_order_not_found','side_effect_performed',false); end if;
  if fo.status='picking' and fo.picker_user_id is not distinct from p_operator_user_id then return jsonb_build_object('ok',true,'replay',true,'status',fo.status,'side_effect_performed',false); end if;
  if fo.status<>'pending' then return jsonb_build_object('ok',false,'error','invalid_fulfillment_state','status',fo.status,'side_effect_performed',false); end if;
  update public.fulfillment_orders set status='picking',picker_user_id=p_operator_user_id,picking_started_at=now(),updated_at=now() where id=fo.id;
  insert into public.fulfillment_events(fulfillment_order_id,event_type,actor_user_id,client_event_id) values(fo.id,'PICKING_STARTED',p_operator_user_id,p_client_event_id) on conflict(client_event_id) do nothing;
  return jsonb_build_object('ok',true,'status','picking','side_effect_performed',true,'external_side_effect',false);
end $$;

create or replace function public.scan_fulfillment_item_v1(p_fulfillment_order_id uuid,p_phase text,p_barcode text,p_quantity numeric,p_operator_user_id uuid,p_client_event_id text,p_device_id text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; fo public.fulfillment_orders%rowtype; t public.fulfillment_tasks%rowtype; phase text:=lower(trim(coalesce(p_phase,''))); bc text:=trim(coalesce(p_barcode,'')); qty numeric:=coalesce(p_quantity,1); existing uuid; result text; new_qty numeric;
begin
  if phase not in ('picking','checking') or bc='' or qty<=0 then return jsonb_build_object('ok',false,'error','invalid_scan_payload','side_effect_performed',false); end if;
  select id into existing from public.fulfillment_scans where client_event_id=p_client_event_id;
  if found then return jsonb_build_object('ok',true,'replay',true,'scan_id',existing,'side_effect_performed',false); end if;
  select * into cfg from public.fulfillment_runtime_config where id=1;
  if not cfg.enabled or cfg.execution_mode not in ('homologation','canary','live') or (phase='picking' and not cfg.picking_enabled) or (phase='checking' and not cfg.checking_enabled) then return jsonb_build_object('ok',false,'error','scan_phase_disabled','side_effect_performed',false); end if;
  select * into fo from public.fulfillment_orders where id=p_fulfillment_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','fulfillment_order_not_found','side_effect_performed',false); end if;
  if phase='picking' and (fo.status<>'picking' or fo.picker_user_id is distinct from p_operator_user_id) then return jsonb_build_object('ok',false,'error','picker_not_owner','side_effect_performed',false); end if;
  if phase='checking' and fo.status not in ('picked','checking') then return jsonb_build_object('ok',false,'error','checking_not_available','side_effect_performed',false); end if;
  if phase='checking' and cfg.require_independent_checker and fo.picker_user_id is not null and fo.picker_user_id=p_operator_user_id then return jsonb_build_object('ok',false,'error','independent_checker_required','side_effect_performed',false); end if;
  select ft.* into t from public.fulfillment_tasks ft join public.products p on p.id=ft.product_id where ft.fulfillment_order_id=fo.id and (coalesce(ft.gtin_snapshot,'')=bc or coalesce(p.gtin,'')=bc or p.sku=bc) order by ft.pick_sequence,ft.id limit 1 for update of ft;
  if not found then
    insert into public.fulfillment_scans(fulfillment_order_id,phase,barcode_value,quantity,result,operator_user_id,device_id,client_event_id) values(fo.id,phase,bc,qty,'not_expected',p_operator_user_id,p_device_id,p_client_event_id) returning id into existing;
    insert into public.fulfillment_exceptions(fulfillment_order_id,type,detail,opened_by) values(fo.id,'wrong_product',jsonb_build_object('barcode',bc,'phase',phase),p_operator_user_id);
    return jsonb_build_object('ok',false,'error','product_not_expected','scan_id',existing,'side_effect_performed',true,'external_side_effect',false);
  end if;
  if phase='picking' then
    new_qty:=t.picked_quantity+qty;
    if new_qty>t.required_quantity then result:='over_quantity'; else result:='accepted'; update public.fulfillment_tasks set picked_quantity=new_qty,status=case when new_qty=t.required_quantity then 'picked' else 'picking' end,updated_at=now() where id=t.id; end if;
  else
    new_qty:=t.checked_quantity+qty;
    if new_qty>t.required_quantity then result:='over_quantity'; else result:='accepted'; update public.fulfillment_tasks set checked_quantity=new_qty,status=case when new_qty=t.required_quantity then 'checked' else 'checking' end,updated_at=now() where id=t.id; end if;
    update public.fulfillment_orders set status='checking',checker_user_id=coalesce(checker_user_id,p_operator_user_id),checking_started_at=coalesce(checking_started_at,now()),updated_at=now() where id=fo.id;
  end if;
  insert into public.fulfillment_scans(fulfillment_order_id,task_id,phase,barcode_value,quantity,result,operator_user_id,device_id,client_event_id) values(fo.id,t.id,phase,bc,qty,result,p_operator_user_id,p_device_id,p_client_event_id) returning id into existing;
  if result='over_quantity' then insert into public.fulfillment_exceptions(fulfillment_order_id,task_id,type,detail,opened_by) values(fo.id,t.id,'over_quantity',jsonb_build_object('barcode',bc,'phase',phase,'quantity',qty),p_operator_user_id); return jsonb_build_object('ok',false,'error','quantity_exceeded','scan_id',existing,'task_id',t.id,'side_effect_performed',true); end if;
  return jsonb_build_object('ok',true,'scan_id',existing,'task_id',t.id,'phase',phase,'quantity_progress',new_qty,'required_quantity',t.required_quantity,'task_complete',new_qty=t.required_quantity,'side_effect_performed',true,'external_side_effect',false);
end $$;

create or replace function public.complete_fulfillment_phase_v1(p_fulfillment_order_id uuid,p_phase text,p_operator_user_id uuid,p_client_event_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; fo public.fulfillment_orders%rowtype; incomplete integer; open_ex integer; phase text:=lower(trim(coalesce(p_phase,'')));
begin
  select * into cfg from public.fulfillment_runtime_config where id=1; select * into fo from public.fulfillment_orders where id=p_fulfillment_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','fulfillment_order_not_found','side_effect_performed',false); end if;
  select count(*) into open_ex from public.fulfillment_exceptions where fulfillment_order_id=fo.id and status='open';
  if open_ex>0 then return jsonb_build_object('ok',false,'error','open_fulfillment_exceptions','count',open_ex,'side_effect_performed',false); end if;
  if phase='picking' then
    if not cfg.enabled or not cfg.picking_enabled or fo.status<>'picking' or fo.picker_user_id is distinct from p_operator_user_id then return jsonb_build_object('ok',false,'error','picking_completion_not_allowed','side_effect_performed',false); end if;
    select count(*) into incomplete from public.fulfillment_tasks where fulfillment_order_id=fo.id and picked_quantity<>required_quantity;
    if incomplete>0 then return jsonb_build_object('ok',false,'error','picking_incomplete','remaining_tasks',incomplete,'side_effect_performed',false); end if;
    update public.fulfillment_orders set status='picked',picked_at=now(),updated_at=now() where id=fo.id;
    insert into public.fulfillment_events(fulfillment_order_id,event_type,actor_user_id,client_event_id) values(fo.id,'PICKING_COMPLETED',p_operator_user_id,p_client_event_id) on conflict(client_event_id) do nothing;
    return jsonb_build_object('ok',true,'status','picked','side_effect_performed',true,'external_side_effect',false);
  elsif phase='checking' then
    if not cfg.enabled or not cfg.checking_enabled or fo.status<>'checking' or fo.checker_user_id is distinct from p_operator_user_id then return jsonb_build_object('ok',false,'error','checking_completion_not_allowed','side_effect_performed',false); end if;
    if cfg.require_independent_checker and fo.picker_user_id is not null and fo.picker_user_id=fo.checker_user_id then return jsonb_build_object('ok',false,'error','independent_checker_required','side_effect_performed',false); end if;
    select count(*) into incomplete from public.fulfillment_tasks where fulfillment_order_id=fo.id and checked_quantity<>required_quantity;
    if incomplete>0 then return jsonb_build_object('ok',false,'error','checking_incomplete','remaining_tasks',incomplete,'side_effect_performed',false); end if;
    update public.fulfillment_orders set status='checked',checked_at=now(),updated_at=now() where id=fo.id;
    insert into public.fulfillment_events(fulfillment_order_id,event_type,actor_user_id,client_event_id) values(fo.id,'CHECKING_COMPLETED',p_operator_user_id,p_client_event_id) on conflict(client_event_id) do nothing;
    return jsonb_build_object('ok',true,'status','checked','side_effect_performed',true,'external_side_effect',false);
  end if;
  return jsonb_build_object('ok',false,'error','invalid_phase','side_effect_performed',false);
end $$;

create or replace function public.create_fulfillment_package_v1(p_fulfillment_order_id uuid,p_package_no integer,p_barcode_value text,p_operator_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; fo public.fulfillment_orders%rowtype; pid uuid;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1; select * into fo from public.fulfillment_orders where id=p_fulfillment_order_id for update;
  if not cfg.enabled or not cfg.packaging_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','packaging_disabled','side_effect_performed',false); end if;
  if not found or fo.status not in ('checked','packaging','packed') then return jsonb_build_object('ok',false,'error','order_not_checked','side_effect_performed',false); end if;
  if p_package_no<=0 or length(trim(coalesce(p_barcode_value,'')))<6 then return jsonb_build_object('ok',false,'error','invalid_package','side_effect_performed',false); end if;
  insert into public.fulfillment_packages(fulfillment_order_id,package_no,barcode_value,status,sealed_by,sealed_at) values(fo.id,p_package_no,trim(p_barcode_value),'sealed',p_operator_user_id,now()) on conflict(fulfillment_order_id,package_no) do update set barcode_value=excluded.barcode_value,status='sealed',sealed_by=excluded.sealed_by,sealed_at=excluded.sealed_at,updated_at=now() returning id into pid;
  update public.fulfillment_orders set status='packed',packed_at=now(),updated_at=now() where id=fo.id;
  return jsonb_build_object('ok',true,'package_id',pid,'status','sealed','side_effect_performed',true,'external_side_effect',false);
end $$;

create or replace function public.release_order_ready_from_fulfillment_v1(p_fulfillment_order_id uuid,p_operator_user_id uuid,p_client_event_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; fo public.fulfillment_orders%rowtype; incomplete integer; open_ex integer; packages integer; order_status text;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;
  if not cfg.enabled or not cfg.ready_release_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','ready_release_disabled','side_effect_performed',false,'external_side_effect',false); end if;
  select * into fo from public.fulfillment_orders where id=p_fulfillment_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','fulfillment_order_not_found','side_effect_performed',false); end if;
  select count(*) into incomplete from public.fulfillment_tasks where fulfillment_order_id=fo.id and (picked_quantity<>required_quantity or checked_quantity<>required_quantity);
  select count(*) into open_ex from public.fulfillment_exceptions where fulfillment_order_id=fo.id and status='open';
  select count(*) into packages from public.fulfillment_packages where fulfillment_order_id=fo.id and status='sealed';
  if fo.status<>'packed' or incomplete>0 or open_ex>0 or packages=0 then return jsonb_build_object('ok',false,'error','fulfillment_not_ready','status',fo.status,'incomplete_tasks',incomplete,'open_exceptions',open_ex,'sealed_packages',packages,'side_effect_performed',false); end if;
  select status into order_status from public.orders where id=fo.order_id for update;
  if order_status not in ('confirmed','sent_to_bling','processing') then return jsonb_build_object('ok',false,'error','commercial_order_state_changed','order_status',order_status,'side_effect_performed',false); end if;
  update public.fulfillment_orders set status='ready',ready_at=now(),updated_at=now() where id=fo.id;
  update public.orders set status='ready',updated_at=now() where id=fo.order_id;
  insert into public.fulfillment_events(fulfillment_order_id,event_type,actor_user_id,client_event_id,payload) values(fo.id,'ORDER_RELEASED_READY',p_operator_user_id,p_client_event_id,jsonb_build_object('sealed_packages',packages)) on conflict(client_event_id) do nothing;
  return jsonb_build_object('ok',true,'fulfillment_status','ready','order_status','ready','sealed_packages',packages,'side_effect_performed',true,'external_side_effect',false);
end $$;

create or replace function public.fulfillment_order_snapshot_v1(p_fulfillment_order_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
 'order',(select to_jsonb(f) from public.fulfillment_orders f where f.id=p_fulfillment_order_id),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.pick_sequence,t.id) from public.fulfillment_tasks t where t.fulfillment_order_id=p_fulfillment_order_id),'[]'::jsonb),
 'packages',coalesce((select jsonb_agg(to_jsonb(p) order by p.package_no) from public.fulfillment_packages p where p.fulfillment_order_id=p_fulfillment_order_id),'[]'::jsonb),
 'open_exceptions',coalesce((select jsonb_agg(to_jsonb(e) order by e.opened_at) from public.fulfillment_exceptions e where e.fulfillment_order_id=p_fulfillment_order_id and e.status='open'),'[]'::jsonb)
) $$;

-- Server-only: mobile clients must go through an authenticated Edge Function/API.
do $$ declare r record; begin
  for r in select unnest(array['fulfillment_runtime_config','warehouse_locations','product_storage_assignments','inventory_lots','fulfillment_orders','fulfillment_tasks','fulfillment_scans','fulfillment_exceptions','fulfillment_packages','fulfillment_events']) t loop
    execute format('revoke all on public.%I from public,anon,authenticated',r.t);
    execute format('grant select,insert,update,delete on public.%I to service_role',r.t);
  end loop;
end $$;
revoke all on public.product_pick_location_v1 from public,anon,authenticated;
grant select on public.product_pick_location_v1 to service_role;

revoke all on function public.preview_fefo_for_product_v1(uuid,numeric,date) from public,anon,authenticated;
revoke all on function public.preview_fulfillment_order_v1(uuid) from public,anon,authenticated;
revoke all on function public.create_fulfillment_order_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.start_fulfillment_picking_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.scan_fulfillment_item_v1(uuid,text,text,numeric,uuid,text,text) from public,anon,authenticated;
revoke all on function public.complete_fulfillment_phase_v1(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.create_fulfillment_package_v1(uuid,integer,text,uuid) from public,anon,authenticated;
revoke all on function public.release_order_ready_from_fulfillment_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.fulfillment_order_snapshot_v1(uuid) from public,anon,authenticated;

grant execute on function public.preview_fefo_for_product_v1(uuid,numeric,date) to service_role;
grant execute on function public.preview_fulfillment_order_v1(uuid) to service_role;
grant execute on function public.create_fulfillment_order_v1(uuid,text) to service_role;
grant execute on function public.start_fulfillment_picking_v1(uuid,uuid,text) to service_role;
grant execute on function public.scan_fulfillment_item_v1(uuid,text,text,numeric,uuid,text,text) to service_role;
grant execute on function public.complete_fulfillment_phase_v1(uuid,text,uuid,text) to service_role;
grant execute on function public.create_fulfillment_package_v1(uuid,integer,text,uuid) to service_role;
grant execute on function public.release_order_ready_from_fulfillment_v1(uuid,uuid,text) to service_role;
grant execute on function public.fulfillment_order_snapshot_v1(uuid) to service_role;

commit;
