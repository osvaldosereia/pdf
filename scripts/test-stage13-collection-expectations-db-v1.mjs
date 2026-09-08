import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async q=>(await db.query(q)).rows?.[0]||null;
const j=async q=>{const r=await one(q);const v=Object.values(r||{})[0];return typeof v==='string'?JSON.parse(v):v;};
const n=v=>Number(v??0);
try{
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create table public.orders(id uuid primary key default gen_random_uuid(),customer_id uuid,status text not null default 'confirmed',total numeric(14,2) not null default 0,currency char(3) not null default 'BRL',delivered_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.drivers(id uuid primary key default gen_random_uuid(),display_name text,status text default 'available');
    create table public.delivery_routes(id uuid primary key default gen_random_uuid(),route_code text,route_date date default current_date,status text default 'draft',driver_id uuid references public.drivers(id),created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.delivery_jobs(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),status text default 'ready');
    create table public.delivery_stops(id uuid primary key default gen_random_uuid(),route_id uuid not null references public.delivery_routes(id),delivery_job_id uuid not null references public.delivery_jobs(id),sequence_no integer not null default 1,status text default 'planned');
    create table public.order_fiscal_controls(order_id uuid primary key references public.orders(id),payment_status text not null default 'pending',settled_amount numeric(14,2),payment_confirmed_at timestamptz);
  `);
  await db.exec(readFileSync('supabase/migrations/20260908170000_stage13_financial_ledger_foundation_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908172000_stage13_financial_append_only_security_fix_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908173000_stage13_collection_expectations_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908173100_stage13_collection_expectations_prepaid_fix_v2.sql','utf8'));

  let ready=await j(`select public.financial_readiness_v2() x`);
  assert.equal(ready.enabled,false);assert.equal(ready.payment_expectations,0);assert.equal(ready.route_collection_manifests,0);
  let disabled=await j(`select public.preview_order_payment_expectation_v1(gen_random_uuid(),'on_delivery','cash',null,null,'test') x`);
  assert.equal(disabled.error,'payment_expectation_preview_disabled');

  const ids=await one(`
    with d as (insert into public.drivers(display_name) values('Driver 1') returning id),
    r as (insert into public.delivery_routes(route_code,status,driver_id) select 'R13B','active',id from d returning id,driver_id),
    o1 as (insert into public.orders(total,currency,status) values(100.00,'BRL','ready') returning id),
    o2 as (insert into public.orders(total,currency,status) values(50.00,'BRL','ready') returning id),
    j1 as (insert into public.delivery_jobs(order_id,status) select id,'ready' from o1 returning id,order_id),
    j2 as (insert into public.delivery_jobs(order_id,status) select id,'ready' from o2 returning id,order_id),
    s1 as (insert into public.delivery_stops(route_id,delivery_job_id,sequence_no,status) select r.id,j1.id,1,'planned' from r,j1 returning id),
    s2 as (insert into public.delivery_stops(route_id,delivery_job_id,sequence_no,status) select r.id,j2.id,2,'planned' from r,j2 returning id)
    select (select id from d) driver_id,(select id from r) route_id,(select id from o1) order1_id,(select id from o2) order2_id;
  `);
  await db.exec(`update public.financial_runtime_config set enabled=true,execution_mode='homologation',receipt_recording_enabled=true,payment_expectation_preview_enabled=true,payment_expectation_recording_enabled=true,route_collection_manifest_preview_enabled=true,route_collection_manifest_recording_enabled=true where id=1;`);

  let cash=await j(`select public.preview_order_payment_expectation_v1('${ids.order1_id}','on_delivery','cash',12000,null,'customer') x`);
  assert.equal(cash.decision,'expected');assert.equal(n(cash.remaining_due_cents),10000);assert.equal(n(cash.change_required_cents),2000);assert.equal(cash.payment_confirmed,false);assert.equal(cash.fiscal_mutated,false);
  let cashRec=await j(`select public.record_order_payment_expectation_v1('${ids.order1_id}','on_delivery','cash',12000,null,'customer','expectation-cash-0001') x`);
  assert.equal(cashRec.ok,true);assert.equal(cashRec.replay,false);assert.equal(n(cashRec.version_no),1);
  let cashReplay=await j(`select public.record_order_payment_expectation_v1('${ids.order1_id}','on_delivery','cash',12000,null,'customer','expectation-cash-0001') x`);
  assert.equal(cashReplay.replay,true);

  let prepaid=await j(`select public.preview_order_payment_expectation_v1('${ids.order2_id}','prepaid','prepaid_pix',null,now()+interval '1 hour','customer') x`);
  assert.equal(prepaid.decision,'expected');assert.equal(prepaid.reason,'prepayment_pending');assert.equal(n(prepaid.remaining_due_cents),5000);
  let preRec=await j(`select public.record_order_payment_expectation_v1('${ids.order2_id}','prepaid','prepaid_pix',null,now()+interval '1 hour','customer','expectation-prepaid-0001') x`);
  assert.equal(preRec.decision,'expected');

  let manifestBefore=await j(`select public.preview_route_collection_manifest_v1('${ids.route_id}') x`);
  assert.equal(manifestBefore.decision,'review_required');assert.equal(n(manifestBefore.order_count),2);assert.equal(n(manifestBefore.collect_due_cents),15000);assert.equal(n(manifestBefore.cash_due_cents),10000);assert.equal(n(manifestBefore.pix_due_cents),5000);assert.equal(n(manifestBefore.change_required_cents),2000);assert.equal(n(manifestBefore.review_order_count),1);

  let receipt=await j(`select public.record_payment_receipt_v1('${ids.order2_id}','prepaid_pix',5000,'test','prepaid-receipt-0001','operational_confirmed',null,null,'pix-test',now(),'{}') x`);
  assert.equal(receipt.ok,true);assert.equal(receipt.fiscal_mutated,false);
  let covered=await j(`select public.preview_order_payment_expectation_v1('${ids.order2_id}','prepaid','prepaid_pix',null,now(),'customer') x`);
  assert.equal(covered.decision,'covered');assert.equal(n(covered.remaining_due_cents),0);

  let manifest=await j(`select public.preview_route_collection_manifest_v1('${ids.route_id}') x`);
  assert.equal(manifest.decision,'ready');assert.equal(n(manifest.collect_order_count),1);assert.equal(n(manifest.collect_due_cents),10000);assert.equal(n(manifest.cash_due_cents),10000);assert.equal(n(manifest.pix_due_cents),0);assert.equal(n(manifest.change_required_cents),2000);assert.equal(n(manifest.review_order_count),0);
  let stored=await j(`select public.record_route_collection_manifest_v1('${ids.route_id}','route-manifest-0001') x`);
  assert.equal(stored.ok,true);assert.equal(stored.replay,false);assert.equal(stored.route_mutated,false);
  let replay=await j(`select public.record_route_collection_manifest_v1('${ids.route_id}','route-manifest-0001') x`);assert.equal(replay.replay,true);

  let immutable=false;try{await db.exec(`update public.financial_payment_expectations set expected_amount_cents=1 where id='${cashRec.expectation_id}'`);}catch{immutable=true;}assert.equal(immutable,true);
  const route=await one(`select status from public.delivery_routes where id='${ids.route_id}'`);assert.equal(route.status,'active');
  const fiscalCount=await one(`select count(*) c from public.order_fiscal_controls`);assert.equal(n(fiscalCount.c),0);
  ready=await j(`select public.financial_readiness_v2() x`);assert.equal(n(ready.payment_expectations),2);assert.equal(n(ready.route_collection_manifests),1);

  console.log('PASS: Stage 13B handles COD cash/change, prepaid coverage, route collection manifests and idempotent immutable records without confirming payment/delivery/fiscal state.');
}finally{await db.close();}
