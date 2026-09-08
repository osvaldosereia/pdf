begin;

create or replace function public.normalize_inventory_lot_expiry_v1()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if new.expires_at is not null and new.expiry_handling='unknown' then
    new.expiry_handling:='known';
  end if;
  if new.expiry_handling='known' and new.expires_at is null then raise exception 'known_expiry_requires_date'; end if;
  if new.expiry_handling='not_required' and new.expires_at is not null then raise exception 'non_expiring_lot_cannot_have_expiry_date'; end if;
  return new;
end;
$$;
drop trigger if exists inventory_lots_normalize_expiry_v1 on public.inventory_lots;
create trigger inventory_lots_normalize_expiry_v1 before insert or update of expires_at,expiry_handling on public.inventory_lots
for each row execute function public.normalize_inventory_lot_expiry_v1();

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
  case
    when c.lot_truth_enabled then case when p.cost is null then ls.max_verified_unit_cost when ls.max_verified_unit_cost is null then p.cost else greatest(p.cost,ls.max_verified_unit_cost) end
    else p.cost
  end effective_unit_cost,
  case when p.price is not null and p.price>0 and (case when c.lot_truth_enabled then case when p.cost is null then ls.max_verified_unit_cost when ls.max_verified_unit_cost is null then p.cost else greatest(p.cost,ls.max_verified_unit_cost) end else p.cost end) is not null
    then round(((p.price-(case when c.lot_truth_enabled then case when p.cost is null then ls.max_verified_unit_cost when ls.max_verified_unit_cost is null then p.cost else greatest(p.cost,ls.max_verified_unit_cost) end else p.cost end))/p.price)*100,4) end base_margin_percent,
  case when p.price is not null and (case when c.lot_truth_enabled then case when p.cost is null then ls.max_verified_unit_cost when ls.max_verified_unit_cost is null then p.cost else greatest(p.cost,ls.max_verified_unit_cost) end else p.cost end) is not null
    then round(p.price-(case when c.lot_truth_enabled then case when p.cost is null then ls.max_verified_unit_cost when ls.max_verified_unit_cost is null then p.cost else greatest(p.cost,ls.max_verified_unit_cost) end else p.cost end),2) end base_margin_brl,
  case
    when not p.is_active then 'inactive'
    when not p.physically_verified then 'not_verified'
    when c.lot_truth_enabled and coalesce(ls.lot_count,0)=0 then 'lot_truth_missing'
    when c.lot_truth_enabled and not exists(select 1 from public.inventory_lots lx where lx.product_id=p.id and lx.status='available' and lx.physically_verified and lx.expiry_handling in ('known','not_required')) then 'no_verified_available_lot'
    when (case when c.lot_truth_enabled then coalesce(ls.sellable_lot_quantity,0) else greatest(coalesce(p.stock,0),0) end)<=0 then 'stockout'
    when (case when c.lot_truth_enabled then ls.earliest_sellable_expiry else p.validity_date end)<current_date then 'expired'
    when (case when c.lot_truth_enabled then case when p.cost is null then ls.max_verified_unit_cost when ls.max_verified_unit_cost is null then p.cost else greatest(p.cost,ls.max_verified_unit_cost) end else p.cost end) is null then 'cost_unknown'
    when p.price is null or p.price<=0 then 'price_unknown'
    when p.price<=(case when c.lot_truth_enabled then case when p.cost is null then ls.max_verified_unit_cost when ls.max_verified_unit_cost is null then p.cost else greatest(p.cost,ls.max_verified_unit_cost) end else p.cost end) then 'margin_risk'
    else 'healthy'
  end commercial_health
from public.products p
cross join public.commercial_runtime_config c
left join public.product_lot_stock_v1 ls on ls.product_id=p.id
where c.id=1;
revoke all on public.commercial_product_health_v1 from public,anon,authenticated;
grant select on public.commercial_product_health_v1 to service_role;

