begin;

alter table public.inventory_lots
  add column if not exists expiry_handling text not null default 'unknown'
    check (expiry_handling in ('unknown','known','not_required'));

update public.inventory_lots
set expiry_handling='known',updated_at=now()
where expires_at is not null and expiry_handling='unknown';

alter table public.inventory_lots drop constraint if exists inventory_lots_expiry_handling_consistency_chk;
alter table public.inventory_lots add constraint inventory_lots_expiry_handling_consistency_chk check (
  (expiry_handling='known' and expires_at is not null)
  or (expiry_handling='not_required' and expires_at is null)
  or expiry_handling='unknown'
);

create or replace view public.product_lot_stock_v1 as
select
  p.id product_id,
  p.name,
  p.stock legacy_product_stock,
  count(l.id)::integer lot_count,
  coalesce(sum(l.quantity_on_hand),0)::numeric(14,3) lot_quantity_on_hand,
  coalesce(sum(l.quantity_reserved),0)::numeric(14,3) lot_quantity_reserved,
  coalesce(sum(case
    when l.status='available' and l.physically_verified=true and l.expiry_handling in ('known','not_required')
      and (l.expiry_handling='not_required' or l.expires_at>=current_date)
    then greatest(l.quantity_on_hand-l.quantity_reserved,0) else 0 end),0)::numeric(14,3) sellable_lot_quantity,
  coalesce(sum(case when l.expiry_handling='known' and l.expires_at<current_date and l.quantity_on_hand>0 then l.quantity_on_hand else 0 end),0)::numeric(14,3) expired_quantity,
  min(l.expires_at) filter(
    where l.status='available' and l.physically_verified=true and l.expiry_handling='known'
      and l.quantity_on_hand>l.quantity_reserved and l.expires_at>=current_date
  ) earliest_sellable_expiry,
  max(l.updated_at) last_lot_update,
  coalesce(sum(case when l.status='available' and (not l.physically_verified or l.expiry_handling='unknown') then greatest(l.quantity_on_hand-l.quantity_reserved,0) else 0 end),0)::numeric(14,3) unverified_or_unknown_quantity,
  max(l.unit_cost) filter(where l.status='available' and l.physically_verified=true and l.quantity_on_hand>l.quantity_reserved) max_verified_unit_cost
from public.products p
left join public.inventory_lots l on l.product_id=p.id
group by p.id,p.name,p.stock;
revoke all on public.product_lot_stock_v1 from public,anon,authenticated;
grant select on public.product_lot_stock_v1 to service_role;

