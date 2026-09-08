begin;

create or replace function public.commercial_readiness_v1()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
 select jsonb_build_object(
   'enabled',c.enabled,
   'execution_mode',c.execution_mode,
   'lot_truth_enabled',c.lot_truth_enabled,
   'lot_reservations_enabled',c.lot_reservations_enabled,
   'fefo_enabled',c.fefo_enabled,
   'expiry_discount_enabled',c.expiry_discount_enabled,
   'promotion_engine_enabled',c.promotion_engine_enabled,
   'benefit_engine_enabled',c.benefit_engine_enabled,
   'margin_guard_enforced',c.margin_guard_enforced,
   'recommendation_guard_enabled',c.recommendation_guard_enabled,
   'legacy_offer_engine_allowed',c.legacy_offer_engine_allowed,
   'canary_percent',c.canary_percent,
   'default_min_margin_percent',c.default_min_margin_percent,
   'default_min_margin_brl',c.default_min_margin_brl,
   'default_max_discount_percent',c.default_max_discount_percent,
   'promotion_budget_brl',c.promotion_budget_brl,
   'promotion_budget_spent_brl',c.promotion_budget_spent_brl,
   'minimum_delivery_shelf_life_days',c.minimum_delivery_shelf_life_days,
   'runtime_released',c.enabled and c.execution_mode in ('homologation','canary','live'),
   'lots',(select count(*) from public.inventory_lots),
   'products_with_lots',(select count(distinct product_id) from public.inventory_lots),
   'products_without_lots',(select count(*) from public.products p where not exists(select 1 from public.inventory_lots l where l.product_id=p.id)),
   'available_lots',(select count(*) from public.inventory_lots where status='available'),
   'verified_available_lots',(select count(*) from public.inventory_lots where status='available' and physically_verified),
   'active_margin_policies',(select count(*) from public.commercial_margin_policies where status='active'),
   'active_expiry_rules',(select count(*) from public.expiry_discount_rules where status='active'),
   'draft_expiry_rules',(select count(*) from public.expiry_discount_rules where status='draft'),
   'lot_reservations',(select count(*) from public.inventory_lot_reservations where status='reserved')
 ) from public.commercial_runtime_config c where c.id=1;
$$;

create or replace function public.commercial_product_eligibility_v1(p_product_id uuid,p_delivery_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  p public.products%rowtype;
  ls public.product_lot_stock_v1%rowtype;
  available_qty numeric(14,3);
  effective_expiry date;
  source text;
  required_expiry date;
  reason text:=null;
begin
  select * into cfg from public.commercial_runtime_config where id=1;
  select * into p from public.products where id=p_product_id;
  if not found then return jsonb_build_object('ok',false,'eligible',false,'reason','product_not_found','side_effect_performed',false); end if;
  select * into ls from public.product_lot_stock_v1 where product_id=p.id;
  required_expiry:=coalesce(p_delivery_date,current_date)+coalesce(cfg.minimum_delivery_shelf_life_days,1);

  if cfg.lot_truth_enabled then
    available_qty:=coalesce(ls.sellable_lot_quantity,0);
    effective_expiry:=ls.earliest_sellable_expiry;
    source:='inventory_lots';
  else
    available_qty:=greatest(coalesce(p.stock,0),0);
    effective_expiry:=p.validity_date;
    source:='products_legacy';
  end if;

  if not p.is_active then reason:='product_inactive';
  elsif not p.physically_verified then reason:='product_not_physically_verified';
  elsif cfg.lot_truth_enabled and coalesce(ls.lot_count,0)=0 then reason:='lot_truth_missing';
  elsif cfg.lot_truth_enabled and not exists(select 1 from public.inventory_lots l where l.product_id=p.id and l.status='available' and l.physically_verified) then reason:='no_verified_available_lot';
  elsif available_qty<=0 then reason:='out_of_stock';
  elsif effective_expiry is not null and effective_expiry<required_expiry then reason:='expiry_incompatible_with_delivery';
  end if;

  return jsonb_build_object(
    'ok',true,'eligible',reason is null,'reason',reason,'product_id',p.id,'source',source,
    'available_quantity',available_qty,'effective_expiry',effective_expiry,'delivery_date',coalesce(p_delivery_date,current_date),
    'minimum_delivery_shelf_life_days',cfg.minimum_delivery_shelf_life_days,'required_expiry_on_or_after',required_expiry,
    'lot_truth_enabled',cfg.lot_truth_enabled,'lot_count',coalesce(ls.lot_count,0),'side_effect_performed',false
  );
end;
$$;

create or replace view public.commercial_product_health_v1 as
select
  p.id product_id,
  p.name,
  p.sku,
  p.category,
  p.sales_category,
  p.price,
  p.cost,
  p.stock legacy_stock,
  p.validity_date legacy_validity_date,
  p.is_active,
  p.is_whatsapp_active,
  p.physically_verified,
  c.lot_truth_enabled,
  coalesce(ls.lot_count,0) lot_count,
  case when c.lot_truth_enabled then coalesce(ls.sellable_lot_quantity,0) else greatest(coalesce(p.stock,0),0) end effective_stock,
  case when c.lot_truth_enabled then ls.earliest_sellable_expiry else p.validity_date end effective_expiry,
  coalesce(ls.expired_quantity,0) expired_lot_quantity,
  case when p.price is not null and p.price>0 and p.cost is not null then round(((p.price-p.cost)/p.price)*100,4) end base_margin_percent,
  case when p.price is not null and p.cost is not null then round(p.price-p.cost,2) end base_margin_brl,
  case
    when not p.is_active then 'inactive'
    when not p.physically_verified then 'not_verified'
    when c.lot_truth_enabled and coalesce(ls.lot_count,0)=0 then 'lot_truth_missing'
    when c.lot_truth_enabled and not exists(select 1 from public.inventory_lots lx where lx.product_id=p.id and lx.status='available' and lx.physically_verified) then 'no_verified_available_lot'
    when (case when c.lot_truth_enabled then coalesce(ls.sellable_lot_quantity,0) else greatest(coalesce(p.stock,0),0) end)<=0 then 'stockout'
    when (case when c.lot_truth_enabled then ls.earliest_sellable_expiry else p.validity_date end)<current_date then 'expired'
    when p.cost is null then 'cost_unknown'
    when p.price is null or p.price<=0 then 'price_unknown'
    when p.price<=p.cost then 'margin_risk'
    else 'healthy'
  end commercial_health
from public.products p
cross join public.commercial_runtime_config c
left join public.product_lot_stock_v1 ls on ls.product_id=p.id
where c.id=1;

revoke all on public.commercial_product_health_v1 from public,anon,authenticated;
grant select on public.commercial_product_health_v1 to service_role;
revoke all on function public.commercial_readiness_v1() from public,anon,authenticated;
revoke all on function public.commercial_product_eligibility_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.commercial_readiness_v1() to service_role;
grant execute on function public.commercial_product_eligibility_v1(uuid,date) to service_role;

commit;
