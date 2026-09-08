begin;

-- Stage 12I — Commercial benefits / birthday / coupons / gifts guardrails V1.
-- Deterministic, server-only and dormant. No offer publication, no order mutation,
-- no stock mutation, no budget spending and no external transport.

alter table public.commercial_truth_runtime_config
  add column if not exists benefit_preview_enabled boolean not null default false,
  add column if not exists benefit_recording_enabled boolean not null default false,
  add column if not exists benefit_reservation_enabled boolean not null default false,
  add column if not exists benefit_apply_enabled boolean not null default false,
  add column if not exists delivered_purchase_evidence_enabled boolean not null default false;

create table if not exists public.customer_benefit_evaluations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  promotion_rule_id uuid not null references public.promotion_rules(id) on delete restrict,
  benefit_scope_key text not null,
  benefit_year integer not null check(benefit_year between 2000 and 2200),
  reference_date date not null,
  delivery_date date not null,
  decision text not null check(decision in ('allow','review','block')),
  reason text null,
  benefit_snapshot jsonb not null default '{}'::jsonb,
  margin_snapshot jsonb not null default '{}'::jsonb,
  budget_snapshot jsonb not null default '{}'::jsonb,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  evaluation_key text null unique,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.customer_benefit_evaluations enable row level security;
create index if not exists customer_benefit_evaluations_customer_idx on public.customer_benefit_evaluations(customer_id,created_at desc);
create index if not exists customer_benefit_evaluations_rule_idx on public.customer_benefit_evaluations(promotion_rule_id,created_at desc);

create table if not exists public.customer_benefit_reservations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  promotion_rule_id uuid not null references public.promotion_rules(id) on delete restrict,
  benefit_scope_key text not null,
  benefit_year integer not null check(benefit_year between 2000 and 2200),
  status text not null default 'reserved' check(status in ('reserved','applied','released','cancelled')),
  benefit_snapshot jsonb not null default '{}'::jsonb,
  evaluation_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  applied_at timestamptz null,
  released_at timestamptz null,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_benefit_reservations enable row level security;
create unique index if not exists customer_benefit_one_active_scope_year_idx
  on public.customer_benefit_reservations(customer_id,benefit_scope_key,benefit_year)
  where status in ('reserved','applied');
create index if not exists customer_benefit_reservations_rule_idx on public.customer_benefit_reservations(promotion_rule_id,status,created_at desc);

