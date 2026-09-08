begin;

-- Stage 13B — payment expectations + route collection manifest.
-- Dormant, server-only and provider-free. Does not confirm payment, delivery or fiscal readiness.

alter table public.financial_runtime_config
  add column if not exists payment_expectation_preview_enabled boolean not null default false,
  add column if not exists payment_expectation_recording_enabled boolean not null default false,
  add column if not exists route_collection_manifest_preview_enabled boolean not null default false,
  add column if not exists route_collection_manifest_recording_enabled boolean not null default false;

create table if not exists public.financial_payment_expectations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  version_no integer not null check(version_no > 0),
  idempotency_key text not null unique,
  supersedes_expectation_id uuid null references public.financial_payment_expectations(id) on delete restrict,
  collection_mode text not null check(collection_mode in ('prepaid','on_delivery','mixed','unknown')),
  expected_method text null check(expected_method is null or expected_method in ('cash','pix','card','payment_link','prepaid_pix','prepaid_link','other')),
  expected_amount_cents bigint not null check(expected_amount_cents >= 0),
  tender_amount_cents bigint null check(tender_amount_cents is null or tender_amount_cents >= 0),
  change_required_cents bigint not null default 0 check(change_required_cents >= 0),
  due_at timestamptz null,
  decision text not null check(decision in ('expected','covered','review_required')),
  reason text null,
  source text not null,
  snapshot jsonb not null default '{}'::jsonb,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now(),
  unique(order_id,version_no),
  check(expected_method='cash' or tender_amount_cents is null),
  check(expected_method='cash' or change_required_cents=0)
);
alter table public.financial_payment_expectations enable row level security;
create index if not exists financial_payment_expectations_order_idx on public.financial_payment_expectations(order_id,version_no desc);

create table if not exists public.financial_route_collection_manifests (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.delivery_routes(id) on delete restrict,
  driver_id uuid null references public.drivers(id) on delete restrict,
  version_no integer not null check(version_no > 0),
  idempotency_key text not null unique,
  order_count integer not null default 0 check(order_count >= 0),
  collect_order_count integer not null default 0 check(collect_order_count >= 0),
  review_order_count integer not null default 0 check(review_order_count >= 0),
  expected_total_cents bigint not null default 0,
  already_received_cents bigint not null default 0,
  collect_due_cents bigint not null default 0,
  cash_due_cents bigint not null default 0,
  pix_due_cents bigint not null default 0,
  card_due_cents bigint not null default 0,
  payment_link_due_cents bigint not null default 0,
  other_due_cents bigint not null default 0,
  change_required_cents bigint not null default 0,
  decision text not null check(decision in ('ready','review_required')),
  snapshot jsonb not null default '{}'::jsonb,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now(),
  unique(route_id,version_no)
);
alter table public.financial_route_collection_manifests enable row level security;
create index if not exists financial_route_collection_manifest_route_idx on public.financial_route_collection_manifests(route_id,version_no desc);

-- Reuse the already-hardened SECURITY INVOKER append-only guard.
drop trigger if exists trg_financial_payment_expectations_append_only on public.financial_payment_expectations;
create trigger trg_financial_payment_expectations_append_only
before update or delete on public.financial_payment_expectations
for each row execute function public.prevent_financial_append_only_mutation_v1();

drop trigger if exists trg_financial_route_collection_manifests_append_only on public.financial_route_collection_manifests;
create trigger trg_financial_route_collection_manifests_append_only
before update or delete on public.financial_route_collection_manifests
for each row execute function public.prevent_financial_append_only_mutation_v1();

create or replace function public.financial_readiness_v2()
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
    'payment_expectation_preview_enabled',c.payment_expectation_preview_enabled,
    'payment_expectation_recording_enabled',c.payment_expectation_recording_enabled,
    'route_collection_manifest_preview_enabled',c.route_collection_manifest_preview_enabled,
    'route_collection_manifest_recording_enabled',c.route_collection_manifest_recording_enabled,
    'allowed_cash_difference_cents',c.allowed_cash_difference_cents,
    'ledger_entries',(select count(*) from public.financial_ledger_entries),
    'payment_expectations',(select count(*) from public.financial_payment_expectations),
    'route_collection_manifests',(select count(*) from public.financial_route_collection_manifests),
    'route_close_evaluations',(select count(*) from public.financial_route_close_evaluations),
    'reconciliation_cases',(select count(*) from public.financial_reconciliation_cases),
    'external_side_effect',false
  ) from public.financial_runtime_config c where c.id=1;
$$;

