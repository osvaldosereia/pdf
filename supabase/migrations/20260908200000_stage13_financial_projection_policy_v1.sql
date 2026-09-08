begin;

-- ETAPA 13E — política financeira versionada + projeção determinística para o gate fiscal.
-- Tudo nasce OFF. Nenhum provider externo ou emissão fiscal é chamado aqui.

alter table public.financial_runtime_config
  add column if not exists fiscal_projection_preview_enabled boolean not null default false,
  add column if not exists fiscal_projection_recording_enabled boolean not null default false,
  add column if not exists fiscal_projection_apply_enabled boolean not null default false,
  add column if not exists financial_policy_preview_enabled boolean not null default false;

create table if not exists public.financial_policy_versions (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null check (scope_key in ('reconciliation','route_close','fiscal_projection')),
  version integer not null check (version>0),
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  max_difference_cents bigint check (max_difference_cents is null or max_difference_cents>=0),
  require_exact_reference boolean not null default true,
  require_delivery_confirmed boolean not null default true,
  require_no_open_reconciliation_case boolean not null default true,
  allow_apply boolean not null default false,
  effective_from timestamptz,
  effective_to timestamptz,
  config jsonb not null default '{}'::jsonb,
  reason text,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(scope_key,version),
  check (status<>'approved' or (approved_by is not null and approved_at is not null and effective_from is not null)),
  check (effective_to is null or effective_from is null or effective_to>effective_from)
);
create unique index if not exists financial_policy_one_active_approved_idx
  on public.financial_policy_versions(scope_key)
  where status='approved' and effective_to is null;
alter table public.financial_policy_versions enable row level security;
revoke all on public.financial_policy_versions from public,anon,authenticated;
grant select,insert,update on public.financial_policy_versions to service_role;

create table if not exists public.financial_fiscal_projection_evaluations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  policy_version_id uuid references public.financial_policy_versions(id) on delete restrict,
  idempotency_key text not null unique,
  decision text not null check (decision in ('ready_to_project','blocked','review_required','already_projected')),
  reason text not null,
  order_total_cents bigint not null,
  reconciled_amount_cents bigint not null,
  difference_cents bigint not null,
  projected_payment_method text,
  delivery_status text,
  payment_status_before text,
  fiscal_status_before text,
  open_reconciliation_cases integer not null default 0 check (open_reconciliation_cases>=0),
  policy_snapshot jsonb not null default '{}'::jsonb,
  ledger_snapshot jsonb not null default '{}'::jsonb,
  deterministic boolean not null default true check (deterministic=true),
  applied boolean not null default false,
  applied_at timestamptz,
  apply_result jsonb,
  external_side_effect boolean not null default false check (external_side_effect=false),
  created_at timestamptz not null default now()
);
create index if not exists financial_fiscal_projection_order_idx on public.financial_fiscal_projection_evaluations(order_id,created_at desc);
create index if not exists financial_fiscal_projection_decision_idx on public.financial_fiscal_projection_evaluations(decision,created_at desc);
alter table public.financial_fiscal_projection_evaluations enable row level security;
revoke all on public.financial_fiscal_projection_evaluations from public,anon,authenticated;
grant select,insert,update on public.financial_fiscal_projection_evaluations to service_role;

create or replace function public.financial_stage13_readiness_v1()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object(
    'enabled',f.enabled,'execution_mode',f.execution_mode,'canary_percent',f.canary_percent,
    'external_reconciliation_enabled',f.external_reconciliation_enabled,
    'reconciliation_preview_enabled',f.reconciliation_preview_enabled,
    'reconciliation_recording_enabled',f.reconciliation_recording_enabled,
    'financial_admin_read_enabled',f.financial_admin_read_enabled,
    'batch_reconciliation_audit_enabled',f.batch_reconciliation_audit_enabled,
    'fiscal_projection_enabled',f.fiscal_projection_enabled,
    'fiscal_projection_preview_enabled',f.fiscal_projection_preview_enabled,
    'fiscal_projection_recording_enabled',f.fiscal_projection_recording_enabled,
    'fiscal_projection_apply_enabled',f.fiscal_projection_apply_enabled,
    'financial_policy_preview_enabled',f.financial_policy_preview_enabled,
    'approved_projection_policies',(select count(*) from public.financial_policy_versions p where p.scope_key='fiscal_projection' and p.status='approved' and p.effective_from<=now() and (p.effective_to is null or p.effective_to>now())),
    'projection_evaluations',(select count(*) from public.financial_fiscal_projection_evaluations),
    'applied_projections',(select count(*) from public.financial_fiscal_projection_evaluations where applied=true),
    'external_side_effect',false
  ) from public.financial_runtime_config f where f.id=1;
