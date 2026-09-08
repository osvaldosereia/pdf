import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async sql=>(await db.query(sql)).rows?.[0]||null;
const migrations=[
 'supabase/migrations/20260908120000_stage12_commercial_truth_foundation_v1.sql',
 'supabase/migrations/20260908120100_stage12_fefo_margin_guard_v1.sql',
 'supabase/migrations/20260908120200_stage12_promotions_benefits_v1.sql',
 'supabase/migrations/20260908120300_stage12_reports_recommendations_v1.sql',
 'supabase/migrations/20260908120400_stage12_lot_truth_fail_closed_v2.sql',
 'supabase/migrations/20260908120500_stage12_fefo_expiry_idempotency_v3.sql',
 'supabase/migrations/20260908120600_stage12_reservation_idempotency_fix_v4.sql'
];
try{
 await db.exec(`
   create role anon; create role authenticated; create role service_role bypassrls;
   create table public.products(
     id uuid primary key default gen_random_uuid(),name text not null,sku text,category text,sales_category text,
     price numeric(12,2),cost numeric(12,2),stock numeric(14,3),validity_date date,
     is_active boolean not null default true,is_whatsapp_active boolean not null default true,
     physically_verified boolean not null default false,is_offer boolean not null default false,is_upsell boolean not null default false,
     image_url text,sort_order integer not null default 0
   );
   create table public.customers(id uuid primary key default gen_random_uuid(),birthday_day smallint,birthday_month smallint);
   create table public.orders(
     id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),status text not null default 'confirmed',
     delivered_at timestamptz,external_status_updated_at timestamptz,updated_at timestamptz not null default now()
   );
   create table public.order_items(
     id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,
     product_id uuid references public.products(id),quantity numeric not null,line_total numeric not null
   );
 `);
 for(const file of migrations)await db.exec(readFileSync(file,'utf8'));

 let r=await one(`select public.commercial_readiness_v1() x`);
 if(r.x.enabled!==false||r.x.execution_mode!=='off'||r.x.lot_truth_enabled!==false||r.x.fefo_enabled!==false||r.x.legacy_offer_engine_allowed!==false)throw new Error('commercial_runtime_must_default_off');
 if(Number(r.x.draft_expiry_rules)!==8||Number(r.x.active_expiry_rules)!==0)throw new Error('legacy_expiry_rules_must_be_draft_only');
 if(Number(r.x.default_max_discount_percent)!==0||Number(r.x.promotion_budget_brl)!==0)throw new Error('commercial_thresholds_must_default_conservative');

 const healthy=(await one(`insert into public.products(name,sku,category,price,cost,stock,validity_date,physically_verified) values('Arroz','A1','mercearia',10,6,10,current_date+60,true) returning id`)).id;
 const risk=(await one(`insert into public.products(name,sku,category,price,cost,stock,validity_date,physically_verified) values('Risco','R1','mercearia',5,6,10,current_date+60,true) returning id`)).id;
 const lot1=(await one(`insert into public.inventory_lots(product_id,lot_code,status,quantity_on_hand,unit_cost,expires_at,expiry_handling,received_at,physically_verified) values('${healthy}','L1','available',2,6,current_date+10,'known',now()-interval '2 days',true) returning id`)).id;
 const lot2=(await one(`insert into public.inventory_lots(product_id,lot_code,status,quantity_on_hand,unit_cost,expires_at,expiry_handling,received_at,physically_verified) values('${healthy}','L2','available',5,6.2,current_date+30,'known',now()-interval '1 day',true) returning id`)).id;
 await db.exec(`insert into public.inventory_lots(product_id,lot_code,status,quantity_on_hand,unit_cost,expires_at,expiry_handling,physically_verified) values('${healthy}','UNKNOWN','available',100,1,current_date+5,'unknown',true)`);

 r=await one(`select public.preview_fefo_allocation_v1('${healthy}',4,current_date) x`);
 if(r.x.sufficient!==true||Number(r.x.available_quantity)!==7||Number(r.x.allocated_quantity)!==4||r.x.allocations?.length!==2)throw new Error('fefo_preview_failed');
 if(r.x.allocations[0].lot_id!==lot1||Number(r.x.allocations[0].quantity)!==2||r.x.allocations[1].lot_id!==lot2)throw new Error('fefo_order_wrong');
 if(r.x.allocations.some(x=>x.lot_code==='UNKNOWN'))throw new Error('unknown_expiry_must_be_excluded_from_fefo');

 r=await one(`select public.reserve_inventory_lots_fefo_v1(null,'${healthy}',1,'test-reservation',current_date,null) x`);
 if(r.x.reason!=='fefo_reservations_disabled'||r.x.side_effect_performed!==false)throw new Error('fefo_reservation_not_fail_closed');

 await db.exec(`update public.commercial_runtime_config set enabled=true,execution_mode='homologation',lot_reservations_enabled=true,fefo_enabled=true where id=1`);
 r=await one(`select public.reserve_inventory_lots_fefo_v1(null,'${healthy}',3,'homologation-key',current_date,null) x`);
 if(r.x.ok!==true||r.x.replay!==false||r.x.reservations?.length!==2)throw new Error('homologation_fefo_reservation_failed');
 const reservedCount=(await one(`select count(*)::int n,sum(quantity)::numeric q from public.inventory_lot_reservations where reservation_key='homologation-key'`));
 if(reservedCount.n!==2||Number(reservedCount.q)!==3)throw new Error('reservation_rows_mismatch');
 r=await one(`select public.reserve_inventory_lots_fefo_v1(null,'${healthy}',3,'homologation-key',current_date,null) x`);
 if(r.x.ok!==true||r.x.replay!==true||r.x.side_effect_performed!==false)throw new Error('reservation_replay_failed');
 r=await one(`select public.reserve_inventory_lots_fefo_v1(null,'${healthy}',2,'homologation-key',current_date,null) x`);
 if(r.x.ok!==false||r.x.reason!=='idempotency_conflict')throw new Error('reservation_idempotency_conflict_not_detected');
 const reservationIds=(await db.query(`select id from public.inventory_lot_reservations where reservation_key='homologation-key' order by created_at,id`)).rows;
 for(const row of reservationIds){
   const released=await one(`select public.release_inventory_lot_reservation_v1('${row.id}','test_cleanup',null) x`);
   if(released.x.ok!==true)throw new Error('reservation_release_failed');
 }
 await db.exec(`select public.kill_commercial_runtime_v1('test_cleanup',null)`);

 r=await one(`select public.margin_guard_v1('${healthy}',10,1,'sale') x`);
 if(r.x.allowed!==true||Number(r.x.margin_brl)<=0||r.x.cost_source!=='products_legacy')throw new Error('regular_margin_should_pass');
 r=await one(`select public.margin_guard_v1('${healthy}',9,1,'sale') x`);
 if(r.x.allowed!==false||r.x.reason!=='max_discount_exceeded')throw new Error('discount_must_default_blocked');
 r=await one(`select public.margin_guard_v1('${risk}',5,1,'sale') x`);
 if(r.x.allowed!==false||r.x.reason!=='below_cost')throw new Error('below_cost_must_block');

 await db.exec(`update public.commercial_runtime_config set lot_truth_enabled=true where id=1`);
 r=await one(`select public.commercial_product_eligibility_v1('${risk}',current_date) x`);
 if(r.x.eligible!==false||r.x.reason!=='lot_truth_missing'||r.x.source!=='inventory_lots')throw new Error('lot_truth_must_not_fallback_to_legacy_stock');
 r=await one(`select public.commercial_product_eligibility_v1('${healthy}',current_date) x`);
 if(r.x.eligible!==true||r.x.source!=='inventory_lots'||Number(r.x.available_quantity)!==7)throw new Error('verified_lot_truth_should_be_usable');
 r=await one(`select public.margin_guard_v1('${healthy}',10,1,'sale') x`);
 if(r.x.cost_source!=='product_and_verified_lots'||Number(r.x.effective_unit_cost)!==6.2)throw new Error('lot_truth_margin_cost_must_use_verified_lots_conservatively');
 await db.exec(`update public.commercial_runtime_config set lot_truth_enabled=false where id=1`);

 r=await one(`select public.preview_expiry_offer_v2('${healthy}',current_date,current_date) x`);
 if(r.x.offer_candidate!==false||r.x.reason!=='expiry_discount_disabled')throw new Error('expiry_runtime_must_default_off');

 const customer=(await one(`insert into public.customers(birthday_day,birthday_month) values(15,extract(month from current_date)::int) returning id`)).id;
 r=await one(`select public.preview_birthday_benefit_v1('${customer}',current_date) x`);
 if(r.x.eligible!==false||r.x.reason!=='birthday_benefit_runtime_disabled')throw new Error('birthday_runtime_must_default_off');

 const delivered=(await one(`insert into public.orders(customer_id,status,delivered_at) values('${customer}','delivered',now()) returning id`)).id;
 const confirmed=(await one(`insert into public.orders(customer_id,status) values('${customer}','confirmed') returning id`)).id;
 await db.exec(`insert into public.order_items(order_id,product_id,quantity,line_total) values('${delivered}','${healthy}',2,20),('${confirmed}','${risk}',1,5)`);
 r=await one(`select count(*)::int n from public.delivered_customer_product_stats_v1 where customer_id='${customer}'`);
 if(r.n!==1)throw new Error('only_delivered_orders_may_feed_safe_stats');
 r=await one(`select product_id,purchase_count from public.delivered_customer_product_stats_v1 where customer_id='${customer}'`);
 if(r.product_id!==healthy||r.purchase_count!==1)throw new Error('delivered_stats_wrong_product');

 const recs=(await db.query(`select product_id,bought_before,reason from public.get_customer_recommendations_commercial_v2('${customer}',10,'personalized')`)).rows;
 if(!recs.some(x=>x.product_id===healthy&&x.bought_before===true))throw new Error('delivered_product_should_be_recommended');
 if(recs.some(x=>x.product_id===risk))throw new Error('negative_margin_product_must_not_be_recommended');
 r=await one(`select sold_30d,turnover_bucket from public.commercial_turnover_report_v1 where product_id='${healthy}'`);
 if(Number(r.sold_30d)!==2)throw new Error('turnover_report_must_use_delivered_sales');

 const campaign=(await one(`insert into public.promotion_campaigns(campaign_key,display_name,campaign_type) values('test','Teste','manual') returning id`)).id;
 r=await one(`select public.create_promotion_item_draft_v1('${campaign}','${healthy}',9,'test',null) x`);
 if(r.x.status!=='blocked')throw new Error('discounted_promotion_draft_should_be_blocked_by_default');
 const active=await one(`select count(*)::int n from public.promotion_campaigns where enabled or execution_mode<>'off'`);
 if(active.n!==0)throw new Error('campaign_runtime_must_remain_off');

 r=await one(`select public.commercial_report_summary_v1() x`);
 if(Number(r.x.products)!==2||Number(r.x.margin_risk)!==1||Number(r.x.delivered_customer_product_pairs)!==1)throw new Error('commercial_summary_mismatch');

 const activeReservations=await one(`select count(*)::int n from public.inventory_lot_reservations where status='reserved'`);
 if(activeReservations.n!==0)throw new Error('test_cleanup_must_leave_no_active_reservation');
 console.log('PASS: stage12 DB truth is dormant, FEFO excludes unknown expiry, idempotency is strict, margin-safe and delivered-only recommendations work.');
} finally { await db.close(); }
