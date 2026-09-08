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
 'supabase/migrations/20260908120600_stage12_reservation_idempotency_fix_v4.sql',
 'supabase/migrations/20260908120700_stage12_margin_coupon_hardening_v5.sql',
 'supabase/migrations/20260908120800_stage12_global_gate_hardening_v6.sql'
];
try{
 await db.exec(`
   create role anon; create role authenticated; create role service_role bypassrls;
   create table public.products(id uuid primary key default gen_random_uuid(),name text not null,sku text,category text,sales_category text,price numeric(12,2),cost numeric(12,2),stock numeric(14,3),validity_date date,is_active boolean not null default true,is_whatsapp_active boolean not null default true,physically_verified boolean not null default false,is_offer boolean not null default false,is_upsell boolean not null default false,image_url text,sort_order integer not null default 0);
   create table public.customers(id uuid primary key default gen_random_uuid(),birthday_day smallint,birthday_month smallint);
   create table public.orders(id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),status text not null default 'confirmed',delivered_at timestamptz,external_status_updated_at timestamptz,updated_at timestamptz not null default now());
   create table public.order_items(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id) on delete cascade,product_id uuid references public.products(id),quantity numeric not null,line_total numeric not null);
 `);
 for(const file of migrations)await db.exec(readFileSync(file,'utf8'));

 const product=(await one(`insert into public.products(name,sku,category,price,cost,stock,validity_date,physically_verified) values('Produto','P1','mercearia',10,6,10,current_date+10,true) returning id`)).id;
 const customer=(await one(`insert into public.customers(birthday_day,birthday_month) values(10,extract(month from current_date)::int) returning id`)).id;
 const order=(await one(`insert into public.orders(customer_id,status) values('${customer}','confirmed') returning id`)).id;

 const lot=(await one(`insert into public.inventory_lots(product_id,lot_code,status,quantity_on_hand,unit_cost,expires_at,physically_verified) values('${product}','AUTO-KNOWN','available',5,7,current_date+20,true) returning id`)).id;
 let r=await one(`select expiry_handling from public.inventory_lots where id='${lot}'`);
 if(r.expiry_handling!=='known')throw new Error('expiry_trigger_must_normalize_known_date');
 await db.exec(`insert into public.inventory_lots(product_id,lot_code,status,quantity_on_hand,unit_cost,expiry_handling,physically_verified) values('${product}','NO-EXPIRY','available',3,6.5,'not_required',true),('${product}','UNKNOWN','available',50,1,'unknown',true)`);
 r=await one(`select sellable_lot_quantity,unverified_or_unknown_quantity,max_verified_unit_cost from public.product_lot_stock_v1 where product_id='${product}'`);
 if(Number(r.sellable_lot_quantity)!==8||Number(r.unverified_or_unknown_quantity)!==50||Number(r.max_verified_unit_cost)!==7)throw new Error('lot_stock_truth_filters_failed');

 const coupon=(await one(`insert into public.commercial_coupons(code,status,enabled,execution_mode,discount_type,discount_value,max_total_uses,max_uses_per_customer) values('TEST10','active',true,'homologation','percent',10,1,1) returning id`)).id;
 await db.exec(`update public.commercial_runtime_config set promotion_engine_enabled=true where id=1`);
 r=await one(`select public.preview_coupon_v1('TEST10',100,'${customer}',now()) x`);
 if(r.x.eligible!==false||r.x.reason!=='coupon_runtime_disabled')throw new Error('global_gate_must_override_coupon_gate');

 await db.exec(`update public.commercial_runtime_config set enabled=true,execution_mode='homologation',promotion_engine_enabled=true where id=1`);
 r=await one(`select public.preview_coupon_v1('TEST10',100,'${customer}',now()) x`);
 if(r.x.eligible!==true||Number(r.x.discount_brl)!==10)throw new Error('coupon_preview_homologation_failed');
 r=await one(`select public.reserve_coupon_redemption_v1('TEST10',100,'${customer}','${order}','coupon-key','{"all_items_allowed":false}'::jsonb) x`);
 if(r.x.reason!=='item_margin_validation_required')throw new Error('coupon_must_require_item_margin_validation');
 r=await one(`select public.reserve_coupon_redemption_v1('TEST10',100,'${customer}','${order}','coupon-key','{"all_items_allowed":true}'::jsonb) x`);
 if(r.x.ok!==true||r.x.replay!==false||r.x.status!=='reserved')throw new Error('coupon_reservation_failed');
 const redemption=(await one(`select id from public.commercial_coupon_redemptions where idempotency_key='coupon-key'`)).id;
 r=await one(`select public.preview_coupon_v1('TEST10',100,'${customer}',now()) x`);
 if(r.x.eligible!==false||r.x.reason!=='coupon_total_limit_reached')throw new Error('coupon_total_limit_not_enforced');
 r=await one(`select public.release_coupon_redemption_v1('${redemption}','test') x`);
 if(r.x.ok!==true||r.x.status!=='released')throw new Error('coupon_release_failed');
 r=await one(`select public.preview_coupon_v1('TEST10',100,'${customer}',now()) x`);
 if(r.x.eligible!==true)throw new Error('released_coupon_should_restore_capacity');

 await db.exec(`insert into public.commercial_benefit_policies(policy_key,benefit_kind,benefit_type,benefit_value,status,enabled,execution_mode) values('birthday-test','birthday','fixed',5,'active',true,'homologation'); update public.commercial_runtime_config set benefit_engine_enabled=true where id=1`);
 r=await one(`select public.preview_birthday_benefit_v1('${customer}',current_date) x`);
 if(r.x.eligible!==true)throw new Error('birthday_homologation_preview_failed');

 await db.exec(`update public.expiry_discount_rules set status='active' where version=1 and min_days_remaining=8; update public.commercial_runtime_config set expiry_discount_enabled=true where id=1`);
 r=await one(`select public.preview_expiry_offer_v2('${product}',current_date,current_date) x`);
 if(r.x.offer_candidate!==false||r.x.reason!=='max_discount_exceeded')throw new Error('expiry_offer_must_still_pass_margin_guard');

 await db.exec(`select public.kill_commercial_runtime_v1('test-kill',null)`);
 r=await one(`select public.preview_coupon_v1('TEST10',100,'${customer}',now()) x`);
 if(r.x.reason!=='coupon_runtime_disabled')throw new Error('kill_switch_must_close_coupon');
 r=await one(`select public.preview_birthday_benefit_v1('${customer}',current_date) x`);
 if(r.x.reason!=='birthday_benefit_runtime_disabled')throw new Error('kill_switch_must_close_birthday');
 r=await one(`select public.preview_expiry_offer_v2('${product}',current_date,current_date) x`);
 if(r.x.reason!=='expiry_discount_runtime_disabled')throw new Error('kill_switch_must_close_expiry_offer');

 await db.exec(`update public.commercial_runtime_config set lot_truth_enabled=true where id=1`);
 r=await one(`select effective_unit_cost,base_margin_brl,commercial_health from public.commercial_product_health_v1 where product_id='${product}'`);
 if(Number(r.effective_unit_cost)!==7||Number(r.base_margin_brl)!==3||r.commercial_health!=='healthy')throw new Error('health_report_must_use_verified_lot_cost');
 console.log('PASS: stage12 global gates, coupon limits, expiry normalization and effective lot cost are fail-closed.');
} finally { await db.close(); }
