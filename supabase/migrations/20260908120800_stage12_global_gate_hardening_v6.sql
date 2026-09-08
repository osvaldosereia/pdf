begin;

create or replace function public.preview_expiry_offer_v2(p_product_id uuid,p_delivery_date date default current_date,p_today date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  p public.products%rowtype;
  ls public.product_lot_stock_v1%rowtype;
  exp date;
  days integer;
  rule public.expiry_discount_rules%rowtype;
  proposed numeric;
  guard jsonb;
  eligibility jsonb;
begin
  select * into cfg from public.commercial_runtime_config where id=1;
  select * into p from public.products where id=p_product_id;
  if not found then return jsonb_build_object('ok',false,'offer_candidate',false,'reason','product_not_found','side_effect_performed',false); end if;
  eligibility:=public.commercial_product_eligibility_v1(p_product_id,p_delivery_date);
  if not coalesce((eligibility->>'eligible')::boolean,false) then return eligibility||jsonb_build_object('offer_candidate',false); end if;
  if not cfg.enabled or cfg.execution_mode not in ('homologation','canary','live') or not cfg.expiry_discount_enabled then
    return jsonb_build_object('ok',true,'offer_candidate',false,'reason','expiry_discount_runtime_disabled','product_id',p.id,'side_effect_performed',false);
  end if;
  select * into ls from public.product_lot_stock_v1 where product_id=p.id;
  exp:=case when cfg.lot_truth_enabled then ls.earliest_sellable_expiry else p.validity_date end;
  if exp is null then return jsonb_build_object('ok',true,'offer_candidate',false,'reason','expiry_unknown','product_id',p.id,'side_effect_performed',false); end if;
  days:=exp-coalesce(p_today,current_date);
  if days<0 then return jsonb_build_object('ok',true,'offer_candidate',false,'reason','expired','product_id',p.id,'days_remaining',days,'side_effect_performed',false); end if;
  select * into rule from public.expiry_discount_rules
  where status='active' and days between min_days_remaining and max_days_remaining
  order by version desc,min_days_remaining asc limit 1;
  if not found then return jsonb_build_object('ok',true,'offer_candidate',false,'reason','no_active_expiry_rule','product_id',p.id,'days_remaining',days,'side_effect_performed',false); end if;
  if p.price is null or p.price<=0 then return jsonb_build_object('ok',true,'offer_candidate',false,'reason','price_unavailable','product_id',p.id,'side_effect_performed',false); end if;
  proposed:=round(p.price*(1-rule.discount_percent/100),2);
  guard:=public.margin_guard_v1(p.id,proposed,1,'expiry');
  return jsonb_build_object(
    'ok',true,'offer_candidate',coalesce((guard->>'allowed')::boolean,false),'product_id',p.id,'expires_at',exp,'days_remaining',days,
    'discount_percent',rule.discount_percent,'regular_price',p.price,'proposed_price',proposed,'rule_id',rule.id,'rule_version',rule.version,
    'margin_guard',guard,'reason',case when coalesce((guard->>'allowed')::boolean,false) then null else guard->>'reason' end,
    'side_effect_performed',false
  );
end;
$$;

create or replace function public.preview_coupon_v1(p_code text,p_order_subtotal numeric,p_customer_id uuid default null,p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  c public.commercial_coupons%rowtype;
  subtotal numeric:=coalesce(p_order_subtotal,0);
  discount numeric;
  total_uses integer;
  customer_uses integer;
begin
  select * into cfg from public.commercial_runtime_config where id=1;
  select * into c from public.commercial_coupons where upper(code)=upper(trim(coalesce(p_code,'')));
  if not found then return jsonb_build_object('ok',true,'eligible',false,'reason','coupon_not_found','side_effect_performed',false); end if;
  if not cfg.enabled or cfg.execution_mode not in ('homologation','canary','live') or not cfg.promotion_engine_enabled
     or not c.enabled or c.status<>'active' or c.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',true,'eligible',false,'reason','coupon_runtime_disabled','coupon_id',c.id,'side_effect_performed',false);
  end if;
  if (c.starts_at is not null and p_at<c.starts_at) or (c.ends_at is not null and p_at>c.ends_at) then return jsonb_build_object('ok',true,'eligible',false,'reason','coupon_outside_window','side_effect_performed',false); end if;
  if subtotal<c.minimum_order_brl then return jsonb_build_object('ok',true,'eligible',false,'reason','minimum_order_not_met','minimum_order_brl',c.minimum_order_brl,'side_effect_performed',false); end if;

  select count(*) into total_uses from public.commercial_coupon_redemptions where coupon_id=c.id and status in ('reserved','redeemed');
  if c.max_total_uses is not null and total_uses>=c.max_total_uses then return jsonb_build_object('ok',true,'eligible',false,'reason','coupon_total_limit_reached','total_uses',total_uses,'side_effect_performed',false); end if;
  if c.max_uses_per_customer is not null then
    if p_customer_id is null then return jsonb_build_object('ok',true,'eligible',false,'reason','customer_required_for_coupon_limit','side_effect_performed',false); end if;
    select count(*) into customer_uses from public.commercial_coupon_redemptions where coupon_id=c.id and customer_id=p_customer_id and status in ('reserved','redeemed');
    if customer_uses>=c.max_uses_per_customer then return jsonb_build_object('ok',true,'eligible',false,'reason','coupon_customer_limit_reached','customer_uses',customer_uses,'side_effect_performed',false); end if;
  else customer_uses:=0;
  end if;

  discount:=case when c.discount_type='percent' then subtotal*c.discount_value/100 else c.discount_value end;
  if c.max_discount_brl is not null then discount:=least(discount,c.max_discount_brl); end if;
  discount:=least(discount,subtotal);
  return jsonb_build_object('ok',true,'eligible',true,'coupon_id',c.id,'discount_brl',round(discount,2),'final_subtotal_brl',round(subtotal-discount,2),
    'total_uses',total_uses,'customer_uses',customer_uses,'requires_item_margin_validation',true,'side_effect_performed',false);
end;
$$;

create or replace function public.preview_birthday_benefit_v1(p_customer_id uuid,p_reference_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare cfg public.commercial_runtime_config%rowtype; c public.customers%rowtype; pol public.commercial_benefit_policies%rowtype; period text;
begin
  select * into cfg from public.commercial_runtime_config where id=1;
  select * into c from public.customers where id=p_customer_id;
  if not found then return jsonb_build_object('ok',false,'eligible',false,'reason','customer_not_found','side_effect_performed',false); end if;
  if c.birthday_month is null then return jsonb_build_object('ok',true,'eligible',false,'reason','birthday_not_registered','side_effect_performed',false); end if;
  if c.birthday_month<>extract(month from p_reference_date)::integer then return jsonb_build_object('ok',true,'eligible',false,'reason','outside_birthday_month','side_effect_performed',false); end if;
  if not cfg.enabled or cfg.execution_mode not in ('homologation','canary','live') or not cfg.benefit_engine_enabled then
    return jsonb_build_object('ok',true,'eligible',false,'reason','birthday_benefit_runtime_disabled','side_effect_performed',false);
  end if;
  select * into pol from public.commercial_benefit_policies
  where benefit_kind='birthday' and status='active' and enabled=true and execution_mode in ('homologation','canary','live')
    and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now())
  order by version desc limit 1;
  if not found then return jsonb_build_object('ok',true,'eligible',false,'reason','birthday_policy_unavailable','side_effect_performed',false); end if;
  period:=to_char(p_reference_date,'YYYY-MM');
  return jsonb_build_object('ok',true,'eligible',true,'policy_id',pol.id,'period_key',period,'benefit_type',pol.benefit_type,'benefit_value',pol.benefit_value,'gift_product_id',pol.gift_product_id,'minimum_order_brl',pol.minimum_order_brl,'requires_margin_guard',true,'side_effect_performed',false);
end;
$$;

revoke all on function public.preview_expiry_offer_v2(uuid,date,date) from public,anon,authenticated;
revoke all on function public.preview_coupon_v1(text,numeric,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.preview_birthday_benefit_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.preview_expiry_offer_v2(uuid,date,date) to service_role;
grant execute on function public.preview_coupon_v1(text,numeric,uuid,timestamptz) to service_role;
grant execute on function public.preview_birthday_benefit_v1(uuid,date) to service_role;

commit;
