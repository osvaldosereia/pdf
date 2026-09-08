begin;

-- Supabase managed Postgres does not allow changing plpgsql.variable_conflict
-- through ALTER FUNCTION. Redefine the preview function with an explicit
-- non-conflicting variable name instead.
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
  target_year integer:=extract(year from ref_date)::integer;
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
  where r.customer_id=c.id
    and r.benefit_scope_key=scope_key
    and r.benefit_year=target_year
    and r.status in ('reserved','applied');
  if prior_active>0 then decision:='block';reason:='benefit_already_reserved_or_used_for_year';end if;

  min_order_cents:=coalesce((pr.conditions->>'minimum_order_total_cents')::bigint,0);
  if p_order_total_cents<min_order_cents then decision:='block';reason:='minimum_order_total_not_met';end if;
  require_delivered:=coalesce((pr.conditions->>'require_delivered_purchase')::boolean,false);
  if require_delivered then
    select count(*) into delivered_count
    from public.orders o
    where o.customer_id=c.id and o.status='delivered' and o.delivered_at is not null;
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
    'benefit_year',target_year,
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

revoke all on function public.preview_customer_benefit_v1(uuid,uuid,date,date,bigint,bigint) from public,anon,authenticated;
grant execute on function public.preview_customer_benefit_v1(uuid,uuid,date,date,bigint,bigint) to service_role;

commit;
