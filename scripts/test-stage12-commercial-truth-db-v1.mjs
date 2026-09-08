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
      sku text,
      gtin text,
      price numeric,
      cost numeric,
      stock numeric default 0,
      physically_verified boolean not null default false,
      validity_date date
    );
  `);
  for(const file of [
    'supabase/migrations/20260908130000_stage12_commercial_truth_foundation_v1.sql',
    'supabase/migrations/20260908130100_stage12_commercial_truth_admin_safety_v2.sql'
  ])await db.exec(readFileSync(file,'utf8'));

  let r=await one(`select public.stage12_readiness_v1() x`);
  for(const key of ['enabled','lot_tracking_enabled','fefo_enforcement_enabled','expiry_block_enabled','promotions_enabled','benefits_enabled','margin_guard_enabled','reports_enabled'])if(r.x[key]!==false)throw new Error(`default_${key}_must_be_false`);
  if(r.x.execution_mode!=='off'||Number(r.x.canary_percent)!==0||Number(r.x.lots)!==0||Number(r.x.active_policies)!==0)throw new Error('stage12_defaults_must_be_off');

  const p=(await one(`insert into public.products(name,price,cost,stock,physically_verified) values('Arroz teste',10.00,7.00,20,true) returning id`)).id;

  r=await one(`select public.create_inventory_lot_draft_v1('${p}'::uuid,'DRAFT-1','2026-11-30'::date,12,6.80,'test','draft') x`);
  if(r.x.ok!==true||r.x.status!=='draft'||r.x.physically_verified!==false||Number(r.x.quantity_available)!==0||r.x.external_side_effect!==false)throw new Error('lot_draft_must_not_be_sellable');
  const draftLot=(await one(`select status,physically_verified,quantity_received,quantity_available,quantity_reserved from public.inventory_lots where id='${r.x.lot_id}'::uuid`));
  if(draftLot.status!=='draft'||draftLot.physically_verified!==false||Number(draftLot.quantity_received)!==12||Number(draftLot.quantity_available)!==0||Number(draftLot.quantity_reserved)!==0)throw new Error('lot_draft_storage_invariant_failed');

  r=await one(`select public.create_commercial_policy_draft_v1('expiry_discount','{"minimum_margin_percent":15,"bands":[{"min_days":0,"max_days":30,"discount_percent":10}]}'::jsonb,null) x`);
  if(r.x.ok!==true||r.x.status!=='draft'||Number(r.x.version)!==1||r.x.external_side_effect!==false)throw new Error('policy_draft_failed');
  if(Number((await one(`select count(*)::int n from public.commercial_policy_versions where status='active'`)).n)!==0)throw new Error('policy_draft_must_not_activate');

  r=await one(`select public.create_promotion_rule_draft_v1('TEST10','Teste 10','coupon','{}'::jsonb,'{"discount_percent":10}'::jsonb,10000) x`);
  if(r.x.ok!==true||r.x.enabled!==false||r.x.execution_mode!=='off'||r.x.external_side_effect!==false)throw new Error('promotion_draft_must_be_off');

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
  if(r.x.lines?.some(x=>['UNVERIFIED','EXPIRED','DRAFT-1'].includes(x.lot_code)))throw new Error('fefo_must_exclude_unverified_incompatible_or_draft_lots');
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
  if(r.x.eligible!==false||r.x.reason!=='no_active_expiry_policy'||r.x.external_side_effect!==false)throw new Error('expiry_offer_without_active_policy_must_be_blocked');

  await db.exec(`update public.commercial_policy_versions set status='active' where policy_key='expiry_discount' and version=1`);
  r=await one(`select public.preview_expiry_offer_v2('${p}'::uuid,'${early}'::uuid,'2026-09-08'::date) x`);
  if(r.x.applied!==false||r.x.external_side_effect!==false)throw new Error('expiry_offer_must_be_preview_only');
  if(r.x.eligible!==true||Number(r.x.discount_percent)!==10||Number(r.x.suggested_price)!==9)throw new Error('expiry_offer_policy_preview_failed');

  await db.exec(`update public.products set cost=9.20 where id='${p}'::uuid`);
  r=await one(`select public.preview_expiry_offer_v2('${p}'::uuid,'${early}'::uuid,'2026-09-08'::date) x`);
  if(r.x.eligible!==false||r.x.margin_guard?.decision!=='block')throw new Error('margin_guard_must_block_bad_expiry_offer');

  await db.exec(`update public.commercial_truth_runtime_config set enabled=true,execution_mode='live',lot_tracking_enabled=true,fefo_enforcement_enabled=true,expiry_block_enabled=true,promotions_enabled=true,benefits_enabled=true,margin_guard_enabled=true,reports_enabled=true,canary_percent=50 where id=1; update public.promotion_rules set enabled=true,execution_mode='live' where code='TEST10'`);
  r=await one(`select public.kill_commercial_truth_runtime_v1('test',null) x`);
  if(r.x.ok!==true||r.x.enabled!==false||r.x.execution_mode!=='off'||r.x.external_side_effect!==false)throw new Error('stage12_kill_switch_failed');
  r=await one(`select public.stage12_readiness_v1() x`);
  for(const key of ['enabled','lot_tracking_enabled','fefo_enforcement_enabled','expiry_block_enabled','promotions_enabled','benefits_enabled','margin_guard_enabled','reports_enabled'])if(r.x[key]!==false)throw new Error(`kill_${key}_must_be_false`);
  if(r.x.execution_mode!=='off'||Number(r.x.canary_percent)!==0)throw new Error('kill_switch_must_reset_mode_and_canary');
  const promo=await one(`select enabled,execution_mode from public.promotion_rules where code='TEST10'`);
  if(promo.enabled!==false||promo.execution_mode!=='off')throw new Error('kill_switch_must_disable_promotions');

  const snap=await one(`select public.stage12_admin_snapshot_v1() x`);
  if(snap.x.external_side_effect!==false||!snap.x.readiness)throw new Error('admin_snapshot_must_be_read_only');

  console.log('PASS: stage12 FEFO, drafts, margin guard and kill switch are deterministic and fail-closed.');
} finally { await db.close(); }