$$;

create or replace function public.preview_financial_policy_v1(p_scope_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  pol public.financial_policy_versions%rowtype;
  scope_text text:=lower(btrim(coalesce(p_scope_key,'')));
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.financial_policy_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_policy_preview_disabled','external_side_effect',false);
  end if;
  if scope_text not in ('reconciliation','route_close','fiscal_projection') then raise exception 'invalid_financial_policy_scope'; end if;
  select * into pol from public.financial_policy_versions p
   where p.scope_key=scope_text and p.status='approved' and p.effective_from<=now() and (p.effective_to is null or p.effective_to>now())
   order by p.version desc limit 1;
  if not found then return jsonb_build_object('ok',false,'error','approved_financial_policy_required','scope_key',scope_text,'external_side_effect',false); end if;
  return jsonb_build_object('ok',true,'policy_id',pol.id,'scope_key',pol.scope_key,'version',pol.version,'max_difference_cents',pol.max_difference_cents,
    'require_exact_reference',pol.require_exact_reference,'require_delivery_confirmed',pol.require_delivery_confirmed,
    'require_no_open_reconciliation_case',pol.require_no_open_reconciliation_case,'allow_apply',pol.allow_apply,
    'effective_from',pol.effective_from,'effective_to',pol.effective_to,'config',pol.config,'external_side_effect',false);
end;$$;

create or replace function public.preview_financial_fiscal_projection_v1(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  ord public.orders%rowtype;
  fc public.order_fiscal_controls%rowtype;
  pol jsonb;
  total_cents bigint;
  reconciled_cents bigint:=0;
  difference bigint:=0;
  open_cases integer:=0;
  method_count integer:=0;
  single_method text;
  projected_method text;
  decision text:='blocked';
  reason text:='unknown';
  ledger_snapshot jsonb:='[]'::jsonb;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.fiscal_projection_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_fiscal_projection_preview_disabled','external_side_effect',false);
  end if;
  select * into ord from public.orders where id=p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  select * into fc from public.order_fiscal_controls where order_id=p_order_id;
  if not found then return jsonb_build_object('ok',true,'decision','blocked','reason','fiscal_control_missing','order_id',p_order_id,'external_side_effect',false); end if;

  pol:=public.preview_financial_policy_v1('fiscal_projection');
  if not coalesce((pol->>'ok')::boolean,false) then
    return jsonb_build_object('ok',true,'decision','blocked','reason',coalesce(pol->>'error','approved_financial_policy_required'),'order_id',p_order_id,'policy',pol,'external_side_effect',false);
  end if;

  total_cents:=round(ord.total*100)::bigint;
  select coalesce(sum(case when le.event_type='payment_received' then le.amount_cents when le.event_type='payment_reversed' then -le.amount_cents else 0 end),0),
         count(distinct case when le.event_type='payment_received' then le.payment_method end),
         min(case when le.event_type='payment_received' then le.payment_method end),
         coalesce(jsonb_agg(jsonb_build_object('id',le.id,'event_type',le.event_type,'payment_method',le.payment_method,'amount_cents',le.amount_cents,'external_reference',le.external_reference,'occurred_at',le.occurred_at) order by le.occurred_at,le.created_at),'[]'::jsonb)
    into reconciled_cents,method_count,single_method,ledger_snapshot
  from public.financial_ledger_entries le
  where le.order_id=p_order_id and le.recognition_status='reconciled';
  difference:=reconciled_cents-total_cents;
  select count(*) into open_cases from public.financial_reconciliation_cases rc where rc.order_id=p_order_id and rc.status='open';
  projected_method:=case when method_count=1 then single_method when method_count>1 then 'other' else null end;

  if fc.payment_status='confirmed' and fc.payment_source='financial_reconciliation_projection' and round(coalesce(fc.settled_amount,0)*100)::bigint=reconciled_cents then
    decision:='already_projected';reason:='financial_projection_already_applied';
  elsif ord.status in ('cancelled','returned') or fc.delivery_status in ('cancelled','returned','failed') then
    decision:='blocked';reason:='order_or_delivery_not_eligible';
  elsif coalesce((pol->>'require_delivery_confirmed')::boolean,true) and (ord.status<>'delivered' or fc.delivery_status<>'delivered' or fc.delivery_confirmed_at is null) then
    decision:='blocked';reason:='delivery_not_confirmed';
  elsif coalesce((pol->>'require_no_open_reconciliation_case')::boolean,true) and open_cases>0 then
    decision:='review_required';reason:='open_reconciliation_case';
  elsif reconciled_cents<=0 then
    decision:='blocked';reason:='reconciled_payment_missing';
  elsif projected_method is null then
    decision:='review_required';reason:='reconciled_payment_method_missing';
  elsif (pol->>'max_difference_cents') is null then
    decision:='blocked';reason:='projection_tolerance_not_configured';
  elsif abs(difference)>(pol->>'max_difference_cents')::bigint then
    decision:='review_required';reason:='reconciled_amount_mismatch';
  else
    decision:='ready_to_project';reason:='delivery_and_reconciled_payment_valid';
  end if;

  return jsonb_build_object('ok',true,'order_id',p_order_id,'decision',decision,'reason',reason,
    'order_total_cents',total_cents,'reconciled_amount_cents',reconciled_cents,'difference_cents',difference,
    'projected_payment_method',projected_method,'delivery_status',fc.delivery_status,'payment_status_before',fc.payment_status,'fiscal_status_before',fc.fiscal_status,
    'open_reconciliation_cases',open_cases,'policy',pol,'ledger_snapshot',ledger_snapshot,'deterministic',true,'external_side_effect',false);
end;$$;

create or replace function public.record_financial_fiscal_projection_evaluation_v1(p_order_id uuid,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  preview jsonb;
  existing_id uuid;
  new_id uuid;
  key_text text:=left(btrim(coalesce(p_idempotency_key,'')),200);
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.fiscal_projection_recording_enabled or cfg.execution_mode not in ('dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_fiscal_projection_recording_disabled','external_side_effect',false);
  end if;
  if key_text='' then raise exception 'idempotency_key_required'; end if;
  select id into existing_id from public.financial_fiscal_projection_evaluations where idempotency_key=key_text;
  if existing_id is not null then return jsonb_build_object('ok',true,'id',existing_id,'idempotent',true,'external_side_effect',false); end if;
  preview:=public.preview_financial_fiscal_projection_v1(p_order_id);
  if not coalesce((preview->>'ok')::boolean,false) then return preview; end if;
  insert into public.financial_fiscal_projection_evaluations(order_id,policy_version_id,idempotency_key,decision,reason,order_total_cents,reconciled_amount_cents,difference_cents,projected_payment_method,delivery_status,payment_status_before,fiscal_status_before,open_reconciliation_cases,policy_snapshot,ledger_snapshot)
  values(p_order_id,nullif(preview#>>'{policy,policy_id}','')::uuid,key_text,preview->>'decision',preview->>'reason',coalesce((preview->>'order_total_cents')::bigint,0),coalesce((preview->>'reconciled_amount_cents')::bigint,0),coalesce((preview->>'difference_cents')::bigint,0),preview->>'projected_payment_method',preview->>'delivery_status',preview->>'payment_status_before',preview->>'fiscal_status_before',coalesce((preview->>'open_reconciliation_cases')::integer,0),coalesce(preview->'policy','{}'::jsonb),coalesce(preview->'ledger_snapshot','[]'::jsonb)) returning id into new_id;
  return jsonb_build_object('ok',true,'id',new_id,'decision',preview->>'decision','idempotent',false,'external_side_effect',false);
end;$$;

create or replace function public.apply_financial_fiscal_projection_v1(p_evaluation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  ev public.financial_fiscal_projection_evaluations%rowtype;
  pol public.financial_policy_versions%rowtype;
  current_preview jsonb;
  apply_result jsonb;
  method_text text;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.fiscal_projection_enabled or not cfg.fiscal_projection_apply_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_fiscal_projection_apply_disabled','side_effect_performed',false,'external_side_effect',false);
  end if;
  select * into ev from public.financial_fiscal_projection_evaluations where id=p_evaluation_id for update;
  if not found then raise exception 'projection_evaluation_not_found'; end if;
  if ev.applied then return jsonb_build_object('ok',true,'id',ev.id,'idempotent',true,'apply_result',ev.apply_result,'side_effect_performed',false,'external_side_effect',false); end if;
  if ev.decision<>'ready_to_project' then return jsonb_build_object('ok',false,'error','projection_not_ready','decision',ev.decision,'side_effect_performed',false,'external_side_effect',false); end if;
  select * into pol from public.financial_policy_versions where id=ev.policy_version_id;
  if not found or pol.status<>'approved' or not pol.allow_apply or pol.effective_from>now() or (pol.effective_to is not null and pol.effective_to<=now()) then
    return jsonb_build_object('ok',false,'error','approved_apply_policy_required','side_effect_performed',false,'external_side_effect',false);
  end if;
  current_preview:=public.preview_financial_fiscal_projection_v1(ev.order_id);
  if not coalesce((current_preview->>'ok')::boolean,false) or current_preview->>'decision'<>'ready_to_project' then
    return jsonb_build_object('ok',false,'error','projection_state_changed','current',current_preview,'side_effect_performed',false,'external_side_effect',false);
  end if;
  if current_preview#>>'{policy,policy_id}' is distinct from ev.policy_version_id::text then
    return jsonb_build_object('ok',false,'error','projection_policy_changed','side_effect_performed',false,'external_side_effect',false);
  end if;
  method_text:=coalesce(nullif(current_preview->>'projected_payment_method',''),'other');
  if method_text not in ('cash','pix','card','payment_link','prepaid_pix','prepaid_link','other') then method_text:='other'; end if;
  apply_result:=public.confirm_order_payment_v1(ev.order_id,method_text,'financial_reconciliation_projection',((current_preview->>'reconciled_amount_cents')::numeric/100.0),now());
  update public.financial_fiscal_projection_evaluations set applied=true,applied_at=now(),apply_result=apply_result where id=ev.id;
  return jsonb_build_object('ok',true,'id',ev.id,'order_id',ev.order_id,'apply_result',apply_result,'side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.preview_financial_reconciliation_batch_v1(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  lim integer:=greatest(1,least(500,coalesce(p_limit,100)));
  result jsonb;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.batch_reconciliation_audit_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_batch_audit_disabled','external_side_effect',false);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('external_event_id',q.id,'preview',public.preview_financial_reconciliation_match_v1(q.id)) order by q.received_at),'[]'::jsonb) into result
  from (select e.id,e.received_at from public.financial_external_events e where not exists(select 1 from public.financial_match_evaluations m where m.external_event_id=e.id) order by e.received_at limit lim) q;
  return jsonb_build_object('ok',true,'count',jsonb_array_length(result),'items',result,'external_side_effect',false);
end;$$;

create or replace function public.preview_financial_projection_batch_v1(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  lim integer:=greatest(1,least(500,coalesce(p_limit,100)));
  result jsonb;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.batch_reconciliation_audit_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_batch_audit_disabled','external_side_effect',false);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('order_id',q.order_id,'preview',public.preview_financial_fiscal_projection_v1(q.order_id)) order by q.last_event_at),'[]'::jsonb) into result
  from (
    select le.order_id,max(le.created_at) last_event_at from public.financial_ledger_entries le
    join public.orders o on o.id=le.order_id
    where le.recognition_status='reconciled' and le.order_id is not null and o.status='delivered'
    group by le.order_id order by max(le.created_at) limit lim
  ) q;
  return jsonb_build_object('ok',true,'count',jsonb_array_length(result),'items',result,'external_side_effect',false);
end;$$;

revoke all on function public.financial_stage13_readiness_v1() from public,anon,authenticated;
revoke all on function public.preview_financial_policy_v1(text) from public,anon,authenticated;
revoke all on function public.preview_financial_fiscal_projection_v1(uuid) from public,anon,authenticated;
revoke all on function public.record_financial_fiscal_projection_evaluation_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.apply_financial_fiscal_projection_v1(uuid) from public,anon,authenticated;
revoke all on function public.preview_financial_reconciliation_batch_v1(integer) from public,anon,authenticated;
revoke all on function public.preview_financial_projection_batch_v1(integer) from public,anon,authenticated;
grant execute on function public.financial_stage13_readiness_v1() to service_role;
grant execute on function public.preview_financial_policy_v1(text) to service_role;
grant execute on function public.preview_financial_fiscal_projection_v1(uuid) to service_role;
grant execute on function public.record_financial_fiscal_projection_evaluation_v1(uuid,text) to service_role;
grant execute on function public.apply_financial_fiscal_projection_v1(uuid) to service_role;
grant execute on function public.preview_financial_reconciliation_batch_v1(integer) to service_role;
grant execute on function public.preview_financial_projection_batch_v1(integer) to service_role;

commit;
