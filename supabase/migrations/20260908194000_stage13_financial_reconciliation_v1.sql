begin;

-- ETAPA 13D — conciliação abstrata + read model financeiro.
-- Nenhum provider externo é chamado. Eventos são normalizados, auditáveis e não alteram o ledger automaticamente.

alter table public.financial_runtime_config
  add column if not exists external_event_recording_enabled boolean not null default false,
  add column if not exists reconciliation_preview_enabled boolean not null default false,
  add column if not exists reconciliation_recording_enabled boolean not null default false,
  add column if not exists financial_admin_read_enabled boolean not null default false,
  add column if not exists batch_reconciliation_audit_enabled boolean not null default false,
  add column if not exists require_exact_reference_for_auto_match boolean not null default true,
  add column if not exists max_reconciliation_difference_cents bigint;

create table if not exists public.financial_provider_adapters (
  adapter_key text primary key,
  provider text not null,
  payment_method text not null check (payment_method in ('pix','card','payment_link','other')),
  adapter_version integer not null default 1 check (adapter_version>0),
  ingest_mode text not null default 'off' check (ingest_mode in ('off','fixture','webhook','poll')),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  external_poll_enabled boolean not null default false,
  mapping_config jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.financial_provider_adapters enable row level security;
revoke all on public.financial_provider_adapters from public,anon,authenticated;
grant select,insert,update on public.financial_provider_adapters to service_role;

create table if not exists public.financial_external_events (
  id uuid primary key default gen_random_uuid(),
  adapter_key text not null references public.financial_provider_adapters(adapter_key) on delete restrict,
  provider text not null,
  provider_event_id text not null,
  event_kind text not null check (event_kind in ('payment_observed','payment_settled','payment_reversed','chargeback','unknown')),
  payment_method text not null check (payment_method in ('pix','card','payment_link','other')),
  amount_cents bigint not null check (amount_cents>=0),
  currency char(3) not null default 'BRL',
  order_id_hint uuid references public.orders(id) on delete set null,
  external_reference text,
  payer_reference_hash text,
  occurred_at timestamptz,
  received_at timestamptz not null default now(),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  normalized_payload jsonb not null default '{}'::jsonb,
  status text not null default 'observed' check (status in ('observed','duplicate','invalid','review_required')),
  external_side_effect boolean not null default false check (external_side_effect=false),
  created_at timestamptz not null default now(),
  unique(adapter_key,provider_event_id)
);
create index if not exists financial_external_events_order_idx on public.financial_external_events(order_id_hint,received_at desc);
create index if not exists financial_external_events_reference_idx on public.financial_external_events(external_reference) where external_reference is not null;
create index if not exists financial_external_events_status_idx on public.financial_external_events(status,received_at desc);
alter table public.financial_external_events enable row level security;
revoke all on public.financial_external_events from public,anon,authenticated;
grant select,insert on public.financial_external_events to service_role;

create table if not exists public.financial_match_evaluations (
  id uuid primary key default gen_random_uuid(),
  external_event_id uuid not null references public.financial_external_events(id) on delete cascade,
  idempotency_key text not null unique,
  decision text not null check (decision in ('matched','unmatched','ambiguous','review_required')),
  match_basis text not null,
  order_id uuid references public.orders(id) on delete set null,
  ledger_entry_id uuid references public.financial_ledger_entries(id) on delete set null,
  expectation_id uuid references public.financial_payment_expectations(id) on delete set null,
  expected_amount_cents bigint,
  observed_amount_cents bigint not null,
  difference_cents bigint,
  candidate_count integer not null default 0 check (candidate_count>=0),
  candidates jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  policy_snapshot jsonb not null default '{}'::jsonb,
  deterministic boolean not null default true check (deterministic=true),
  external_side_effect boolean not null default false check (external_side_effect=false),
  created_at timestamptz not null default now()
);
create index if not exists financial_match_evaluations_event_idx on public.financial_match_evaluations(external_event_id,created_at desc);
create index if not exists financial_match_evaluations_decision_idx on public.financial_match_evaluations(decision,created_at desc);
alter table public.financial_match_evaluations enable row level security;
revoke all on public.financial_match_evaluations from public,anon,authenticated;
grant select,insert on public.financial_match_evaluations to service_role;

create or replace function public.financial_reconciliation_readiness_v1()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object(
    'enabled',f.enabled,'execution_mode',f.execution_mode,'external_reconciliation_enabled',f.external_reconciliation_enabled,
    'external_event_recording_enabled',f.external_event_recording_enabled,
    'reconciliation_preview_enabled',f.reconciliation_preview_enabled,
    'reconciliation_recording_enabled',f.reconciliation_recording_enabled,
    'financial_admin_read_enabled',f.financial_admin_read_enabled,
    'batch_reconciliation_audit_enabled',f.batch_reconciliation_audit_enabled,
    'fiscal_projection_enabled',f.fiscal_projection_enabled,
    'adapters',(select count(*) from public.financial_provider_adapters),
    'enabled_adapters',(select count(*) from public.financial_provider_adapters where enabled=true and execution_mode<>'off'),
    'external_events',(select count(*) from public.financial_external_events),
    'match_evaluations',(select count(*) from public.financial_match_evaluations),
    'external_side_effect',false
  ) from public.financial_runtime_config f where f.id=1;
$$;

create or replace function public.record_financial_external_event_v1(
  p_adapter_key text,
  p_provider_event_id text,
  p_event_kind text,
  p_amount_cents bigint,
  p_currency text,
  p_order_id_hint uuid,
  p_external_reference text,
  p_payer_reference_hash text,
  p_occurred_at timestamptz,
  p_payload_hash text,
  p_normalized_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  adapter public.financial_provider_adapters%rowtype;
  existing_id uuid;
  new_id uuid;
  event_kind_text text:=lower(btrim(coalesce(p_event_kind,'')));
  currency_text text:=upper(btrim(coalesce(p_currency,'BRL')));
  provider_event_text text:=left(btrim(coalesce(p_provider_event_id,'')),240);
  payload_hash_text text:=lower(btrim(coalesce(p_payload_hash,'')));
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.external_event_recording_enabled or cfg.execution_mode not in ('dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_external_event_recording_disabled','external_side_effect',false);
  end if;
  select * into adapter from public.financial_provider_adapters where adapter_key=p_adapter_key;
  if not found or not adapter.enabled or adapter.execution_mode='off' or adapter.ingest_mode='off' then
    return jsonb_build_object('ok',false,'error','financial_adapter_disabled','external_side_effect',false);
  end if;
  if provider_event_text='' then raise exception 'provider_event_id_required'; end if;
  if event_kind_text not in ('payment_observed','payment_settled','payment_reversed','chargeback','unknown') then raise exception 'invalid_event_kind'; end if;
  if coalesce(p_amount_cents,-1)<0 then raise exception 'invalid_amount'; end if;
  if currency_text<>'BRL' then raise exception 'unsupported_currency'; end if;
  if payload_hash_text !~ '^[a-f0-9]{64}$' then raise exception 'payload_hash_required'; end if;
  if p_payer_reference_hash is not null and lower(btrim(p_payer_reference_hash)) !~ '^[a-f0-9]{64}$' then raise exception 'payer_reference_hash_invalid'; end if;

  select id into existing_id from public.financial_external_events where adapter_key=p_adapter_key and provider_event_id=provider_event_text;
  if existing_id is not null then return jsonb_build_object('ok',true,'id',existing_id,'idempotent',true,'external_side_effect',false); end if;

  insert into public.financial_external_events(
    adapter_key,provider,payment_method,provider_event_id,event_kind,amount_cents,currency,order_id_hint,
    external_reference,payer_reference_hash,occurred_at,payload_hash,normalized_payload
  ) values(
    adapter.adapter_key,adapter.provider,adapter.payment_method,provider_event_text,event_kind_text,p_amount_cents,currency_text,p_order_id_hint,
    nullif(left(btrim(coalesce(p_external_reference,'')),240),''),nullif(lower(btrim(coalesce(p_payer_reference_hash,''))),''),p_occurred_at,payload_hash_text,coalesce(p_normalized_payload,'{}'::jsonb)
  ) returning id into new_id;
  return jsonb_build_object('ok',true,'id',new_id,'idempotent',false,'external_side_effect',false);
end;$$;

create or replace function public.preview_financial_reconciliation_match_v1(p_external_event_id uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  ev public.financial_external_events%rowtype;
  exp public.financial_payment_expectations%rowtype;
  ledger public.financial_ledger_entries%rowtype;
  decision text:='unmatched';
  basis text:='none';
  matched_order uuid;
  matched_expectation uuid;
  matched_ledger uuid;
  expected bigint;
  difference bigint;
  candidate_count integer:=0;
  candidates jsonb:='[]'::jsonb;
  reasons jsonb:='[]'::jsonb;
  max_diff bigint;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.reconciliation_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_reconciliation_preview_disabled','external_side_effect',false);
  end if;
  select * into ev from public.financial_external_events where id=p_external_event_id;
  if not found then raise exception 'external_event_not_found'; end if;
  max_diff:=cfg.max_reconciliation_difference_cents;

  -- 1) Referência exata para um lançamento já observado na operação.
  if ev.external_reference is not null then
    select * into ledger from public.financial_ledger_entries le
     where le.external_reference=ev.external_reference and le.payment_method in (ev.payment_method,case when ev.payment_method='pix' then 'prepaid_pix' else ev.payment_method end)
     order by le.created_at desc limit 1;
    if found and ledger.order_id is not null then
      matched_order:=ledger.order_id;matched_ledger:=ledger.id;expected:=ledger.amount_cents;
      difference:=ev.amount_cents-ledger.amount_cents;
      if difference=0 then decision:='matched';basis:='exact_external_reference';
      else decision:='review_required';basis:='reference_amount_mismatch';reasons:=reasons||jsonb_build_array('external_reference_matched_but_amount_differs'); end if;
    end if;
  end if;

  -- 2) Hint explícito de pedido, sempre validado contra expectativa mais recente.
  if matched_order is null and ev.order_id_hint is not null then
    select * into exp from public.financial_payment_expectations pe where pe.order_id=ev.order_id_hint order by pe.version_no desc limit 1;
    if found then
      matched_order:=ev.order_id_hint;matched_expectation:=exp.id;expected:=exp.expected_amount_cents;difference:=ev.amount_cents-exp.expected_amount_cents;
      if difference=0 and (exp.expected_method is null or exp.expected_method in (ev.payment_method,case when ev.payment_method='pix' then 'prepaid_pix' else ev.payment_method end)) then
        decision:='matched';basis:='explicit_order_hint_exact_amount_method';
      elsif max_diff is not null and abs(difference)<=max_diff then
        decision:='review_required';basis:='explicit_order_hint_within_configured_tolerance';reasons:=reasons||jsonb_build_array('configured_tolerance_requires_review');
      else
        decision:='review_required';basis:='explicit_order_hint_mismatch';reasons:=reasons||jsonb_build_array('amount_or_method_mismatch');
      end if;
    else
      decision:='unmatched';basis:='order_hint_without_expectation';reasons:=reasons||jsonb_build_array('payment_expectation_missing');
    end if;
  end if;

  -- 3) Sem referência forte: procurar candidatos por valor + método, mas nunca auto-conciliar.
  if matched_order is null and ev.order_id_hint is null then
    select count(*),coalesce(jsonb_agg(jsonb_build_object('order_id',q.order_id,'expectation_id',q.id,'expected_amount_cents',q.expected_amount_cents,'expected_method',q.expected_method) order by q.created_at desc),'[]'::jsonb)
      into candidate_count,candidates
    from (
      select pe.* from public.financial_payment_expectations pe
      where pe.expected_amount_cents=ev.amount_cents
        and (pe.expected_method is null or pe.expected_method in (ev.payment_method,case when ev.payment_method='pix' then 'prepaid_pix' else ev.payment_method end))
        and pe.created_at>=coalesce(ev.occurred_at,ev.received_at)-interval '7 days'
        and pe.created_at<=coalesce(ev.occurred_at,ev.received_at)+interval '1 day'
      order by pe.created_at desc limit 10
    ) q;
    if candidate_count=1 then decision:='review_required';basis:='single_weak_amount_method_candidate';reasons:=reasons||jsonb_build_array('exact_reference_required_for_auto_match');
    elsif candidate_count>1 then decision:='ambiguous';basis:='multiple_amount_method_candidates';reasons:=reasons||jsonb_build_array('multiple_candidates');
    else decision:='unmatched';basis:='no_candidate';reasons:=reasons||jsonb_build_array('no_matching_expectation'); end if;
  end if;

  if cfg.require_exact_reference_for_auto_match and decision='matched' and basis<>'exact_external_reference' and basis<>'explicit_order_hint_exact_amount_method' then
    decision:='review_required';reasons:=reasons||jsonb_build_array('exact_reference_policy');
  end if;

  return jsonb_build_object(
    'ok',true,'external_event_id',ev.id,'decision',decision,'match_basis',basis,
    'order_id',matched_order,'ledger_entry_id',matched_ledger,'expectation_id',matched_expectation,
    'expected_amount_cents',expected,'observed_amount_cents',ev.amount_cents,'difference_cents',difference,
    'candidate_count',candidate_count,'candidates',candidates,'reasons',reasons,
    'policy',jsonb_build_object('require_exact_reference_for_auto_match',cfg.require_exact_reference_for_auto_match,'max_reconciliation_difference_cents',max_diff),
    'deterministic',true,'external_side_effect',false
  );
