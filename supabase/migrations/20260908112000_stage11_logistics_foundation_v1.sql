begin;

create table if not exists public.logistics_runtime_config (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  job_creation_enabled boolean not null default false,
  routing_enabled boolean not null default false,
  driver_app_enabled boolean not null default false,
  gps_tracking_enabled boolean not null default false,
  notifications_enabled boolean not null default false,
  external_provider_enabled boolean not null default false,
  provider_name text not null default 'none',
  canary_percent smallint not null default 0 check (canary_percent between 0 and 100),
  approaching_eta_threshold_seconds integer not null default 180 check (approaching_eta_threshold_seconds between 30 and 3600),
  minimum_gps_freshness_seconds integer not null default 120 check (minimum_gps_freshness_seconds between 15 and 3600),
  minimum_eta_confidence numeric(5,4) not null default 0.8000 check (minimum_eta_confidence between 0 and 1),
  notification_cooldown_seconds integer not null default 300 check (notification_cooldown_seconds between 30 and 86400),
  routing_batch_window_minutes integer not null default 15 check (routing_batch_window_minutes between 1 and 240),
  max_provider_calls_per_route integer not null default 20 check (max_provider_calls_per_route between 0 and 500),
  max_provider_cost_brl_per_route numeric(10,2) not null default 0 check (max_provider_cost_brl_per_route >= 0),
  location_retention_days integer not null default 30 check (location_retention_days between 1 and 365),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.logistics_runtime_config(id)
values (1)
on conflict (id) do nothing;

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  display_name text not null,
  phone_e164 text,
  status text not null default 'inactive' check (status in ('inactive','available','assigned','on_route','suspended')),
  max_active_routes smallint not null default 1 check (max_active_routes between 1 and 3),
  capabilities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  status text not null default 'inactive' check (status in ('inactive','available','assigned','maintenance','disabled')),
  vehicle_type text not null default 'car' check (vehicle_type in ('car','motorcycle','van','other')),
  max_stops integer check (max_stops is null or max_stops > 0),
  max_weight_kg numeric(10,2) check (max_weight_kg is null or max_weight_kg > 0),
  max_volume_units integer check (max_volume_units is null or max_volume_units > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  attempt_no smallint not null default 1 check (attempt_no between 1 and 20),
  idempotency_key text not null,
  status text not null default 'waiting_route' check (status in ('waiting_route','planned','assigned','out_for_delivery','delivered','failed','suspended','reschedule_required','cancelled')),
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  contact_e164 text,
  address_snapshot jsonb not null,
  latitude double precision,
  longitude double precision,
  coordinate_source text not null default 'unknown' check (coordinate_source in ('unknown','customer_pin','geocoded','admin_confirmed','driver_corrected')),
  coordinate_confidence numeric(5,4) check (coordinate_confidence is null or coordinate_confidence between 0 and 1),
  coordinate_confirmed_at timestamptz,
  geocode_status text not null default 'required' check (geocode_status in ('required','confirmed','blocked','not_required')),
  reference_text text,
  volumes integer not null default 1 check (volumes > 0),
  amount_due numeric(12,2) not null default 0 check (amount_due >= 0),
  payment_method text not null default 'delivery_unspecified',
  priority smallint not null default 0 check (priority between 0 and 5),
  delivery_window_start timestamptz,
  delivery_window_end timestamptz,
  operational_notes text,
  ready_at timestamptz not null,
  delivered_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id,attempt_no),
  unique(idempotency_key),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (delivery_window_end is null or delivery_window_start is null or delivery_window_end >= delivery_window_start)
);

