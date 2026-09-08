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
    create table public.orders(
      id uuid primary key default gen_random_uuid(),status text not null default 'ready',total numeric(14,2) not null default 0,currency char(3) not null default 'BRL',
      delivered_at timestamptz,external_status_updated_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now()
    );
    create table public.drivers(
      id uuid primary key default gen_random_uuid(),auth_user_id uuid unique,display_name text,status text default 'available',updated_at timestamptz default now()
    );
    create table public.delivery_routes(
      id uuid primary key default gen_random_uuid(),route_code text,route_date date default current_date,status text default 'draft',driver_id uuid references public.drivers(id),
      started_at timestamptz,completed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now()
    );
    create table public.delivery_jobs(
      id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),status text default 'out_for_delivery',address_snapshot jsonb default '{}'::jsonb,
      latitude double precision,longitude double precision,reference_text text,volumes integer default 1,amount_due numeric(14,2) default 0,payment_method text,operational_notes text,
      delivered_at timestamptz,updated_at timestamptz default now()
    );
    create table public.delivery_stops(
      id uuid primary key default gen_random_uuid(),route_id uuid not null references public.delivery_routes(id),delivery_job_id uuid not null references public.delivery_jobs(id),
      sequence_no integer not null,status text default 'planned',locked boolean not null default false,delivered_at timestamptz,updated_at timestamptz default now()
    );
    create table public.delivery_events(
      id uuid primary key default gen_random_uuid(),delivery_job_id uuid references public.delivery_jobs(id),route_id uuid references public.delivery_routes(id),stop_id uuid references public.delivery_stops(id),
      event_type text not null,actor_type text not null,actor_id uuid,client_event_id text unique,payload jsonb not null default '{}'::jsonb,created_at timestamptz default now()
    );
    create table public.logistics_runtime_config(
      id smallint primary key default 1,enabled boolean not null default false,execution_mode text not null default 'off',driver_app_enabled boolean not null default false,
      gps_tracking_enabled boolean not null default false,canary_percent smallint not null default 0
    );
    insert into public.logistics_runtime_config(id) values(1);
    create table public.order_fiscal_controls(
      order_id uuid primary key references public.orders(id),delivery_status text not null default 'pending',delivery_confirmed_at timestamptz,delivery_event_id uuid references public.delivery_events(id),
      payment_status text not null default 'pending',settled_amount numeric(14,2),payment_confirmed_at timestamptz,fiscal_status text not null default 'blocked',fiscal_block_reason text,updated_at timestamptz default now()
    );
  `);

  await db.exec(readFileSync('supabase/migrations/20260908170000_stage13_financial_ledger_foundation_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908172000_stage13_financial_append_only_security_fix_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908173000_stage13_collection_expectations_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908173100_stage13_collection_expectations_prepaid_fix_v2.sql','utf8'));

  await db.exec(`
    create or replace function public.get_driver_route_snapshot_v1(p_auth_user_id uuid)
    returns jsonb language sql security definer set search_path=public,pg_temp as $$
      with d as (select * from public.drivers where auth_user_id=p_auth_user_id limit 1),
      r as (select r.* from public.delivery_routes r join d on d.id=r.driver_id where r.status in ('published','active') order by r.created_at limit 1)
      select coalesce((select jsonb_build_object(
        'ok',true,
        'driver',jsonb_build_object('id',d.id,'display_name',d.display_name,'status',d.status),
        'route',jsonb_build_object('id',r.id,'route_code',r.route_code,'status',r.status,'route_date',r.route_date,'started_at',r.started_at),
        'stops',coalesce((select jsonb_agg(jsonb_build_object(
          'id',s.id,'sequence_no',s.sequence_no,'status',s.status,'locked',s.locked,'delivery_job_id',j.id,
          'address',j.address_snapshot,'latitude',j.latitude,'longitude',j.longitude,'reference',j.reference_text,'volumes',j.volumes,
          'amount_due',j.amount_due,'payment_method',j.payment_method,'operational_notes',j.operational_notes
        ) order by s.sequence_no) from public.delivery_stops s join public.delivery_jobs j on j.id=s.delivery_job_id where s.route_id=r.id),'[]'::jsonb)
      ) from d join r on true),jsonb_build_object('ok',false,'error','no_active_driver_route'));
    $$;

    create or replace function public.refresh_order_fiscal_readiness_v1(p_order_id uuid)
    returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
    declare st text;reason text;
    begin
      insert into public.order_fiscal_controls(order_id) values(p_order_id) on conflict(order_id) do nothing;
      select case when payment_status='confirmed' then 'ready' else 'blocked' end,
             case when payment_status='confirmed' then null else 'payment_not_confirmed' end
        into st,reason from public.order_fiscal_controls where order_id=p_order_id;
      update public.order_fiscal_controls set fiscal_status=st,fiscal_block_reason=reason,updated_at=now() where order_id=p_order_id;
      return jsonb_build_object('ok',true,'fiscal_status',st,'block_reason',reason,'external_side_effect',false);
    end;$$;

    create or replace function public.confirm_order_payment_v1(uuid,text,text,numeric,timestamptz default now())
    returns jsonb language plpgsql as $$ begin raise exception 'driver_must_never_call_confirm_order_payment_v1'; end; $$;
  `);

  await db.exec(readFileSync('supabase/migrations/20260908174000_stage13_driver_financial_context_v1.sql','utf8'));

  let ready=await j(`select public.financial_readiness_v3() x`);
  assert.equal(ready.enabled,false);assert.equal(ready.driver_financial_context_enabled,false);assert.equal(ready.driver_collection_recording_enabled,false);assert.equal(ready.driver_delivery_financial_guard_enabled,false);
  let disabled=await j(`select public.preview_driver_order_collection_v1(gen_random_uuid(),null) x`);
  assert.equal(disabled.error,'driver_financial_context_disabled');

  const authUser='11111111-1111-4111-8111-111111111111';
  const ids=await one(`
    with d as (insert into public.drivers(auth_user_id,display_name,status) values('${authUser}','Entregador 1','on_route') returning id),
    r as (insert into public.delivery_routes(route_code,status,driver_id,started_at) select 'R13C','active',id,now() from d returning id,driver_id),
    o1 as (insert into public.orders(total,status) values(100.00,'out_for_delivery') returning id),
    o2 as (insert into public.orders(total,status) values(50.00,'out_for_delivery') returning id),
    o3 as (insert into public.orders(total,status) values(75.00,'out_for_delivery') returning id),
    j1 as (insert into public.delivery_jobs(order_id,status,amount_due,address_snapshot) select id,'out_for_delivery',100.00,'{"street":"Rua A","number":"10"}'::jsonb from o1 returning id,order_id),
    j2 as (insert into public.delivery_jobs(order_id,status,amount_due,address_snapshot) select id,'out_for_delivery',50.00,'{"street":"Rua B","number":"20"}'::jsonb from o2 returning id,order_id),
    j3 as (insert into public.delivery_jobs(order_id,status,amount_due,address_snapshot) select id,'out_for_delivery',75.00,'{"street":"Rua C","number":"30"}'::jsonb from o3 returning id,order_id),
    s1 as (insert into public.delivery_stops(route_id,delivery_job_id,sequence_no,status) select r.id,j1.id,1,'arrived' from r,j1 returning id),
    s2 as (insert into public.delivery_stops(route_id,delivery_job_id,sequence_no,status) select r.id,j2.id,2,'arrived' from r,j2 returning id),
    s3 as (insert into public.delivery_stops(route_id,delivery_job_id,sequence_no,status) select r.id,j3.id,3,'arrived' from r,j3 returning id)
    select (select id from d) driver_id,(select id from r) route_id,
           (select id from o1) order1_id,(select id from o2) order2_id,(select id from o3) order3_id,
           (select id from s1) stop1_id,(select id from s2) stop2_id,(select id from s3) stop3_id;
  `);

  await db.exec(`
    update public.logistics_runtime_config set enabled=true,execution_mode='homologation',driver_app_enabled=true where id=1;
    update public.financial_runtime_config set
      enabled=true,execution_mode='homologation',receipt_recording_enabled=true,
      payment_expectation_preview_enabled=true,payment_expectation_recording_enabled=true,
      driver_financial_context_enabled=true,driver_collection_recording_enabled=true,driver_delivery_financial_guard_enabled=true
    where id=1;
  `);

  let e1=await j(`select public.record_order_payment_expectation_v1('${ids.order1_id}','on_delivery','cash',12000,null,'customer','driver-expect-cash-0001') x`);assert.equal(e1.ok,true);
  let e2=await j(`select public.record_order_payment_expectation_v1('${ids.order2_id}','prepaid','prepaid_pix',null,null,'customer','driver-expect-prepaid-0001') x`);assert.equal(e2.ok,true);
  let e3=await j(`select public.record_order_payment_expectation_v1('${ids.order3_id}','on_delivery','pix',null,null,'customer','driver-expect-pix-0001') x`);assert.equal(e3.ok,true);
  let pre=await j(`select public.record_payment_receipt_v1('${ids.order2_id}','prepaid_pix',5000,'test','driver-prepaid-receipt-0001','operational_confirmed',null,null,'pix-pre',now(),'{}') x`);assert.equal(pre.ok,true);

  const snap=await j(`select public.get_driver_route_snapshot_v2('${authUser}') x`);
  assert.equal(snap.ok,true);assert.equal(snap.financial_context.enabled,true);assert.equal(n(snap.collection_summary.collect_order_count),2);assert.equal(n(snap.collection_summary.review_order_count),0);
  assert.equal(n(snap.collection_summary.collect_due_cents),17500);assert.equal(n(snap.collection_summary.cash_due_cents),10000);assert.equal(n(snap.collection_summary.pix_due_cents),7500);assert.equal(n(snap.collection_summary.change_required_cents),2000);
  const byOrder=Object.fromEntries(snap.stops.map(s=>[s.order_id,s]));
  assert.equal(byOrder[ids.order1_id].financial.decision,'collect');assert.equal(n(byOrder[ids.order1_id].financial.change_required_cents),2000);
  assert.equal(byOrder[ids.order2_id].financial.decision,'covered');assert.equal(n(byOrder[ids.order2_id].financial.remaining_due_cents),0);
  assert.equal(byOrder[ids.order3_id].financial.decision,'collect');assert.equal(byOrder[ids.order3_id].financial.expected_method,'pix');

  const mismatch=await j(`select public.driver_deliver_stop_v3('${authUser}','${ids.stop1_id}','driver:cash-mismatch-0001','{}'::jsonb,'{"payment_method":"cash","amount_cents":9900,"tender_amount_cents":12000}'::jsonb) x`);
  assert.equal(mismatch.ok,false);assert.equal(mismatch.error,'collection_amount_mismatch');
  let st=await one(`select status from public.delivery_stops where id='${ids.stop1_id}'`);assert.equal(st.status,'arrived');

  const cash=await j(`select public.driver_deliver_stop_v3('${authUser}','${ids.stop1_id}','driver:cash-ok-0001','{"method":"driver_confirmation"}'::jsonb,'{"payment_method":"cash","amount_cents":10000,"tender_amount_cents":12000}'::jsonb) x`);
  assert.equal(cash.ok,true);assert.equal(cash.receipt.recognition_status,'operational_confirmed');assert.equal(cash.fiscal_payment_confirmed_by_driver,false);
  const cashEntry=await one(`select payment_method,amount_cents,recognition_status,metadata from public.financial_ledger_entries where id='${cash.receipt.entry_id}'`);
  assert.equal(cashEntry.payment_method,'cash');assert.equal(n(cashEntry.amount_cents),10000);assert.equal(cashEntry.recognition_status,'operational_confirmed');assert.equal(n(cashEntry.metadata.change_given_cents),2000);
  let fc=await one(`select payment_status,fiscal_status,fiscal_block_reason from public.order_fiscal_controls where order_id='${ids.order1_id}'`);
  assert.equal(fc.payment_status,'pending');assert.equal(fc.fiscal_status,'blocked');assert.equal(fc.fiscal_block_reason,'payment_not_confirmed');

  const prepaidDelivery=await j(`select public.driver_deliver_stop_v3('${authUser}','${ids.stop2_id}','driver:prepaid-ok-0001','{}'::jsonb,null) x`);
  assert.equal(prepaidDelivery.ok,true);assert.equal(prepaidDelivery.financial.decision,'covered');assert.equal(prepaidDelivery.fiscal_payment_confirmed_by_driver,false);
  fc=await one(`select payment_status,fiscal_status from public.order_fiscal_controls where order_id='${ids.order2_id}'`);assert.equal(fc.payment_status,'pending');assert.equal(fc.fiscal_status,'blocked');

  const pix=await j(`select public.driver_deliver_stop_v3('${authUser}','${ids.stop3_id}','driver:pix-ok-0001','{}'::jsonb,'{"payment_method":"pix","amount_cents":7500}'::jsonb) x`);
  assert.equal(pix.ok,true);assert.equal(pix.receipt.recognition_status,'observed');assert.equal(pix.route_completed,true);assert.equal(pix.fiscal_payment_confirmed_by_driver,false);
  const pixEntry=await one(`select recognition_status,payment_method from public.financial_ledger_entries where id='${pix.receipt.entry_id}'`);assert.equal(pixEntry.recognition_status,'observed');assert.equal(pixEntry.payment_method,'pix');
  fc=await one(`select payment_status,fiscal_status from public.order_fiscal_controls where order_id='${ids.order3_id}'`);assert.equal(fc.payment_status,'pending');assert.equal(fc.fiscal_status,'blocked');

  const route=await one(`select status from public.delivery_routes where id='${ids.route_id}'`);assert.equal(route.status,'completed');
  const driver=await one(`select status from public.drivers where id='${ids.driver_id}'`);assert.equal(driver.status,'available');
  const ledger=await one(`select count(*) c,count(*) filter(where recognition_status='observed') observed from public.financial_ledger_entries`);assert.equal(n(ledger.c),3);assert.equal(n(ledger.observed),1);
  const deliveryEvents=await one(`select count(*) c,bool_and(coalesce((payload->>'fiscal_payment_confirmed_by_driver')::boolean,false)=false) all_safe from public.delivery_events where event_type='STOP_DELIVERED'`);assert.equal(n(deliveryEvents.c),3);assert.equal(deliveryEvents.all_safe,true);

  ready=await j(`select public.financial_readiness_v3() x`);assert.equal(ready.driver_financial_context_enabled,true);assert.equal(n(ready.ledger_entries),3);
  console.log('PASS: Stage 13C shows collect/covered states, validates cash/change, writes cash as operational and electronic payment as observed, completes delivery without confirming fiscal payment.');
}finally{await db.close();}