create table if not exists public.commercial_coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.commercial_coupons(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  status text not null default 'reserved' check (status in ('reserved','redeemed','released','cancelled')),
  discount_brl numeric(12,2) not null check (discount_brl >= 0),
  idempotency_key text not null unique,
  margin_validation jsonb not null default '{}'::jsonb,
  reserved_at timestamptz not null default now(),
  redeemed_at timestamptz,
  released_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists commercial_coupon_redemptions_usage_idx on public.commercial_coupon_redemptions(coupon_id,status,customer_id);
alter table public.commercial_coupon_redemptions enable row level security;
revoke all on public.commercial_coupon_redemptions from public,anon,authenticated;
grant select,insert,update,delete on public.commercial_coupon_redemptions to service_role;

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
  if not cfg.promotion_engine_enabled or not c.enabled or c.status<>'active' or c.execution_mode not in ('homologation','canary','live') then
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

create or replace function public.reserve_coupon_redemption_v1(
  p_code text,p_order_subtotal numeric,p_customer_id uuid,p_order_id uuid,p_idempotency_key text,p_margin_validation jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare key text:=nullif(trim(coalesce(p_idempotency_key,'')),''); preview jsonb; existing public.commercial_coupon_redemptions%rowtype; rid uuid;
begin
  if key is null or length(key)>180 then return jsonb_build_object('ok',false,'reason','invalid_idempotency_key','side_effect_performed',false); end if;
  select * into existing from public.commercial_coupon_redemptions where idempotency_key=key;
  if found then
    if existing.customer_id is distinct from p_customer_id or existing.order_id is distinct from p_order_id then return jsonb_build_object('ok',false,'reason','idempotency_conflict','side_effect_performed',false); end if;
    return jsonb_build_object('ok',true,'replay',true,'redemption_id',existing.id,'status',existing.status,'side_effect_performed',false);
  end if;
  if p_order_id is null or not exists(select 1 from public.orders where id=p_order_id) then return jsonb_build_object('ok',false,'reason','order_required','side_effect_performed',false); end if;
  if coalesce((p_margin_validation->>'all_items_allowed')::boolean,false) is not true then return jsonb_build_object('ok',false,'reason','item_margin_validation_required','side_effect_performed',false); end if;
  preview:=public.preview_coupon_v1(p_code,p_order_subtotal,p_customer_id,now());
  if not coalesce((preview->>'eligible')::boolean,false) then return preview; end if;
  insert into public.commercial_coupon_redemptions(coupon_id,customer_id,order_id,status,discount_brl,idempotency_key,margin_validation)
  values((preview->>'coupon_id')::uuid,p_customer_id,p_order_id,'reserved',(preview->>'discount_brl')::numeric,key,coalesce(p_margin_validation,'{}'::jsonb)) returning id into rid;
  return jsonb_build_object('ok',true,'replay',false,'redemption_id',rid,'status','reserved','discount_brl',(preview->>'discount_brl')::numeric,'external_side_effect',false,'side_effect_performed',true);
end;
$$;

create or replace function public.release_coupon_redemption_v1(p_redemption_id uuid,p_reason text default 'release')
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare r public.commercial_coupon_redemptions%rowtype;
begin
  select * into r from public.commercial_coupon_redemptions where id=p_redemption_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','redemption_not_found','side_effect_performed',false); end if;
  if r.status='released' then return jsonb_build_object('ok',true,'replay',true,'side_effect_performed',false); end if;
  if r.status='redeemed' then return jsonb_build_object('ok',false,'reason','redemption_already_redeemed','side_effect_performed',false); end if;
  update public.commercial_coupon_redemptions set status='released',released_at=now(),updated_at=now(),metadata=metadata||jsonb_build_object('release_reason',coalesce(nullif(trim(p_reason),''),'release')) where id=r.id;
  return jsonb_build_object('ok',true,'redemption_id',r.id,'status','released','side_effect_performed',true);
end;
$$;

revoke all on function public.normalize_inventory_lot_expiry_v1() from public,anon,authenticated;
revoke all on function public.preview_coupon_v1(text,numeric,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.reserve_coupon_redemption_v1(text,numeric,uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.release_coupon_redemption_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.preview_coupon_v1(text,numeric,uuid,timestamptz) to service_role;
grant execute on function public.reserve_coupon_redemption_v1(text,numeric,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.release_coupon_redemption_v1(uuid,text) to service_role;

commit;
