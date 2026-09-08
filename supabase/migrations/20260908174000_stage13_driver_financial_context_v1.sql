begin;

-- Stage 13C — Driver App financial context + governed collection observation.
-- Dormant/off by default. No bank/Pix/acquirer/Bling/SEFAZ transport.
-- Driver collection is written to the operational ledger and NEVER confirms fiscal payment directly.

alter table public.financial_runtime_config
  add column if not exists driver_financial_context_enabled boolean not null default false,
  add column if not exists driver_collection_recording_enabled boolean not null default false,
  add column if not exists driver_delivery_financial_guard_enabled boolean not null default false;

create or replace function public.financial_readiness_v3()
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
    'driver_financial_context_enabled',c.driver_financial_context_enabled,
    'driver_collection_recording_enabled',c.driver_collection_recording_enabled,
    'driver_delivery_financial_guard_enabled',c.driver_delivery_financial_guard_enabled,
    'allowed_cash_difference_cents',c.allowed_cash_difference_cents,
    'ledger_entries',(select count(*) from public.financial_ledger_entries),
    'payment_expectations',(select count(*) from public.financial_payment_expectations),
    'route_collection_manifests',(select count(*) from public.financial_route_collection_manifests),
    'route_close_evaluations',(select count(*) from public.financial_route_close_evaluations),
    'reconciliation_cases',(select count(*) from public.financial_reconciliation_cases),
    'external_side_effect',false
  ) from public.financial_runtime_config c where c.id=1;
$$;

