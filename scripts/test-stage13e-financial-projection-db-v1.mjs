import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async q=>(await db.query(q)).rows?.[0]||null;
const j=async q=>{const r=await one(q);const v=Object.values(r||{})[0];return typeof v==='string'?JSON.parse(v):v};
const n=v=>Number(v??0);
const owner='11111111-1111-4111-8111-111111111111';
const operator='22222222-2222-4222-8222-222222222222';

try{
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create table public.admin_users(user_id uuid primary key,role text not null,is_active boolean not null default true);
    insert into public.admin_users(user_id,role,is_active) values('${owner}','owner',true),('${operator}','operator',true);
    create table public.orders(id uuid primary key default gen_random_uuid(),status text not null,total numeric not null default 0,currency char(3) default 'BRL',confirmed_at timestamptz,delivered_at timestamptz,created_at timestamptz default now());
    create table public.order_fiscal_controls(order_id uuid primary key references public.orders(id),delivery_status text not null default 'pending',delivery_confirmed_at timestamptz,payment_status text not null default 'pending',payment_method text,payment_source text,settled_amount numeric,payment_confirmed_at timestamptz,fiscal_status text not null default 'blocked',fiscal_block_reason text,fiscal_ready_at timestamptz,updated_at timestamptz default now());
    create table public.financial_runtime_config(id smallint primary key default 1,enabled boolean default false,execution_mode text default 'off',canary_percent smallint default 0,base_currency char(3) default 'BRL',external_reconciliation_enabled boolean default false,reconciliation_preview_enabled boolean default false,reconciliation_recording_enabled boolean default false,financial_admin_read_enabled boolean default false,batch_reconciliation_audit_enabled boolean default false,fiscal_projection_enabled boolean default false);
    insert into public.financial_runtime_config(id) values(1);
    create table public.financial_ledger_entries(id uuid primary key default gen_random_uuid(),idempotency_key text unique,event_type text not null,recognition_status text not null,order_id uuid references public.orders(id),payment_method text,amount_cents bigint not null,external_reference text,reverses_entry_id uuid,occurred_at timestamptz default now(),created_at timestamptz default now());
    create table public.financial_reconciliation_cases(id uuid primary key default gen_random_uuid(),case_type text not null,order_id uuid references public.orders(id),status text default 'open',reason text not null,created_at timestamptz default now());
    create table public.financial_external_events(id uuid primary key default gen_random_uuid(),received_at timestamptz default now());
    create table public.financial_match_evaluations(id uuid primary key default gen_random_uuid(),external_event_id uuid references public.financial_external_events(id));
    create table public.financial_payment_expectations(id uuid primary key default gen_random_uuid(),order_id uuid references public.orders(id),version_no integer default 1,collection_mode text,expected_method text,expected_amount_cents bigint,created_at timestamptz default now());
    create table public.financial_route_collection_manifests(id uuid primary key default gen_random_uuid());
    create or replace function public.preview_financial_reconciliation_match_v1(uuid) returns jsonb language sql as $$select jsonb_build_object('ok',true,'decision','unmatched','external_side_effect',false)$$;
    create or replace function public.confirm_order_payment_v1(p_order_id uuid,p_payment_method text,p_payment_source text,p_settled_amount numeric,p_confirmed_at timestamptz default now()) returns jsonb language plpgsql as $$
    declare o public.orders%rowtype;fc public.order_fiscal_controls%rowtype;next_status text;
    begin select * into o from public.orders where id=p_order_id;select * into fc from public.order_fiscal_controls where order_id=p_order_id;
      next_status:=case when o.status='delivered' and fc.delivery_status='delivered' and fc.delivery_confirmed_at is not null and abs(p_settled_amount-o.total)<=0.01 then 'ready' else 'review_required' end;
      update public.order_fiscal_controls set payment_status='confirmed',payment_method=p_payment_method,payment_source=p_payment_source,settled_amount=p_settled_amount,payment_confirmed_at=p_confirmed_at,
        fiscal_status=next_status,fiscal_block_reason=case when next_status='ready' then null else 'mismatch' end,updated_at=now()
      where order_id=p_order_id;
      return jsonb_build_object('ok',true,'order_id',p_order_id,'fiscal_status',next_status,'side_effect_performed',true,'external_side_effect',false);
    end$$;
  `);
  await db.exec(readFileSync('supabase/migrations/20260908200000_stage13_financial_projection_policy_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908201000_stage13_financial_policy_admin_hardening_v2.sql','utf8'));

  let ready=await j(`select public.financial_stage13_readiness_v1() x`);
  assert.equal(ready.enabled,false);assert.equal(ready.fiscal_projection_apply_enabled,false);assert.equal(ready.financial_policy_write_enabled,false);assert.equal(n(ready.approved_projection_policies),0);
  let disabled=await j(`select public.preview_financial_fiscal_projection_v1(gen_random_uuid()) x`);assert.equal(disabled.error,'financial_fiscal_projection_preview_disabled');
  disabled=await j(`select public.preview_financial_reconciliation_batch_v1(10) x`);assert.equal(disabled.error,'financial_batch_audit_disabled');
  disabled=await j(`select public.create_financial_policy_draft_v1('fiscal_projection',0,true,true,true,true,null,null,'x','{}'::jsonb,'${owner}') x`);assert.equal(disabled.error,'financial_policy_write_disabled');

  await db.exec(`update public.financial_runtime_config set enabled=true,execution_mode='homologation',financial_admin_read_enabled=true,financial_policy_preview_enabled=true,financial_policy_write_enabled=true,fiscal_projection_preview_enabled=true,fiscal_projection_recording_enabled=true,fiscal_projection_enabled=true,fiscal_projection_apply_enabled=true,batch_reconciliation_audit_enabled=true where id=1;`);

  await assert.rejects(()=>db.query(`select public.create_financial_policy_draft_v1('fiscal_projection',0,true,true,true,true,null,null,'operator cannot own policy','{}'::jsonb,'${operator}')`),/owner_required/);
  const draft=await j(`select public.create_financial_policy_draft_v1('fiscal_projection',0,true,true,true,true,null,null,'fixture policy','{}'::jsonb,'${owner}') x`);
  assert.equal(draft.ok,true);assert.equal(draft.status,'draft');assert.equal(n(draft.version),1);
  let policyList=await j(`select public.list_financial_policies_v1('fiscal_projection') x`);assert.equal(policyList.ok,true);assert.equal(policyList.items.length,1);assert.equal(policyList.items[0].status,'draft');
  const approved=await j(`select public.approve_financial_policy_v1('${draft.id}','${owner}',now()-interval '1 minute','reviewed in fixture') x`);assert.equal(approved.ok,true);assert.equal(approved.status,'approved');
  ready=await j(`select public.financial_stage13_readiness_v1() x`);assert.equal(n(ready.approved_projection_policies),1);assert.equal(n(ready.policy_events),2);

  const order=await one(`insert into public.orders(status,total,delivered_at) values('delivered',100.00,now()) returning id`);
  await db.exec(`insert into public.order_fiscal_controls(order_id,delivery_status,delivery_confirmed_at,payment_status,fiscal_status) values('${order.id}','delivered',now(),'pending','blocked');
    insert into public.financial_ledger_entries(idempotency_key,event_type,recognition_status,order_id,payment_method,amount_cents,external_reference) values('pay-1','payment_received','reconciled','${order.id}','pix',10000,'pix-ref-1');`);
  let preview=await j(`select public.preview_financial_fiscal_projection_v1('${order.id}') x`);
  assert.equal(preview.decision,'ready_to_project');assert.equal(n(preview.order_total_cents),10000);assert.equal(n(preview.reconciled_amount_cents),10000);assert.equal(preview.projected_payment_method,'pix');assert.equal(n(preview.reference_gap_count),0);
  const rec=await j(`select public.record_financial_fiscal_projection_evaluation_v1('${order.id}','proj-1') x`);assert.equal(rec.ok,true);assert.equal(rec.decision,'ready_to_project');
  let fiscal=await one(`select payment_status,fiscal_status from public.order_fiscal_controls where order_id='${order.id}'`);assert.equal(fiscal.payment_status,'pending');assert.equal(fiscal.fiscal_status,'blocked');
  const applied=await j(`select public.apply_financial_fiscal_projection_v1('${rec.id}') x`);assert.equal(applied.ok,true);assert.equal(applied.side_effect_performed,true);
  fiscal=await one(`select payment_status,payment_method,payment_source,settled_amount,fiscal_status from public.order_fiscal_controls where order_id='${order.id}'`);assert.equal(fiscal.payment_status,'confirmed');assert.equal(fiscal.payment_method,'pix');assert.equal(fiscal.payment_source,'financial_reconciliation_projection');assert.equal(Number(fiscal.settled_amount),100);assert.equal(fiscal.fiscal_status,'ready');
  const again=await j(`select public.apply_financial_fiscal_projection_v1('${rec.id}') x`);assert.equal(again.idempotent,true);assert.equal(again.side_effect_performed,false);

  const order2=await one(`insert into public.orders(status,total,delivered_at) values('delivered',80.00,now()) returning id`);
  await db.exec(`insert into public.order_fiscal_controls(order_id,delivery_status,delivery_confirmed_at,payment_status,fiscal_status) values('${order2.id}','delivered',now(),'pending','blocked');
    insert into public.financial_ledger_entries(idempotency_key,event_type,recognition_status,order_id,payment_method,amount_cents) values('pay-2','payment_received','reconciled','${order2.id}','cash',8000);
    insert into public.financial_reconciliation_cases(case_type,order_id,status,reason) values('amount_mismatch','${order2.id}','open','manual review');`);
  const review=await j(`select public.preview_financial_fiscal_projection_v1('${order2.id}') x`);assert.equal(review.decision,'review_required');assert.equal(review.reason,'open_reconciliation_case');

  const order3=await one(`insert into public.orders(status,total,delivered_at) values('delivered',50.00,now()) returning id`);
  await db.exec(`insert into public.order_fiscal_controls(order_id,delivery_status,delivery_confirmed_at,payment_status,fiscal_status) values('${order3.id}','delivered',now(),'pending','blocked');
    insert into public.financial_ledger_entries(idempotency_key,event_type,recognition_status,order_id,payment_method,amount_cents) values('pay-3','payment_received','observed','${order3.id}','pix',5000);`);
  const noReconciled=await j(`select public.preview_financial_fiscal_projection_v1('${order3.id}') x`);assert.equal(noReconciled.decision,'blocked');assert.equal(noReconciled.reason,'reconciled_payment_missing');

  const order4=await one(`insert into public.orders(status,total,delivered_at) values('delivered',30.00,now()) returning id`);
  await db.exec(`insert into public.order_fiscal_controls(order_id,delivery_status,delivery_confirmed_at,payment_status,fiscal_status) values('${order4.id}','delivered',now(),'pending','blocked');
    insert into public.financial_ledger_entries(idempotency_key,event_type,recognition_status,order_id,payment_method,amount_cents) values('pay-4','payment_received','reconciled','${order4.id}','cash',3000);`);
  const cash=await j(`select public.preview_financial_fiscal_projection_v1('${order4.id}') x`);assert.equal(cash.decision,'ready_to_project');assert.equal(n(cash.reference_gap_count),0);

  const order5=await one(`insert into public.orders(status,total,delivered_at) values('delivered',40.00,now()) returning id`);
  await db.exec(`insert into public.order_fiscal_controls(order_id,delivery_status,delivery_confirmed_at,payment_status,fiscal_status) values('${order5.id}','delivered',now(),'pending','blocked');
    insert into public.financial_ledger_entries(idempotency_key,event_type,recognition_status,order_id,payment_method,amount_cents) values('pay-5','payment_received','reconciled','${order5.id}','pix',4000);`);
  const missingRef=await j(`select public.preview_financial_fiscal_projection_v1('${order5.id}') x`);assert.equal(missingRef.decision,'review_required');assert.equal(missingRef.reason,'reconciled_external_reference_missing');assert.equal(n(missingRef.reference_gap_count),1);

  const batch=await j(`select public.preview_financial_projection_batch_v1(20) x`);assert.equal(batch.ok,true);assert.ok(n(batch.count)>=3);assert.equal(batch.external_side_effect,false);
  const evalCount=await one(`select count(*) c from public.financial_fiscal_projection_evaluations where applied=true`);assert.equal(n(evalCount.c),1);
  const eventCount=await one(`select count(*) c from public.financial_policy_events`);assert.equal(n(eventCount.c),2);
  await assert.rejects(()=>db.query(`update public.financial_policy_events set reason='tamper'`),/financial_policy_events_append_only/);

  const retired=await j(`select public.retire_financial_policy_v1('${draft.id}','${owner}','end fixture') x`);assert.equal(retired.ok,true);assert.equal(retired.status,'retired');
  const retiredAgain=await j(`select public.retire_financial_policy_v1('${draft.id}','${owner}','again') x`);assert.equal(retiredAgain.idempotent,true);
  ready=await j(`select public.financial_stage13_readiness_v1() x`);assert.equal(n(ready.approved_projection_policies),0);assert.equal(n(ready.policy_events),3);

  console.log('PASS: Stage 13E exige owner/política versionada + ledger reconciliado + referência quando aplicável + entrega; projeção é idempotente e fiscal-ready antes de marcar aplicada.');
}finally{await db.close()}
