begin;

-- Stage 13A — Operational Financial Ledger foundation V1.
-- Server-only, dormant and provider-agnostic.
-- No bank/Pix/acquirer/Bling transport, no fiscal mutation and no route mutation.

create table if not exists public.financial_runtime_config (
  id smallint primary key default 1 check (id=1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  base_currency char(3) not null default 'BRL',
  preview_enabled boolean not null default false,
  receipt_recording_enabled boolean not null default false,
  reversal_recording_enabled boolean not null default false,
  route_cash_recording_enabled boolean not null default false,
  route_close_preview_enabled boolean not null default false,
  route_close_recording_enabled boolean not null default false,
  reconciliation_case_recording_enabled boolean not null default false,
  fiscal_projection_enabled boolean not null default false,
  external_reconciliation_enabled boolean not null default false,
  allowed_cash_difference_cents bigint null check (allowed_cash_difference_cents is null or allowed_cash_difference_cents>=0),
  canary_percent smallint not null default 0 check (canary_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

insert into public.financial_runtime_config(id) values(1) on conflict(id) do nothing;
alter table public.financial_runtime_config enable row level security;

create table if not exists public.financial_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  event_type text not null check(event_type in (
    'payment_received','payment_reversed',
    'route_cash_float_start','route_cash_declaration','route_cash_handover'
  )),
  recognition_status text not null check(recognition_status in ('observed','operational_confirmed','reconciled','review_required')),
  order_id uuid null references public.orders(id) on delete restrict,
  route_id uuid null references public.delivery_routes(id) on delete restrict,
  driver_id uuid null references public.drivers(id) on delete restrict,
  payment_method text null check(payment_method is null or payment_method in ('cash','pix','card','payment_link','prepaid_pix','prepaid_link','other')),
  amount_cents bigint not null check(amount_cents>=0),
  currency char(3) not null,
  source text not null,
  external_reference text null,
  reverses_entry_id uuid null references public.financial_ledger_entries(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now(),
  check(event_type not in ('payment_received','payment_reversed') or order_id is not null),
  check(event_type not in ('route_cash_float_start','route_cash_declaration','route_cash_handover') or route_id is not null),
  check(event_type<>'payment_reversed' or reverses_entry_id is not null)
);
alter table public.financial_ledger_entries enable row level security;
create index if not exists financial_ledger_order_idx on public.financial_ledger_entries(order_id,occurred_at,id);
create index if not exists financial_ledger_route_idx on public.financial_ledger_entries(route_id,occurred_at,id);
create index if not exists financial_ledger_driver_idx on public.financial_ledger_entries(driver_id,occurred_at,id);
create unique index if not exists financial_one_reversal_per_entry_idx
  on public.financial_ledger_entries(reverses_entry_id)
  where event_type='payment_reversed';

create table if not exists public.financial_route_close_evaluations (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.delivery_routes(id) on delete restrict,
  driver_id uuid null references public.drivers(id) on delete restrict,
  idempotency_key text not null unique,
  expected_cash_cents bigint not null,
  declared_cash_cents bigint null,
  difference_cents bigint null,
  tolerance_cents bigint null,
  decision text not null check(decision in ('balanced','review')),
  reason text null,
  cash_receipt_count integer not null default 0 check(cash_receipt_count>=0),
  unresolved_entry_count integer not null default 0 check(unresolved_entry_count>=0),
  snapshot jsonb not null default '{}'::jsonb,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.financial_route_close_evaluations enable row level security;
create index if not exists financial_route_close_route_idx on public.financial_route_close_evaluations(route_id,created_at desc);

create table if not exists public.financial_reconciliation_cases (
  id uuid primary key default gen_random_uuid(),
  case_type text not null check(case_type in ('order_payment_mismatch','route_cash_mismatch','provider_mismatch','fiscal_alignment','other')),
  order_id uuid null references public.orders(id) on delete restrict,
  route_id uuid null references public.delivery_routes(id) on delete restrict,
  status text not null default 'open' check(status in ('open','review_required','resolved','cancelled')),
  reason text not null,
  expected_amount_cents bigint null,
  observed_amount_cents bigint null,
  difference_cents bigint null,
  idempotency_key text not null unique,
  source_snapshot jsonb not null default '{}'::jsonb,
  resolution_snapshot jsonb not null default '{}'::jsonb,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz null,
  check(order_id is not null or route_id is not null)
);
alter table public.financial_reconciliation_cases enable row level security;
create index if not exists financial_reconciliation_order_idx on public.financial_reconciliation_cases(order_id,status,created_at desc);
create index if not exists financial_reconciliation_route_idx on public.financial_reconciliation_cases(route_id,status,created_at desc);

create or replace function public.prevent_financial_append_only_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  raise exception 'financial_append_only_record';
end;
$$;

drop trigger if exists trg_financial_ledger_append_only on public.financial_ledger_entries;
create trigger trg_financial_ledger_append_only
before update or delete on public.financial_ledger_entries
for each row execute function public.prevent_financial_append_only_mutation_v1();

drop trigger if exists trg_financial_route_close_append_only on public.financial_route_close_evaluations;
create trigger trg_financial_route_close_append_only
before update or delete on public.financial_route_close_evaluations
for each row execute function public.prevent_financial_append_only_mutation_v1();

create or replace function public.financial_readiness_v1()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'enabled',c.enabled,
    'execution_mode',c.execution_mode,
    'canary_percent',c.canary_percent,
    'base_currency',c.base_currency,
    'preview_enabled',c.preview_enabled,
    'receipt_recording_enabled',c.receipt_recording_enabled,
    'reversal_recording_enabled',c.reversal_recording_enabled,
    'route_cash_recording_enabled',c.route_cash_recording_enabled,
    'route_close_preview_enabled',c.route_close_preview_enabled,
    'route_close_recording_enabled',c.route_close_recording_enabled,
    'reconciliation_case_recording_enabled',c.reconciliation_case_recording_enabled,
    'fiscal_projection_enabled',c.fiscal_projection_enabled,
    'external_reconciliation_enabled',c.external_reconciliation_enabled,
    'allowed_cash_difference_cents',c.allowed_cash_difference_cents,
    'ledger_entries',(select count(*) from public.financial_ledger_entries),
    'route_close_evaluations',(select count(*) from public.financial_route_close_evaluations),
    'reconciliation_cases',(select count(*) from public.financial_reconciliation_cases),
    'external_side_effect',false
  ) from public.financial_runtime_config c where c.id=1;
$$;

create or replace function public.preview_order_financial_state_v1(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  o public.orders%rowtype;
  fc public.order_fiscal_controls%rowtype;
  expected_cents bigint;
  received_cents bigint:=0;
  reversed_cents bigint:=0;
  net_received_cents bigint:=0;
  unresolved_count integer:=0;
  difference_cents bigint:=0;
  state text:='pending';
  fiscal_settled_cents bigint:=null;
  alignment text:='not_available';
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_preview_disabled','external_side_effect',false);
  end if;
  select * into o from public.orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found','external_side_effect',false); end if;

  expected_cents:=round(o.total*100)::bigint;

  select
    coalesce(sum(case when e.event_type='payment_received' and e.recognition_status in ('operational_confirmed','reconciled') then e.amount_cents else 0 end),0),
    coalesce(sum(case when e.event_type='payment_reversed' and e.recognition_status in ('operational_confirmed','reconciled') then e.amount_cents else 0 end),0),
    count(*) filter(where e.recognition_status in ('observed','review_required'))
  into received_cents,reversed_cents,unresolved_count
  from public.financial_ledger_entries e where e.order_id=o.id;

  net_received_cents:=received_cents-reversed_cents;
  difference_cents:=net_received_cents-expected_cents;

  if unresolved_count>0 then state:='review_required';
  elsif net_received_cents=0 then state:='pending';
  elsif difference_cents=0 then state:='balanced';
  elsif difference_cents<0 then state:='underpaid';
  else state:='overpaid'; end if;

  select * into fc from public.order_fiscal_controls where order_id=o.id;
  if found then
    fiscal_settled_cents:=case when fc.settled_amount is null then null else round(fc.settled_amount*100)::bigint end;
    if fc.payment_status='confirmed' and fiscal_settled_cents=net_received_cents and state='balanced' then alignment:='aligned';
    elsif fc.payment_status='pending' and net_received_cents=0 then alignment:='aligned_pending';
    else alignment:='review_required'; end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'order_id',o.id,
    'currency',o.currency,
    'expected_amount_cents',expected_cents,
    'received_amount_cents',received_cents,
    'reversed_amount_cents',reversed_cents,
    'net_received_amount_cents',net_received_cents,
    'difference_cents',difference_cents,
    'unresolved_entry_count',unresolved_count,
    'state',state,
    'fiscal_alignment',jsonb_build_object(
      'status',alignment,
      'payment_status',case when found then fc.payment_status else null end,
      'settled_amount_cents',fiscal_settled_cents
    ),
    'fiscal_mutated',false,
    'side_effect_performed',false,
    'external_side_effect',false
  );
end;
$$;

create or replace function public.record_payment_receipt_v1(
  p_order_id uuid,
  p_payment_method text,
  p_amount_cents bigint,
  p_source text,
  p_idempotency_key text,
  p_recognition_status text default 'operational_confirmed',
  p_route_id uuid default null,
  p_driver_id uuid default null,
  p_external_reference text default null,
  p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  o public.orders%rowtype;
  r public.delivery_routes%rowtype;
  prior public.financial_ledger_entries%rowtype;
  new_id uuid;
  method text:=lower(trim(coalesce(p_payment_method,'')));
  rec_status text:=lower(trim(coalesce(p_recognition_status,'')));
  src text:=trim(coalesce(p_source,''));
  belongs boolean:=false;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.receipt_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_receipt_recording_disabled','external_side_effect',false);
  end if;
  if method not in ('cash','pix','card','payment_link','prepaid_pix','prepaid_link','other') then return jsonb_build_object('ok',false,'error','invalid_payment_method','external_side_effect',false); end if;
  if rec_status not in ('observed','operational_confirmed','review_required') then return jsonb_build_object('ok',false,'error','invalid_recognition_status','external_side_effect',false); end if;
  if p_amount_cents is null or p_amount_cents<=0 then return jsonb_build_object('ok',false,'error','invalid_amount_cents','external_side_effect',false); end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','external_side_effect',false); end if;
  if src='' then return jsonb_build_object('ok',false,'error','source_required','external_side_effect',false); end if;

  select * into prior from public.financial_ledger_entries where idempotency_key=trim(p_idempotency_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'entry_id',prior.id,'recognition_status',prior.recognition_status,'external_side_effect',false); end if;

  select * into o from public.orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found','external_side_effect',false); end if;

  if p_route_id is not null then
    select * into r from public.delivery_routes where id=p_route_id;
    if not found then return jsonb_build_object('ok',false,'error','route_not_found','external_side_effect',false); end if;
    select exists(
      select 1 from public.delivery_stops s
      join public.delivery_jobs j on j.id=s.delivery_job_id
      where s.route_id=p_route_id and j.order_id=o.id
    ) into belongs;
    if not belongs then return jsonb_build_object('ok',false,'error','order_not_in_route','external_side_effect',false); end if;
    if p_driver_id is not null and r.driver_id is distinct from p_driver_id then return jsonb_build_object('ok',false,'error','driver_not_assigned_to_route','external_side_effect',false); end if;
  elsif p_driver_id is not null then
    return jsonb_build_object('ok',false,'error','driver_requires_route','external_side_effect',false);
  end if;

  insert into public.financial_ledger_entries(
    idempotency_key,event_type,recognition_status,order_id,route_id,driver_id,payment_method,
    amount_cents,currency,source,external_reference,occurred_at,metadata
  ) values(
    trim(p_idempotency_key),'payment_received',rec_status,o.id,p_route_id,p_driver_id,method,
    p_amount_cents,o.currency,src,nullif(trim(coalesce(p_external_reference,'')),''),coalesce(p_occurred_at,now()),coalesce(p_metadata,'{}'::jsonb)
  ) returning id into new_id;

  return jsonb_build_object(
    'ok',true,'replay',false,'entry_id',new_id,'order_id',o.id,'amount_cents',p_amount_cents,
    'recognition_status',rec_status,'fiscal_mutated',false,'provider_called',false,
    'side_effect_performed',true,'external_side_effect',false
  );
end;
$$;

create or replace function public.record_payment_reversal_v1(
  p_original_entry_id uuid,
  p_idempotency_key text,
  p_source text,
  p_reason text,
  p_occurred_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  original public.financial_ledger_entries%rowtype;
  prior public.financial_ledger_entries%rowtype;
  new_id uuid;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.reversal_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_reversal_recording_disabled','external_side_effect',false);
  end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','external_side_effect',false); end if;
  if trim(coalesce(p_source,''))='' or trim(coalesce(p_reason,''))='' then return jsonb_build_object('ok',false,'error','source_and_reason_required','external_side_effect',false); end if;

  select * into prior from public.financial_ledger_entries where idempotency_key=trim(p_idempotency_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'entry_id',prior.id,'external_side_effect',false); end if;

  select * into original from public.financial_ledger_entries where id=p_original_entry_id;
  if not found or original.event_type<>'payment_received' then return jsonb_build_object('ok',false,'error','reversible_payment_entry_not_found','external_side_effect',false); end if;
  if exists(select 1 from public.financial_ledger_entries where reverses_entry_id=original.id and event_type='payment_reversed') then
    return jsonb_build_object('ok',false,'error','payment_entry_already_reversed','external_side_effect',false);
  end if;

  insert into public.financial_ledger_entries(
    idempotency_key,event_type,recognition_status,order_id,route_id,driver_id,payment_method,
    amount_cents,currency,source,reverses_entry_id,occurred_at,metadata
  ) values(
    trim(p_idempotency_key),'payment_reversed','operational_confirmed',original.order_id,original.route_id,original.driver_id,original.payment_method,
    original.amount_cents,original.currency,trim(p_source),original.id,coalesce(p_occurred_at,now()),jsonb_build_object('reason',trim(p_reason))
  ) returning id into new_id;

  return jsonb_build_object('ok',true,'replay',false,'entry_id',new_id,'reverses_entry_id',original.id,'amount_cents',original.amount_cents,'fiscal_mutated',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.record_route_cash_event_v1(
  p_route_id uuid,
  p_driver_id uuid,
  p_event_type text,
  p_amount_cents bigint,
  p_source text,
  p_idempotency_key text,
  p_occurred_at timestamptz default now(),
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  r public.delivery_routes%rowtype;
  prior public.financial_ledger_entries%rowtype;
  new_id uuid;
  kind text:=lower(trim(coalesce(p_event_type,'')));
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.route_cash_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','route_cash_recording_disabled','external_side_effect',false);
  end if;
  if kind not in ('route_cash_float_start','route_cash_declaration','route_cash_handover') then return jsonb_build_object('ok',false,'error','invalid_route_cash_event_type','external_side_effect',false); end if;
  if p_amount_cents is null or p_amount_cents<0 then return jsonb_build_object('ok',false,'error','invalid_amount_cents','external_side_effect',false); end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 or trim(coalesce(p_source,''))='' then return jsonb_build_object('ok',false,'error','invalid_route_cash_event_input','external_side_effect',false); end if;

  select * into prior from public.financial_ledger_entries where idempotency_key=trim(p_idempotency_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'entry_id',prior.id,'external_side_effect',false); end if;

  select * into r from public.delivery_routes where id=p_route_id;
  if not found then return jsonb_build_object('ok',false,'error','route_not_found','external_side_effect',false); end if;
  if p_driver_id is null or r.driver_id is distinct from p_driver_id then return jsonb_build_object('ok',false,'error','driver_not_assigned_to_route','external_side_effect',false); end if;

  insert into public.financial_ledger_entries(
    idempotency_key,event_type,recognition_status,route_id,driver_id,amount_cents,currency,source,occurred_at,metadata
  ) values(
    trim(p_idempotency_key),kind,'operational_confirmed',r.id,p_driver_id,p_amount_cents,cfg.base_currency,trim(p_source),coalesce(p_occurred_at,now()),coalesce(p_metadata,'{}'::jsonb)
  ) returning id into new_id;

  return jsonb_build_object('ok',true,'replay',false,'entry_id',new_id,'route_id',r.id,'event_type',kind,'amount_cents',p_amount_cents,'route_mutated',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.preview_route_financial_close_v1(p_route_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  r public.delivery_routes%rowtype;
  float_cents bigint:=0;
  declaration_cents bigint:=null;
  cash_received_cents bigint:=0;
  cash_reversed_cents bigint:=0;
  expected_cash_cents bigint:=0;
  difference_cents bigint:=null;
  cash_receipt_count integer:=0;
  unresolved_count integer:=0;
  decision text:='review';
  reason text:='cash_declaration_missing';
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.route_close_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','route_close_preview_disabled','external_side_effect',false);
  end if;
  select * into r from public.delivery_routes where id=p_route_id;
  if not found then return jsonb_build_object('ok',false,'error','route_not_found','external_side_effect',false); end if;

  select coalesce(e.amount_cents,0) into float_cents
  from public.financial_ledger_entries e
  where e.route_id=r.id and e.event_type='route_cash_float_start' and e.recognition_status in ('operational_confirmed','reconciled')
  order by e.occurred_at desc,e.id desc limit 1;
  if float_cents is null then float_cents:=0; end if;

  select e.amount_cents into declaration_cents
  from public.financial_ledger_entries e
  where e.route_id=r.id and e.event_type='route_cash_declaration' and e.recognition_status in ('operational_confirmed','reconciled')
  order by e.occurred_at desc,e.id desc limit 1;

  select
    coalesce(sum(case when e.event_type='payment_received' and e.payment_method='cash' and e.recognition_status in ('operational_confirmed','reconciled') then e.amount_cents else 0 end),0),
    coalesce(sum(case when e.event_type='payment_reversed' and e.payment_method='cash' and e.recognition_status in ('operational_confirmed','reconciled') then e.amount_cents else 0 end),0),
    count(*) filter(where e.event_type='payment_received' and e.payment_method='cash' and e.recognition_status in ('operational_confirmed','reconciled')),
    count(*) filter(where e.recognition_status in ('observed','review_required'))
  into cash_received_cents,cash_reversed_cents,cash_receipt_count,unresolved_count
  from public.financial_ledger_entries e where e.route_id=r.id;

  expected_cash_cents:=float_cents+cash_received_cents-cash_reversed_cents;
  if declaration_cents is not null then difference_cents:=declaration_cents-expected_cash_cents; end if;

  if unresolved_count>0 then decision:='review';reason:='unresolved_financial_entries';
  elsif declaration_cents is null then decision:='review';reason:='cash_declaration_missing';
  elsif difference_cents=0 then decision:='balanced';reason:=null;
  elsif cfg.allowed_cash_difference_cents is null then decision:='review';reason:='cash_tolerance_not_configured';
  elsif abs(difference_cents)<=cfg.allowed_cash_difference_cents then decision:='balanced';reason:='within_configured_tolerance';
  else decision:='review';reason:='cash_difference_exceeds_tolerance'; end if;

  return jsonb_build_object(
    'ok',true,'route_id',r.id,'driver_id',r.driver_id,'route_status',r.status,
    'cash_float_start_cents',float_cents,'cash_received_cents',cash_received_cents,'cash_reversed_cents',cash_reversed_cents,
    'expected_cash_cents',expected_cash_cents,'declared_cash_cents',declaration_cents,'difference_cents',difference_cents,
    'tolerance_cents',cfg.allowed_cash_difference_cents,'cash_receipt_count',cash_receipt_count,'unresolved_entry_count',unresolved_count,
    'decision',decision,'reason',reason,'route_mutated',false,'side_effect_performed',false,'external_side_effect',false
  );
end;
$$;

create or replace function public.record_route_close_evaluation_v1(p_route_id uuid,p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  prior public.financial_route_close_evaluations%rowtype;
  preview jsonb;
  new_id uuid;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.route_close_preview_enabled or not cfg.route_close_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','route_close_recording_disabled','external_side_effect',false);
  end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','external_side_effect',false); end if;
  select * into prior from public.financial_route_close_evaluations where idempotency_key=trim(p_idempotency_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'evaluation_id',prior.id,'decision',prior.decision,'external_side_effect',false); end if;

  preview:=public.preview_route_financial_close_v1(p_route_id);
  if not coalesce((preview->>'ok')::boolean,false) then return preview; end if;

  insert into public.financial_route_close_evaluations(
    route_id,driver_id,idempotency_key,expected_cash_cents,declared_cash_cents,difference_cents,tolerance_cents,
    decision,reason,cash_receipt_count,unresolved_entry_count,snapshot
  ) values(
    p_route_id,(preview->>'driver_id')::uuid,trim(p_idempotency_key),(preview->>'expected_cash_cents')::bigint,
    nullif(preview->>'declared_cash_cents','')::bigint,nullif(preview->>'difference_cents','')::bigint,
    nullif(preview->>'tolerance_cents','')::bigint,preview->>'decision',preview->>'reason',
    (preview->>'cash_receipt_count')::integer,(preview->>'unresolved_entry_count')::integer,preview
  ) returning id into new_id;

  return jsonb_build_object('ok',true,'replay',false,'evaluation_id',new_id,'decision',preview->>'decision','reason',preview->>'reason','route_closed',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.open_financial_reconciliation_case_v1(
  p_case_type text,
  p_order_id uuid,
  p_route_id uuid,
  p_reason text,
  p_expected_amount_cents bigint,
  p_observed_amount_cents bigint,
  p_idempotency_key text,
  p_source_snapshot jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  prior public.financial_reconciliation_cases%rowtype;
  new_id uuid;
  kind text:=lower(trim(coalesce(p_case_type,'')));
  diff bigint:=null;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.reconciliation_case_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_reconciliation_case_recording_disabled','external_side_effect',false);
  end if;
  if kind not in ('order_payment_mismatch','route_cash_mismatch','provider_mismatch','fiscal_alignment','other') then return jsonb_build_object('ok',false,'error','invalid_case_type','external_side_effect',false); end if;
  if p_order_id is null and p_route_id is null then return jsonb_build_object('ok',false,'error','order_or_route_required','external_side_effect',false); end if;
  if trim(coalesce(p_reason,''))='' or length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_reconciliation_case_input','external_side_effect',false); end if;
  if p_expected_amount_cents is not null and p_observed_amount_cents is not null then diff:=p_observed_amount_cents-p_expected_amount_cents; end if;

  select * into prior from public.financial_reconciliation_cases where idempotency_key=trim(p_idempotency_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'case_id',prior.id,'status',prior.status,'external_side_effect',false); end if;

  insert into public.financial_reconciliation_cases(
    case_type,order_id,route_id,status,reason,expected_amount_cents,observed_amount_cents,difference_cents,idempotency_key,source_snapshot
  ) values(kind,p_order_id,p_route_id,'review_required',trim(p_reason),p_expected_amount_cents,p_observed_amount_cents,diff,trim(p_idempotency_key),coalesce(p_source_snapshot,'{}'::jsonb)) returning id into new_id;

  return jsonb_build_object('ok',true,'replay',false,'case_id',new_id,'status','review_required','external_action_taken',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

revoke all on table public.financial_runtime_config,public.financial_ledger_entries,public.financial_route_close_evaluations,public.financial_reconciliation_cases from public,anon,authenticated;
grant select on table public.financial_runtime_config,public.financial_ledger_entries,public.financial_route_close_evaluations,public.financial_reconciliation_cases to service_role;

do $$
begin
  execute 'revoke all on function public.financial_readiness_v1() from public,anon,authenticated';
  execute 'revoke all on function public.preview_order_financial_state_v1(uuid) from public,anon,authenticated';
  execute 'revoke all on function public.record_payment_receipt_v1(uuid,text,bigint,text,text,text,uuid,uuid,text,timestamptz,jsonb) from public,anon,authenticated';
  execute 'revoke all on function public.record_payment_reversal_v1(uuid,text,text,text,timestamptz) from public,anon,authenticated';
  execute 'revoke all on function public.record_route_cash_event_v1(uuid,uuid,text,bigint,text,text,timestamptz,jsonb) from public,anon,authenticated';
  execute 'revoke all on function public.preview_route_financial_close_v1(uuid) from public,anon,authenticated';
  execute 'revoke all on function public.record_route_close_evaluation_v1(uuid,text) from public,anon,authenticated';
  execute 'revoke all on function public.open_financial_reconciliation_case_v1(text,uuid,uuid,text,bigint,bigint,text,jsonb) from public,anon,authenticated';

  execute 'grant execute on function public.financial_readiness_v1() to service_role';
  execute 'grant execute on function public.preview_order_financial_state_v1(uuid) to service_role';
  execute 'grant execute on function public.record_payment_receipt_v1(uuid,text,bigint,text,text,text,uuid,uuid,text,timestamptz,jsonb) to service_role';
  execute 'grant execute on function public.record_payment_reversal_v1(uuid,text,text,text,timestamptz) to service_role';
  execute 'grant execute on function public.record_route_cash_event_v1(uuid,uuid,text,bigint,text,text,timestamptz,jsonb) to service_role';
  execute 'grant execute on function public.preview_route_financial_close_v1(uuid) to service_role';
  execute 'grant execute on function public.record_route_close_evaluation_v1(uuid,text) to service_role';
  execute 'grant execute on function public.open_financial_reconciliation_case_v1(text,uuid,uuid,text,bigint,bigint,text,jsonb) to service_role';
end $$;

commit;
