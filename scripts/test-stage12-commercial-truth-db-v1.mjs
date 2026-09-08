import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async sql=>(await db.query(sql)).rows?.[0]||null;
try{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.products(
      id uuid primary key default gen_random_uuid(),
      name text not null,
      price numeric,
      cost numeric,
      stock numeric default 0,
      physically_verified boolean not null default false,
      validity_date date
    );
  `);
  await db.exec(readFileSync('supabase/migrations/20260908130000_stage12_commercial_truth_foundation_v1.sql','utf8'));

  let r=await one(`select public.stage12_readiness_v1() x`);
  for(const key of ['enabled','lot_tracking_enabled','fefo_enforcement_enabled','expiry_block_enabled','promotions_enabled','benefits_enabled','margin_guard_enabled','reports_enabled'])if(r.x[key]!==false)throw new Error(`default_${key}_must_be_false`);
  if(r.x.execution_mode!=='off'||Number(r.x.canary_percent)!==0||Number(r.x.lots)!==0||Number(r.x.active_policies)!==0)throw new Error('stage12_defaults_must_be_off');

  const p=(await one(`insert into public.products(name,price,cost,stock,physically_verified) values('Arroz teste',10.00,7.00,20,true) returning id`)).id;
  await db.exec(`
    insert into public.inventory_lots(product_id,lot_code,expires_at,quantity_received,quantity_available,physically_verified,status,unit_cost,received_at) values
    ('${p}'::uuid,'LATE','2026-12-31',10,10,true,'available',7.00,'2026-09-01T00:00:00Z'),
    ('${p}'::uuid,'EARLY','2026-10-01',5,5,true,'available',7.00,'2026-09-02T00:00:00Z'),
    ('${p}'::uuid,'UNVERIFIED','2026-09-20',100,100,false,'available',7.00,'2026-09-03T00:00:00Z'),
    ('${p}'::uuid,'EXPIRED','2026-09-01',100,100,true,'available',7.00,'2026-08-01T00:00:00Z');
  `);
  r=await one(`select public.preview_fefo_allocation_v1('${p}'::uuid,8,'2026-09-08'::date,7) x`);
  if(r.x.ok!==true||r.x.sufficient!==true||Number(r.x.allocated_quantity)!==8||r.x.external_side_effect!==false)throw new Error('fefo_preview_failed');
  if(r.x.lines?.[0]?.lot_code!=='EARLY'||Number(r.x.lines?.[0]?.quantity)!==5)throw new Error('fefo_must_take_earliest_valid_lot_first');
  if(r.x.lines?.some(x=>['UNVERIFIED','EXPIRED'].includes(x.lot_code)))throw new Error('fefo_must_exclude_unverified_or_incompatible_lots');
  r=await one(`select public.preview_fefo_allocation_v1('${p}'::uuid,50,'2026-09-08'::date,7) x`);
  if(r.x.sufficient!==false||Number(r.x.shortage)!==35)throw new Error('fefo_shortage_must_be_explicit');

  r=await one(`select public.evaluate_margin_guard_v1(100,70,10,15) x`);
  if(r.x.decision!=='allow'||Number(r.x.margin_percent)<=15)throw new Error('healthy_margin_should_allow');
  r=await one(`select public.evaluate_margin_guard_v1(100,85,10,15) x`);
  if(r.x.decision!=='block'||r.x.reason!=='below_minimum_margin')throw new Error('low_margin_should_block');
  r=await one(`select public.evaluate_margin_guard_v1(100,110,0,0) x`);
  if(r.x.decision!=='block'||r.x.reason!=='negative_margin')throw new Error('negative_margin_should_block');

  const early=(await one(`select id from public.inventory_lots where product_id='${p}'::uuid and lot_code='EARLY'`)).id;
  r=await one(`select public.preview_expiry_offer_v2('${p}'::uuid,'${early}'::uuid,'2026-09-08'::date) x`);
  if(r.x.eligible!==false||r.x.reason!=='no_active_expiry_policy'||r.x.external_side_effect!==false)throw new Error('expiry_offer_without_policy_must_be_blocked');

  const policy=(await one(`insert into public.commercial_policy_versions(policy_key,version,status,policy) values('expiry_discount',1,'active','{"minimum_margin_percent":15,"bands":[{"min_days":0,"max_days":30,"discount_percent":10}]}'::jsonb) returning id`)).id;
  r=await one(`select public.preview_expiry_offer_v2('${p}'::uuid,'${early}'::uuid,'2026-09-08'::date) x`);
  if(r.x.applied!==false||r.x.external_side_effect!==false)throw new Error('expiry_offer_must_be_preview_only');
  if(r.x.eligible!==true||Number(r.x.discount_percent)!==10||Number(r.x.suggested_price)!==9)throw new Error('expiry_offer_policy_preview_failed');

  await db.exec(`update public.products set cost=9.20 where id='${p}'::uuid`);
  r=await one(`select public.preview_expiry_offer_v2('${p}'::uuid,'${early}'::uuid,'2026-09-08'::date) x`);
  if(r.x.eligible!==false||r.x.margin_guard?.decision!=='block')throw new Error('margin_guard_must_block_bad_expiry_offer');

  console.log('PASS: stage12 FEFO, expiry compatibility and margin guard are deterministic and fail-closed.');
} finally { await db.close(); }
