begin;

create or replace view public.delivered_customer_product_stats_v1 as
select
  o.customer_id,
  oi.product_id,
  count(distinct o.id)::integer purchase_count,
  coalesce(sum(oi.quantity),0)::numeric total_quantity,
  coalesce(sum(oi.line_total),0)::numeric total_spent,
  min(coalesce(o.delivered_at,o.external_status_updated_at,o.updated_at)) first_delivered_at,
  max(coalesce(o.delivered_at,o.external_status_updated_at,o.updated_at)) last_delivered_at
from public.orders o
join public.order_items oi on oi.order_id=o.id
where o.status='delivered' and o.customer_id is not null and oi.product_id is not null
group by o.customer_id,oi.product_id;
revoke all on public.delivered_customer_product_stats_v1 from public,anon,authenticated;
grant select on public.delivered_customer_product_stats_v1 to service_role;

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
  case when c.lot_truth_enabled and coalesce(ls.lot_count,0)>0 then ls.sellable_lot_quantity else greatest(coalesce(p.stock,0),0) end effective_stock,
  case when c.lot_truth_enabled and coalesce(ls.lot_count,0)>0 then ls.earliest_sellable_expiry else p.validity_date end effective_expiry,
  coalesce(ls.expired_quantity,0) expired_lot_quantity,
  case when p.price is not null and p.price>0 and p.cost is not null then round(((p.price-p.cost)/p.price)*100,4) end base_margin_percent,
  case when p.price is not null and p.cost is not null then round(p.price-p.cost,2) end base_margin_brl,
  case
    when not p.is_active then 'inactive'
    when not p.physically_verified then 'not_verified'
    when (case when c.lot_truth_enabled and coalesce(ls.lot_count,0)>0 then ls.sellable_lot_quantity else greatest(coalesce(p.stock,0),0) end)<=0 then 'stockout'
    when (case when c.lot_truth_enabled and coalesce(ls.lot_count,0)>0 then ls.earliest_sellable_expiry else p.validity_date end)<current_date then 'expired'
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

create or replace view public.commercial_expiry_report_v1 as
select
  product_id,name,sku,category,effective_stock,effective_expiry,
  case when effective_expiry is null then null else effective_expiry-current_date end days_remaining,
  expired_lot_quantity,
  case
    when effective_expiry is null then 'unknown'
    when effective_expiry<current_date then 'expired'
    when effective_expiry<=current_date+interval '7 days' then '0_7_days'
    when effective_expiry<=current_date+interval '30 days' then '8_30_days'
    when effective_expiry<=current_date+interval '60 days' then '31_60_days'
    when effective_expiry<=current_date+interval '90 days' then '61_90_days'
    else 'over_90_days'
  end expiry_bucket
from public.commercial_product_health_v1;
revoke all on public.commercial_expiry_report_v1 from public,anon,authenticated;
grant select on public.commercial_expiry_report_v1 to service_role;

create or replace function public.get_customer_recommendations_commercial_v2(p_customer_id uuid,p_limit integer default 20,p_kind text default 'personalized')
returns table(
  product_id uuid,name text,price numeric,image_url text,category text,stock numeric,score numeric,reason text,
  bought_before boolean,last_delivered_at timestamptz,purchase_count integer,margin_guard jsonb,eligibility jsonb
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
 with stats as (
   select * from public.delivered_customer_product_stats_v1 where customer_id=p_customer_id
 ), affinity as (
   select p.category,sum(s.purchase_count)::numeric category_purchases
   from stats s join public.products p on p.id=s.product_id
   where p.category is not null group by p.category
 ), ranked as (
   select p.id,p.name,p.price,p.image_url,p.category,
     (elig.e->>'available_quantity')::numeric stock,
     (case when s.product_id is not null then 60 else 0 end
       + least(coalesce(s.purchase_count,0)*8,32)
       + least(coalesce(a.category_purchases,0)*2,20)
       + case when p.is_offer then 20 else 0 end
       + case when p.is_upsell then 8 else 0 end)::numeric score,
     case
       when s.product_id is not null and p.is_offer then 'Compra entregue anteriormente e produto marcado como oferta'
       when s.product_id is not null then 'Compra entregue anteriormente'
       when p.is_offer and coalesce(a.category_purchases,0)>0 then 'Oferta em categoria com compras entregues'
       when coalesce(a.category_purchases,0)>0 then 'Categoria presente em compras entregues'
       else 'Produto comercialmente elegível'
     end reason,
     (s.product_id is not null) bought_before,s.last_delivered_at,coalesce(s.purchase_count,0)::integer purchase_count,
     guard.g margin_guard,elig.e eligibility,p.sort_order
   from public.products p
   left join stats s on s.product_id=p.id
   left join affinity a on a.category=p.category
   cross join lateral (select public.commercial_product_eligibility_v1(p.id,current_date) e) elig
   cross join lateral (select public.margin_guard_v1(p.id,p.price,1,'sale') g) guard
   where p.is_whatsapp_active=true
     and coalesce((elig.e->>'eligible')::boolean,false)=true
     and coalesce((guard.g->>'allowed')::boolean,false)=true
     and (p_kind<>'offers' or p.is_offer=true)
 )
 select id,name,price,image_url,category,stock,score,reason,bought_before,last_delivered_at,purchase_count,margin_guard,eligibility
 from ranked
 order by score desc,sort_order asc,name asc
 limit greatest(1,least(coalesce(p_limit,20),50));
$$;

create or replace function public.commercial_report_summary_v1()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
 select jsonb_build_object(
   'products',(select count(*) from public.products),
   'healthy',(select count(*) from public.commercial_product_health_v1 where commercial_health='healthy'),
   'stockout',(select count(*) from public.commercial_product_health_v1 where commercial_health='stockout'),
   'expired',(select count(*) from public.commercial_product_health_v1 where commercial_health='expired'),
   'margin_risk',(select count(*) from public.commercial_product_health_v1 where commercial_health='margin_risk'),
   'cost_unknown',(select count(*) from public.commercial_product_health_v1 where commercial_health='cost_unknown'),
   'expiry_30_days',(select count(*) from public.commercial_expiry_report_v1 where days_remaining between 0 and 30),
   'lots',(select count(*) from public.inventory_lots),
   'active_promotions',(select count(*) from public.promotion_campaigns where enabled and status='active'),
   'active_coupons',(select count(*) from public.commercial_coupons where enabled and status='active'),
   'active_benefits',(select count(*) from public.commercial_benefit_policies where enabled and status='active'),
   'delivered_customer_product_pairs',(select count(*) from public.delivered_customer_product_stats_v1)
 );
$$;

revoke all on function public.get_customer_recommendations_commercial_v2(uuid,integer,text) from public,anon,authenticated;
revoke all on function public.commercial_report_summary_v1() from public,anon,authenticated;
grant execute on function public.get_customer_recommendations_commercial_v2(uuid,integer,text) to service_role;
grant execute on function public.commercial_report_summary_v1() to service_role;

commit;
