begin;

-- Stage 12E/12F/12G/12H — Label Service + Recall + Control Tower + SLA/Aging V1.
-- Server-only, deterministic and dormant. No printer, message, stock quarantine, Bling or external transport.

create table if not exists public.operational_control_runtime_config (
  id smallint primary key check(id=1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check(execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  label_preview_enabled boolean not null default false,
  label_recording_enabled boolean not null default false,
  label_dispatch_enabled boolean not null default false,
  recall_preview_enabled boolean not null default false,
  recall_case_enabled boolean not null default false,
  recall_quarantine_enabled boolean not null default false,
  control_tower_enabled boolean not null default false,
  sla_preview_enabled boolean not null default false,
  sla_exception_recording_enabled boolean not null default false,
  canary_percent numeric(5,2) not null default 0 check(canary_percent between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into public.operational_control_runtime_config(id) values(1) on conflict(id) do nothing;
alter table public.operational_control_runtime_config enable row level security;

create table if not exists public.label_documents (
  id uuid primary key default gen_random_uuid(),
  label_type text not null check(label_type in ('order','package','lot','location')),
  fulfillment_order_id uuid null references public.fulfillment_orders(id) on delete cascade,
  package_id uuid null references public.order_packages(id) on delete cascade,
  lot_id uuid null references public.inventory_lots(id) on delete restrict,
  location_id uuid null references public.warehouse_locations(id) on delete set null,
  width_mm integer not null default 100 check(width_mm>0),
  height_mm integer not null default 150 check(height_mm>0),
  barcode text null,
  qr_payload text null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check(status in ('draft','rendered','printed','cancelled')),
  print_count integer not null default 0 check(print_count>=0),
  document_key text not null unique,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.label_documents enable row level security;
create index if not exists label_documents_fulfillment_idx on public.label_documents(fulfillment_order_id,created_at desc);
create index if not exists label_documents_package_idx on public.label_documents(package_id,created_at desc) where package_id is not null;

create table if not exists public.label_events (
  id uuid primary key default gen_random_uuid(),
  label_document_id uuid not null references public.label_documents(id) on delete cascade,
  event_type text not null check(event_type in ('DRAFT_CREATED','RENDERED','PRINT_REQUESTED','PRINTED','REPRINT_REQUESTED','CANCELLED')),
  actor_type text not null default 'system',
  actor_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.label_events enable row level security;
create index if not exists label_events_document_idx on public.label_events(label_document_id,created_at);

create table if not exists public.recall_cases (
  id uuid primary key default gen_random_uuid(),
  case_code text not null unique,
  title text not null,
  reason text not null,
  severity text not null default 'review' check(severity in ('review','low','medium','high','critical')),
  status text not null default 'draft' check(status in ('draft','under_review','approved','active','resolved','cancelled')),
  source_type text not null default 'internal' check(source_type in ('internal','supplier','authority','customer','other')),
  instructions jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  quarantine_applied boolean not null default false,
  notifications_sent boolean not null default false,
  external_side_effect boolean not null default false,
  created_by uuid null,
  approved_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null
);
alter table public.recall_cases enable row level security;

create table if not exists public.recall_case_lots (
  id uuid primary key default gen_random_uuid(),
  recall_case_id uuid not null references public.recall_cases(id) on delete cascade,
  lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  impact_status text not null default 'pending_review' check(impact_status in ('pending_review','quarantine_required','cleared','resolved')),
  lot_snapshot jsonb not null default '{}'::jsonb,
  impact_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(recall_case_id,lot_id)
);
alter table public.recall_case_lots enable row level security;
create index if not exists recall_case_lots_lot_idx on public.recall_case_lots(lot_id,created_at desc);

create table if not exists public.recall_events (
  id uuid primary key default gen_random_uuid(),
  recall_case_id uuid not null references public.recall_cases(id) on delete cascade,
  event_type text not null,
  actor_type text not null default 'system',
  actor_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.recall_events enable row level security;
create index if not exists recall_events_case_idx on public.recall_events(recall_case_id,created_at);

create table if not exists public.operational_sla_policies (
  id uuid primary key default gen_random_uuid(),
  stage text not null check(stage in ('confirmed','promise_review','fulfillment_pending','picking','checking','packing','ready','delivery','delivered_unreconciled','fiscal_ready')),
  version_no integer not null default 1 check(version_no>0),
  status text not null default 'draft' check(status in ('draft','active','retired')),
  threshold_minutes integer null check(threshold_minutes is null or threshold_minutes>0),
  severity text not null default 'warning' check(severity in ('info','warning','critical')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(stage,version_no)
);
create unique index if not exists operational_sla_one_active_idx on public.operational_sla_policies(stage) where status='active';
alter table public.operational_sla_policies enable row level security;

create table if not exists public.operational_sla_exceptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  stage text not null,
  status text not null default 'open' check(status in ('open','acknowledged','resolved','cancelled')),
  age_minutes integer not null check(age_minutes>=0),
  threshold_minutes integer not null check(threshold_minutes>0),
  severity text not null check(severity in ('info','warning','critical')),
  evaluation_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null
);
alter table public.operational_sla_exceptions enable row level security;
create index if not exists operational_sla_exceptions_open_idx on public.operational_sla_exceptions(status,severity,created_at);
create index if not exists operational_sla_exceptions_order_idx on public.operational_sla_exceptions(order_id,created_at desc);

create or replace function public.preview_fulfillment_label_v1(
  p_fulfillment_order_id uuid,
  p_label_type text default 'order',
  p_package_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  cfg public.operational_control_runtime_config%rowtype;
  fo public.fulfillment_orders%rowtype;
  o public.orders%rowtype;
  pkg public.order_packages%rowtype;
  c public.customers%rowtype;
  label_type text:=lower(trim(coalesce(p_label_type,'order')));
  customer_name text;
  code text;
  payload jsonb;
begin
  select * into cfg from public.operational_control_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.label_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','label_preview_disabled','side_effect_performed',false,'external_side_effect',false);
  end if;
  if label_type not in ('order','package') or p_fulfillment_order_id is null then return jsonb_build_object('ok',false,'error','invalid_label_request','external_side_effect',false);end if;
  select * into fo from public.fulfillment_orders where id=p_fulfillment_order_id;if not found then return jsonb_build_object('ok',false,'error','fulfillment_order_not_found','external_side_effect',false);end if;
  select * into o from public.orders where id=fo.order_id;if not found then return jsonb_build_object('ok',false,'error','order_not_found','external_side_effect',false);end if;
  if o.customer_id is not null then select * into c from public.customers where id=o.customer_id;end if;
  customer_name:=coalesce(nullif(c.name,''),nullif(o.customer_snapshot->>'name',''),nullif(o.customer_snapshot->>'nome',''),'Cliente');
  code:='ORD-'||upper(left(replace(o.id::text,'-',''),10));

  if label_type='package' then
    if p_package_id is null then return jsonb_build_object('ok',false,'error','package_id_required','external_side_effect',false);end if;
    select * into pkg from public.order_packages where id=p_package_id and fulfillment_order_id=fo.id;
    if not found then return jsonb_build_object('ok',false,'error','package_not_found_for_fulfillment','external_side_effect',false);end if;
    payload:=jsonb_build_object(
      'label_type','package','format_mm',jsonb_build_object('width',100,'height',150),
      'order_code',code,'order_id',o.id,'fulfillment_order_id',fo.id,
      'customer_name',customer_name,'delivery_address',o.delivery_address,
      'package_no',pkg.package_no,'package_count',pkg.package_count,
      'volume_text',pkg.package_no::text||'/'||pkg.package_count::text,
      'barcode',pkg.barcode,'amount_visible',false,'price_fields',jsonb_build_array(),
      'external_side_effect',false
    );
  else
    payload:=jsonb_build_object(
      'label_type','order','format_mm',jsonb_build_object('width',100,'height',150),
      'order_code',code,'order_id',o.id,'fulfillment_order_id',fo.id,
      'customer_name',customer_name,'delivery_address',o.delivery_address,
      'amount_visible',false,'price_fields',jsonb_build_array(),
      'external_side_effect',false
    );
  end if;
  return jsonb_build_object('ok',true,'preview_only',true,'payload',payload,'side_effect_performed',false,'external_side_effect',false);
end;
$$;

create or replace function public.record_label_draft_v1(
  p_fulfillment_order_id uuid,
  p_label_type text,
  p_package_id uuid,
  p_document_key text,
  p_actor_type text default 'system',
  p_actor_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare cfg public.operational_control_runtime_config%rowtype; prior uuid; preview jsonb; docid uuid; pl jsonb;
begin
  select * into cfg from public.operational_control_runtime_config where id=1;
  if not cfg.enabled or not cfg.label_preview_enabled or not cfg.label_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','label_recording_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  if length(trim(coalesce(p_document_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_document_key','side_effect_performed',false,'external_side_effect',false);end if;
  select id into prior from public.label_documents where document_key=trim(p_document_key);if found then return jsonb_build_object('ok',true,'replay',true,'label_document_id',prior,'side_effect_performed',false,'external_side_effect',false);end if;
  preview:=public.preview_fulfillment_label_v1(p_fulfillment_order_id,p_label_type,p_package_id);if coalesce((preview->>'ok')::boolean,false)=false then return preview;end if;pl:=preview->'payload';
  insert into public.label_documents(label_type,fulfillment_order_id,package_id,width_mm,height_mm,barcode,qr_payload,payload,status,document_key)
  values(lower(trim(p_label_type)),p_fulfillment_order_id,p_package_id,100,150,nullif(pl->>'barcode',''),null,pl,'draft',trim(p_document_key)) returning id into docid;
  insert into public.label_events(label_document_id,event_type,actor_type,actor_id,payload) values(docid,'DRAFT_CREATED',coalesce(nullif(trim(p_actor_type),''),'system'),p_actor_id,jsonb_build_object('dispatch_enabled',cfg.label_dispatch_enabled,'printed',false));
  return jsonb_build_object('ok',true,'replay',false,'label_document_id',docid,'status','draft','print_dispatched',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.preview_lot_reverse_trace_v1(p_lot_id uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare cfg public.operational_control_runtime_config%rowtype; l public.inventory_lots%rowtype; affected jsonb; movements jsonb; affected_count integer;
begin
  select * into cfg from public.operational_control_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.recall_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then return jsonb_build_object('ok',false,'error','recall_preview_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  select * into l from public.inventory_lots where id=p_lot_id;if not found then return jsonb_build_object('ok',false,'error','lot_not_found','external_side_effect',false);end if;
  select coalesce(jsonb_agg(x order by x.order_created_at,x.order_id),'[]'::jsonb),count(*) into affected,affected_count
  from (
    select distinct o.id order_id,o.status order_status,o.created_at order_created_at,o.delivered_at,
      o.customer_id,coalesce(c.name,o.customer_snapshot->>'name',o.customer_snapshot->>'nome') customer_name,
      c.primary_whatsapp_e164,
      fo.id fulfillment_order_id,fo.status fulfillment_status,
      fi.expected_quantity lot_quantity,
      dj.id delivery_job_id,dj.status delivery_status
    from public.fulfillment_items fi
    join public.fulfillment_orders fo on fo.id=fi.fulfillment_order_id
    join public.orders o on o.id=fo.order_id
    left join public.customers c on c.id=o.customer_id
    left join lateral (select d.* from public.delivery_jobs d where d.order_id=o.id order by d.attempt_no desc,d.created_at desc limit 1) dj on true
    where fi.lot_id=p_lot_id
  ) x;
  select coalesce(jsonb_agg(jsonb_build_object('movement_id',m.id,'movement_type',m.movement_type,'quantity',m.quantity,'reference_type',m.reference_type,'reference_id',m.reference_id,'created_at',m.created_at) order by m.created_at,m.id),'[]'::jsonb)
    into movements from public.inventory_lot_movements m where m.lot_id=p_lot_id;
  return jsonb_build_object('ok',true,'lot',jsonb_build_object('lot_id',l.id,'product_id',l.product_id,'lot_code',l.lot_code,'status',l.status,'expires_at',l.expires_at,'quantity_available',l.quantity_available,'quantity_reserved',l.quantity_reserved,'physically_verified',l.physically_verified),'affected_order_count',affected_count,'affected_orders',affected,'movements',movements,'quarantine_applied',false,'notifications_sent',false,'side_effect_performed',false,'external_side_effect',false);
end;
$$;

create or replace function public.create_recall_case_draft_v1(
  p_case_code text,
  p_title text,
  p_reason text,
  p_severity text,
  p_source_type text,
  p_lot_ids uuid[],
  p_idempotency_key text,
  p_created_by uuid default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare cfg public.operational_control_runtime_config%rowtype; prior uuid; cid uuid; lid uuid; impact jsonb; l public.inventory_lots%rowtype; n integer:=0;
begin
  select * into cfg from public.operational_control_runtime_config where id=1;
  if not cfg.enabled or not cfg.recall_preview_enabled or not cfg.recall_case_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','recall_case_creation_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  if length(trim(coalesce(p_case_code,'')))<3 or length(trim(coalesce(p_title,'')))<3 or length(trim(coalesce(p_reason,'')))<3 or lower(trim(coalesce(p_severity,''))) not in ('review','low','medium','high','critical') or lower(trim(coalesce(p_source_type,''))) not in ('internal','supplier','authority','customer','other') or coalesce(array_length(p_lot_ids,1),0)=0 or length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_recall_case','side_effect_performed',false,'external_side_effect',false);end if;
  select id into prior from public.recall_cases where idempotency_key=trim(p_idempotency_key);if found then return jsonb_build_object('ok',true,'replay',true,'recall_case_id',prior,'side_effect_performed',false,'external_side_effect',false);end if;
  insert into public.recall_cases(case_code,title,reason,severity,status,source_type,idempotency_key,created_by)
  values(trim(p_case_code),trim(p_title),trim(p_reason),lower(trim(p_severity)),'draft',lower(trim(p_source_type)),trim(p_idempotency_key),p_created_by) returning id into cid;
  foreach lid in array p_lot_ids loop
    select * into l from public.inventory_lots where id=lid;if not found then raise exception 'recall_lot_not_found:%',lid;end if;
    impact:=public.preview_lot_reverse_trace_v1(lid);if coalesce((impact->>'ok')::boolean,false)=false then raise exception 'recall_impact_preview_failed:%',lid;end if;
    insert into public.recall_case_lots(recall_case_id,lot_id,impact_status,lot_snapshot,impact_snapshot)
    values(cid,lid,'pending_review',coalesce(impact->'lot','{}'::jsonb),impact);n:=n+1;
  end loop;
  insert into public.recall_events(recall_case_id,event_type,actor_type,actor_id,payload) values(cid,'RECALL_DRAFT_CREATED','admin',p_created_by,jsonb_build_object('lot_count',n,'quarantine_enabled',cfg.recall_quarantine_enabled,'quarantine_applied',false,'notifications_sent',false));
  return jsonb_build_object('ok',true,'replay',false,'recall_case_id',cid,'status','draft','lot_count',n,'quarantine_applied',false,'notifications_sent',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.control_tower_order_snapshot_v1(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare cfg public.operational_control_runtime_config%rowtype; o public.orders%rowtype; fo public.fulfillment_orders%rowtype; dj public.delivery_jobs%rowtype; fc public.order_fiscal_controls%rowtype; pc public.order_promise_commitments%rowtype; pkg_count integer:=0; loaded_pkg integer:=0; current_stage text; stage_anchor timestamptz; c public.customers%rowtype;
begin
  select * into cfg from public.operational_control_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.control_tower_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then return jsonb_build_object('ok',false,'error','control_tower_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  select * into o from public.orders where id=p_order_id;if not found then return jsonb_build_object('ok',false,'error','order_not_found','external_side_effect',false);end if;
  if o.customer_id is not null then select * into c from public.customers where id=o.customer_id;end if;
  select * into fo from public.fulfillment_orders where order_id=o.id order by created_at desc limit 1;
  if found then select count(*)::integer,count(*) filter(where status='loaded')::integer into pkg_count,loaded_pkg from public.order_packages where fulfillment_order_id=fo.id;end if;
  select * into dj from public.delivery_jobs where order_id=o.id order by attempt_no desc,created_at desc limit 1;
  select * into fc from public.order_fiscal_controls where order_id=o.id;
  select * into pc from public.order_promise_commitments where order_id=o.id and status in ('held','committed') order by created_at desc limit 1;

  if o.status in ('cancelled','returned','delivered') then current_stage:='closed';stage_anchor:=coalesce(o.delivered_at,o.returned_at,o.cancelled_at,o.updated_at,o.created_at);
  elsif dj.id is not null and dj.status in ('out_for_delivery','assigned','planned','waiting_route') then current_stage:=case when dj.status='out_for_delivery' then 'delivery' else 'ready' end;stage_anchor:=coalesce(dj.ready_at,dj.updated_at,dj.created_at);
  elsif fo.id is not null then
    if fo.status in ('loading','loaded','ready') then current_stage:='ready';stage_anchor:=coalesce(fo.ready_at,fo.updated_at,fo.created_at);
    elsif fo.status in ('packing','packed') then current_stage:='packing';stage_anchor:=coalesce(fo.checked_at,fo.updated_at,fo.created_at);
    elsif fo.status in ('checking','checked') then current_stage:='checking';stage_anchor:=coalesce(fo.checking_started_at,fo.picked_at,fo.updated_at,fo.created_at);
    elsif fo.status in ('picking','picked') then current_stage:='picking';stage_anchor:=coalesce(fo.started_picking_at,fo.created_at);
    else current_stage:='fulfillment_pending';stage_anchor:=fo.created_at;end if;
  else current_stage:='confirmed';stage_anchor:=coalesce(o.confirmed_at,o.created_at);end if;

  if fc.order_id is not null and fc.delivery_status='delivered' and fc.payment_status<>'confirmed' then current_stage:='delivered_unreconciled';stage_anchor:=coalesce(fc.delivery_confirmed_at,o.delivered_at,o.updated_at);
  elsif fc.order_id is not null and fc.fiscal_status='ready' then current_stage:='fiscal_ready';stage_anchor:=coalesce(fc.fiscal_ready_at,fc.updated_at);end if;

  return jsonb_build_object('ok',true,'order',jsonb_build_object('order_id',o.id,'status',o.status,'created_at',o.created_at,'confirmed_at',o.confirmed_at,'customer_id',o.customer_id,'customer_name',coalesce(c.name,o.customer_snapshot->>'name',o.customer_snapshot->>'nome')),'promise',case when pc.id is null then null else jsonb_build_object('commitment_id',pc.id,'promised_date',pc.promised_date,'status',pc.status,'item_units',pc.item_units) end,'fulfillment',case when fo.id is null then null else jsonb_build_object('fulfillment_order_id',fo.id,'status',fo.status,'started_picking_at',fo.started_picking_at,'picked_at',fo.picked_at,'checking_started_at',fo.checking_started_at,'checked_at',fo.checked_at,'packed_at',fo.packed_at,'ready_at',fo.ready_at,'loaded_at',fo.loaded_at,'package_count',pkg_count,'loaded_packages',loaded_pkg) end,'delivery',case when dj.id is null then null else jsonb_build_object('delivery_job_id',dj.id,'status',dj.status,'attempt_no',dj.attempt_no,'ready_at',dj.ready_at,'delivered_at',dj.delivered_at,'failed_at',dj.failed_at) end,'fiscal',case when fc.order_id is null then null else jsonb_build_object('delivery_status',fc.delivery_status,'payment_status',fc.payment_status,'fiscal_status',fc.fiscal_status,'fiscal_ready_at',fc.fiscal_ready_at,'issued_at',fc.issued_at) end,'current_stage',current_stage,'stage_anchor',stage_anchor,'side_effect_performed',false,'external_side_effect',false);
end;
$$;

create or replace function public.preview_order_aging_v1(p_order_id uuid,p_reference_at timestamptz default now())
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare cfg public.operational_control_runtime_config%rowtype; snap jsonb; stage text; anchor timestamptz; pol public.operational_sla_policies%rowtype; age_min integer;
begin
  select * into cfg from public.operational_control_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.control_tower_enabled or not cfg.sla_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then return jsonb_build_object('ok',false,'error','sla_preview_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  snap:=public.control_tower_order_snapshot_v1(p_order_id);if coalesce((snap->>'ok')::boolean,false)=false then return snap;end if;
  stage:=snap->>'current_stage';anchor:=(snap->>'stage_anchor')::timestamptz;
  if stage='closed' then return jsonb_build_object('ok',true,'order_id',p_order_id,'stage','closed','breach',false,'result','closed','age_minutes',0,'side_effect_performed',false,'external_side_effect',false);end if;
  age_min:=greatest(floor(extract(epoch from (p_reference_at-anchor))/60)::integer,0);
  select * into pol from public.operational_sla_policies where stage=stage and status='active' order by version_no desc limit 1;
  if not found or pol.threshold_minutes is null then return jsonb_build_object('ok',true,'order_id',p_order_id,'stage',stage,'result','review','breach',false,'reason','sla_policy_missing','age_minutes',age_min,'threshold_minutes',null,'snapshot',snap,'side_effect_performed',false,'external_side_effect',false);end if;
  return jsonb_build_object('ok',true,'order_id',p_order_id,'stage',stage,'result',case when age_min>pol.threshold_minutes then 'breach' else 'within_sla' end,'breach',age_min>pol.threshold_minutes,'age_minutes',age_min,'threshold_minutes',pol.threshold_minutes,'severity',pol.severity,'policy_version',pol.version_no,'snapshot',snap,'side_effect_performed',false,'external_side_effect',false);
end;
$$;

create or replace function public.record_sla_exception_v1(p_order_id uuid,p_reference_at timestamptz,p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare cfg public.operational_control_runtime_config%rowtype; prior uuid; preview jsonb; eid uuid;
begin
  select * into cfg from public.operational_control_runtime_config where id=1;
  if not cfg.enabled or not cfg.control_tower_enabled or not cfg.sla_preview_enabled or not cfg.sla_exception_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','sla_exception_recording_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','side_effect_performed',false,'external_side_effect',false);end if;
  select id into prior from public.operational_sla_exceptions where idempotency_key=trim(p_idempotency_key);if found then return jsonb_build_object('ok',true,'replay',true,'sla_exception_id',prior,'side_effect_performed',false,'external_side_effect',false);end if;
  preview:=public.preview_order_aging_v1(p_order_id,coalesce(p_reference_at,now()));if coalesce((preview->>'ok')::boolean,false)=false then return preview;end if;
  if coalesce((preview->>'breach')::boolean,false)=false then return jsonb_build_object('ok',true,'recorded',false,'result',preview->>'result','stage',preview->>'stage','side_effect_performed',false,'external_side_effect',false);end if;
  insert into public.operational_sla_exceptions(order_id,stage,age_minutes,threshold_minutes,severity,evaluation_snapshot,idempotency_key)
  values(p_order_id,preview->>'stage',(preview->>'age_minutes')::integer,(preview->>'threshold_minutes')::integer,preview->>'severity',preview,trim(p_idempotency_key)) returning id into eid;
  return jsonb_build_object('ok',true,'replay',false,'recorded',true,'sla_exception_id',eid,'stage',preview->>'stage','side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.control_tower_queue_v1(p_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare cfg public.operational_control_runtime_config%rowtype; r record; arr jsonb:='[]'::jsonb; snap jsonb; lim integer:=least(greatest(coalesce(p_limit,100),1),500);
begin
  select * into cfg from public.operational_control_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.control_tower_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then return jsonb_build_object('ok',false,'error','control_tower_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  for r in select id from public.orders where status not in ('delivered','cancelled','returned') order by created_at asc limit lim loop
    snap:=public.control_tower_order_snapshot_v1(r.id);arr:=arr||jsonb_build_array(snap);
  end loop;
  return jsonb_build_object('ok',true,'count',jsonb_array_length(arr),'orders',arr,'side_effect_performed',false,'external_side_effect',false);
end;
$$;

-- Server-only: browser roles have no table or RPC access.
revoke all on table public.operational_control_runtime_config,public.label_documents,public.label_events,public.recall_cases,public.recall_case_lots,public.recall_events,public.operational_sla_policies,public.operational_sla_exceptions from public,anon,authenticated;
grant select,insert,update,delete on table public.operational_control_runtime_config,public.label_documents,public.label_events,public.recall_cases,public.recall_case_lots,public.recall_events,public.operational_sla_policies,public.operational_sla_exceptions to service_role;

revoke all on function public.preview_fulfillment_label_v1(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.record_label_draft_v1(uuid,text,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.preview_lot_reverse_trace_v1(uuid) from public,anon,authenticated;
revoke all on function public.create_recall_case_draft_v1(text,text,text,text,text,uuid[],text,uuid) from public,anon,authenticated;
revoke all on function public.control_tower_order_snapshot_v1(uuid) from public,anon,authenticated;
revoke all on function public.preview_order_aging_v1(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.record_sla_exception_v1(uuid,timestamptz,text) from public,anon,authenticated;
revoke all on function public.control_tower_queue_v1(integer) from public,anon,authenticated;

grant execute on function public.preview_fulfillment_label_v1(uuid,text,uuid),public.record_label_draft_v1(uuid,text,uuid,text,text,uuid),public.preview_lot_reverse_trace_v1(uuid),public.create_recall_case_draft_v1(text,text,text,text,text,uuid[],text,uuid),public.control_tower_order_snapshot_v1(uuid),public.preview_order_aging_v1(uuid,timestamptz),public.record_sla_exception_v1(uuid,timestamptz,text),public.control_tower_queue_v1(integer) to service_role;

commit;
