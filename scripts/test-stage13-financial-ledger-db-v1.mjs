import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async(q)=>((await db.query(q)).rows?.[0]??null);
const scalarJson=async(q)=>{const r=await one(q);const v=Object.values(r||{})[0];return typeof v==='string'?JSON.parse(v):v;};
const num=v=>Number(v??0);

try{
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create table public.orders(
      id uuid primary key default gen_random_uuid(), customer_id uuid, status text not null default 'confirmed',
      total numeric(14,2) not null default 0, currency char(3) not null default 'BRL', delivered_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now()
    );
    create table public.drivers(id uuid primary key default gen_random_uuid(), display_name text, status text default 'available');
    create table public.delivery_routes(
      id uuid primary key default gen_random_uuid(), route_code text, route_date date default current_date,status text default 'draft',driver_id uuid references public.drivers(id),created_at timestamptz default now(),updated_at timestamptz default now()
    );
    create table public.delivery_jobs(
      id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),status text default 'ready'
    );
    create table public.delivery_stops(
      id uuid primary key default gen_random_uuid(),route_id uuid not null references public.delivery_routes(id),delivery_job_id uuid not null references public.delivery_jobs(id),status text default 'planned'
    );
    create table public.order_fiscal_controls(
      order_id uuid primary key references public.orders(id),payment_status text not null default 'pending',settled_amount numeric(14,2),payment_confirmed_at timestamptz
    );
  `);

  await db.exec(readFileSync('supabase/migrations/20260908170000_stage13_financial_ledger_foundation_v1.sql','utf8'));

  let ready=await scalarJson(`select public.financial_readiness_v1() x`);
  assert.equal(ready.enabled,false);
  assert.equal(ready.execution_mode,'off');
  assert.equal(ready.ledger_entries,0);

  let disabled=await scalarJson(`select public.preview_order_financial_state_v1(gen_random_uuid()) x`);
  assert.equal(disabled.error,'financial_preview_disabled');

  const ids=await one(`
    with d as (insert into public.drivers(display_name) values('Driver 1') returning id),
    r as (insert into public.delivery_routes(route_code,status,driver_id) select 'R1','active',id from d returning id,driver_id),
    o as (insert into public.orders(total,currency,status) values(100.00,'BRL','delivered') returning id),
    j as (insert into public.delivery_jobs(order_id,status) select id,'delivered' from o returning id,order_id),
    s as (insert into public.delivery_stops(route_id,delivery_job_id,status) select r.id,j.id,'delivered' from r,j returning id)
    select (select id from d) driver_id,(select id from r) route_id,(select id from o) order_id,(select id from j) job_id;
  `);
  await db.exec(`insert into public.order_fiscal_controls(order_id,payment_status) values('${ids.order_id}','pending');`);
  await db.exec(`update public.financial_runtime_config set enabled=true,execution_mode='homologation',preview_enabled=true,receipt_recording_enabled=true,reversal_recording_enabled=true,route_cash_recording_enabled=true,route_close_preview_enabled=true,route_close_recording_enabled=true,reconciliation_case_recording_enabled=true where id=1;`);

  let pending=await scalarJson(`select public.preview_order_financial_state_v1('${ids.order_id}') x`);
  assert.equal(pending.state,'pending');
  assert.equal(num(pending.expected_amount_cents),10000);

  let receipt=await scalarJson(`select public.record_payment_receipt_v1('${ids.order_id}','pix',10000,'test','receipt-stage13-0001','operational_confirmed',null,null,null,now(),'{}') x`);
  assert.equal(receipt.ok,true);assert.equal(receipt.replay,false);assert.equal(receipt.fiscal_mutated,false);
  let replay=await scalarJson(`select public.record_payment_receipt_v1('${ids.order_id}','pix',10000,'test','receipt-stage13-0001','operational_confirmed',null,null,null,now(),'{}') x`);
  assert.equal(replay.replay,true);

  let balanced=await scalarJson(`select public.preview_order_financial_state_v1('${ids.order_id}') x`);
  assert.equal(balanced.state,'balanced');assert.equal(num(balanced.net_received_amount_cents),10000);
  assert.equal(balanced.fiscal_alignment.status,'review_required');

  let immutable=false;
  try{await db.exec(`update public.financial_ledger_entries set amount_cents=1 where id='${receipt.entry_id}'`);}catch{immutable=true;}
  assert.equal(immutable,true,'ledger must be append-only');

  let reversed=await scalarJson(`select public.record_payment_reversal_v1('${receipt.entry_id}','reversal-stage13-0001','test','test reversal',now()) x`);
  assert.equal(reversed.ok,true);assert.equal(reversed.fiscal_mutated,false);
  pending=await scalarJson(`select public.preview_order_financial_state_v1('${ids.order_id}') x`);
  assert.equal(pending.state,'pending');assert.equal(num(pending.net_received_amount_cents),0);

  let float=await scalarJson(`select public.record_route_cash_event_v1('${ids.route_id}','${ids.driver_id}','route_cash_float_start',5000,'test','route-float-stage13-0001',now(),'{}') x`);
  assert.equal(float.ok,true);assert.equal(float.route_mutated,false);
  let cash=await scalarJson(`select public.record_payment_receipt_v1('${ids.order_id}','cash',10000,'driver_app','route-cash-stage13-0001','operational_confirmed','${ids.route_id}','${ids.driver_id}',null,now(),'{}') x`);
  assert.equal(cash.ok,true);
  let decl=await scalarJson(`select public.record_route_cash_event_v1('${ids.route_id}','${ids.driver_id}','route_cash_declaration',15000,'driver_app','route-declare-stage13-0001',now(),'{}') x`);
  assert.equal(decl.ok,true);

  let close=await scalarJson(`select public.preview_route_financial_close_v1('${ids.route_id}') x`);
  assert.equal(close.decision,'balanced');assert.equal(num(close.expected_cash_cents),15000);assert.equal(num(close.difference_cents),0);
  let closeRec=await scalarJson(`select public.record_route_close_evaluation_v1('${ids.route_id}','route-close-stage13-0001') x`);
  assert.equal(closeRec.ok,true);assert.equal(closeRec.route_closed,false);
  const route=await one(`select status from public.delivery_routes where id='${ids.route_id}'`);assert.equal(route.status,'active');

  let caseRec=await scalarJson(`select public.open_financial_reconciliation_case_v1('fiscal_alignment','${ids.order_id}',null,'ledger and fiscal differ',10000,0,'recon-stage13-0001','{}') x`);
  assert.equal(caseRec.ok,true);assert.equal(caseRec.status,'review_required');assert.equal(caseRec.external_action_taken,false);

  ready=await scalarJson(`select public.financial_readiness_v1() x`);
  assert.equal(num(ready.ledger_entries),5);
  assert.equal(num(ready.route_close_evaluations),1);
  assert.equal(num(ready.reconciliation_cases),1);

  console.log('PASS: Stage 13 financial ledger validates fail-closed gates, immutable/idempotent receipts, reversal, route cash closure and review cases without fiscal/logistics mutation.');
} finally { await db.close(); }
