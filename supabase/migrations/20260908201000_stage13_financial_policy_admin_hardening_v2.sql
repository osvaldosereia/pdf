begin;

-- ETAPA 13E V2 — administração de políticas + hardening da projeção financeira.
-- Continua fail-closed: nenhuma política nasce aprovada e nenhum runtime é ativado.

alter table public.financial_runtime_config
  add column if not exists financial_policy_write_enabled boolean not null default false;

create table if not exists public.financial_policy_events (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.financial_policy_versions(id) on delete restrict,
  scope_key text not null,
  version integer not null,
  event_type text not null check (event_type in ('draft_created','approved','retired')),
  actor_admin_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  reason text,
  snapshot jsonb not null default '{}'::jsonb,
  external_side_effect boolean not null default false check (external_side_effect=false),
  created_at timestamptz not null default now()
);
create index if not exists financial_policy_events_policy_idx on public.financial_policy_events(policy_id,created_at desc);
create index if not exists financial_policy_events_scope_idx on public.financial_policy_events(scope_key,created_at desc);
alter table public.financial_policy_events enable row level security;
revoke all on public.financial_policy_events from public,anon,authenticated;
grant select,insert on public.financial_policy_events to service_role;

create or replace function public.prevent_financial_policy_event_mutation_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception 'financial_policy_events_append_only';
end;$$;
drop trigger if exists financial_policy_events_append_only on public.financial_policy_events;
create trigger financial_policy_events_append_only
before update or delete on public.financial_policy_events
for each row execute function public.prevent_financial_policy_event_mutation_v1();

create or replace function public.list_financial_policies_v1(p_scope_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  scope_text text:=nullif(lower(btrim(coalesce(p_scope_key,''))), '');
  items jsonb;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.financial_admin_read_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_admin_read_disabled','external_side_effect',false);
  end if;
  if scope_text is not null and scope_text not in ('reconciliation','route_close','fiscal_projection') then raise exception 'invalid_financial_policy_scope'; end if;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.scope_key,q.version desc),'[]'::jsonb) into items
  from (
    select p.id,p.scope_key,p.version,p.status,p.max_difference_cents,p.require_exact_reference,p.require_delivery_confirmed,
      p.require_no_open_reconciliation_case,p.allow_apply,p.effective_from,p.effective_to,p.config,p.reason,p.approved_by,p.approved_at,p.created_at,p.updated_at
    from public.financial_policy_versions p
    where scope_text is null or p.scope_key=scope_text
  ) q;
  return jsonb_build_object('ok',true,'items',items,'external_side_effect',false);
end;$$;