end;$$;

create or replace function public.record_financial_reconciliation_evaluation_v1(
  p_external_event_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  cfg public.financial_runtime_config%rowtype;
  preview jsonb;
  existing_id uuid;
  new_id uuid;
  key_text text:=left(btrim(coalesce(p_idempotency_key,'')),200);
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.reconciliation_recording_enabled or cfg.execution_mode not in ('dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_reconciliation_recording_disabled','external_side_effect',false);
  end if;
  if key_text='' then raise exception 'idempotency_key_required'; end if;
  select id into existing_id from public.financial_match_evaluations where idempotency_key=key_text;
  if existing_id is not null then return jsonb_build_object('ok',true,'id',existing_id,'idempotent',true,'external_side_effect',false); end if;
  preview:=public.preview_financial_reconciliation_match_v1(p_external_event_id);
  if not coalesce((preview->>'ok')::boolean,false) then return preview; end if;
  insert into public.financial_match_evaluations(
    external_event_id,idempotency_key,decision,match_basis,order_id,ledger_entry_id,expectation_id,
    expected_amount_cents,observed_amount_cents,difference_cents,candidate_count,candidates,reasons,policy_snapshot
  ) values(
    p_external_event_id,key_text,preview->>'decision',preview->>'match_basis',nullif(preview->>'order_id','')::uuid,nullif(preview->>'ledger_entry_id','')::uuid,nullif(preview->>'expectation_id','')::uuid,
    nullif(preview->>'expected_amount_cents','')::bigint,(preview->>'observed_amount_cents')::bigint,nullif(preview->>'difference_cents','')::bigint,
    coalesce((preview->>'candidate_count')::integer,0),coalesce(preview->'candidates','[]'::jsonb),coalesce(preview->'reasons','[]'::jsonb),coalesce(preview->'policy','{}'::jsonb)
  ) returning id into new_id;
  return jsonb_build_object('ok',true,'id',new_id,'decision',preview->>'decision','idempotent',false,'external_side_effect',false);
end;$$;

create or replace function public.get_financial_admin_dashboard_v1()
returns jsonb
language plpgsql security definer set search_path='' as $$
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
      'route_manifests',(select count(*) from public.financial_route_collection_manifests)
    ),
    'recent_external_events',coalesce((select jsonb_agg(x) from (select id,provider,event_kind,payment_method,amount_cents,currency,order_id_hint,external_reference,status,received_at from public.financial_external_events order by received_at desc limit 30)x),'[]'::jsonb),
    'recent_matches',coalesce((select jsonb_agg(x) from (select id,external_event_id,decision,match_basis,order_id,expected_amount_cents,observed_amount_cents,difference_cents,created_at from public.financial_match_evaluations order by created_at desc limit 30)x),'[]'::jsonb),
    'open_reconciliation_cases',coalesce((select jsonb_agg(x) from (select id,case_type,order_id,route_id,status,reason,expected_amount_cents,observed_amount_cents,difference_cents,created_at from public.financial_reconciliation_cases where status='open' order by created_at desc limit 30)x),'[]'::jsonb),
    'external_side_effect',false
  );
