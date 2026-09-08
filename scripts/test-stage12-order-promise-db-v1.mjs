import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async q=>(await db.query(q)).rows?.[0]||null;
try{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.products(id uuid primary key default gen_random_uuid(),sku text,name text not null,gtin text);
    create table public.carts(id uuid primary key default gen_random_uuid(),status text not null default 'draft',pricing_status text not null default 'ready');
    create table public.cart_items(id uuid primary key default gen_random_uuid(),cart_id uuid not null references public.carts(id),product_id uuid not null references public.products(id),quantity numeric not null);
    create table public.orders(id uuid primary key default gen_random_uuid(),status text not null default 'confirmed',delivery_address jsonb not null default '{}',updated_at timestamptz not null default now());
    create table public.order_items(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),product_id uuid references public.products(id),quantity numeric not null,sku_snapshot text,name_snapshot text not null);
    create table public.fulfillment_orders(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),status text not null default 'pending',created_at timestamptz not null default now());
  `);
  for(const f of ['supabase/migrations/20260908130000_stage12_commercial_truth_foundation_v1.sql','supabase/migrations/20260908143000_stage12_order_promise_change_control_v1.sql']) await db.exec(readFileSync(f,'utf8'));

  let cfg=await one(`select * from public.order_promise_runtime_config where id=1`);
  for(const k of ['enabled','preview_enabled','evaluation_recording_enabled','commitment_write_enabled','inventory_reservation_on_commit_enabled','change_control_enabled']) if(cfg[k]!==false) throw new Error(`unsafe_default_${k}`);
  if(cfg.execution_mode!=='off'||Number(cfg.canary_percent)!==0) throw new Error('unsafe_runtime_default');

  const p=(await one(`insert into public.products(sku,name,gtin) values('ARROZ5','Arroz 5kg','7891000') returning id`)).id;
  await db.exec(`
    insert into public.inventory_lots(product_id,lot_code,received_at,expires_at,quantity_received,quantity_available,quantity_reserved,status,physically_verified)
    values('${p}','GOOD',now(),'2027-02-01',5,5,0,'available',true),
          ('${p}','UNVERIFIED',now(),'2027-01-01',50,50,0,'available',false),
          ('${p}','TOO-EARLY',now(),'2027-01-10',50,50,0,'available',true);
  `);
  const cart=(await one(`insert into public.carts(status,pricing_status) values('draft','ready') returning id`)).id;
  await db.exec(`insert into public.cart_items(cart_id,product_id,quantity) values('${cart}','${p}',2)`);

  let r=await one(`select public.preview_cart_promise_v1('${cart}','2027-01-15','{"city":"Cuiaba","district":"Centro"}'::jsonb) x`);
  if(r.x.error!=='order_promise_preview_disabled'||r.x.side_effect_performed!==false) throw new Error('promise_must_fail_closed');

  await db.exec(`update public.order_promise_runtime_config set enabled=true,execution_mode='observe',preview_enabled=true where id=1`);
  r=await one(`select public.preview_cart_promise_v1('${cart}','2027-01-15','{"city":"Cuiaba","district":"Centro"}'::jsonb) x`);
  if(r.x.result!=='review'||!r.x.reasons.some(x=>x.code==='capacity_rule_missing')) throw new Error('missing_capacity_must_review');

  await db.exec(`insert into public.order_promise_daily_capacity(capacity_date,status,fulfillment_max_orders,fulfillment_max_item_units,delivery_max_stops,available_drivers) values('2027-01-15','active',5,10,4,1)`);
  r=await one(`select public.preview_cart_promise_v1('${cart}','2027-01-15','{"city":"Cuiaba","district":"Centro"}'::jsonb) x`);
  if(r.x.result!=='eligible'||r.x.promiseable!==true||Number(r.x.total_item_units)!==2) throw new Error('eligible_promise_failed');
  if(r.x.line_results.length!==1||r.x.line_results[0].allocations.length!==1||r.x.line_results[0].allocations[0].lot_code!=='GOOD') throw new Error('fefo_delivery_date_or_verified_lot_failed');

  r=await one(`select public.preview_cart_promise_v1('${cart}','2027-01-15','{}'::jsonb) x`);
  if(r.x.result!=='blocked'||!r.x.reasons.some(x=>x.code==='delivery_address_missing')) throw new Error('missing_address_not_blocked');

  r=await one(`select public.preview_cart_promise_v1('${cart}','2027-03-01','{"city":"Cuiaba"}'::jsonb) x`);
  if(r.x.result!=='review'&&r.x.result!=='blocked') throw new Error('future_without_capacity_should_not_be_eligible');
  if(!r.x.reasons.some(x=>x.code==='inventory_shortage')) throw new Error('expiry_shortage_not_detected');

  const order=(await one(`insert into public.orders(status,delivery_address) values('confirmed','{"city":"Cuiaba","district":"Centro"}') returning id`)).id;
  await db.exec(`insert into public.order_items(order_id,product_id,quantity,sku_snapshot,name_snapshot) values('${order}','${p}',2,'ARROZ5','Arroz 5kg')`);
  await db.exec(`insert into public.order_promise_commitments(order_id,promised_date,item_units,delivery_stops,status) values('${order}','2027-01-15',9,4,'committed')`);
  r=await one(`select public.preview_cart_promise_v1('${cart}','2027-01-15','{"city":"Cuiaba"}'::jsonb) x`);
  if(r.x.result!=='blocked'||!r.x.reasons.some(x=>x.code==='fulfillment_item_capacity_exceeded')||!r.x.reasons.some(x=>x.code==='delivery_capacity_exceeded')) throw new Error('capacity_usage_not_enforced');
  await db.exec(`update public.order_promise_commitments set status='released',released_at=now() where order_id='${order}'`);

  r=await one(`select public.record_order_promise_evaluation_v1('order','${order}','2027-01-15',null,'eval:${order}:0001') x`);
  if(r.x.error!=='promise_evaluation_recording_disabled') throw new Error('evaluation_recording_gate_failed');
  await db.exec(`update public.order_promise_runtime_config set evaluation_recording_enabled=true where id=1`);
  r=await one(`select public.record_order_promise_evaluation_v1('order','${order}','2027-01-15',null,'eval:${order}:0001') x`);
  if(r.x.ok!==true||r.x.replay!==false||r.x.result!=='eligible') throw new Error('evaluation_record_failed');
  r=await one(`select public.record_order_promise_evaluation_v1('order','${order}','2027-01-15',null,'eval:${order}:0001') x`);
  if(r.x.replay!==true) throw new Error('evaluation_idempotency_failed');

  r=await one(`select public.preview_order_change_control_v1('${order}') x`);
  if(r.x.lock_state!=='editable'||r.x.direct_change_allowed!==true||Number(r.x.order_version)!==1) throw new Error('editable_change_state_failed');
  r=await one(`select public.create_order_change_request_v1('${order}',1,'{"items":[{"product_id":"${p}","quantity":3}]}'::jsonb,'admin',null,'Cliente pediu ajuste','change:${order}:0001') x`);
  if(r.x.error!=='order_change_control_disabled') throw new Error('change_control_gate_failed');

  await db.exec(`update public.order_promise_runtime_config set execution_mode='homologation',change_control_enabled=true where id=1`);
  r=await one(`select public.create_order_change_request_v1('${order}',1,'{"items":[{"product_id":"${p}","quantity":3}]}'::jsonb,'admin',null,'Cliente pediu ajuste','change:${order}:0001') x`);
  if(r.x.status!=='draft'||r.x.order_mutated!==false) throw new Error('editable_request_must_be_draft_only');
  if(Number((await one(`select quantity q from public.order_items where order_id='${order}'`)).q)!==2) throw new Error('change_request_mutated_order');

  await db.exec(`insert into public.fulfillment_orders(order_id,status) values('${order}','pending')`);
  r=await one(`select public.preview_order_change_control_v1('${order}') x`);
  if(r.x.lock_state!=='soft_locked'||r.x.direct_change_allowed!==false||r.x.change_request_required!==true) throw new Error('soft_lock_not_enforced');
  r=await one(`select public.create_order_change_request_v1('${order}',1,'{"delivery_address":{"district":"Goiabeiras"}}'::jsonb,'customer',null,'Mudança de endereço','change:${order}:0002') x`);
  if(r.x.status!=='review_required'||r.x.order_mutated!==false) throw new Error('materialized_order_change_must_review');

  await db.exec(`update public.fulfillment_orders set status='picking' where order_id='${order}'`);
  r=await one(`select public.preview_order_change_control_v1('${order}') x`);
  if(r.x.lock_state!=='fulfillment_locked'||r.x.direct_change_allowed!==false) throw new Error('picking_lock_failed');

  await db.exec(`update public.orders set status='ready' where id='${order}'`);
  r=await one(`select public.create_order_change_request_v1('${order}',1,'{"items":[]}'::jsonb,'admin',null,'Late change','change:${order}:0003') x`);
  if(r.x.error!=='order_change_closed') throw new Error('closed_order_change_allowed');

  const counts=await one(`select (select count(*)::int from public.order_promise_evaluations) evals,(select count(*)::int from public.order_change_requests) changes`);
  if(Number(counts.evals)!==1||Number(counts.changes)!==2) throw new Error('unexpected_audit_counts');
  console.log('PASS: Stage 12 Order Promise is deterministic/fail-closed and Change Control prevents silent post-fulfillment mutation.');
}finally{await db.close();}
