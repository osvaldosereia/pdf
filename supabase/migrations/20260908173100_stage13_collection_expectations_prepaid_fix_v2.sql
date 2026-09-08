begin;

-- Stage 13B hardening: a prepaid expectation can legitimately be pending before payment arrives.
-- It becomes review-worthy at route collection time if a balance still remains.

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
  elsif mode='prepaid' then
    decision:='expected';reason:='prepayment_pending';
  elsif method='cash' and p_tender_amount_cents is not null and p_tender_amount_cents<remaining_cents and mode<>'mixed' then
    decision:='review_required';reason:='cash_tender_below_remaining_due';
  end if;

  if method='cash' and p_tender_amount_cents is not null then
    change_cents:=greatest(p_tender_amount_cents-remaining_cents,0);
  end if;

  return jsonb_build_object(
    'ok',true,'order_id',o.id,'currency',o.currency,'collection_mode',mode,'expected_method',method,
    'expected_amount_cents',expected_cents,'already_received_cents',net_received_cents,'remaining_due_cents',remaining_cents,
    'tender_amount_cents',p_tender_amount_cents,'change_required_cents',change_cents,'due_at',p_due_at,
    'decision',decision,'reason',reason,'source',src,'payment_confirmed',false,'delivery_confirmed',false,
    'fiscal_mutated',false,'side_effect_performed',false,'external_side_effect',false
  );
end;
$$;

revoke all on function public.preview_order_payment_expectation_v1(uuid,text,text,bigint,timestamptz,text) from public,anon,authenticated;
grant execute on function public.preview_order_payment_expectation_v1(uuid,text,text,bigint,timestamptz,text) to service_role;

commit;