end;$$;

create or replace function public.get_financial_admin_order_v1(p_order_id uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg public.financial_runtime_config%rowtype; ord public.orders%rowtype;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.financial_admin_read_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','financial_admin_read_disabled','external_side_effect',false);
  end if;
  select * into ord from public.orders where id=p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  return jsonb_build_object(
    'ok',true,
    'order',jsonb_build_object('id',ord.id,'status',ord.status,'total',ord.total,'currency',ord.currency,'confirmed_at',ord.confirmed_at,'delivered_at',ord.delivered_at),
    'expectations',coalesce((select jsonb_agg(x) from (select id,version_no,collection_mode,expected_method,expected_amount_cents,tender_amount_cents,change_required_cents,due_at,decision,reason,created_at from public.financial_payment_expectations where order_id=p_order_id order by version_no desc)x),'[]'::jsonb),
    'ledger',coalesce((select jsonb_agg(x) from (select id,event_type,recognition_status,payment_method,amount_cents,external_reference,reverses_entry_id,occurred_at,created_at from public.financial_ledger_entries where order_id=p_order_id order by occurred_at,created_at)x),'[]'::jsonb),
    'external_events',coalesce((select jsonb_agg(x) from (select id,provider,event_kind,payment_method,amount_cents,external_reference,status,received_at from public.financial_external_events where order_id_hint=p_order_id order by received_at desc)x),'[]'::jsonb),
    'matches',coalesce((select jsonb_agg(x) from (select me.id,me.external_event_id,me.decision,me.match_basis,me.expected_amount_cents,me.observed_amount_cents,me.difference_cents,me.created_at from public.financial_match_evaluations me where me.order_id=p_order_id order by me.created_at desc)x),'[]'::jsonb),
    'cases',coalesce((select jsonb_agg(x) from (select id,case_type,status,reason,expected_amount_cents,observed_amount_cents,difference_cents,created_at,resolved_at from public.financial_reconciliation_cases where order_id=p_order_id order by created_at desc)x),'[]'::jsonb),
    'fiscal',coalesce((select jsonb_build_object('delivery_status',fc.delivery_status,'payment_status',fc.payment_status,'payment_method',fc.payment_method,'fiscal_status',fc.fiscal_status,'fiscal_block_reason',fc.fiscal_block_reason) from public.order_fiscal_controls fc where fc.order_id=p_order_id),'{}'::jsonb),
    'external_side_effect',false
  );
end;$$;

revoke all on function public.financial_reconciliation_readiness_v1() from public,anon,authenticated;
revoke all on function public.record_financial_external_event_v1(text,text,text,bigint,text,uuid,text,text,timestamptz,text,jsonb) from public,anon,authenticated;
revoke all on function public.preview_financial_reconciliation_match_v1(uuid) from public,anon,authenticated;
revoke all on function public.record_financial_reconciliation_evaluation_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.get_financial_admin_dashboard_v1() from public,anon,authenticated;
revoke all on function public.get_financial_admin_order_v1(uuid) from public,anon,authenticated;
grant execute on function public.financial_reconciliation_readiness_v1() to service_role;
grant execute on function public.record_financial_external_event_v1(text,text,text,bigint,text,uuid,text,text,timestamptz,text,jsonb) to service_role;
grant execute on function public.preview_financial_reconciliation_match_v1(uuid) to service_role;
grant execute on function public.record_financial_reconciliation_evaluation_v1(uuid,text) to service_role;
grant execute on function public.get_financial_admin_dashboard_v1() to service_role;
grant execute on function public.get_financial_admin_order_v1(uuid) to service_role;

commit;