create or replace function public.preview_order_payment_expectation_v1(
  p_order_id uuid,
  p_collection_mode text,
  p_expected_method text default null,
  p_tender_amount_cents bigint default null,
  p_due_at timestamptz default null,
  p_source text default 'system'
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  o public.orders%rowtype;
  mode text:=lower(trim(coalesce(p_collection_mode,'')));
  method text:=nullif(lower(trim(coalesce(p_expected_method,''))), '');
  src text:=trim(coalesce(p_source,''));
  expected_cents bigint;
  received_cents bigint:=0;
  reversed_cents bigint:=0;
  net_received_cents bigint:=0;
  remaining_cents bigint:=0;
  change_cents bigint:=0;
  decision text:='expected';
  reason text:=null;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.payment_expectation_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','payment_expectation_preview_disabled','external_side_effect',false);
  end if;
  select * into o from public.orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found','external_side_effect',false); end if;
  if mode not in ('prepaid','on_delivery','mixed','unknown') then return jsonb_build_object('ok',false,'error','invalid_collection_mode','external_side_effect',false); end if;
  if method is not null and method not in ('cash','pix','card','payment_link','prepaid_pix','prepaid_link','other') then return jsonb_build_object('ok',false,'error','invalid_expected_method','external_side_effect',false); end if;
  if src='' then return jsonb_build_object('ok',false,'error','source_required','external_side_effect',false); end if;
  if p_tender_amount_cents is not null and p_tender_amount_cents<0 then return jsonb_build_object('ok',false,'error','invalid_tender_amount','external_side_effect',false); end if;
  if p_tender_amount_cents is not null and method is distinct from 'cash' then return jsonb_build_object('ok',false,'error','tender_amount_requires_cash','external_side_effect',false); end if;

  expected_cents:=round(o.total*100)::bigint;
  select
    coalesce(sum(case when e.event_type='payment_received' and e.recognition_status in ('operational_confirmed','reconciled') then e.amount_cents else 0 end),0),
    coalesce(sum(case when e.event_type='payment_reversed' and e.recognition_status in ('operational_confirmed','reconciled') then e.amount_cents else 0 end),0)
  into received_cents,reversed_cents
  from public.financial_ledger_entries e where e.order_id=o.id;
  net_received_cents:=received_cents-reversed_cents;
  remaining_cents:=greatest(expected_cents-net_received_cents,0);

  if net_received_cents>expected_cents then
    decision:='review_required';reason:='order_overpaid';
  elsif remaining_cents=0 then
    decision:='covered';reason:='already_received';
  elsif mode='unknown' then
    decision:='review_required';reason:='collection_mode_unknown';
  elsif mode='prepaid' and net_received_cents<expected_cents then
    decision:='review_required';reason:='prepayment_incomplete';
  elsif method='cash' and p_tender_amount_cents is not null and p_tender_amount_cents<remaining_cents and mode<>'mixed' then
    decision:='review_required';reason:='cash_tender_below_remaining_due';
  end if;

  if method='cash' and p_tender_amount_cents is not null then
    change_cents:=greatest(p_tender_amount_cents-remaining_cents,0);
  end if;

  return jsonb_build_object(
    'ok',true,
    'order_id',o.id,
    'currency',o.currency,
    'collection_mode',mode,
    'expected_method',method,
    'expected_amount_cents',expected_cents,
    'already_received_cents',net_received_cents,
    'remaining_due_cents',remaining_cents,
    'tender_amount_cents',p_tender_amount_cents,
    'change_required_cents',change_cents,
    'due_at',p_due_at,
    'decision',decision,
    'reason',reason,
    'source',src,
    'payment_confirmed',false,
    'delivery_confirmed',false,
    'fiscal_mutated',false,
    'side_effect_performed',false,
    'external_side_effect',false
  );
end;
$$;

create or replace function public.record_order_payment_expectation_v1(
  p_order_id uuid,
  p_collection_mode text,
  p_expected_method text,
  p_tender_amount_cents bigint,
  p_due_at timestamptz,
  p_source text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  prior public.financial_payment_expectations%rowtype;
  previous public.financial_payment_expectations%rowtype;
  preview jsonb;
  next_version integer;
  new_id uuid;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.payment_expectation_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','payment_expectation_recording_disabled','external_side_effect',false);
  end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','external_side_effect',false); end if;
  select * into prior from public.financial_payment_expectations where idempotency_key=trim(p_idempotency_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'expectation_id',prior.id,'version_no',prior.version_no,'decision',prior.decision,'external_side_effect',false); end if;

  preview:=public.preview_order_payment_expectation_v1(p_order_id,p_collection_mode,p_expected_method,p_tender_amount_cents,p_due_at,p_source);
  if not coalesce((preview->>'ok')::boolean,false) then return preview; end if;

  select * into previous from public.financial_payment_expectations where order_id=p_order_id order by version_no desc limit 1;
  next_version:=coalesce(previous.version_no,0)+1;

  insert into public.financial_payment_expectations(
    order_id,version_no,idempotency_key,supersedes_expectation_id,collection_mode,expected_method,
    expected_amount_cents,tender_amount_cents,change_required_cents,due_at,decision,reason,source,snapshot
  ) values(
    p_order_id,next_version,trim(p_idempotency_key),previous.id,preview->>'collection_mode',nullif(preview->>'expected_method',''),
    (preview->>'expected_amount_cents')::bigint,p_tender_amount_cents,(preview->>'change_required_cents')::bigint,p_due_at,
    preview->>'decision',nullif(preview->>'reason',''),trim(p_source),preview
  ) returning id into new_id;

  return jsonb_build_object('ok',true,'replay',false,'expectation_id',new_id,'version_no',next_version,'decision',preview->>'decision','payment_confirmed',false,'fiscal_mutated',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.preview_route_collection_manifest_v1(p_route_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  r public.delivery_routes%rowtype;
  rec record;
  order_count integer:=0;
  collect_count integer:=0;
  review_count integer:=0;
  expected_total bigint:=0;
  already_received bigint:=0;
  collect_due bigint:=0;
  cash_due bigint:=0;
  pix_due bigint:=0;
  card_due bigint:=0;
  link_due bigint:=0;
  other_due bigint:=0;
  change_due bigint:=0;
  remaining bigint;
  net_received bigint;
  tender bigint;
  method text;
  mode text;
  row_review boolean;
  rows_json jsonb:='[]'::jsonb;
  decision text:='ready';
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.route_collection_manifest_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','route_collection_manifest_preview_disabled','external_side_effect',false);
  end if;
  select * into r from public.delivery_routes where id=p_route_id;
  if not found then return jsonb_build_object('ok',false,'error','route_not_found','external_side_effect',false); end if;

  for rec in
    select distinct on (o.id)
      o.id as order_id,
      round(o.total*100)::bigint as expected_cents,
      e.id as expectation_id,e.collection_mode,e.expected_method,e.tender_amount_cents,e.decision as expectation_decision
    from public.delivery_stops s
    join public.delivery_jobs j on j.id=s.delivery_job_id
    join public.orders o on o.id=j.order_id
    left join lateral (
      select x.* from public.financial_payment_expectations x where x.order_id=o.id order by x.version_no desc limit 1
    ) e on true
    where s.route_id=p_route_id
    order by o.id,s.sequence_no
  loop
    order_count:=order_count+1;
    expected_total:=expected_total+rec.expected_cents;
    select coalesce(sum(case when l.event_type='payment_received' and l.recognition_status in ('operational_confirmed','reconciled') then l.amount_cents when l.event_type='payment_reversed' and l.recognition_status in ('operational_confirmed','reconciled') then -l.amount_cents else 0 end),0)
      into net_received from public.financial_ledger_entries l where l.order_id=rec.order_id;
    already_received:=already_received+net_received;
    remaining:=greatest(rec.expected_cents-net_received,0);
    mode:=rec.collection_mode;
    method:=rec.expected_method;
    tender:=rec.tender_amount_cents;
    row_review:=false;

    if rec.expectation_id is null then row_review:=true;
    elsif rec.expectation_decision='review_required' then row_review:=true;
    elsif net_received>rec.expected_cents then row_review:=true;
    elsif mode='prepaid' and remaining>0 then row_review:=true;
    elsif mode='unknown' then row_review:=true;
    elsif remaining>0 and method is null then row_review:=true;
    end if;

    if remaining>0 then
      collect_count:=collect_count+1;
      collect_due:=collect_due+remaining;
      case method
        when 'cash' then cash_due:=cash_due+remaining;
        when 'pix' then pix_due:=pix_due+remaining;
        when 'prepaid_pix' then pix_due:=pix_due+remaining;
        when 'card' then card_due:=card_due+remaining;
        when 'payment_link' then link_due:=link_due+remaining;
        when 'prepaid_link' then link_due:=link_due+remaining;
        else other_due:=other_due+remaining;
      end case;
      if method='cash' and tender is not null then change_due:=change_due+greatest(tender-remaining,0); end if;
    end if;
    if row_review then review_count:=review_count+1; end if;

    rows_json:=rows_json||jsonb_build_array(jsonb_build_object(
      'order_id',rec.order_id,'expectation_id',rec.expectation_id,'collection_mode',mode,'expected_method',method,
      'expected_amount_cents',rec.expected_cents,'already_received_cents',net_received,'collect_due_cents',remaining,
      'tender_amount_cents',tender,'change_required_cents',case when method='cash' and tender is not null then greatest(tender-remaining,0) else 0 end,
      'review_required',row_review
    ));
  end loop;

  if review_count>0 then decision:='review_required'; end if;
  return jsonb_build_object(
    'ok',true,'route_id',r.id,'driver_id',r.driver_id,'decision',decision,'order_count',order_count,
    'collect_order_count',collect_count,'review_order_count',review_count,'expected_total_cents',expected_total,
    'already_received_cents',already_received,'collect_due_cents',collect_due,'cash_due_cents',cash_due,
    'pix_due_cents',pix_due,'card_due_cents',card_due,'payment_link_due_cents',link_due,'other_due_cents',other_due,
    'change_required_cents',change_due,'orders',rows_json,'route_mutated',false,'payment_confirmed',false,
    'fiscal_mutated',false,'side_effect_performed',false,'external_side_effect',false
  );
end;
$$;

create or replace function public.record_route_collection_manifest_v1(p_route_id uuid,p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  prior public.financial_route_collection_manifests%rowtype;
  r public.delivery_routes%rowtype;
  preview jsonb;
  next_version integer;
  new_id uuid;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.route_collection_manifest_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','route_collection_manifest_recording_disabled','external_side_effect',false);
  end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','external_side_effect',false); end if;
  select * into prior from public.financial_route_collection_manifests where idempotency_key=trim(p_idempotency_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'manifest_id',prior.id,'version_no',prior.version_no,'decision',prior.decision,'external_side_effect',false); end if;
  select * into r from public.delivery_routes where id=p_route_id;
  if not found then return jsonb_build_object('ok',false,'error','route_not_found','external_side_effect',false); end if;

  preview:=public.preview_route_collection_manifest_v1(p_route_id);
  if not coalesce((preview->>'ok')::boolean,false) then return preview; end if;
  select coalesce(max(version_no),0)+1 into next_version from public.financial_route_collection_manifests where route_id=p_route_id;

  insert into public.financial_route_collection_manifests(
    route_id,driver_id,version_no,idempotency_key,order_count,collect_order_count,review_order_count,
    expected_total_cents,already_received_cents,collect_due_cents,cash_due_cents,pix_due_cents,card_due_cents,
    payment_link_due_cents,other_due_cents,change_required_cents,decision,snapshot
  ) values(
    p_route_id,r.driver_id,next_version,trim(p_idempotency_key),(preview->>'order_count')::integer,
    (preview->>'collect_order_count')::integer,(preview->>'review_order_count')::integer,
    (preview->>'expected_total_cents')::bigint,(preview->>'already_received_cents')::bigint,(preview->>'collect_due_cents')::bigint,
    (preview->>'cash_due_cents')::bigint,(preview->>'pix_due_cents')::bigint,(preview->>'card_due_cents')::bigint,
    (preview->>'payment_link_due_cents')::bigint,(preview->>'other_due_cents')::bigint,(preview->>'change_required_cents')::bigint,
    preview->>'decision',preview
  ) returning id into new_id;

  return jsonb_build_object('ok',true,'replay',false,'manifest_id',new_id,'version_no',next_version,'decision',preview->>'decision','route_mutated',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

revoke all on table public.financial_payment_expectations,public.financial_route_collection_manifests from public,anon,authenticated;
grant select on table public.financial_payment_expectations,public.financial_route_collection_manifests to service_role;

revoke all on function public.financial_readiness_v2() from public,anon,authenticated;
revoke all on function public.preview_order_payment_expectation_v1(uuid,text,text,bigint,timestamptz,text) from public,anon,authenticated;
revoke all on function public.record_order_payment_expectation_v1(uuid,text,text,bigint,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.preview_route_collection_manifest_v1(uuid) from public,anon,authenticated;
revoke all on function public.record_route_collection_manifest_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.financial_readiness_v2() to service_role;
grant execute on function public.preview_order_payment_expectation_v1(uuid,text,text,bigint,timestamptz,text) to service_role;
grant execute on function public.record_order_payment_expectation_v1(uuid,text,text,bigint,timestamptz,text,text) to service_role;
grant execute on function public.preview_route_collection_manifest_v1(uuid) to service_role;
grant execute on function public.record_route_collection_manifest_v1(uuid,text) to service_role;

comment on table public.financial_payment_expectations is 'Immutable Stage 13 expectation of how an order is expected to be collected; never confirms payment.';
comment on table public.financial_route_collection_manifests is 'Immutable route collection snapshot including cash/change requirements; never mutates route, payment or fiscal state.';

commit;
