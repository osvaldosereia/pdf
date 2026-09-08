begin;

create table if not exists public.fulfillment_runtime_config (
  id smallint primary key default 1 check (id=1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  picking_enabled boolean not null default false,
  checking_enabled boolean not null default false,
  packing_enabled boolean not null default false,
  ready_release_enabled boolean not null default false,
  loading_enabled boolean not null default false,
  fefo_enforced boolean not null default false,
  require_independent_checker boolean not null default true,
  allow_manual_barcode_override boolean not null default false,
  canary_percent smallint not null default 0 check (canary_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid null
);
insert into public.fulfillment_runtime_config(id) values(1) on conflict(id) do nothing;
alter table public.fulfillment_runtime_config enable row level security;

create table if not exists public.warehouse_staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  display_name text not null,
  role text not null check (role in ('picker','checker','loader','supervisor')),
  status text not null default 'inactive' check (status in ('inactive','available','busy','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.warehouse_staff enable row level security;

create table if not exists public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  zone_code text null,
  gondola_code text not null,
  shelf_code text not null,
  position_code text null,
  pick_sequence integer not null default 1000,
  active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.warehouse_locations enable row level security;

create table if not exists public.product_location_assignments (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.warehouse_locations(id) on delete cascade,
  priority smallint not null default 1 check (priority between 1 and 100),
  is_primary boolean not null default false,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique(product_id,location_id)
);
alter table public.product_location_assignments enable row level security;
create unique index if not exists product_location_one_primary_active_idx on public.product_location_assignments(product_id) where is_primary and active;

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  location_id uuid null references public.warehouse_locations(id) on delete set null,
  lot_code text not null,
  expires_on date null,
  received_on date null,
  quantity_on_hand numeric(14,3) not null default 0 check (quantity_on_hand>=0),
  quantity_reserved numeric(14,3) not null default 0 check (quantity_reserved>=0 and quantity_reserved<=quantity_on_hand),
  status text not null default 'inactive' check (status in ('inactive','available','blocked','expired','depleted')),
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id,lot_code,location_id)
);
alter table public.inventory_lots enable row level security;
create index if not exists inventory_lots_fefo_idx on public.inventory_lots(product_id,status,expires_on,received_on);

create table if not exists public.fulfillment_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','picking','picked','checking','checked','packing','packed','ready','loading','loaded','cancelled','exception')),
  picker_id uuid null references public.warehouse_staff(id) on delete set null,
  checker_id uuid null references public.warehouse_staff(id) on delete set null,
  loader_id uuid null references public.warehouse_staff(id) on delete set null,
  started_picking_at timestamptz null,
  picked_at timestamptz null,
  checking_started_at timestamptz null,
  checked_at timestamptz null,
  packed_at timestamptz null,
  ready_at timestamptz null,
  loaded_at timestamptz null,
  exception_code text null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.fulfillment_orders enable row level security;

create table if not exists public.fulfillment_items (
  id uuid primary key default gen_random_uuid(),
  fulfillment_order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  product_id uuid null references public.products(id) on delete set null,
  expected_quantity numeric(14,3) not null check (expected_quantity>0),
  picked_quantity numeric(14,3) not null default 0 check (picked_quantity>=0),
  checked_quantity numeric(14,3) not null default 0 check (checked_quantity>=0),
  expected_gtin text null,
  location_id uuid null references public.warehouse_locations(id) on delete set null,
  lot_id uuid null references public.inventory_lots(id) on delete set null,
  pick_sequence integer not null default 1000,
  status text not null default 'pending' check (status in ('pending','picking','picked','checked','short','wrong_item','exception')),
  updated_at timestamptz not null default now(),
  unique(fulfillment_order_id,order_item_id)
);
alter table public.fulfillment_items enable row level security;
create index if not exists fulfillment_items_pick_idx on public.fulfillment_items(fulfillment_order_id,pick_sequence,id);

create table if not exists public.fulfillment_scan_events (
  id uuid primary key default gen_random_uuid(),
  fulfillment_order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  fulfillment_item_id uuid null references public.fulfillment_items(id) on delete set null,
  staff_id uuid null references public.warehouse_staff(id) on delete set null,
  phase text not null check (phase in ('picking','checking','loading')),
  barcode text not null,
  result text not null check (result in ('accepted','wrong_item','excess','unknown','manual_override')),
  client_event_id text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.fulfillment_scan_events enable row level security;

create table if not exists public.order_packages (
  id uuid primary key default gen_random_uuid(),
  fulfillment_order_id uuid not null references public.fulfillment_orders(id) on delete cascade,
  package_no integer not null check (package_no>0),
  package_count integer not null default 1 check (package_count>0),
  barcode text not null unique,
  status text not null default 'packed' check (status in ('packed','loaded','delivered','returned')),
  loaded_at timestamptz null,
  created_at timestamptz not null default now(),
  unique(fulfillment_order_id,package_no)
);
alter table public.order_packages enable row level security;

create or replace function public.create_fulfillment_from_order_v1(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; o public.orders%rowtype; f_id uuid; existing uuid;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;
  if not cfg.enabled or not cfg.picking_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','fulfillment_runtime_disabled','side_effect_performed',false);
  end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found','side_effect_performed',false); end if;
  if o.status not in ('confirmed','sent_to_bling','processing') then return jsonb_build_object('ok',false,'error','order_not_eligible','order_status',o.status,'side_effect_performed',false); end if;
  select id into existing from public.fulfillment_orders where order_id=o.id;
  if found then return jsonb_build_object('ok',true,'replay',true,'fulfillment_order_id',existing,'side_effect_performed',false); end if;
  insert into public.fulfillment_orders(order_id) values(o.id) returning id into f_id;
  insert into public.fulfillment_items(fulfillment_order_id,order_item_id,product_id,expected_quantity,expected_gtin,location_id,lot_id,pick_sequence)
  select f_id,oi.id,oi.product_id,oi.quantity,p.gtin,pla.location_id,
         case when cfg.fefo_enforced then (
           select il.id from public.inventory_lots il where il.product_id=oi.product_id and il.status='available' and il.quantity_on_hand>il.quantity_reserved and (il.expires_on is null or il.expires_on>=current_date)
           order by il.expires_on nulls last,il.received_on nulls last,il.created_at limit 1
         ) else null end,
         coalesce(wl.pick_sequence,1000)
  from public.order_items oi
  left join public.products p on p.id=oi.product_id
  left join public.product_location_assignments pla on pla.product_id=oi.product_id and pla.active and pla.is_primary
  left join public.warehouse_locations wl on wl.id=pla.location_id
  where oi.order_id=o.id;
  return jsonb_build_object('ok',true,'replay',false,'fulfillment_order_id',f_id,'side_effect_performed',true,'external_side_effect',false);
end; $$;

create or replace function public.scan_fulfillment_item_v1(p_fulfillment_order_id uuid,p_staff_id uuid,p_phase text,p_barcode text,p_client_event_id text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; f public.fulfillment_orders%rowtype; i public.fulfillment_items%rowtype; prior uuid; phase text:=lower(trim(coalesce(p_phase,''))); code text:=trim(coalesce(p_barcode,''));
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;
  if not cfg.enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','fulfillment_runtime_disabled','side_effect_performed',false); end if;
  if phase='picking' and not cfg.picking_enabled then return jsonb_build_object('ok',false,'error','picking_disabled','side_effect_performed',false); end if;
  if phase='checking' and not cfg.checking_enabled then return jsonb_build_object('ok',false,'error','checking_disabled','side_effect_performed',false); end if;
  if phase not in ('picking','checking') or code='' or length(trim(coalesce(p_client_event_id,'')))<8 then return jsonb_build_object('ok',false,'error','invalid_scan_payload','side_effect_performed',false); end if;
  select id into prior from public.fulfillment_scan_events where client_event_id=p_client_event_id;
  if found then return jsonb_build_object('ok',true,'replay',true,'event_id',prior,'side_effect_performed',false); end if;
  select * into f from public.fulfillment_orders where id=p_fulfillment_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','fulfillment_order_not_found','side_effect_performed',false); end if;
  if phase='checking' and cfg.require_independent_checker and f.picker_id is not null and f.picker_id=p_staff_id then return jsonb_build_object('ok',false,'error','independent_checker_required','side_effect_performed',false); end if;
  select fi.* into i from public.fulfillment_items fi join public.products p on p.id=fi.product_id
   where fi.fulfillment_order_id=f.id and (coalesce(fi.expected_gtin,'')=code or p.sku=code) order by fi.pick_sequence,fi.id limit 1 for update of fi;
  if not found then
    insert into public.fulfillment_scan_events(fulfillment_order_id,staff_id,phase,barcode,result,client_event_id) values(f.id,p_staff_id,phase,code,'wrong_item',p_client_event_id) returning id into prior;
    return jsonb_build_object('ok',false,'error','wrong_item','event_id',prior,'side_effect_performed',true);
  end if;
  if phase='picking' then
    if i.picked_quantity>=i.expected_quantity then
      insert into public.fulfillment_scan_events(fulfillment_order_id,fulfillment_item_id,staff_id,phase,barcode,result,client_event_id) values(f.id,i.id,p_staff_id,phase,code,'excess',p_client_event_id) returning id into prior;
      return jsonb_build_object('ok',false,'error','quantity_already_complete','event_id',prior,'side_effect_performed',true);
    end if;
    update public.fulfillment_items set picked_quantity=picked_quantity+1,status=case when picked_quantity+1>=expected_quantity then 'picked' else 'picking' end,updated_at=now() where id=i.id;
    update public.fulfillment_orders set picker_id=coalesce(picker_id,p_staff_id),status='picking',started_picking_at=coalesce(started_picking_at,now()),updated_at=now() where id=f.id;
  else
    if i.checked_quantity>=i.expected_quantity then
      insert into public.fulfillment_scan_events(fulfillment_order_id,fulfillment_item_id,staff_id,phase,barcode,result,client_event_id) values(f.id,i.id,p_staff_id,phase,code,'excess',p_client_event_id) returning id into prior;
      return jsonb_build_object('ok',false,'error','quantity_already_complete','event_id',prior,'side_effect_performed',true);
    end if;
    if i.picked_quantity<i.expected_quantity then return jsonb_build_object('ok',false,'error','item_not_fully_picked','side_effect_performed',false); end if;
    update public.fulfillment_items set checked_quantity=checked_quantity+1,status=case when checked_quantity+1>=expected_quantity then 'checked' else status end,updated_at=now() where id=i.id;
    update public.fulfillment_orders set checker_id=coalesce(checker_id,p_staff_id),status='checking',checking_started_at=coalesce(checking_started_at,now()),updated_at=now() where id=f.id;
  end if;
  insert into public.fulfillment_scan_events(fulfillment_order_id,fulfillment_item_id,staff_id,phase,barcode,result,client_event_id) values(f.id,i.id,p_staff_id,phase,code,'accepted',p_client_event_id) returning id into prior;
  return jsonb_build_object('ok',true,'replay',false,'event_id',prior,'fulfillment_item_id',i.id,'side_effect_performed',true,'external_side_effect',false);
end; $$;

create or replace function public.finalize_fulfillment_phase_v1(p_fulfillment_order_id uuid,p_staff_id uuid,p_phase text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; f public.fulfillment_orders%rowtype; missing integer; phase text:=lower(trim(coalesce(p_phase,'')));
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;
  if not cfg.enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','fulfillment_runtime_disabled','side_effect_performed',false); end if;
  select * into f from public.fulfillment_orders where id=p_fulfillment_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','fulfillment_order_not_found','side_effect_performed',false); end if;
  if phase='picking' then
    select count(*) into missing from public.fulfillment_items where fulfillment_order_id=f.id and picked_quantity<>expected_quantity;
    if missing>0 then return jsonb_build_object('ok',false,'error','picking_incomplete','missing_items',missing,'side_effect_performed',false); end if;
    update public.fulfillment_orders set status='picked',picked_at=coalesce(picked_at,now()),updated_at=now() where id=f.id;
  elsif phase='checking' then
    if cfg.require_independent_checker and f.picker_id is not null and f.picker_id=p_staff_id then return jsonb_build_object('ok',false,'error','independent_checker_required','side_effect_performed',false); end if;
    select count(*) into missing from public.fulfillment_items where fulfillment_order_id=f.id and checked_quantity<>expected_quantity;
    if missing>0 then return jsonb_build_object('ok',false,'error','checking_incomplete','missing_items',missing,'side_effect_performed',false); end if;
    update public.fulfillment_orders set status='checked',checker_id=coalesce(checker_id,p_staff_id),checked_at=coalesce(checked_at,now()),updated_at=now() where id=f.id;
  else return jsonb_build_object('ok',false,'error','invalid_phase','side_effect_performed',false); end if;
  return jsonb_build_object('ok',true,'phase',phase,'side_effect_performed',true,'external_side_effect',false);
end; $$;

create or replace function public.release_fulfillment_ready_v1(p_fulfillment_order_id uuid,p_staff_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.fulfillment_runtime_config%rowtype; f public.fulfillment_orders%rowtype; o public.orders%rowtype;
begin
  select * into cfg from public.fulfillment_runtime_config where id=1;
  if not cfg.enabled or not cfg.ready_release_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','ready_release_disabled','side_effect_performed',false); end if;
  select * into f from public.fulfillment_orders where id=p_fulfillment_order_id for update;
  if not found or f.status not in ('checked','packed') then return jsonb_build_object('ok',false,'error','fulfillment_not_checked','side_effect_performed',false); end if;
  select * into o from public.orders where id=f.order_id for update;
  if o.status not in ('confirmed','sent_to_bling','processing','ready') then return jsonb_build_object('ok',false,'error','order_not_releasable','order_status',o.status,'side_effect_performed',false); end if;
  update public.fulfillment_orders set status='ready',ready_at=coalesce(ready_at,now()),updated_at=now() where id=f.id;
  update public.orders set status='ready',external_status_updated_at=now(),updated_at=now() where id=o.id and status<>'ready';
  return jsonb_build_object('ok',true,'order_id',o.id,'order_status','ready','side_effect_performed',true,'external_side_effect',false);
end; $$;

revoke all on public.fulfillment_runtime_config,public.warehouse_staff,public.warehouse_locations,public.product_location_assignments,public.inventory_lots,public.fulfillment_orders,public.fulfillment_items,public.fulfillment_scan_events,public.order_packages from public,anon,authenticated;
grant all on public.fulfillment_runtime_config,public.warehouse_staff,public.warehouse_locations,public.product_location_assignments,public.inventory_lots,public.fulfillment_orders,public.fulfillment_items,public.fulfillment_scan_events,public.order_packages to service_role;
revoke all on function public.create_fulfillment_from_order_v1(uuid) from public,anon,authenticated;
revoke all on function public.scan_fulfillment_item_v1(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.finalize_fulfillment_phase_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.release_fulfillment_ready_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_fulfillment_from_order_v1(uuid) to service_role;
grant execute on function public.scan_fulfillment_item_v1(uuid,uuid,text,text,text) to service_role;
grant execute on function public.finalize_fulfillment_phase_v1(uuid,uuid,text) to service_role;
grant execute on function public.release_fulfillment_ready_v1(uuid,uuid) to service_role;

commit;