create table if not exists public.delivery_routes (
  id uuid primary key default gen_random_uuid(),
  route_code text not null unique,
  route_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft','optimized','published','active','completed','cancelled')),
  driver_id uuid references public.drivers(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  provider_name text not null default 'none',
  optimization_status text not null default 'not_requested' check (optimization_status in ('not_requested','held','drafted','optimized','review_required','failed')),
  planned_start_at timestamptz,
  published_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  estimated_distance_m integer check (estimated_distance_m is null or estimated_distance_m >= 0),
  estimated_duration_seconds integer check (estimated_duration_seconds is null or estimated_duration_seconds >= 0),
  version_no integer not null default 0 check (version_no >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.delivery_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.delivery_routes(id) on delete cascade,
  delivery_job_id uuid not null references public.delivery_jobs(id) on delete restrict,
  sequence_no integer not null check (sequence_no > 0),
  status text not null default 'planned' check (status in ('planned','locked_next','active','arrived','delivered','failed','skipped','rescheduled')),
  locked boolean not null default false,
  locked_reason text,
  eta_seconds integer check (eta_seconds is null or eta_seconds >= 0),
  eta_confidence numeric(5,4) check (eta_confidence is null or eta_confidence between 0 and 1),
  eta_computed_at timestamptz,
  activated_at timestamptz,
  arrived_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(route_id,sequence_no),
  unique(route_id,delivery_job_id)
);

create table if not exists public.delivery_route_versions (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.delivery_routes(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  snapshot jsonb not null,
  reason text not null,
  actor_type text not null default 'system' check (actor_type in ('system','admin','driver')),
  actor_id uuid,
  created_at timestamptz not null default now(),
  unique(route_id,version_no)
);

create table if not exists public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_job_id uuid references public.delivery_jobs(id) on delete cascade,
  route_id uuid references public.delivery_routes(id) on delete cascade,
  stop_id uuid references public.delivery_stops(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system' check (actor_type in ('system','admin','driver','customer','provider')),
  actor_id uuid,
  client_event_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists delivery_events_client_event_uniq on public.delivery_events(client_event_id) where client_event_id is not null;

create table if not exists public.delivery_incidents (
  id uuid primary key default gen_random_uuid(),
  delivery_job_id uuid not null references public.delivery_jobs(id) on delete cascade,
  route_id uuid references public.delivery_routes(id) on delete set null,
  stop_id uuid references public.delivery_stops(id) on delete set null,
  incident_type text not null check (incident_type in ('customer_absent','address_issue','payment_issue','vehicle_issue','delay','damage','safety','other')),
  status text not null default 'open' check (status in ('open','review_required','resolved','cancelled')),
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_by_type text not null default 'driver' check (created_by_type in ('system','admin','driver')),
  created_by uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_locations (
  id bigint generated by default as identity primary key,
  driver_id uuid not null references public.drivers(id) on delete cascade,
  route_id uuid not null references public.delivery_routes(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m numeric(8,2) check (accuracy_m is null or accuracy_m >= 0),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  client_event_id text not null unique,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists driver_locations_route_time_idx on public.driver_locations(route_id,captured_at desc);

create table if not exists public.delivery_notifications (
  id uuid primary key default gen_random_uuid(),
  delivery_job_id uuid not null references public.delivery_jobs(id) on delete cascade,
  route_id uuid references public.delivery_routes(id) on delete set null,
  stop_id uuid references public.delivery_stops(id) on delete set null,
  notification_type text not null check (notification_type in ('ready_for_route','next_stop','approaching','delivered','exception')),
  channel text not null default 'whatsapp' check (channel in ('whatsapp','sms','email','none')),
  status text not null default 'held' check (status in ('held','queued','sent','delivered','failed','review_required','cancelled')),
  idempotency_key text not null unique,
  provider_message_id text,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.routing_provider_calls (
  id uuid primary key default gen_random_uuid(),
  route_id uuid references public.delivery_routes(id) on delete set null,
  delivery_job_id uuid references public.delivery_jobs(id) on delete set null,
  provider_name text not null default 'none',
  operation text not null check (operation in ('optimize_routes','compute_eta','geocode')),
  request_hash text not null,
  status text not null default 'held' check (status in ('held','dry_run','success','failed','review_required')),
  external_call_performed boolean not null default false,
  estimated_cost_brl numeric(12,6) not null default 0 check (estimated_cost_brl >= 0),
  actual_cost_brl numeric(12,6) check (actual_cost_brl is null or actual_cost_brl >= 0),
  input_meta jsonb not null default '{}'::jsonb,
  output_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.logistics_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_type text not null default 'system' check (actor_type in ('system','admin','driver')),
  actor_id uuid,
  entity_type text,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists delivery_jobs_status_ready_idx on public.delivery_jobs(status,ready_at,priority desc);
create index if not exists delivery_routes_status_date_idx on public.delivery_routes(status,route_date);
create index if not exists delivery_stops_route_status_idx on public.delivery_stops(route_id,status,sequence_no);
create index if not exists delivery_events_job_time_idx on public.delivery_events(delivery_job_id,created_at desc);
create index if not exists delivery_notifications_status_idx on public.delivery_notifications(status,created_at);
create index if not exists routing_provider_calls_route_idx on public.routing_provider_calls(route_id,created_at desc);

alter table public.logistics_runtime_config enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.delivery_jobs enable row level security;
alter table public.delivery_routes enable row level security;
alter table public.delivery_stops enable row level security;
alter table public.delivery_route_versions enable row level security;
alter table public.delivery_events enable row level security;
alter table public.delivery_incidents enable row level security;
alter table public.driver_locations enable row level security;
alter table public.delivery_notifications enable row level security;
alter table public.routing_provider_calls enable row level security;
alter table public.logistics_audit_events enable row level security;

revoke all on public.logistics_runtime_config,public.drivers,public.vehicles,public.delivery_jobs,public.delivery_routes,public.delivery_stops,public.delivery_route_versions,public.delivery_events,public.delivery_incidents,public.driver_locations,public.delivery_notifications,public.routing_provider_calls,public.logistics_audit_events from public,anon,authenticated;
grant select,insert,update,delete on public.logistics_runtime_config,public.drivers,public.vehicles,public.delivery_jobs,public.delivery_routes,public.delivery_stops,public.delivery_route_versions,public.delivery_events,public.delivery_incidents,public.driver_locations,public.delivery_notifications,public.routing_provider_calls,public.logistics_audit_events to service_role;
grant usage,select on sequence public.driver_locations_id_seq to service_role;

create or replace function public.logistics_readiness_v1()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'enabled',c.enabled,
    'execution_mode',c.execution_mode,
    'job_creation_enabled',c.job_creation_enabled,
    'routing_enabled',c.routing_enabled,
    'driver_app_enabled',c.driver_app_enabled,
    'gps_tracking_enabled',c.gps_tracking_enabled,
    'notifications_enabled',c.notifications_enabled,
    'external_provider_enabled',c.external_provider_enabled,
    'provider_name',c.provider_name,
    'canary_percent',c.canary_percent,
    'runtime_released',c.enabled and c.execution_mode in ('homologation','canary','live'),
    'external_provider_released',c.enabled and c.external_provider_enabled and c.provider_name <> 'none',
    'jobs',(select count(*) from public.delivery_jobs),
    'routes',(select count(*) from public.delivery_routes),
    'active_routes',(select count(*) from public.delivery_routes where status='active'),
    'drivers',(select count(*) from public.drivers),
    'vehicles',(select count(*) from public.vehicles),
    'provider_calls_performed',(select count(*) from public.routing_provider_calls where external_call_performed),
    'notifications_sent',(select count(*) from public.delivery_notifications where status in ('sent','delivered'))
  ) from public.logistics_runtime_config c where c.id=1;
$$;

create or replace function public.preview_delivery_job_from_ready_order_v1(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.orders%rowtype;
  lat double precision;
  lng double precision;
  addr jsonb;
  missing text[]:=array[]::text[];
  source text:='unknown';
  confidence numeric(5,4);
  geocode text:='required';
begin
  select * into o from public.orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found'); end if;
  if o.status <> 'ready' then return jsonb_build_object('ok',false,'error','order_not_ready','order_status',o.status); end if;
  addr:=coalesce(o.delivery_address,'{}'::jsonb);
  if addr='{}'::jsonb then missing:=array_append(missing,'delivery_address'); end if;
  if jsonb_typeof(addr->'latitude')='number' then lat:=(addr->>'latitude')::double precision; end if;
  if jsonb_typeof(addr->'longitude')='number' then lng:=(addr->>'longitude')::double precision; end if;
  if lat is not null and lng is not null and lat between -90 and 90 and lng between -180 and 180 then
    source:=case when coalesce(addr->>'coordinate_source','') in ('customer_pin','geocoded','admin_confirmed','driver_corrected') then addr->>'coordinate_source' else 'unknown' end;
    if jsonb_typeof(addr->'coordinate_confidence')='number' then confidence:=greatest(0,least(1,(addr->>'coordinate_confidence')::numeric)); end if;
    geocode:='not_required';
  else
    lat:=null; lng:=null; missing:=array_append(missing,'coordinates_or_geocode');
  end if;
  return jsonb_build_object(
    'ok',cardinality(missing)=0 or (cardinality(missing)=1 and missing[1]='coordinates_or_geocode'),
    'order_id',o.id,
    'order_status',o.status,
    'customer_id',o.customer_id,
    'address_snapshot',addr,
    'latitude',lat,
    'longitude',lng,
    'coordinate_source',source,
    'coordinate_confidence',confidence,
    'geocode_status',geocode,
    'amount_due',o.total,
    'ready_at',coalesce(o.external_status_updated_at,o.updated_at,o.created_at),
    'missing',to_jsonb(missing),
    'side_effect_performed',false
  );
end;
$$;

create or replace function public.create_delivery_job_from_ready_order_v1(p_order_id uuid,p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.logistics_runtime_config%rowtype;
  o public.orders%rowtype;
  p jsonb;
  existing public.delivery_jobs%rowtype;
  job public.delivery_jobs%rowtype;
  key text:=nullif(trim(coalesce(p_idempotency_key,'')),'');
begin
  select * into cfg from public.logistics_runtime_config where id=1 for update;
  if not cfg.enabled or not cfg.job_creation_enabled or cfg.execution_mode='off' then
    return jsonb_build_object('ok',false,'error','logistics_job_creation_disabled','side_effect_performed',false);
  end if;
  if key is null or length(key)>160 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','side_effect_performed',false); end if;
  select * into existing from public.delivery_jobs where idempotency_key=key;
  if found then return jsonb_build_object('ok',true,'replay',true,'delivery_job_id',existing.id,'status',existing.status,'side_effect_performed',false); end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found','side_effect_performed',false); end if;
  p:=public.preview_delivery_job_from_ready_order_v1(p_order_id);
  if coalesce((p->>'ok')::boolean,false)=false then return p; end if;
  insert into public.delivery_jobs(
    order_id,attempt_no,idempotency_key,status,customer_id,customer_name,contact_e164,address_snapshot,latitude,longitude,coordinate_source,coordinate_confidence,geocode_status,reference_text,volumes,amount_due,payment_method,priority,delivery_window_start,delivery_window_end,operational_notes,ready_at
  ) values (
    o.id,1,key,'waiting_route',o.customer_id,nullif(o.customer_snapshot->>'name',''),nullif(o.customer_snapshot->>'whatsapp_e164',''),o.delivery_address,
    nullif(p->>'latitude','')::double precision,nullif(p->>'longitude','')::double precision,coalesce(p->>'coordinate_source','unknown'),nullif(p->>'coordinate_confidence','')::numeric,coalesce(p->>'geocode_status','required'),
    nullif(o.delivery_address->>'reference',''),greatest(1,coalesce(nullif(o.delivery_address->>'volumes','')::integer,1)),o.total,'delivery_unspecified',0,
    nullif(o.delivery_address->>'window_start','')::timestamptz,nullif(o.delivery_address->>'window_end','')::timestamptz,nullif(o.delivery_address->>'operational_notes',''),coalesce(o.external_status_updated_at,o.updated_at,o.created_at)
  ) returning * into job;
  insert into public.delivery_events(delivery_job_id,event_type,actor_type,payload) values(job.id,'ORDER_READY','system',jsonb_build_object('order_id',o.id,'geocode_status',job.geocode_status));
  return jsonb_build_object('ok',true,'replay',false,'delivery_job_id',job.id,'status',job.status,'geocode_status',job.geocode_status,'side_effect_performed',true);
exception when unique_violation then
  select * into existing from public.delivery_jobs where idempotency_key=key or (order_id=p_order_id and attempt_no=1) order by created_at limit 1;
  return jsonb_build_object('ok',true,'replay',true,'delivery_job_id',existing.id,'status',existing.status,'side_effect_performed',false);
end;
$$;

create or replace function public.transition_delivery_job_v1(p_delivery_job_id uuid,p_new_status text,p_actor_type text default 'system',p_actor_id uuid default null,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  j public.delivery_jobs%rowtype;
  old text;
  allowed boolean:=false;
begin
  select * into j from public.delivery_jobs where id=p_delivery_job_id for update;
  if not found then return jsonb_build_object('ok',false,'error','delivery_job_not_found'); end if;
  old:=j.status;
  if old=p_new_status then return jsonb_build_object('ok',true,'replay',true,'status',old,'side_effect_performed',false); end if;
  allowed:=case old
    when 'waiting_route' then p_new_status in ('planned','suspended','cancelled')
    when 'planned' then p_new_status in ('assigned','waiting_route','suspended','cancelled')
    when 'assigned' then p_new_status in ('out_for_delivery','planned','suspended','cancelled')
    when 'out_for_delivery' then p_new_status in ('delivered','failed','suspended','reschedule_required')
    when 'failed' then p_new_status in ('reschedule_required','cancelled')
    when 'reschedule_required' then p_new_status in ('waiting_route','cancelled')
    when 'suspended' then p_new_status in ('waiting_route','planned','assigned','cancelled')
    else false end;
  if not allowed then return jsonb_build_object('ok',false,'error','invalid_delivery_job_transition','from',old,'to',p_new_status); end if;
  update public.delivery_jobs set status=p_new_status,updated_at=now(),delivered_at=case when p_new_status='delivered' then now() else delivered_at end,failed_at=case when p_new_status='failed' then now() else failed_at end,cancelled_at=case when p_new_status='cancelled' then now() else cancelled_at end where id=j.id;
  insert into public.delivery_events(delivery_job_id,event_type,actor_type,actor_id,payload) values(j.id,'DELIVERY_JOB_STATUS_CHANGED',coalesce(nullif(p_actor_type,''),'system'),p_actor_id,jsonb_build_object('from',old,'to',p_new_status,'reason',p_reason));
  return jsonb_build_object('ok',true,'replay',false,'from',old,'to',p_new_status,'side_effect_performed',true);
end;
$$;

create or replace function public.transition_delivery_route_v1(p_route_id uuid,p_new_status text,p_actor_type text default 'system',p_actor_id uuid default null,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  r public.delivery_routes%rowtype;
  old text;
  allowed boolean:=false;
begin
  select * into r from public.delivery_routes where id=p_route_id for update;
  if not found then return jsonb_build_object('ok',false,'error','route_not_found'); end if;
  old:=r.status;
  if old=p_new_status then return jsonb_build_object('ok',true,'replay',true,'status',old,'side_effect_performed',false); end if;
  allowed:=case old
    when 'draft' then p_new_status in ('optimized','published','cancelled')
    when 'optimized' then p_new_status in ('draft','published','cancelled')
    when 'published' then p_new_status in ('active','cancelled')
    when 'active' then p_new_status in ('completed','cancelled')
    else false end;
  if not allowed then return jsonb_build_object('ok',false,'error','invalid_route_transition','from',old,'to',p_new_status); end if;
  if p_new_status='active' and r.driver_id is null then return jsonb_build_object('ok',false,'error','route_driver_required'); end if;
  update public.delivery_routes set status=p_new_status,updated_at=now(),published_at=case when p_new_status='published' then coalesce(published_at,now()) else published_at end,started_at=case when p_new_status='active' then coalesce(started_at,now()) else started_at end,completed_at=case when p_new_status='completed' then coalesce(completed_at,now()) else completed_at end where id=r.id;
  insert into public.delivery_events(route_id,event_type,actor_type,actor_id,payload) values(r.id,'ROUTE_STATUS_CHANGED',coalesce(nullif(p_actor_type,''),'system'),p_actor_id,jsonb_build_object('from',old,'to',p_new_status,'reason',p_reason));
  return jsonb_build_object('ok',true,'from',old,'to',p_new_status,'side_effect_performed',true);
end;
$$;

create or replace function public.transition_delivery_stop_v1(p_stop_id uuid,p_new_status text,p_actor_type text default 'system',p_actor_id uuid default null,p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  s public.delivery_stops%rowtype;
  old text;
  allowed boolean:=false;
begin
  select * into s from public.delivery_stops where id=p_stop_id for update;
  if not found then return jsonb_build_object('ok',false,'error','stop_not_found'); end if;
  old:=s.status;
  if old=p_new_status then return jsonb_build_object('ok',true,'replay',true,'status',old,'side_effect_performed',false); end if;
  allowed:=case old
    when 'planned' then p_new_status in ('locked_next','active','skipped','rescheduled')
    when 'locked_next' then p_new_status in ('active','rescheduled')
    when 'active' then p_new_status in ('arrived','failed','rescheduled')
    when 'arrived' then p_new_status in ('delivered','failed','rescheduled')
    when 'failed' then p_new_status in ('rescheduled','skipped')
    else false end;
  if not allowed then return jsonb_build_object('ok',false,'error','invalid_stop_transition','from',old,'to',p_new_status); end if;
  if s.locked and old='locked_next' and p_new_status='rescheduled' and coalesce(trim(p_reason),'')='' then return jsonb_build_object('ok',false,'error','locked_stop_override_reason_required'); end if;
  update public.delivery_stops set status=p_new_status,locked=case when p_new_status='locked_next' then true when p_new_status in ('delivered','failed','skipped','rescheduled') then false else locked end,locked_reason=case when p_new_status='locked_next' then coalesce(nullif(trim(p_reason),''),'next_stop_notified') else locked_reason end,updated_at=now(),activated_at=case when p_new_status='active' then coalesce(activated_at,now()) else activated_at end,arrived_at=case when p_new_status='arrived' then coalesce(arrived_at,now()) else arrived_at end,delivered_at=case when p_new_status='delivered' then coalesce(delivered_at,now()) else delivered_at end,failed_at=case when p_new_status='failed' then coalesce(failed_at,now()) else failed_at end where id=s.id;
  insert into public.delivery_events(delivery_job_id,route_id,stop_id,event_type,actor_type,actor_id,payload) values(s.delivery_job_id,s.route_id,s.id,'STOP_STATUS_CHANGED',coalesce(nullif(p_actor_type,''),'system'),p_actor_id,jsonb_build_object('from',old,'to',p_new_status,'reason',p_reason));
  return jsonb_build_object('ok',true,'from',old,'to',p_new_status,'side_effect_performed',true);
end;
$$;

create or replace function public.record_driver_location_v1(p_driver_id uuid,p_route_id uuid,p_latitude double precision,p_longitude double precision,p_accuracy_m numeric,p_captured_at timestamptz,p_client_event_id text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.logistics_runtime_config%rowtype;
  r public.delivery_routes%rowtype;
  existing_id bigint;
begin
  select * into cfg from public.logistics_runtime_config where id=1;
  if not cfg.enabled or not cfg.driver_app_enabled or not cfg.gps_tracking_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','gps_tracking_disabled','side_effect_performed',false);
  end if;
  select id into existing_id from public.driver_locations where client_event_id=p_client_event_id;
  if found then return jsonb_build_object('ok',true,'replay',true,'location_id',existing_id,'side_effect_performed',false); end if;
  select * into r from public.delivery_routes where id=p_route_id;
  if not found or r.status<>'active' or r.driver_id is distinct from p_driver_id then return jsonb_build_object('ok',false,'error','route_not_active_for_driver','side_effect_performed',false); end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then return jsonb_build_object('ok',false,'error','invalid_coordinates','side_effect_performed',false); end if;
  insert into public.driver_locations(driver_id,route_id,latitude,longitude,accuracy_m,captured_at,client_event_id) values(p_driver_id,p_route_id,p_latitude,p_longitude,p_accuracy_m,p_captured_at,p_client_event_id) returning id into existing_id;
  return jsonb_build_object('ok',true,'replay',false,'location_id',existing_id,'side_effect_performed',true);
end;
$$;

create or replace function public.get_driver_route_snapshot_v1(p_auth_user_id uuid)
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  with d as (
    select * from public.drivers where auth_user_id=p_auth_user_id and status<>'suspended' limit 1
  ), r as (
    select r.* from public.delivery_routes r join d on d.id=r.driver_id where r.status in ('published','active') order by r.route_date,r.created_at limit 1
  )
  select coalesce((select jsonb_build_object(
    'ok',true,
    'driver',jsonb_build_object('id',d.id,'display_name',d.display_name,'status',d.status),
    'route',jsonb_build_object('id',r.id,'route_code',r.route_code,'status',r.status,'route_date',r.route_date,'started_at',r.started_at),
    'stops',coalesce((select jsonb_agg(jsonb_build_object(
      'id',s.id,'sequence_no',s.sequence_no,'status',s.status,'locked',s.locked,
      'delivery_job_id',j.id,'address',j.address_snapshot,'latitude',j.latitude,'longitude',j.longitude,'reference',j.reference_text,'volumes',j.volumes,'amount_due',j.amount_due,'payment_method',j.payment_method,'operational_notes',j.operational_notes,'eta_seconds',s.eta_seconds,'eta_confidence',s.eta_confidence
    ) order by s.sequence_no) from public.delivery_stops s join public.delivery_jobs j on j.id=s.delivery_job_id where s.route_id=r.id),'[]'::jsonb)
  ) from d join r on true),jsonb_build_object('ok',false,'error','no_active_driver_route'));
$$;

create or replace function public.kill_logistics_runtime_v1(p_reason text default null,p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare before_row jsonb; after_row jsonb;
begin
  select to_jsonb(c) into before_row from public.logistics_runtime_config c where id=1 for update;
  update public.logistics_runtime_config set enabled=false,execution_mode='off',job_creation_enabled=false,routing_enabled=false,driver_app_enabled=false,gps_tracking_enabled=false,notifications_enabled=false,external_provider_enabled=false,provider_name='none',canary_percent=0,updated_at=now(),updated_by=p_actor_id where id=1;
  select to_jsonb(c) into after_row from public.logistics_runtime_config c where id=1;
  insert into public.logistics_audit_events(event_type,actor_type,actor_id,entity_type,before_state,after_state,reason) values('LOGISTICS_KILL_SWITCH','admin',p_actor_id,'logistics_runtime_config',before_row,after_row,p_reason);
  return jsonb_build_object('ok',true,'enabled',false,'execution_mode','off','external_side_effect',false);
end;
$$;

revoke all on function public.logistics_readiness_v1() from public,anon,authenticated;
revoke all on function public.preview_delivery_job_from_ready_order_v1(uuid) from public,anon,authenticated;
revoke all on function public.create_delivery_job_from_ready_order_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.transition_delivery_job_v1(uuid,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.transition_delivery_route_v1(uuid,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.transition_delivery_stop_v1(uuid,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.record_driver_location_v1(uuid,uuid,double precision,double precision,numeric,timestamptz,text) from public,anon,authenticated;
revoke all on function public.get_driver_route_snapshot_v1(uuid) from public,anon,authenticated;
revoke all on function public.kill_logistics_runtime_v1(text,uuid) from public,anon,authenticated;

grant execute on function public.logistics_readiness_v1() to service_role;
grant execute on function public.preview_delivery_job_from_ready_order_v1(uuid) to service_role;
grant execute on function public.create_delivery_job_from_ready_order_v1(uuid,text) to service_role;
grant execute on function public.transition_delivery_job_v1(uuid,text,text,uuid,text) to service_role;
grant execute on function public.transition_delivery_route_v1(uuid,text,text,uuid,text) to service_role;
grant execute on function public.transition_delivery_stop_v1(uuid,text,text,uuid,text) to service_role;
grant execute on function public.record_driver_location_v1(uuid,uuid,double precision,double precision,numeric,timestamptz,text) to service_role;
grant execute on function public.get_driver_route_snapshot_v1(uuid) to service_role;
grant execute on function public.kill_logistics_runtime_v1(text,uuid) to service_role;

commit;