create or replace function public.create_financial_policy_draft_v1(
  p_scope_key text,
  p_max_difference_cents bigint,
  p_require_exact_reference boolean,
  p_require_delivery_confirmed boolean,
  p_require_no_open_reconciliation_case boolean,
  p_allow_apply boolean,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_reason text,
  p_config jsonb,
  p_admin_user_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  scope_text text:=lower(btrim(coalesce(p_scope_key,'')));
  next_version integer;
  new_id uuid;
  snapshot jsonb;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.financial_policy_write_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_policy_write_disabled','external_side_effect',false);
  end if;
  if not exists(select 1 from public.admin_users a where a.user_id=p_admin_user_id and a.is_active=true and a.role='owner') then raise exception 'owner_required'; end if;
  if scope_text not in ('reconciliation','route_close','fiscal_projection') then raise exception 'invalid_financial_policy_scope'; end if;
  if p_max_difference_cents is not null and p_max_difference_cents<0 then raise exception 'invalid_max_difference_cents'; end if;
  if p_effective_to is not null and p_effective_from is not null and p_effective_to<=p_effective_from then raise exception 'invalid_policy_window'; end if;
  select coalesce(max(version),0)+1 into next_version from public.financial_policy_versions where scope_key=scope_text;
  insert into public.financial_policy_versions(
    scope_key,version,status,max_difference_cents,require_exact_reference,require_delivery_confirmed,
    require_no_open_reconciliation_case,allow_apply,effective_from,effective_to,config,reason
  ) values(
    scope_text,next_version,'draft',p_max_difference_cents,coalesce(p_require_exact_reference,true),coalesce(p_require_delivery_confirmed,true),
    coalesce(p_require_no_open_reconciliation_case,true),coalesce(p_allow_apply,false),p_effective_from,p_effective_to,coalesce(p_config,'{}'::jsonb),left(nullif(btrim(coalesce(p_reason,'')),''),1000)
  ) returning id into new_id;
  select to_jsonb(p) into snapshot from public.financial_policy_versions p where id=new_id;
  insert into public.financial_policy_events(policy_id,scope_key,version,event_type,actor_admin_user_id,reason,snapshot)
  values(new_id,scope_text,next_version,'draft_created',p_admin_user_id,left(nullif(btrim(coalesce(p_reason,'')),''),1000),snapshot);
  return jsonb_build_object('ok',true,'id',new_id,'scope_key',scope_text,'version',next_version,'status','draft','external_side_effect',false);
end;$$;

create or replace function public.approve_financial_policy_v1(
  p_policy_id uuid,
  p_admin_user_id uuid,
  p_effective_from timestamptz default now(),
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  pol public.financial_policy_versions%rowtype;
  start_at timestamptz:=coalesce(p_effective_from,now());
  snapshot jsonb;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.financial_policy_write_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_policy_write_disabled','external_side_effect',false);
  end if;
  if not exists(select 1 from public.admin_users a where a.user_id=p_admin_user_id and a.is_active=true and a.role='owner') then raise exception 'owner_required'; end if;
  select * into pol from public.financial_policy_versions where id=p_policy_id for update;
  if not found then raise exception 'financial_policy_not_found'; end if;
  if pol.status<>'draft' then return jsonb_build_object('ok',false,'error','financial_policy_not_draft','status',pol.status,'external_side_effect',false); end if;
  if pol.effective_to is not null and pol.effective_to<=start_at then raise exception 'invalid_policy_window'; end if;
  if exists(
    select 1 from public.financial_policy_versions x
    where x.scope_key=pol.scope_key and x.id<>pol.id and x.status='approved'
      and x.effective_from<coalesce(pol.effective_to,'infinity'::timestamptz)
      and coalesce(x.effective_to,'infinity'::timestamptz)>start_at
      and x.effective_to is not null
  ) then
    return jsonb_build_object('ok',false,'error','approved_policy_window_overlap','external_side_effect',false);
  end if;
  update public.financial_policy_versions
     set effective_to=start_at,updated_at=now()
   where scope_key=pol.scope_key and id<>pol.id and status='approved' and effective_to is null and effective_from<start_at;
  if exists(select 1 from public.financial_policy_versions x where x.scope_key=pol.scope_key and x.id<>pol.id and x.status='approved' and x.effective_to is null) then
    return jsonb_build_object('ok',false,'error','future_approved_policy_exists','external_side_effect',false);
  end if;
  update public.financial_policy_versions
     set status='approved',effective_from=start_at,approved_by=p_admin_user_id,approved_at=now(),
         reason=coalesce(left(nullif(btrim(coalesce(p_reason,'')),''),1000),reason),updated_at=now()
   where id=pol.id;
  select to_jsonb(p) into snapshot from public.financial_policy_versions p where id=pol.id;
  insert into public.financial_policy_events(policy_id,scope_key,version,event_type,actor_admin_user_id,reason,snapshot)
  values(pol.id,pol.scope_key,pol.version,'approved',p_admin_user_id,left(nullif(btrim(coalesce(p_reason,'')),''),1000),snapshot);
  return jsonb_build_object('ok',true,'id',pol.id,'scope_key',pol.scope_key,'version',pol.version,'status','approved','effective_from',start_at,'external_side_effect',false);
end;$$;

create or replace function public.retire_financial_policy_v1(
  p_policy_id uuid,
  p_admin_user_id uuid,
  p_reason text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  pol public.financial_policy_versions%rowtype;
  snapshot jsonb;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.financial_policy_write_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_policy_write_disabled','external_side_effect',false);
  end if;
  if not exists(select 1 from public.admin_users a where a.user_id=p_admin_user_id and a.is_active=true and a.role='owner') then raise exception 'owner_required'; end if;
  select * into pol from public.financial_policy_versions where id=p_policy_id for update;
  if not found then raise exception 'financial_policy_not_found'; end if;
  if pol.status='retired' then return jsonb_build_object('ok',true,'id',pol.id,'status','retired','idempotent',true,'external_side_effect',false); end if;
  update public.financial_policy_versions
     set status='retired',effective_to=case when effective_from is not null then greatest(effective_from+interval '1 microsecond',coalesce(effective_to,now())) else effective_to end,
         reason=coalesce(left(nullif(btrim(coalesce(p_reason,'')),''),1000),reason),updated_at=now()
   where id=pol.id;
  select to_jsonb(p) into snapshot from public.financial_policy_versions p where id=pol.id;
  insert into public.financial_policy_events(policy_id,scope_key,version,event_type,actor_admin_user_id,reason,snapshot)
  values(pol.id,pol.scope_key,pol.version,'retired',p_admin_user_id,left(nullif(btrim(coalesce(p_reason,'')),''),1000),snapshot);
  return jsonb_build_object('ok',true,'id',pol.id,'scope_key',pol.scope_key,'version',pol.version,'status','retired','idempotent',false,'external_side_effect',false);
end;$$;

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
    'financial_policy_write_enabled',f.financial_policy_write_enabled,
    'approved_projection_policies',(select count(*) from public.financial_policy_versions p where p.scope_key='fiscal_projection' and p.status='approved' and p.effective_from<=now() and (p.effective_to is null or p.effective_to>now())),
    'policy_versions',(select count(*) from public.financial_policy_versions),
    'policy_events',(select count(*) from public.financial_policy_events),
    'projection_evaluations',(select count(*) from public.financial_fiscal_projection_evaluations),
    'applied_projections',(select count(*) from public.financial_fiscal_projection_evaluations where applied=true),
    'external_side_effect',false
  ) from public.financial_runtime_config f where f.id=1;
$$;

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
  reference_gap_count integer:=0;
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
  if upper(coalesce(ord.currency,'BRL'))<>upper(coalesce(cfg.base_currency,'BRL')) then
    return jsonb_build_object('ok',true,'decision','review_required','reason','unsupported_order_currency','order_id',p_order_id,'external_side_effect',false);
  end if;
  pol:=public.preview_financial_policy_v1('fiscal_projection');
  if not coalesce((pol->>'ok')::boolean,false) then
    return jsonb_build_object('ok',true,'decision','blocked','reason',coalesce(pol->>'error','approved_financial_policy_required'),'order_id',p_order_id,'policy',pol,'external_side_effect',false);
  end if;
  total_cents:=round(ord.total*100)::bigint;
  select
    coalesce(sum(case when le.event_type='payment_received' then le.amount_cents when le.event_type='payment_reversed' then -le.amount_cents else 0 end),0),
    count(distinct case when le.event_type='payment_received' then le.payment_method end),
    min(case when le.event_type='payment_received' then le.payment_method end),
    count(*) filter(where le.event_type='payment_received' and le.payment_method not in ('cash') and nullif(btrim(coalesce(le.external_reference,'')),'') is null),
    coalesce(jsonb_agg(jsonb_build_object('id',le.id,'event_type',le.event_type,'payment_method',le.payment_method,'amount_cents',le.amount_cents,'external_reference',le.external_reference,'occurred_at',le.occurred_at) order by le.occurred_at,le.created_at),'[]'::jsonb)
  into reconciled_cents,method_count,single_method,reference_gap_count,ledger_snapshot
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
  elsif coalesce((pol->>'require_exact_reference')::boolean,true) and reference_gap_count>0 then
    decision:='review_required';reason:='reconciled_external_reference_missing';
  elsif (pol->>'max_difference_cents') is null then
    decision:='blocked';reason:='projection_tolerance_not_configured';
  elsif abs(difference)>(pol->>'max_difference_cents')::bigint then
    decision:='review_required';reason:='reconciled_amount_mismatch';
  else
    decision:='ready_to_project';reason:='delivery_and_reconciled_payment_valid';
  end if;

  return jsonb_build_object(
    'ok',true,'order_id',p_order_id,'decision',decision,'reason',reason,
    'order_total_cents',total_cents,'reconciled_amount_cents',reconciled_cents,'difference_cents',difference,
    'projected_payment_method',projected_method,'delivery_status',fc.delivery_status,'payment_status_before',fc.payment_status,'fiscal_status_before',fc.fiscal_status,
    'open_reconciliation_cases',open_cases,'reference_gap_count',reference_gap_count,
    'policy',pol,'ledger_snapshot',ledger_snapshot,'deterministic',true,'external_side_effect',false
  );
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
  update public.financial_fiscal_projection_evaluations set apply_result=apply_result where id=ev.id;
  if not coalesce((apply_result->>'ok')::boolean,false) or coalesce(apply_result->>'fiscal_status','')<>'ready' then
    return jsonb_build_object('ok',false,'error','projection_apply_not_fiscal_ready','id',ev.id,'apply_result',apply_result,'side_effect_performed',true,'external_side_effect',false);
  end if;
  update public.financial_fiscal_projection_evaluations set applied=true,applied_at=now() where id=ev.id;
  return jsonb_build_object('ok',true,'id',ev.id,'order_id',ev.order_id,'apply_result',apply_result,'side_effect_performed',true,'external_side_effect',false);
end;$$;

create or replace function public.get_financial_admin_dashboard_v1()
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.financial_runtime_config%rowtype;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.financial_admin_read_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_admin_read_disabled','external_side_effect',false);
  end if;
  return jsonb_build_object(
    'ok',true,
    'metrics',jsonb_build_object(
      'ledger_entries',(select count(*) from public.financial_ledger_entries),
      'payment_expectations',(select count(*) from public.financial_payment_expectations),
      'external_events',(select count(*) from public.financial_external_events),
      'unmatched_events',(select count(*) from public.financial_match_evaluations where decision='unmatched'),
      'ambiguous_events',(select count(*) from public.financial_match_evaluations where decision='ambiguous'),
      'review_required',(select count(*) from public.financial_match_evaluations where decision='review_required'),
      'open_cases',(select count(*) from public.financial_reconciliation_cases where status='open'),
      'route_manifests',(select count(*) from public.financial_route_collection_manifests),
      'policy_versions',(select count(*) from public.financial_policy_versions),
      'approved_projection_policies',(select count(*) from public.financial_policy_versions where scope_key='fiscal_projection' and status='approved' and effective_from<=now() and (effective_to is null or effective_to>now())),
      'projection_evaluations',(select count(*) from public.financial_fiscal_projection_evaluations),
      'applied_projections',(select count(*) from public.financial_fiscal_projection_evaluations where applied=true)
    ),
    'recent_external_events',coalesce((select jsonb_agg(x) from (select id,provider,event_kind,payment_method,amount_cents,currency,order_id_hint,external_reference,status,received_at from public.financial_external_events order by received_at desc limit 30)x),'[]'::jsonb),
    'recent_matches',coalesce((select jsonb_agg(x) from (select id,external_event_id,decision,match_basis,order_id,expected_amount_cents,observed_amount_cents,difference_cents,created_at from public.financial_match_evaluations order by created_at desc limit 30)x),'[]'::jsonb),
    'open_reconciliation_cases',coalesce((select jsonb_agg(x) from (select id,case_type,order_id,route_id,status,reason,expected_amount_cents,observed_amount_cents,difference_cents,created_at from public.financial_reconciliation_cases where status='open' order by created_at desc limit 30)x),'[]'::jsonb),
    'recent_projections',coalesce((select jsonb_agg(x) from (select id,order_id,decision,reason,order_total_cents,reconciled_amount_cents,difference_cents,projected_payment_method,applied,applied_at,created_at from public.financial_fiscal_projection_evaluations order by created_at desc limit 30)x),'[]'::jsonb),
    'recent_policies',coalesce((select jsonb_agg(x) from (select id,scope_key,version,status,max_difference_cents,require_exact_reference,require_delivery_confirmed,require_no_open_reconciliation_case,allow_apply,effective_from,effective_to,reason,approved_at,created_at from public.financial_policy_versions order by scope_key,version desc limit 30)x),'[]'::jsonb),
    'external_side_effect',false
  );
end;$$;

revoke all on function public.prevent_financial_policy_event_mutation_v1() from public,anon,authenticated;
revoke all on function public.list_financial_policies_v1(text) from public,anon,authenticated;
revoke all on function public.create_financial_policy_draft_v1(text,bigint,boolean,boolean,boolean,boolean,timestamptz,timestamptz,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.approve_financial_policy_v1(uuid,uuid,timestamptz,text) from public,anon,authenticated;
revoke all on function public.retire_financial_policy_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.financial_stage13_readiness_v1() from public,anon,authenticated;
revoke all on function public.preview_financial_fiscal_projection_v1(uuid) from public,anon,authenticated;
revoke all on function public.apply_financial_fiscal_projection_v1(uuid) from public,anon,authenticated;
revoke all on function public.get_financial_admin_dashboard_v1() from public,anon,authenticated;
grant execute on function public.list_financial_policies_v1(text) to service_role;
grant execute on function public.create_financial_policy_draft_v1(text,bigint,boolean,boolean,boolean,boolean,timestamptz,timestamptz,text,jsonb,uuid) to service_role;
grant execute on function public.approve_financial_policy_v1(uuid,uuid,timestamptz,text) to service_role;
grant execute on function public.retire_financial_policy_v1(uuid,uuid,text) to service_role;
grant execute on function public.financial_stage13_readiness_v1() to service_role;
grant execute on function public.preview_financial_fiscal_projection_v1(uuid) to service_role;
grant execute on function public.apply_financial_fiscal_projection_v1(uuid) to service_role;
grant execute on function public.get_financial_admin_dashboard_v1() to service_role;

commit;