create or replace function public.customer_delivered_purchase_evidence_v1(
  p_customer_id uuid,
  p_product_id uuid default null,
  p_limit integer default 20
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_truth_runtime_config%rowtype;
  lim integer:=least(greatest(coalesce(p_limit,20),1),100);
  rows_json jsonb:='[]'::jsonb;
  order_count integer:=0;
  unit_count numeric:=0;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.delivered_purchase_evidence_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','delivered_purchase_evidence_disabled','external_side_effect',false);
  end if;
  if p_customer_id is null then return jsonb_build_object('ok',false,'error','customer_required','external_side_effect',false);end if;

  select coalesce(jsonb_agg(x order by x.delivered_at desc,x.order_id),'[]'::jsonb),count(distinct x.order_id),coalesce(sum(x.quantity),0)
    into rows_json,order_count,unit_count
  from (
    select o.id order_id,o.delivered_at,oi.product_id,oi.quantity,oi.sku_snapshot,oi.name_snapshot
    from public.orders o
    join public.order_items oi on oi.order_id=o.id
    where o.customer_id=p_customer_id
      and o.status='delivered'
      and o.delivered_at is not null
      and (p_product_id is null or oi.product_id=p_product_id)
    order by o.delivered_at desc,o.id,oi.id
    limit lim
  ) x;

  return jsonb_build_object(
    'ok',true,
    'customer_id',p_customer_id,
    'product_id',p_product_id,
    'delivered_order_count',order_count,
    'delivered_item_units',unit_count,
    'evidence',rows_json,
    'source_status_required','delivered',
    'external_side_effect',false
  );
end;
$$;

create or replace function public.preview_customer_benefit_v1(
  p_customer_id uuid,
  p_promotion_rule_id uuid,
  p_reference_date date,
  p_delivery_date date,
  p_order_total_cents bigint,
  p_order_estimated_cost_cents bigint
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_truth_runtime_config%rowtype;
  c public.customers%rowtype;
  pr public.promotion_rules%rowtype;
  gift public.products%rowtype;
  ref_date date:=coalesce(p_reference_date,(now() at time zone 'America/Cuiaba')::date);
  delivery_date date:=coalesce(p_delivery_date,ref_date);
  benefit_kind text;
  scope_key text;
  benefit_year integer:=extract(year from ref_date)::integer;
  discount_cents bigint:=0;
  benefit_cost_cents bigint:=0;
  gift_qty numeric:=0;
  min_margin numeric;
  min_order_cents bigint:=0;
  require_delivered boolean:=false;
  delivered_count integer:=0;
  budget_remaining bigint;
  margin jsonb:='{}'::jsonb;
  inv jsonb:='{}'::jsonb;
  decision text:='allow';
  reason text:=null;
  evidence jsonb:='{}'::jsonb;
  prior_active integer:=0;
  gift_product_id uuid;
  min_shelf_life integer:=0;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.benefits_enabled or not cfg.benefit_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','benefit_preview_disabled','side_effect_performed',false,'external_side_effect',false);
  end if;
  if p_customer_id is null or p_promotion_rule_id is null or p_order_total_cents is null or p_order_total_cents<0 or p_order_estimated_cost_cents is null or p_order_estimated_cost_cents<0 then
    return jsonb_build_object('ok',false,'error','invalid_benefit_input','side_effect_performed',false,'external_side_effect',false);
  end if;
  select * into c from public.customers where id=p_customer_id and is_active=true;
  if not found then return jsonb_build_object('ok',false,'error','customer_not_active','external_side_effect',false);end if;
  select * into pr from public.promotion_rules where id=p_promotion_rule_id;
  if not found then return jsonb_build_object('ok',false,'error','promotion_rule_not_found','external_side_effect',false);end if;

  if pr.rule_type not in ('birthday','coupon','gift','benefit') then
    return jsonb_build_object('ok',true,'decision','block','reason','unsupported_benefit_rule_type','rule_type',pr.rule_type,'applied',false,'external_side_effect',false);
  end if;
  if not pr.enabled or pr.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',true,'decision','block','reason','promotion_rule_disabled','rule_code',pr.code,'applied',false,'external_side_effect',false);
  end if;
  if pr.starts_at is not null and ref_date < (pr.starts_at at time zone 'America/Cuiaba')::date then decision:='block';reason:='promotion_not_started';end if;
  if pr.ends_at is not null and ref_date > (pr.ends_at at time zone 'America/Cuiaba')::date then decision:='block';reason:='promotion_ended';end if;

  benefit_kind:=lower(trim(coalesce(pr.benefit->>'kind','')));
  scope_key:=case when pr.rule_type='birthday' then 'birthday' else 'promotion:'||pr.code end;

  if pr.rule_type='birthday' then
    if c.birthday_month is null then decision:='block';reason:='birthday_month_missing';
    elsif c.birthday_month<>extract(month from ref_date)::integer then decision:='block';reason:='outside_birthday_month';end if;
  end if;

  select count(*) into prior_active
  from public.customer_benefit_reservations r
  where r.customer_id=c.id and r.benefit_scope_key=scope_key and r.benefit_year=benefit_year and r.status in ('reserved','applied');
  if prior_active>0 then decision:='block';reason:='benefit_already_reserved_or_used_for_year';end if;

  min_order_cents:=coalesce((pr.conditions->>'minimum_order_total_cents')::bigint,0);
  if p_order_total_cents<min_order_cents then decision:='block';reason:='minimum_order_total_not_met';end if;
  require_delivered:=coalesce((pr.conditions->>'require_delivered_purchase')::boolean,false);
  if require_delivered then
    select count(*) into delivered_count from public.orders o where o.customer_id=c.id and o.status='delivered' and o.delivered_at is not null;
    evidence:=jsonb_build_object('require_delivered_purchase',true,'delivered_order_count',delivered_count,'source_status_required','delivered');
    if delivered_count=0 then decision:='block';reason:='delivered_purchase_required';end if;
  else
    evidence:=jsonb_build_object('require_delivered_purchase',false);
  end if;

  if not (pr.conditions ? 'minimum_margin_percent') then
    if decision<>'block' then decision:='review';reason:='minimum_margin_percent_missing';end if;
  else
    min_margin:=(pr.conditions->>'minimum_margin_percent')::numeric;
    if min_margin<0 or min_margin>100 then return jsonb_build_object('ok',false,'error','invalid_minimum_margin_percent','external_side_effect',false);end if;
  end if;

  if benefit_kind='discount_percent' then
    if not (pr.benefit ? 'value_percent') then return jsonb_build_object('ok',false,'error','discount_percent_value_missing','external_side_effect',false);end if;
    if (pr.benefit->>'value_percent')::numeric<=0 or (pr.benefit->>'value_percent')::numeric>100 then return jsonb_build_object('ok',false,'error','invalid_discount_percent','external_side_effect',false);end if;
    discount_cents:=round(p_order_total_cents*((pr.benefit->>'value_percent')::numeric/100.0))::bigint;
    benefit_cost_cents:=discount_cents;
  elsif benefit_kind='discount_fixed' then
    if not (pr.benefit ? 'value_cents') then return jsonb_build_object('ok',false,'error','discount_fixed_value_missing','external_side_effect',false);end if;
    discount_cents:=(pr.benefit->>'value_cents')::bigint;
    if discount_cents<=0 or discount_cents>p_order_total_cents then return jsonb_build_object('ok',false,'error','invalid_discount_fixed','external_side_effect',false);end if;
    benefit_cost_cents:=discount_cents;
  elsif benefit_kind='gift_product' then
    begin gift_product_id:=(pr.benefit->>'product_id')::uuid;exception when others then return jsonb_build_object('ok',false,'error','invalid_gift_product_id','external_side_effect',false);end;
    gift_qty:=coalesce((pr.benefit->>'quantity')::numeric,1);
    if gift_qty<=0 then return jsonb_build_object('ok',false,'error','invalid_gift_quantity','external_side_effect',false);end if;
    select * into gift from public.products where id=gift_product_id and is_active=true;
    if not found then decision:='block';reason:='gift_product_not_active';
    elsif gift.cost is null then if decision<>'block' then decision:='review';reason:='gift_cost_unknown';end if;
    else
      benefit_cost_cents:=round(gift.cost*gift_qty*100)::bigint;
      min_shelf_life:=coalesce((pr.conditions->>'min_shelf_life_days')::integer,0);
      inv:=public.preview_fefo_allocation_v1(gift.id,gift_qty,delivery_date,min_shelf_life);
      if coalesce((inv->>'sufficient')::boolean,false)=false then decision:='block';reason:='gift_inventory_or_validity_insufficient';end if;
    end if;
  else
    return jsonb_build_object('ok',false,'error','unsupported_benefit_kind','benefit_kind',benefit_kind,'external_side_effect',false);
  end if;

  if pr.budget_cents is null then
    if decision<>'block' then decision:='review';reason:='promotion_budget_missing';end if;
    budget_remaining:=null;
  else
    budget_remaining:=greatest(pr.budget_cents-pr.spent_cents,0);
    if benefit_cost_cents>budget_remaining then decision:='block';reason:='promotion_budget_insufficient';end if;
  end if;

  if min_margin is not null and decision<>'block' then
    margin:=public.evaluate_margin_guard_v1(
      p_order_total_cents/100.0,
      (p_order_estimated_cost_cents+case when benefit_kind='gift_product' then benefit_cost_cents else 0 end)/100.0,
      discount_cents/100.0,
      min_margin
    );
    if coalesce(margin->>'decision','block')='block' then decision:='block';reason:='margin_guard_block';end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'customer_id',c.id,
    'promotion_rule_id',pr.id,
    'rule_code',pr.code,
    'rule_type',pr.rule_type,
    'benefit_scope_key',scope_key,
    'benefit_year',benefit_year,
    'reference_date',ref_date,
    'delivery_date',delivery_date,
    'decision',decision,
    'reason',reason,
    'benefit',jsonb_build_object('kind',benefit_kind,'discount_cents',discount_cents,'gift_product_id',gift_product_id,'gift_quantity',gift_qty,'estimated_budget_cost_cents',benefit_cost_cents),
    'budget',jsonb_build_object('budget_cents',pr.budget_cents,'spent_cents',pr.spent_cents,'remaining_cents',budget_remaining),
    'margin_guard',margin,
    'gift_inventory',inv,
    'purchase_evidence',evidence,
    'birthday_month',c.birthday_month,
    'birthday_day',c.birthday_day,
    'applied',false,
    'side_effect_performed',false,
    'external_side_effect',false
  );
end;
$$;

create or replace function public.record_customer_benefit_evaluation_v1(
  p_customer_id uuid,
  p_promotion_rule_id uuid,
  p_reference_date date,
  p_delivery_date date,
  p_order_total_cents bigint,
  p_order_estimated_cost_cents bigint,
  p_evaluation_key text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_truth_runtime_config%rowtype;
  prior uuid;
  preview jsonb;
  eid uuid;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if not cfg.enabled or not cfg.benefits_enabled or not cfg.benefit_preview_enabled or not cfg.benefit_recording_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','benefit_recording_disabled','side_effect_performed',false,'external_side_effect',false);
  end if;
  if length(trim(coalesce(p_evaluation_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_evaluation_key','external_side_effect',false);end if;
  select id into prior from public.customer_benefit_evaluations where evaluation_key=trim(p_evaluation_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'evaluation_id',prior,'side_effect_performed',false,'external_side_effect',false);end if;
  preview:=public.preview_customer_benefit_v1(p_customer_id,p_promotion_rule_id,p_reference_date,p_delivery_date,p_order_total_cents,p_order_estimated_cost_cents);
  if coalesce((preview->>'ok')::boolean,false)=false then return preview;end if;
  insert into public.customer_benefit_evaluations(customer_id,promotion_rule_id,benefit_scope_key,benefit_year,reference_date,delivery_date,decision,reason,benefit_snapshot,margin_snapshot,budget_snapshot,evidence_snapshot,evaluation_key)
  values(p_customer_id,p_promotion_rule_id,preview->>'benefit_scope_key',(preview->>'benefit_year')::integer,coalesce(p_reference_date,(now() at time zone 'America/Cuiaba')::date),coalesce(p_delivery_date,p_reference_date,(now() at time zone 'America/Cuiaba')::date),preview->>'decision',preview->>'reason',coalesce(preview->'benefit','{}'::jsonb),coalesce(preview->'margin_guard','{}'::jsonb),coalesce(preview->'budget','{}'::jsonb),coalesce(preview->'purchase_evidence','{}'::jsonb),trim(p_evaluation_key)) returning id into eid;
  return jsonb_build_object('ok',true,'replay',false,'evaluation_id',eid,'decision',preview->>'decision','applied',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.reserve_customer_benefit_v1(
  p_customer_id uuid,
  p_promotion_rule_id uuid,
  p_reference_date date,
  p_delivery_date date,
  p_order_total_cents bigint,
  p_order_estimated_cost_cents bigint,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_truth_runtime_config%rowtype;
  prior uuid;
  preview jsonb;
  rid uuid;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if not cfg.enabled or not cfg.benefits_enabled or not cfg.benefit_preview_enabled or not cfg.benefit_reservation_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','benefit_reservation_disabled','side_effect_performed',false,'external_side_effect',false);
  end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','external_side_effect',false);end if;
  select id into prior from public.customer_benefit_reservations where idempotency_key=trim(p_idempotency_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'reservation_id',prior,'side_effect_performed',false,'external_side_effect',false);end if;
  preview:=public.preview_customer_benefit_v1(p_customer_id,p_promotion_rule_id,p_reference_date,p_delivery_date,p_order_total_cents,p_order_estimated_cost_cents);
  if coalesce((preview->>'ok')::boolean,false)=false then return preview;end if;
  if preview->>'decision'<>'allow' then return jsonb_build_object('ok',true,'reserved',false,'decision',preview->>'decision','reason',preview->>'reason','side_effect_performed',false,'external_side_effect',false);end if;
  insert into public.customer_benefit_reservations(customer_id,promotion_rule_id,benefit_scope_key,benefit_year,status,benefit_snapshot,evaluation_snapshot,idempotency_key)
  values(p_customer_id,p_promotion_rule_id,preview->>'benefit_scope_key',(preview->>'benefit_year')::integer,'reserved',coalesce(preview->'benefit','{}'::jsonb),preview,trim(p_idempotency_key)) returning id into rid;
  return jsonb_build_object('ok',true,'replay',false,'reserved',true,'reservation_id',rid,'status','reserved','budget_spent',false,'order_mutated',false,'stock_mutated',false,'applied',false,'side_effect_performed',true,'external_side_effect',false);
exception when unique_violation then
  return jsonb_build_object('ok',true,'reserved',false,'decision','block','reason','benefit_already_reserved_or_used_for_year','side_effect_performed',false,'external_side_effect',false);
end;
$$;

create or replace function public.stage12_benefits_readiness_v1()
returns jsonb
language sql security definer set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'enabled',c.enabled,
    'execution_mode',c.execution_mode,
    'benefits_enabled',c.benefits_enabled,
    'benefit_preview_enabled',c.benefit_preview_enabled,
    'benefit_recording_enabled',c.benefit_recording_enabled,
    'benefit_reservation_enabled',c.benefit_reservation_enabled,
    'benefit_apply_enabled',c.benefit_apply_enabled,
    'delivered_purchase_evidence_enabled',c.delivered_purchase_evidence_enabled,
    'canary_percent',c.canary_percent,
    'promotion_rules',(select count(*) from public.promotion_rules),
    'enabled_promotion_rules',(select count(*) from public.promotion_rules where enabled),
    'benefit_evaluations',(select count(*) from public.customer_benefit_evaluations),
    'active_benefit_reservations',(select count(*) from public.customer_benefit_reservations where status in ('reserved','applied')),
    'external_side_effect',false
  ) from public.commercial_truth_runtime_config c where c.id=1;
$$;

-- Server-only. Browser roles receive no direct table/RPC access.
revoke all on table public.customer_benefit_evaluations,public.customer_benefit_reservations from public,anon,authenticated;
grant select,insert,update,delete on table public.customer_benefit_evaluations,public.customer_benefit_reservations to service_role;

revoke all on function public.customer_delivered_purchase_evidence_v1(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.preview_customer_benefit_v1(uuid,uuid,date,date,bigint,bigint) from public,anon,authenticated;
revoke all on function public.record_customer_benefit_evaluation_v1(uuid,uuid,date,date,bigint,bigint,text) from public,anon,authenticated;
revoke all on function public.reserve_customer_benefit_v1(uuid,uuid,date,date,bigint,bigint,text) from public,anon,authenticated;
revoke all on function public.stage12_benefits_readiness_v1() from public,anon,authenticated;

grant execute on function public.customer_delivered_purchase_evidence_v1(uuid,uuid,integer),public.preview_customer_benefit_v1(uuid,uuid,date,date,bigint,bigint),public.record_customer_benefit_evaluation_v1(uuid,uuid,date,date,bigint,bigint,text),public.reserve_customer_benefit_v1(uuid,uuid,date,date,bigint,bigint,text),public.stage12_benefits_readiness_v1() to service_role;

commit;