create or replace function public.preview_driver_order_collection_v1(
  p_order_id uuid,
  p_route_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.financial_runtime_config%rowtype;
  o public.orders%rowtype;
  expectation public.financial_payment_expectations%rowtype;
  expected_cents bigint;
  received_cents bigint:=0;
  reversed_cents bigint:=0;
  net_received_cents bigint:=0;
  unresolved_count integer:=0;
  remaining_cents bigint:=0;
  tender_cents bigint:=null;
  change_cents bigint:=0;
  method text:=null;
  mode text:=null;
  decision text:='review_required';
  reason text:=null;
  belongs boolean:=true;
begin
  select * into cfg from public.financial_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.driver_financial_context_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','driver_financial_context_disabled','external_side_effect',false);
  end if;

  select * into o from public.orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found','external_side_effect',false); end if;

  if p_route_id is not null then
    select exists(
      select 1
      from public.delivery_stops s
      join public.delivery_jobs j on j.id=s.delivery_job_id
      where s.route_id=p_route_id and j.order_id=o.id
    ) into belongs;
    if not belongs then return jsonb_build_object('ok',false,'error','order_not_in_route','external_side_effect',false); end if;
  end if;

  expected_cents:=round(o.total*100)::bigint;
  select
    coalesce(sum(case when e.event_type='payment_received' and e.recognition_status in ('operational_confirmed','reconciled') then e.amount_cents else 0 end),0),
    coalesce(sum(case when e.event_type='payment_reversed' and e.recognition_status in ('operational_confirmed','reconciled') then e.amount_cents else 0 end),0),
    count(*) filter(where e.recognition_status in ('observed','review_required'))
  into received_cents,reversed_cents,unresolved_count
  from public.financial_ledger_entries e
  where e.order_id=o.id;

  net_received_cents:=received_cents-reversed_cents;
  remaining_cents:=greatest(expected_cents-net_received_cents,0);

  select * into expectation
  from public.financial_payment_expectations
  where order_id=o.id
  order by version_no desc
  limit 1;

  if found then
    method:=expectation.expected_method;
    mode:=expectation.collection_mode;
    tender_cents:=expectation.tender_amount_cents;
  end if;

  if net_received_cents>expected_cents then
    decision:='review_required';reason:='order_overpaid';
  elsif unresolved_count>0 then
    decision:='review_required';reason:='unresolved_payment_observation';
  elsif remaining_cents=0 then
    decision:='covered';reason:='already_received';
  elsif expectation.id is null then
    decision:='review_required';reason:='payment_expectation_missing';
  elsif expectation.decision='review_required' then
    decision:='review_required';reason:=coalesce(expectation.reason,'payment_expectation_review_required');
  elsif mode='prepaid' or method in ('prepaid_pix','prepaid_link') then
    decision:='review_required';reason:='prepayment_incomplete_at_route';
  elsif method is null then
    decision:='review_required';reason:='expected_payment_method_missing';
  else
    decision:='collect';reason:='collection_due';
  end if;

  if decision='collect' and method='cash' and tender_cents is not null then
    change_cents:=greatest(tender_cents-remaining_cents,0);
  end if;

  return jsonb_build_object(
    'ok',true,
    'order_id',o.id,
    'route_id',p_route_id,
    'currency',o.currency,
    'collection_mode',mode,
    'expected_method',method,
    'expected_amount_cents',expected_cents,
    'operationally_confirmed_cents',net_received_cents,
    'remaining_due_cents',remaining_cents,
    'unresolved_entry_count',unresolved_count,
    'tender_amount_cents',case when method='cash' then tender_cents else null end,
    'change_required_cents',case when method='cash' then change_cents else 0 end,
    'decision',decision,
    'reason',reason,
    'collection_allowed',decision='collect',
    'delivery_financially_clear',decision in ('covered','collect'),
    'requires_reconciliation',true,
    'fiscal_payment_confirmed',false,
    'fiscal_mutated',false,
    'side_effect_performed',false,
    'external_side_effect',false
  );
end;
$$;

create or replace function public.get_driver_route_snapshot_v2(p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  base jsonb;
  cfg public.financial_runtime_config%rowtype;
  route_id uuid;
  stop_item jsonb;
  stop_id uuid;
  order_id uuid;
  financial jsonb;
  enriched_stops jsonb:='[]'::jsonb;
  collect_due bigint:=0;
  cash_due bigint:=0;
  pix_due bigint:=0;
  card_due bigint:=0;
  link_due bigint:=0;
  other_due bigint:=0;
  change_due bigint:=0;
  collect_count integer:=0;
  review_count integer:=0;
  f_method text;
  f_due bigint;
begin
  base:=public.get_driver_route_snapshot_v1(p_auth_user_id);
  if not coalesce((base->>'ok')::boolean,false) then return base; end if;

  route_id:=nullif(base->'route'->>'id','')::uuid;
  select * into cfg from public.financial_runtime_config where id=1;

  if not found or not cfg.enabled or not cfg.driver_financial_context_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return base || jsonb_build_object(
      'financial_context',jsonb_build_object('enabled',false,'reason','driver_financial_context_disabled','external_side_effect',false),
      'collection_summary',jsonb_build_object('enabled',false,'collect_due_cents',0,'review_order_count',0,'change_required_cents',0)
    );
  end if;

  for stop_item in select value from jsonb_array_elements(coalesce(base->'stops','[]'::jsonb))
  loop
    stop_id:=nullif(stop_item->>'id','')::uuid;
    select j.order_id into order_id
    from public.delivery_stops s
    join public.delivery_jobs j on j.id=s.delivery_job_id
    where s.id=stop_id;

    financial:=public.preview_driver_order_collection_v1(order_id,route_id);
    enriched_stops:=enriched_stops || jsonb_build_array(stop_item || jsonb_build_object('order_id',order_id,'financial',financial));

    if financial->>'decision'='collect' then
      collect_count:=collect_count+1;
      f_due:=coalesce(nullif(financial->>'remaining_due_cents','')::bigint,0);
      f_method:=financial->>'expected_method';
      collect_due:=collect_due+f_due;
      change_due:=change_due+coalesce(nullif(financial->>'change_required_cents','')::bigint,0);
      if f_method='cash' then cash_due:=cash_due+f_due;
      elsif f_method='pix' then pix_due:=pix_due+f_due;
      elsif f_method='card' then card_due:=card_due+f_due;
      elsif f_method='payment_link' then link_due:=link_due+f_due;
      else other_due:=other_due+f_due; end if;
    elsif financial->>'decision'='review_required' then
      review_count:=review_count+1;
    end if;
  end loop;

  return (base - 'stops') || jsonb_build_object(
    'stops',enriched_stops,
    'financial_context',jsonb_build_object(
      'enabled',true,
      'driver_collection_recording_enabled',cfg.driver_collection_recording_enabled,
      'driver_delivery_financial_guard_enabled',cfg.driver_delivery_financial_guard_enabled,
      'requires_reconciliation',true,
      'fiscal_projection_enabled',cfg.fiscal_projection_enabled,
      'external_side_effect',false
    ),
    'collection_summary',jsonb_build_object(
      'enabled',true,
      'collect_order_count',collect_count,
      'review_order_count',review_count,
      'collect_due_cents',collect_due,
      'cash_due_cents',cash_due,
      'pix_due_cents',pix_due,
      'card_due_cents',card_due,
      'payment_link_due_cents',link_due,
      'other_due_cents',other_due,
      'change_required_cents',change_due,
      'external_side_effect',false
    )
  );
end;
$$;

create or replace function public.driver_deliver_stop_v3(
  p_auth_user_id uuid,
  p_stop_id uuid,
  p_client_event_id text,
  p_proof jsonb default '{}'::jsonb,
  p_collection jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  lcfg public.logistics_runtime_config%rowtype;
  fcfg public.financial_runtime_config%rowtype;
  d public.drivers%rowtype;
  s public.delivery_stops%rowtype;
  r public.delivery_routes%rowtype;
  j public.delivery_jobs%rowtype;
  existing uuid;
  remaining integer;
  fiscal_result jsonb;
  financial jsonb:=jsonb_build_object('enabled',false);
  receipt jsonb:='{}'::jsonb;
  collection jsonb:=coalesce(p_collection,'{}'::jsonb);
  method text:=null;
  amount_text text:=null;
  tender_text text:=null;
  amount_cents bigint:=null;
  tender_cents bigint:=null;
  change_cents bigint:=0;
  recognition text:=null;
  expected_method text:=null;
  expected_due bigint:=0;
  collection_present boolean:=false;
begin
  select * into lcfg from public.logistics_runtime_config where id=1;
  if not found or not lcfg.enabled or not lcfg.driver_app_enabled or lcfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','driver_runtime_disabled','side_effect_performed',false,'external_side_effect',false);
  end if;

  if p_collection is not null and jsonb_typeof(p_collection)<>'object' then
    return jsonb_build_object('ok',false,'error','invalid_collection_payload','side_effect_performed',false,'external_side_effect',false);
  end if;
  collection_present:=p_collection is not null and p_collection<>'{}'::jsonb;

  select id into existing from public.delivery_events where client_event_id=p_client_event_id;
  if found then return jsonb_build_object('ok',true,'replay',true,'event_id',existing,'side_effect_performed',false,'external_side_effect',false); end if;

  select * into d from public.drivers where auth_user_id=p_auth_user_id and status='on_route';
  if not found then return jsonb_build_object('ok',false,'error','driver_not_on_route','side_effect_performed',false,'external_side_effect',false); end if;
  select * into s from public.delivery_stops where id=p_stop_id for update;
  if not found then return jsonb_build_object('ok',false,'error','stop_not_found','side_effect_performed',false,'external_side_effect',false); end if;
  select * into r from public.delivery_routes where id=s.route_id for update;
  if r.status<>'active' or r.driver_id is distinct from d.id then return jsonb_build_object('ok',false,'error','stop_not_owned_by_driver','side_effect_performed',false,'external_side_effect',false); end if;
  if s.status='delivered' then return jsonb_build_object('ok',true,'replay',true,'stop_id',s.id,'side_effect_performed',false,'external_side_effect',false); end if;
  if s.status<>'arrived' then return jsonb_build_object('ok',false,'error','arrival_confirmation_required','stop_status',s.status,'side_effect_performed',false,'external_side_effect',false); end if;
  select * into j from public.delivery_jobs where id=s.delivery_job_id for update;

  select * into fcfg from public.financial_runtime_config where id=1;
  if fcfg.driver_delivery_financial_guard_enabled then
    if not fcfg.enabled or not fcfg.driver_financial_context_enabled or fcfg.execution_mode not in ('homologation','canary','live') then
      return jsonb_build_object('ok',false,'error','driver_financial_guard_misconfigured','side_effect_performed',false,'external_side_effect',false);
    end if;

    financial:=public.preview_driver_order_collection_v1(j.order_id,r.id);
    if not coalesce((financial->>'ok')::boolean,false) then return financial; end if;
    if financial->>'decision'='review_required' then
      return jsonb_build_object('ok',false,'error','financial_review_required','financial',financial,'side_effect_performed',false,'external_side_effect',false);
    end if;

    if financial->>'decision'='covered' then
      if collection_present then
        return jsonb_build_object('ok',false,'error','collection_not_expected_for_covered_order','financial',financial,'side_effect_performed',false,'external_side_effect',false);
      end if;
    elsif financial->>'decision'='collect' then
      if not collection_present then
        return jsonb_build_object('ok',false,'error','collection_required_before_delivery','financial',financial,'side_effect_performed',false,'external_side_effect',false);
      end if;
      if not fcfg.driver_collection_recording_enabled or not fcfg.receipt_recording_enabled then
        return jsonb_build_object('ok',false,'error','driver_collection_recording_disabled','financial',financial,'side_effect_performed',false,'external_side_effect',false);
      end if;

      method:=lower(trim(coalesce(collection->>'payment_method','')));
      if method not in ('cash','pix','card','payment_link','other') then
        return jsonb_build_object('ok',false,'error','invalid_driver_collection_method','side_effect_performed',false,'external_side_effect',false);
      end if;
      amount_text:=trim(coalesce(collection->>'amount_cents',''));
      if amount_text !~ '^[0-9]{1,18}$' then return jsonb_build_object('ok',false,'error','invalid_collection_amount','side_effect_performed',false,'external_side_effect',false); end if;
      amount_cents:=amount_text::bigint;
      expected_due:=coalesce(nullif(financial->>'remaining_due_cents','')::bigint,0);
      expected_method:=financial->>'expected_method';
      if amount_cents<>expected_due or amount_cents<=0 then
        return jsonb_build_object('ok',false,'error','collection_amount_mismatch','expected_cents',expected_due,'received_cents',amount_cents,'side_effect_performed',false,'external_side_effect',false);
      end if;

      tender_text:=trim(coalesce(collection->>'tender_amount_cents',''));
      if method='cash' then
        if tender_text='' then tender_cents:=amount_cents;
        elsif tender_text ~ '^[0-9]{1,18}$' then tender_cents:=tender_text::bigint;
        else return jsonb_build_object('ok',false,'error','invalid_cash_tender_amount','side_effect_performed',false,'external_side_effect',false); end if;
        if tender_cents<amount_cents then return jsonb_build_object('ok',false,'error','cash_tender_below_due','side_effect_performed',false,'external_side_effect',false); end if;
        change_cents:=tender_cents-amount_cents;
        recognition:='operational_confirmed';
      else
        if tender_text<>'' then return jsonb_build_object('ok',false,'error','tender_amount_only_for_cash','side_effect_performed',false,'external_side_effect',false); end if;
        recognition:='observed';
      end if;

      receipt:=public.record_payment_receipt_v1(
        j.order_id,
        method,
        amount_cents,
        'driver_app',
        'driver-collection:'||p_client_event_id,
        recognition,
        r.id,
        d.id,
        null,
        now(),
        jsonb_build_object(
          'stop_id',s.id,
          'delivery_job_id',j.id,
          'tender_amount_cents',tender_cents,
          'change_given_cents',change_cents,
          'expected_method',expected_method,
          'method_changed',expected_method is distinct from method,
          'driver_collection',true
        )
      );
      if not coalesce((receipt->>'ok')::boolean,false) then return receipt; end if;
    end if;
  elsif collection_present then
    return jsonb_build_object('ok',false,'error','financial_guard_required_for_collection','side_effect_performed',false,'external_side_effect',false);
  end if;

  update public.delivery_stops
    set status='delivered',locked=false,delivered_at=coalesce(delivered_at,now()),updated_at=now()
    where id=s.id;
  update public.delivery_jobs
    set status='delivered',delivered_at=coalesce(delivered_at,now()),updated_at=now()
    where id=j.id;
  update public.orders
    set status='delivered',delivered_at=coalesce(delivered_at,now()),external_status_updated_at=now(),updated_at=now()
    where id=j.order_id and status in ('ready','out_for_delivery');

  insert into public.delivery_events(delivery_job_id,route_id,stop_id,event_type,actor_type,actor_id,client_event_id,payload)
  values(
    j.id,s.route_id,s.id,'STOP_DELIVERED','driver',d.id,p_client_event_id,
    jsonb_build_object(
      'proof',coalesce(p_proof,'{}'::jsonb),
      'financial_guard_enabled',fcfg.driver_delivery_financial_guard_enabled,
      'collection_recorded',coalesce((receipt->>'ok')::boolean,false),
      'ledger_entry_id',nullif(receipt->>'entry_id',''),
      'collection_recognition_status',nullif(receipt->>'recognition_status',''),
      'fiscal_payment_confirmed_by_driver',false
    )
  ) returning id into existing;

  insert into public.order_fiscal_controls(order_id,delivery_status,delivery_confirmed_at,delivery_event_id)
  values(j.order_id,'delivered',now(),existing)
  on conflict(order_id) do update
    set delivery_status='delivered',
        delivery_confirmed_at=coalesce(public.order_fiscal_controls.delivery_confirmed_at,excluded.delivery_confirmed_at),
        delivery_event_id=excluded.delivery_event_id,
        updated_at=now();

  -- Delivery may refresh a payment state that was confirmed by another governed source,
  -- but this function never calls confirm_order_payment_v1 and never projects ledger payment to fiscal.
  fiscal_result:=public.refresh_order_fiscal_readiness_v1(j.order_id);

  select count(*) into remaining
  from public.delivery_stops
  where route_id=r.id and status not in ('delivered','skipped','rescheduled');

  if remaining=0 then
    update public.delivery_routes set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=r.id;
    update public.drivers set status='available',updated_at=now() where id=d.id;
    insert into public.delivery_events(route_id,event_type,actor_type,actor_id,payload)
    values(r.id,'ROUTE_FINISHED','driver',d.id,jsonb_build_object('financial_reconciliation_pending',true));
  end if;

  return jsonb_build_object(
    'ok',true,
    'replay',false,
    'stop_id',s.id,
    'delivery_job_id',j.id,
    'order_id',j.order_id,
    'route_completed',remaining=0,
    'event_id',existing,
    'financial',financial,
    'receipt',receipt,
    'fiscal',fiscal_result,
    'fiscal_payment_confirmed_by_driver',false,
    'reconciliation_required',coalesce((receipt->>'recognition_status')<>'reconciled',true),
    'side_effect_performed',true,
    'external_side_effect',false
  );
end;
$$;

revoke all on function public.financial_readiness_v3() from public,anon,authenticated;
revoke all on function public.preview_driver_order_collection_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_driver_route_snapshot_v2(uuid) from public,anon,authenticated;
revoke all on function public.driver_deliver_stop_v3(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;

grant execute on function public.financial_readiness_v3() to service_role;
grant execute on function public.preview_driver_order_collection_v1(uuid,uuid) to service_role;
grant execute on function public.get_driver_route_snapshot_v2(uuid) to service_role;
grant execute on function public.driver_deliver_stop_v3(uuid,uuid,text,jsonb,jsonb) to service_role;

comment on function public.driver_deliver_stop_v3(uuid,uuid,text,jsonb,jsonb) is
'Driver delivery + optional governed operational collection. Collection writes ledger only and never calls confirm_order_payment_v1.';

commit;
