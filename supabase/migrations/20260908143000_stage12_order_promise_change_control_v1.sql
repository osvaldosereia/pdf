begin;

-- Stage 12 — Order Promise + Order Change Control foundation v1.
-- Deterministic and server-only. No external calls. All runtime/write gates default OFF.

create table if not exists public.order_promise_runtime_config (
  id smallint primary key check (id = 1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  preview_enabled boolean not null default false,
  evaluation_recording_enabled boolean not null default false,
  commitment_write_enabled boolean not null default false,
  inventory_reservation_on_commit_enabled boolean not null default false,
  change_control_enabled boolean not null default false,
  require_capacity_rule boolean not null default true,
  require_delivery_address boolean not null default true,
  same_day_cutoff_enforced boolean not null default true,
  min_shelf_life_days integer not null default 0 check (min_shelf_life_days >= 0),
  max_horizon_days integer null check (max_horizon_days is null or max_horizon_days > 0),
  canary_percent numeric(5,2) not null default 0 check (canary_percent between 0 and 100),
  updated_at timestamptz not null default now()
);
alter table public.order_promise_runtime_config enable row level security;
insert into public.order_promise_runtime_config(id) values(1) on conflict(id) do nothing;

create table if not exists public.order_promise_daily_capacity (
  capacity_date date primary key,
  status text not null default 'draft' check (status in ('draft','active','paused')),
  fulfillment_max_orders integer null check (fulfillment_max_orders is null or fulfillment_max_orders >= 0),
  fulfillment_max_item_units numeric(14,3) null check (fulfillment_max_item_units is null or fulfillment_max_item_units >= 0),
  delivery_max_stops integer null check (delivery_max_stops is null or delivery_max_stops >= 0),
  available_drivers smallint null check (available_drivers is null or available_drivers >= 0),
  same_day_cutoff_local time null,
  version_no integer not null default 1 check (version_no > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.order_promise_daily_capacity enable row level security;

create table if not exists public.order_promise_evaluations (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('cart','order')),
  source_id uuid not null,
  target_delivery_date date not null,
  result text not null check (result in ('eligible','review','blocked')),
  reasons jsonb not null default '[]'::jsonb,
  line_results jsonb not null default '[]'::jsonb,
  capacity_snapshot jsonb not null default '{}'::jsonb,
  total_item_units numeric(14,3) not null default 0,
  address_present boolean not null default false,
  evaluation_key text null unique,
  created_at timestamptz not null default now()
);
alter table public.order_promise_evaluations enable row level security;
create index if not exists order_promise_evaluations_source_idx on public.order_promise_evaluations(source_type,source_id,created_at desc);

create table if not exists public.order_promise_commitments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  evaluation_id uuid null references public.order_promise_evaluations(id) on delete set null,
  promised_date date not null,
  item_units numeric(14,3) not null default 0 check (item_units >= 0),
  delivery_stops integer not null default 1 check (delivery_stops > 0),
  status text not null default 'held' check (status in ('held','committed','released','cancelled')),
  inventory_reservations jsonb not null default '[]'::jsonb,
  idempotency_key text null unique,
  expires_at timestamptz null,
  released_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.order_promise_commitments enable row level security;
create unique index if not exists order_promise_one_active_commitment_idx on public.order_promise_commitments(order_id) where status in ('held','committed');
create index if not exists order_promise_capacity_usage_idx on public.order_promise_commitments(promised_date,status);

create table if not exists public.order_operational_controls (
  order_id uuid primary key references public.orders(id) on delete cascade,
  order_version integer not null default 1 check (order_version > 0),
  lock_state text not null default 'editable' check (lock_state in ('editable','soft_locked','fulfillment_locked','closed')),
  locked_at timestamptz null,
  lock_reason text null,
  last_change_at timestamptz null,
  updated_at timestamptz not null default now()
);
alter table public.order_operational_controls enable row level security;

create table if not exists public.order_change_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  expected_order_version integer not null check (expected_order_version > 0),
  requested_changes jsonb not null check (jsonb_typeof(requested_changes) = 'object'),
  reason text null,
  requested_by_type text not null check (requested_by_type in ('customer','admin','ai','system')),
  requested_by uuid null,
  status text not null default 'draft' check (status in ('draft','review_required','approved','applied','rejected','cancelled')),
  lock_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.order_change_requests enable row level security;
create index if not exists order_change_requests_open_idx on public.order_change_requests(order_id,status,created_at desc);

create table if not exists public.order_change_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  change_request_id uuid null references public.order_change_requests(id) on delete set null,
  event_type text not null,
  actor_type text not null default 'system',
  actor_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.order_change_events enable row level security;
create index if not exists order_change_events_order_idx on public.order_change_events(order_id,created_at desc);

create or replace function public.preview_promise_inventory_v1(p_source_type text,p_source_id uuid,p_target_delivery_date date,p_min_shelf_life_days integer default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  source_type text:=lower(trim(coalesce(p_source_type,'')));
  item_row record;
  fefo jsonb;
  results jsonb:='[]'::jsonb;
  reasons jsonb:='[]'::jsonb;
  total_units numeric:=0;
  item_count integer:=0;
  shortage_count integer:=0;
begin
  if source_type not in ('cart','order') or p_source_id is null or p_target_delivery_date is null or p_min_shelf_life_days<0 then
    return jsonb_build_object('ok',false,'error','invalid_inventory_preview_input','external_side_effect',false);
  end if;

  if source_type='cart' then
    for item_row in
      select ci.id source_item_id,ci.product_id,ci.quantity,p.sku,p.gtin,p.name
      from public.cart_items ci join public.products p on p.id=ci.product_id
      where ci.cart_id=p_source_id and ci.quantity>0
      order by ci.id
    loop
      item_count:=item_count+1; total_units:=total_units+item_row.quantity;
      fefo:=public.preview_fefo_allocation_v1(item_row.product_id,item_row.quantity,p_target_delivery_date,p_min_shelf_life_days);
      if coalesce((fefo->>'sufficient')::boolean,false)=false then
        shortage_count:=shortage_count+1;
        reasons:=reasons||jsonb_build_array(jsonb_build_object('code','inventory_shortage','product_id',item_row.product_id,'shortage',coalesce((fefo->>'shortage')::numeric,item_row.quantity)));
      end if;
      results:=results||jsonb_build_array(jsonb_build_object('source_item_id',item_row.source_item_id,'product_id',item_row.product_id,'sku',item_row.sku,'gtin',item_row.gtin,'name',item_row.name,'quantity',item_row.quantity,'sufficient',coalesce((fefo->>'sufficient')::boolean,false),'shortage',coalesce((fefo->>'shortage')::numeric,item_row.quantity),'allocations',coalesce(fefo->'lines','[]'::jsonb)));
    end loop;
  else
    for item_row in
      select oi.id source_item_id,oi.product_id,oi.quantity,coalesce(oi.sku_snapshot,p.sku) sku,p.gtin,coalesce(oi.name_snapshot,p.name) name
      from public.order_items oi join public.products p on p.id=oi.product_id
      where oi.order_id=p_source_id and oi.product_id is not null and oi.quantity>0
      order by oi.id
    loop
      item_count:=item_count+1; total_units:=total_units+item_row.quantity;
      fefo:=public.preview_fefo_allocation_v1(item_row.product_id,item_row.quantity,p_target_delivery_date,p_min_shelf_life_days);
      if coalesce((fefo->>'sufficient')::boolean,false)=false then
        shortage_count:=shortage_count+1;
        reasons:=reasons||jsonb_build_array(jsonb_build_object('code','inventory_shortage','product_id',item_row.product_id,'shortage',coalesce((fefo->>'shortage')::numeric,item_row.quantity)));
      end if;
      results:=results||jsonb_build_array(jsonb_build_object('source_item_id',item_row.source_item_id,'product_id',item_row.product_id,'sku',item_row.sku,'gtin',item_row.gtin,'name',item_row.name,'quantity',item_row.quantity,'sufficient',coalesce((fefo->>'sufficient')::boolean,false),'shortage',coalesce((fefo->>'shortage')::numeric,item_row.quantity),'allocations',coalesce(fefo->'lines','[]'::jsonb)));
    end loop;
  end if;

  if item_count=0 then reasons:=reasons||jsonb_build_array(jsonb_build_object('code','no_promiseable_items')); end if;
  return jsonb_build_object('ok',true,'item_count',item_count,'total_item_units',total_units,'shortage_count',shortage_count,'sufficient',(item_count>0 and shortage_count=0),'reasons',reasons,'lines',results,'external_side_effect',false);
end;$$;

create or replace function public.preview_order_promise_core_v1(p_source_type text,p_source_id uuid,p_target_delivery_date date,p_delivery_address jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  cfg public.order_promise_runtime_config%rowtype;
  source_type text:=lower(trim(coalesce(p_source_type,'')));
  local_today date:=(now() at time zone 'America/Cuiaba')::date;
  local_time time:=(now() at time zone 'America/Cuiaba')::time;
  source_status text;
  pricing_status text;
  effective_address jsonb:=coalesce(p_delivery_address,'{}'::jsonb);
  inv jsonb;
  reasons jsonb:='[]'::jsonb;
  blocked boolean:=false;
  review boolean:=false;
  cap public.order_promise_daily_capacity%rowtype;
  used_orders integer:=0;
  used_units numeric:=0;
  used_stops integer:=0;
  total_units numeric:=0;
  capacity_snapshot jsonb:='{}'::jsonb;
  result text;
begin
  select * into cfg from public.order_promise_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','order_promise_preview_disabled','side_effect_performed',false,'external_side_effect',false);
  end if;
  if source_type not in ('cart','order') or p_source_id is null or p_target_delivery_date is null then
    return jsonb_build_object('ok',false,'error','invalid_promise_input','side_effect_performed',false,'external_side_effect',false);
  end if;
  if p_target_delivery_date<local_today then blocked:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','delivery_date_in_past')); end if;
  if cfg.max_horizon_days is not null and p_target_delivery_date>local_today+cfg.max_horizon_days then blocked:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','delivery_date_beyond_horizon','max_horizon_days',cfg.max_horizon_days)); end if;

  if source_type='cart' then
    select c.status,c.pricing_status into source_status,pricing_status from public.carts c where c.id=p_source_id;
    if not found then return jsonb_build_object('ok',false,'error','cart_not_found','side_effect_performed',false,'external_side_effect',false); end if;
    if source_status not in ('draft','confirmed') then blocked:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','cart_not_promiseable','status',source_status)); end if;
    if pricing_status<>'ready' then review:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','cart_pricing_needs_review','pricing_status',pricing_status)); end if;
  else
    select o.status,case when p_delivery_address is null then o.delivery_address else p_delivery_address end into source_status,effective_address from public.orders o where o.id=p_source_id;
    if not found then return jsonb_build_object('ok',false,'error','order_not_found','side_effect_performed',false,'external_side_effect',false); end if;
    if source_status not in ('confirmed','sent_to_bling','processing') then blocked:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','order_not_promiseable','status',source_status)); end if;
  end if;

  if cfg.require_delivery_address and (effective_address is null or jsonb_typeof(effective_address)<>'object' or effective_address='{}'::jsonb) then
    blocked:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','delivery_address_missing'));
  end if;

  inv:=public.preview_promise_inventory_v1(source_type,p_source_id,p_target_delivery_date,cfg.min_shelf_life_days);
  if coalesce((inv->>'ok')::boolean,false)=false then return inv; end if;
  total_units:=coalesce((inv->>'total_item_units')::numeric,0);
  reasons:=reasons||coalesce(inv->'reasons','[]'::jsonb);
  if coalesce((inv->>'sufficient')::boolean,false)=false then blocked:=true; end if;

  select * into cap from public.order_promise_daily_capacity where capacity_date=p_target_delivery_date and status='active';
  if not found then
    if cfg.require_capacity_rule then review:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','capacity_rule_missing','date',p_target_delivery_date)); end if;
    capacity_snapshot:=jsonb_build_object('rule_found',false,'date',p_target_delivery_date);
  else
    select count(*)::integer,coalesce(sum(item_units),0),coalesce(sum(delivery_stops),0)
      into used_orders,used_units,used_stops
      from public.order_promise_commitments
      where promised_date=p_target_delivery_date and status in ('held','committed');

    if cfg.same_day_cutoff_enforced and p_target_delivery_date=local_today then
      if cap.same_day_cutoff_local is null then review:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','same_day_cutoff_unknown')); 
      elsif local_time>cap.same_day_cutoff_local then blocked:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','same_day_cutoff_passed','cutoff',cap.same_day_cutoff_local)); end if;
    end if;

    if cap.fulfillment_max_orders is null then review:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','fulfillment_order_capacity_unknown'));
    elsif used_orders+1>cap.fulfillment_max_orders then blocked:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','fulfillment_order_capacity_exceeded','used',used_orders,'limit',cap.fulfillment_max_orders)); end if;

    if cap.fulfillment_max_item_units is null then review:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','fulfillment_item_capacity_unknown'));
    elsif used_units+total_units>cap.fulfillment_max_item_units then blocked:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','fulfillment_item_capacity_exceeded','used',used_units,'requested',total_units,'limit',cap.fulfillment_max_item_units)); end if;

    if cap.delivery_max_stops is null then review:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','delivery_capacity_unknown'));
    elsif used_stops+1>cap.delivery_max_stops then blocked:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','delivery_capacity_exceeded','used',used_stops,'limit',cap.delivery_max_stops)); end if;

    if cap.available_drivers is null then review:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','driver_capacity_unknown'));
    elsif cap.available_drivers=0 then blocked:=true; reasons:=reasons||jsonb_build_array(jsonb_build_object('code','no_driver_available')); end if;

    capacity_snapshot:=jsonb_build_object('rule_found',true,'date',cap.capacity_date,'version_no',cap.version_no,'used_orders',used_orders,'used_item_units',used_units,'used_stops',used_stops,'fulfillment_max_orders',cap.fulfillment_max_orders,'fulfillment_max_item_units',cap.fulfillment_max_item_units,'delivery_max_stops',cap.delivery_max_stops,'available_drivers',cap.available_drivers,'same_day_cutoff_local',cap.same_day_cutoff_local);
  end if;

  result:=case when blocked then 'blocked' when review then 'review' else 'eligible' end;
  return jsonb_build_object('ok',true,'source_type',source_type,'source_id',p_source_id,'target_delivery_date',p_target_delivery_date,'result',result,'promiseable',result='eligible','reasons',reasons,'line_results',coalesce(inv->'lines','[]'::jsonb),'total_item_units',total_units,'capacity',capacity_snapshot,'address_present',(effective_address is not null and jsonb_typeof(effective_address)='object' and effective_address<>'{}'::jsonb),'side_effect_performed',false,'external_side_effect',false);
end;$$;

create or replace function public.preview_cart_promise_v1(p_cart_id uuid,p_target_delivery_date date,p_delivery_address jsonb)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select public.preview_order_promise_core_v1('cart',p_cart_id,p_target_delivery_date,p_delivery_address);
$$;

create or replace function public.preview_order_promise_v1(p_order_id uuid,p_target_delivery_date date,p_delivery_address jsonb default null)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select public.preview_order_promise_core_v1('order',p_order_id,p_target_delivery_date,p_delivery_address);
$$;

create or replace function public.record_order_promise_evaluation_v1(p_source_type text,p_source_id uuid,p_target_delivery_date date,p_delivery_address jsonb,p_evaluation_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.order_promise_runtime_config%rowtype; prior uuid; preview jsonb; eid uuid;
begin
  select * into cfg from public.order_promise_runtime_config where id=1;
  if not cfg.enabled or not cfg.preview_enabled or not cfg.evaluation_recording_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then return jsonb_build_object('ok',false,'error','promise_evaluation_recording_disabled','side_effect_performed',false,'external_side_effect',false); end if;
  if length(trim(coalesce(p_evaluation_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_evaluation_key','side_effect_performed',false,'external_side_effect',false); end if;
  select id into prior from public.order_promise_evaluations where evaluation_key=trim(p_evaluation_key);if found then return jsonb_build_object('ok',true,'replay',true,'evaluation_id',prior,'side_effect_performed',false,'external_side_effect',false);end if;
  preview:=public.preview_order_promise_core_v1(p_source_type,p_source_id,p_target_delivery_date,p_delivery_address);
  if coalesce((preview->>'ok')::boolean,false)=false then return preview; end if;
  insert into public.order_promise_evaluations(source_type,source_id,target_delivery_date,result,reasons,line_results,capacity_snapshot,total_item_units,address_present,evaluation_key)
  values(lower(trim(p_source_type)),p_source_id,p_target_delivery_date,preview->>'result',coalesce(preview->'reasons','[]'::jsonb),coalesce(preview->'line_results','[]'::jsonb),coalesce(preview->'capacity','{}'::jsonb),coalesce((preview->>'total_item_units')::numeric,0),coalesce((preview->>'address_present')::boolean,false),trim(p_evaluation_key)) returning id into eid;
  return jsonb_build_object('ok',true,'replay',false,'evaluation_id',eid,'result',preview->>'result','side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.preview_order_change_control_v1(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.orders%rowtype; f public.fulfillment_orders%rowtype; ctl public.order_operational_controls%rowtype; effective_version integer:=1; lock_state text:='editable'; lock_reason text:=null; direct_allowed boolean:=true;
begin
  select * into o from public.orders where id=p_order_id;if not found then return jsonb_build_object('ok',false,'error','order_not_found','external_side_effect',false);end if;
  select * into ctl from public.order_operational_controls where order_id=o.id;if found then effective_version:=ctl.order_version;end if;
  if o.status in ('ready','out_for_delivery','delivered','cancelled','returned') then lock_state:='closed';lock_reason:='commercial_state_'||o.status;direct_allowed:=false;
  else
    select * into f from public.fulfillment_orders where order_id=o.id order by created_at desc limit 1;
    if found then
      if f.status='pending' then lock_state:='soft_locked';lock_reason:='fulfillment_materialized';direct_allowed:=false;
      elsif f.status in ('picking','picked','checking','checked','packing','packed','ready','loading','loaded','exception') then lock_state:='fulfillment_locked';lock_reason:='fulfillment_'||f.status;direct_allowed:=false;
      elsif f.status='cancelled' then lock_state:='editable';lock_reason:='fulfillment_cancelled';direct_allowed:=true;end if;
    end if;
  end if;
  return jsonb_build_object('ok',true,'order_id',o.id,'order_status',o.status,'order_version',effective_version,'lock_state',lock_state,'lock_reason',lock_reason,'direct_change_allowed',direct_allowed,'change_request_required',not direct_allowed and lock_state<>'closed','external_side_effect',false);
end;$$;

create or replace function public.create_order_change_request_v1(p_order_id uuid,p_expected_order_version integer,p_requested_changes jsonb,p_requested_by_type text,p_requested_by uuid,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.order_promise_runtime_config%rowtype; prior uuid; snapshot jsonb; request_id uuid; effective_status text; current_version integer;
begin
  select * into cfg from public.order_promise_runtime_config where id=1;
  if not cfg.enabled or not cfg.change_control_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','order_change_control_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  if p_expected_order_version is null or p_expected_order_version<=0 or p_requested_changes is null or jsonb_typeof(p_requested_changes)<>'object' or p_requested_changes='{}'::jsonb or lower(trim(coalesce(p_requested_by_type,''))) not in ('customer','admin','ai','system') or length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_change_request','side_effect_performed',false,'external_side_effect',false);end if;
  select id into prior from public.order_change_requests where idempotency_key=trim(p_idempotency_key);if found then return jsonb_build_object('ok',true,'replay',true,'change_request_id',prior,'side_effect_performed',false,'external_side_effect',false);end if;
  snapshot:=public.preview_order_change_control_v1(p_order_id);if coalesce((snapshot->>'ok')::boolean,false)=false then return snapshot;end if;
  current_version:=coalesce((snapshot->>'order_version')::integer,1);if current_version<>p_expected_order_version then return jsonb_build_object('ok',false,'error','order_version_conflict','expected_version',p_expected_order_version,'current_version',current_version,'side_effect_performed',false,'external_side_effect',false);end if;
  if snapshot->>'lock_state'='closed' then return jsonb_build_object('ok',false,'error','order_change_closed','lock_reason',snapshot->>'lock_reason','side_effect_performed',false,'external_side_effect',false);end if;
  effective_status:=case when coalesce((snapshot->>'direct_change_allowed')::boolean,false) then 'draft' else 'review_required' end;
  insert into public.order_operational_controls(order_id,order_version,lock_state,locked_at,lock_reason,updated_at)
  values(p_order_id,current_version,snapshot->>'lock_state',case when snapshot->>'lock_state'='editable' then null else now() end,snapshot->>'lock_reason',now())
  on conflict(order_id) do update set lock_state=excluded.lock_state,locked_at=coalesce(public.order_operational_controls.locked_at,excluded.locked_at),lock_reason=excluded.lock_reason,updated_at=now();
  insert into public.order_change_requests(order_id,expected_order_version,requested_changes,reason,requested_by_type,requested_by,status,lock_snapshot,idempotency_key)
  values(p_order_id,current_version,p_requested_changes,nullif(trim(coalesce(p_reason,'')),''),lower(trim(p_requested_by_type)),p_requested_by,effective_status,snapshot,trim(p_idempotency_key)) returning id into request_id;
  insert into public.order_change_events(order_id,change_request_id,event_type,actor_type,actor_id,payload) values(p_order_id,request_id,'CHANGE_REQUEST_CREATED',lower(trim(p_requested_by_type)),p_requested_by,jsonb_build_object('status',effective_status,'lock_state',snapshot->>'lock_state','order_version',current_version));
  return jsonb_build_object('ok',true,'replay',false,'change_request_id',request_id,'status',effective_status,'lock_state',snapshot->>'lock_state','order_version',current_version,'order_mutated',false,'side_effect_performed',true,'external_side_effect',false);
end;$$;

-- Server-only objects. Browser/anon/authenticated have no direct table/RPC access.
revoke all on table public.order_promise_runtime_config,public.order_promise_daily_capacity,public.order_promise_evaluations,public.order_promise_commitments,public.order_operational_controls,public.order_change_requests,public.order_change_events from public,anon,authenticated;
grant select,insert,update,delete on table public.order_promise_runtime_config,public.order_promise_daily_capacity,public.order_promise_evaluations,public.order_promise_commitments,public.order_operational_controls,public.order_change_requests,public.order_change_events to service_role;

revoke all on function public.preview_promise_inventory_v1(text,uuid,date,integer) from public,anon,authenticated;
revoke all on function public.preview_order_promise_core_v1(text,uuid,date,jsonb) from public,anon,authenticated;
revoke all on function public.preview_cart_promise_v1(uuid,date,jsonb) from public,anon,authenticated;
revoke all on function public.preview_order_promise_v1(uuid,date,jsonb) from public,anon,authenticated;
revoke all on function public.record_order_promise_evaluation_v1(text,uuid,date,jsonb,text) from public,anon,authenticated;
revoke all on function public.preview_order_change_control_v1(uuid) from public,anon,authenticated;
revoke all on function public.create_order_change_request_v1(uuid,integer,jsonb,text,uuid,text,text) from public,anon,authenticated;

grant execute on function public.preview_promise_inventory_v1(text,uuid,date,integer),public.preview_order_promise_core_v1(text,uuid,date,jsonb),public.preview_cart_promise_v1(uuid,date,jsonb),public.preview_order_promise_v1(uuid,date,jsonb),public.record_order_promise_evaluation_v1(text,uuid,date,jsonb,text),public.preview_order_change_control_v1(uuid),public.create_order_change_request_v1(uuid,integer,jsonb,text,uuid,text,text) to service_role;

commit;