create or replace function public.preview_fefo_allocation_v1(p_product_id uuid,p_quantity numeric,p_delivery_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  requested numeric(14,3):=coalesce(p_quantity,0);
  remaining numeric(14,3);
  alloc numeric(14,3);
  total_available numeric(14,3):=0;
  required_expiry date;
  l record;
  allocations jsonb:='[]'::jsonb;
begin
  if requested<=0 then return jsonb_build_object('ok',false,'reason','invalid_quantity','side_effect_performed',false); end if;
  if not exists(select 1 from public.products where id=p_product_id) then return jsonb_build_object('ok',false,'reason','product_not_found','side_effect_performed',false); end if;
  select * into cfg from public.commercial_runtime_config where id=1;
  required_expiry:=coalesce(p_delivery_date,current_date)+coalesce(cfg.minimum_delivery_shelf_life_days,1);
  remaining:=requested;

  select coalesce(sum(greatest(quantity_on_hand-quantity_reserved,0)),0)::numeric(14,3)
    into total_available
  from public.inventory_lots
  where product_id=p_product_id and status='available' and physically_verified=true
    and expiry_handling in ('known','not_required')
    and quantity_on_hand>quantity_reserved
    and (expiry_handling='not_required' or expires_at>=required_expiry);

  for l in
    select id,lot_code,expires_at,expiry_handling,unit_cost,greatest(quantity_on_hand-quantity_reserved,0)::numeric(14,3) available
    from public.inventory_lots
    where product_id=p_product_id and status='available' and physically_verified=true
      and expiry_handling in ('known','not_required')
      and quantity_on_hand>quantity_reserved
      and (expiry_handling='not_required' or expires_at>=required_expiry)
    order by case when expiry_handling='known' then 0 else 1 end,expires_at asc nulls last,received_at asc nulls last,id
  loop
    exit when remaining<=0;
    alloc:=least(remaining,l.available);
    if alloc>0 then
      allocations:=allocations||jsonb_build_array(jsonb_build_object(
        'lot_id',l.id,'lot_code',l.lot_code,'expires_at',l.expires_at,'expiry_handling',l.expiry_handling,
        'quantity',alloc,'unit_cost',l.unit_cost
      ));
      remaining:=remaining-alloc;
    end if;
  end loop;

  return jsonb_build_object(
    'ok',true,'product_id',p_product_id,'requested_quantity',requested,'available_quantity',total_available,
    'allocated_quantity',requested-greatest(remaining,0),'remaining_quantity',greatest(remaining,0),
    'sufficient',remaining<=0,'allocations',allocations,'delivery_date',coalesce(p_delivery_date,current_date),
    'required_expiry_on_or_after',required_expiry,'strategy','FEFO','unknown_expiry_excluded',true,'side_effect_performed',false
  );
end;
$$;

create or replace function public.reserve_inventory_lots_fefo_v1(
  p_order_id uuid,p_product_id uuid,p_quantity numeric,p_reservation_key text,p_delivery_date date default current_date,p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  key text:=nullif(trim(coalesce(p_reservation_key,'')),'');
  preview jsonb;
  item jsonb;
  lot public.inventory_lots%rowtype;
  qty numeric(14,3);
  r_id uuid;
  reservations jsonb:='[]'::jsonb;
  existing_count integer;
  existing_product uuid;
  existing_order uuid;
  existing_quantity numeric;
begin
  if key is null or length(key)>160 then return jsonb_build_object('ok',false,'reason','invalid_reservation_key','side_effect_performed',false); end if;
  if coalesce(p_quantity,0)<=0 then return jsonb_build_object('ok',false,'reason','invalid_quantity','side_effect_performed',false); end if;

  select count(*),min(product_id),min(order_id),coalesce(sum(quantity),0)
    into existing_count,existing_product,existing_order,existing_quantity
  from public.inventory_lot_reservations where reservation_key=key;
  if existing_count>0 then
    if existing_product is distinct from p_product_id or existing_order is distinct from p_order_id or existing_quantity<>p_quantity then
      return jsonb_build_object('ok',false,'reason','idempotency_conflict','reservation_key',key,'side_effect_performed',false);
    end if;
    return jsonb_build_object('ok',true,'replay',true,'reservation_key',key,'reservation_count',existing_count,'reserved_quantity',existing_quantity,'side_effect_performed',false);
  end if;

  select * into cfg from public.commercial_runtime_config where id=1;
  if not cfg.enabled or not cfg.lot_reservations_enabled or not cfg.fefo_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'reason','fefo_reservations_disabled','side_effect_performed',false);
  end if;
  if p_order_id is not null and not exists(select 1 from public.orders where id=p_order_id) then return jsonb_build_object('ok',false,'reason','order_not_found','side_effect_performed',false); end if;
  preview:=public.preview_fefo_allocation_v1(p_product_id,p_quantity,p_delivery_date);
  if not coalesce((preview->>'sufficient')::boolean,false) then return preview||jsonb_build_object('ok',false,'reason','insufficient_fefo_stock'); end if;

  for item in select value from jsonb_array_elements(preview->'allocations')
  loop
    qty:=(item->>'quantity')::numeric;
    select * into lot from public.inventory_lots where id=(item->>'lot_id')::uuid for update;
    if not found or lot.status<>'available' or not lot.physically_verified or lot.expiry_handling='unknown' or lot.quantity_on_hand-lot.quantity_reserved<qty then
      raise exception 'fefo_allocation_race';
    end if;
    if lot.expiry_handling='known' and lot.expires_at<coalesce(p_delivery_date,current_date)+cfg.minimum_delivery_shelf_life_days then
      raise exception 'fefo_expiry_race';
    end if;
    update public.inventory_lots set quantity_reserved=quantity_reserved+qty,updated_at=now() where id=lot.id;
    insert into public.inventory_lot_reservations(order_id,product_id,lot_id,quantity,status,reservation_key,idempotency_key,delivery_date,metadata)
    values(p_order_id,p_product_id,lot.id,qty,'reserved',key,key||':'||lot.id::text,p_delivery_date,jsonb_build_object('strategy','FEFO')) returning id into r_id;
    insert into public.inventory_lot_movements(lot_id,product_id,movement_type,quantity,idempotency_key,reference_type,reference_id,before_quantity,after_quantity,actor_type,actor_id,metadata)
    values(lot.id,p_product_id,'reserve',qty,'reserve:'||r_id::text,'lot_reservation',r_id,lot.quantity_reserved,lot.quantity_reserved+qty,'order',p_actor_id,jsonb_build_object('reservation_key',key));
    reservations:=reservations||jsonb_build_array(jsonb_build_object('reservation_id',r_id,'lot_id',lot.id,'quantity',qty));
  end loop;
  return jsonb_build_object('ok',true,'replay',false,'reservation_key',key,'reservations',reservations,'side_effect_performed',true);
end;
$$;

create or replace function public.margin_guard_v1(
  p_product_id uuid,p_sale_price numeric,p_quantity numeric default 1,p_context text default 'sale'
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  p public.products%rowtype;
  pol public.commercial_margin_policies%rowtype;
  ls public.product_lot_stock_v1%rowtype;
  qty numeric:=coalesce(p_quantity,0);
  sale numeric:=coalesce(p_sale_price,0);
  regular numeric;
  effective_cost numeric;
  cost_source text;
  margin_brl numeric;
  margin_percent numeric;
  discount_percent numeric;
  min_margin_percent numeric;
  min_margin_brl numeric;
  max_discount_percent numeric;
  budget_available numeric;
  markdown_cost numeric;
  promo_context boolean;
  allowed boolean;
  reason text:=null;
begin
  if qty<=0 or sale<=0 then return jsonb_build_object('ok',false,'allowed',false,'reason','invalid_sale_input','side_effect_performed',false); end if;
  select * into cfg from public.commercial_runtime_config where id=1;
  select * into p from public.products where id=p_product_id;
  if not found then return jsonb_build_object('ok',false,'allowed',false,'reason','product_not_found','side_effect_performed',false); end if;
  select * into ls from public.product_lot_stock_v1 where product_id=p.id;
  regular:=coalesce(p.price,sale);

  if cfg.lot_truth_enabled then
    effective_cost:=case
      when p.cost is null then ls.max_verified_unit_cost
      when ls.max_verified_unit_cost is null then p.cost
      else greatest(p.cost,ls.max_verified_unit_cost)
    end;
    cost_source:='product_and_verified_lots';
  else
    effective_cost:=p.cost;
    cost_source:='products_legacy';
  end if;

  select * into pol
  from public.commercial_margin_policies x
  where x.status='active'
    and (x.effective_from is null or x.effective_from<=now()) and (x.effective_until is null or x.effective_until>=now())
    and ((x.scope='product' and x.product_id=p.id) or (x.scope='category' and x.category=p.category) or x.scope='global')
  order by case x.scope when 'product' then 3 when 'category' then 2 else 1 end desc,x.priority desc,x.version desc
  limit 1;

  min_margin_percent:=coalesce(pol.min_margin_percent,cfg.default_min_margin_percent);
  min_margin_brl:=coalesce(pol.min_margin_brl,cfg.default_min_margin_brl);
  max_discount_percent:=coalesce(pol.max_discount_percent,cfg.default_max_discount_percent);
  margin_brl:=(sale-coalesce(effective_cost,0))*qty;
  margin_percent:=case when sale>0 and effective_cost is not null then round(((sale-effective_cost)/sale)*100,4) else null end;
  discount_percent:=case when regular>0 and sale<regular then round(((regular-sale)/regular)*100,4) else 0 end;
  markdown_cost:=greatest(regular-sale,0)*qty;
  budget_available:=greatest(cfg.promotion_budget_brl-cfg.promotion_budget_spent_brl,0);
  promo_context:=lower(coalesce(p_context,'sale')) in ('promotion','expiry','coupon','benefit','birthday','recompra','gift','ads','credit');

  if effective_cost is null then reason:='cost_unknown';
  elsif sale<effective_cost then reason:='below_cost';
  elsif margin_brl<min_margin_brl*qty then reason:='min_margin_brl_not_met';
  elsif margin_percent<min_margin_percent then reason:='min_margin_percent_not_met';
  elsif discount_percent>max_discount_percent then reason:='max_discount_exceeded';
  elsif promo_context and markdown_cost>budget_available then reason:='promotion_budget_exhausted';
  end if;
  allowed:=reason is null;
  return jsonb_build_object(
    'ok',true,'allowed',allowed,'reason',reason,'product_id',p.id,'context',lower(coalesce(p_context,'sale')),
    'regular_price',regular,'sale_price',sale,'quantity',qty,'effective_unit_cost',effective_cost,'cost_source',cost_source,
    'margin_brl',round(coalesce(margin_brl,0),2),'margin_percent',margin_percent,'discount_percent',discount_percent,
    'min_margin_brl',min_margin_brl,'min_margin_percent',min_margin_percent,'max_discount_percent',max_discount_percent,
    'promotion_budget_available_brl',budget_available,'estimated_markdown_brl',round(markdown_cost,2),
    'policy_id',pol.id,'margin_guard_enforced',cfg.margin_guard_enforced,'side_effect_performed',false
  );
end;
$$;

create or replace view public.commercial_turnover_report_v1 as
with sold as (
  select oi.product_id,
    coalesce(sum(oi.quantity) filter(where o.delivered_at>=now()-interval '30 days'),0)::numeric sold_30d,
    coalesce(sum(oi.quantity) filter(where o.delivered_at>=now()-interval '90 days'),0)::numeric sold_90d,
    max(o.delivered_at) last_delivered_at
  from public.orders o
  join public.order_items oi on oi.order_id=o.id
  where o.status='delivered' and oi.product_id is not null
  group by oi.product_id
), health as (
  select * from public.commercial_product_health_v1
)
select
  h.product_id,h.name,h.sku,h.category,h.effective_stock,h.effective_expiry,h.commercial_health,
  coalesce(s.sold_30d,0) sold_30d,coalesce(s.sold_90d,0) sold_90d,s.last_delivered_at,
  case when coalesce(s.sold_30d,0)>0 then round(h.effective_stock/(s.sold_30d/30.0),2) end estimated_days_cover,
  case
    when coalesce(s.sold_30d,0)<=0 and h.effective_stock>0 then 'no_recent_turnover'
    when h.effective_stock<=0 then 'stockout'
    when h.effective_stock/(nullif(s.sold_30d,0)/30.0)<=7 then 'fast'
    when h.effective_stock/(nullif(s.sold_30d,0)/30.0)<=30 then 'normal'
    else 'slow'
  end turnover_bucket
from health h left join sold s on s.product_id=h.product_id;
revoke all on public.commercial_turnover_report_v1 from public,anon,authenticated;
grant select on public.commercial_turnover_report_v1 to service_role;

revoke all on function public.preview_fefo_allocation_v1(uuid,numeric,date) from public,anon,authenticated;
revoke all on function public.reserve_inventory_lots_fefo_v1(uuid,uuid,numeric,text,date,uuid) from public,anon,authenticated;
revoke all on function public.margin_guard_v1(uuid,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.preview_fefo_allocation_v1(uuid,numeric,date) to service_role;
grant execute on function public.reserve_inventory_lots_fefo_v1(uuid,uuid,numeric,text,date,uuid) to service_role;
grant execute on function public.margin_guard_v1(uuid,numeric,numeric,text) to service_role;

commit;
