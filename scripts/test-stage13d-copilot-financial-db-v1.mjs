import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async q=>(await db.query(q)).rows?.[0]||null;
const j=async q=>{const r=await one(q);const v=Object.values(r||{})[0];return typeof v==='string'?JSON.parse(v):v};
const n=v=>Number(v??0);

try{
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create table public.admin_users(user_id uuid primary key,role text not null,is_active boolean not null default true,display_name text,email text);
    create table public.customers(id uuid primary key default gen_random_uuid(),name text,preferred_reply text default 'auto',shopping_mode text default 'auto',order_count integer default 0,last_order_at timestamptz,last_inbound_message_type text);
    create table public.conversations(id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),channel text not null default 'whatsapp',channel_account_id uuid,stage text not null default 'new',mode text not null default 'human',status text not null default 'needs_human',service_window_expires_at timestamptz,human_required boolean not null default true,updated_at timestamptz default now());
    alter table public.conversations add constraint conversations_mode_check check(mode in ('ai','human','paused'));
    create table public.human_handoffs(id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id),customer_id uuid references public.customers(id),reason text not null default 'test',priority smallint not null default 2,status text not null default 'claimed',claimed_by uuid,claimed_at timestamptz,sla_due_at timestamptz,created_at timestamptz default now());
    create table public.messages(id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id),direction text,message_type text,body_text text,transcript text,delivery_status text,created_at timestamptz default now());
    create table public.products(id uuid primary key default gen_random_uuid(),name text not null);
    create table public.carts(id uuid primary key default gen_random_uuid(),conversation_id uuid not null references public.conversations(id),status text not null default 'draft',version integer default 1,total numeric default 0,currency char(3) default 'BRL',pricing_status text default 'ready',pricing_issues jsonb default '[]',updated_at timestamptz default now());
    create table public.cart_items(id uuid primary key default gen_random_uuid(),cart_id uuid not null references public.carts(id),product_id uuid not null references public.products(id),quantity numeric not null,unit_price numeric default 0,line_total numeric default 0,created_at timestamptz default now());
    create table public.orders(id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),conversation_id uuid references public.conversations(id),status text not null default 'confirmed',total numeric default 0,currency char(3) default 'BRL',confirmed_at timestamptz,delivered_at timestamptz,cancelled_at timestamptz,created_at timestamptz default now());
    create table public.order_fiscal_controls(order_id uuid primary key references public.orders(id),delivery_status text default 'pending',payment_status text default 'pending',payment_method text,fiscal_status text default 'blocked',fiscal_block_reason text);
    create table public.financial_ledger_entries(id uuid primary key default gen_random_uuid(),idempotency_key text unique,event_type text not null,recognition_status text not null,order_id uuid references public.orders(id),route_id uuid,driver_id uuid,payment_method text,amount_cents bigint not null,currency char(3) default 'BRL',source text default 'test',external_reference text,reverses_entry_id uuid,occurred_at timestamptz default now(),metadata jsonb default '{}',external_side_effect boolean default false,created_at timestamptz default now());
    create table public.financial_runtime_config(id smallint primary key default 1,enabled boolean default false,execution_mode text default 'off',external_reconciliation_enabled boolean default false,fiscal_projection_enabled boolean default false);
    insert into public.financial_runtime_config(id) values(1);
    create table public.financial_payment_expectations(id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),version_no integer not null default 1,collection_mode text default 'on_delivery',expected_method text,expected_amount_cents bigint not null,tender_amount_cents bigint,change_required_cents bigint default 0,due_at timestamptz,decision text default 'collect',reason text,source text default 'test',snapshot jsonb default '{}',external_side_effect boolean default false,created_at timestamptz default now());
    create table public.financial_reconciliation_cases(id uuid primary key default gen_random_uuid(),case_type text not null,order_id uuid references public.orders(id),route_id uuid,status text default 'open',reason text not null,expected_amount_cents bigint,observed_amount_cents bigint,difference_cents bigint,idempotency_key text unique,source_snapshot jsonb default '{}',resolution_snapshot jsonb default '{}',external_side_effect boolean default false,created_at timestamptz default now(),updated_at timestamptz default now(),resolved_at timestamptz);
    create table public.financial_route_collection_manifests(id uuid primary key default gen_random_uuid(),route_id uuid not null,driver_id uuid,version_no integer default 1,idempotency_key text unique,order_count integer default 0,collect_order_count integer default 0,review_order_count integer default 0,expected_total_cents bigint default 0,already_received_cents bigint default 0,collect_due_cents bigint default 0,cash_due_cents bigint default 0,pix_due_cents bigint default 0,card_due_cents bigint default 0,payment_link_due_cents bigint default 0,other_due_cents bigint default 0,change_required_cents bigint default 0,decision text default 'ready',snapshot jsonb default '{}',external_side_effect boolean default false,created_at timestamptz default now());
    create table public.operator_reply_jobs(id uuid primary key default gen_random_uuid(),conversation_id uuid,customer_id uuid,handoff_id uuid,channel text,channel_account_id uuid,admin_user_id uuid,body_text text,status text,blocked_reason text);
    create table public.commercial_tool_registry(tool_key text primary key,channel text not null,category text not null,provider text not null,ai_action_key text,risk_class text not null,reversible boolean not null,confirmation_required boolean not null,confidence_autorun_allowed boolean not null,cost_policy_required boolean not null default true,priority integer default 100,enabled boolean default false,execution_mode text default 'off',metadata jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.commercial_decision_runtime_config(id smallint primary key default 1,enabled boolean default false,execution_mode text default 'off',action_safety_preview_enabled boolean default false,confidence_policy_preview_enabled boolean default false,objective_order text[] default array['resolve_correctly'],canary_percent smallint default 0);
    insert into public.commercial_decision_runtime_config(id) values(1);
    create table public.decision_confidence_policy_versions(id uuid primary key default gen_random_uuid(),scope_key text,version integer,low_threshold numeric,high_threshold numeric,status text,effective_from timestamptz,effective_to timestamptz);
    create or replace function public.dispatch_operator_reply_whatsapp_v1(uuid) returns jsonb language sql as $$select jsonb_build_object('ok',true,'skipped','test_no_transport')$$;
    create or replace function public.preview_safe_commercial_action_v2(text,numeric,boolean default false,boolean default false,text default 'default',text default 'system',text default null) returns jsonb language sql as $$select jsonb_build_object('ok',true,'allowed',false,'decision','blocked','reason','test_policy_disabled','external_side_effect',false)$$;
  `);

  await db.exec(readFileSync('supabase/migrations/20260908193000_human_copilot_backend_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908194000_stage13_financial_reconciliation_v1.sql','utf8'));

  let ready=await j(`select public.human_copilot_readiness_v1() x`);
  assert.equal(ready.enabled,false);assert.equal(ready.provider_generation_enabled,false);assert.equal(n(ready.suggestions),0);
  let disabled=await j(`select public.preview_human_copilot_context_v1(gen_random_uuid(),gen_random_uuid()) x`);
  assert.equal(disabled.error,'human_copilot_context_disabled');
  let frec=await j(`select public.financial_reconciliation_readiness_v1() x`);
  assert.equal(frec.enabled,false);assert.equal(frec.external_event_recording_enabled,false);assert.equal(n(frec.external_events),0);
  disabled=await j(`select public.preview_financial_reconciliation_match_v1(gen_random_uuid()) x`);
  assert.equal(disabled.error,'financial_reconciliation_preview_disabled');

  const admin='11111111-1111-4111-8111-111111111111';
  const ids=await one(`
    with a as (insert into public.admin_users(user_id,role,is_active,display_name) values('${admin}','operator',true,'Operador') returning user_id),
    c as (insert into public.customers(name,order_count) values('Maria',2) returning id),
    cv as (insert into public.conversations(customer_id,mode,human_required,stage) select id,'human',true,'cart' from c returning id,customer_id),
    h as (insert into public.human_handoffs(conversation_id,customer_id,status,claimed_by,claimed_at,reason) select cv.id,cv.customer_id,'claimed','${admin}',now(),'cliente pediu humano' from cv returning id),
    p as (insert into public.products(name) values('Arroz 5kg') returning id),
    ca as (insert into public.carts(conversation_id,total) select cv.id,120.00 from cv returning id),
    ci as (insert into public.cart_items(cart_id,product_id,quantity,unit_price,line_total) select ca.id,p.id,2,60,120 from ca,p returning id),
    o as (insert into public.orders(customer_id,conversation_id,status,total,confirmed_at) select cv.customer_id,cv.id,'ready',120.00,now() from cv returning id),
    f as (insert into public.order_fiscal_controls(order_id,payment_status,fiscal_status) select o.id,'pending','blocked' from o returning order_id)
    select (select id from cv) conversation_id,(select id from o) order_id,(select id from h) handoff_id;
  `);
  await db.exec(`insert into public.messages(conversation_id,direction,message_type,body_text) values('${ids.conversation_id}','inbound','text','Quero confirmar meu pedido');
    update public.human_copilot_runtime_config set enabled=true,execution_mode='homologation',mode_switch_enabled=true,context_preview_enabled=true,deterministic_nba_enabled=true where id=1;`);

  const ctx=await j(`select public.preview_human_copilot_context_v1('${ids.conversation_id}','${admin}') x`);
  assert.equal(ctx.ok,true);assert.equal(ctx.customer.name,'Maria');assert.equal(n(ctx.cart.total),120);assert.equal(ctx.last_order.payment_status,'pending');
  const nba=await j(`select public.preview_human_copilot_nba_v1('${ids.conversation_id}','${admin}') x`);
  assert.equal(nba.ok,true);assert.equal(nba.recommended_action,'review_payment');assert.equal(nba.external_side_effect,false);
  const mode=await j(`select public.set_human_copilot_mode_v1('${ids.conversation_id}','${admin}',true) x`);assert.equal(mode.ok,true);assert.equal(mode.mode,'human_copilot');
  const reply=await j(`select public.queue_operator_reply_v1('${ids.conversation_id}','${admin}','Resposta do operador') x`);assert.equal(reply.ok,true);
  const conv=await one(`select mode from public.conversations where id='${ids.conversation_id}'`);assert.equal(conv.mode,'human_copilot');
  const suggestions=await one(`select count(*) c from public.human_copilot_suggestions`);assert.equal(n(suggestions.c),0);

  await db.exec(`
    update public.financial_runtime_config set enabled=true,execution_mode='homologation',external_event_recording_enabled=true,reconciliation_preview_enabled=true,reconciliation_recording_enabled=true,financial_admin_read_enabled=true where id=1;
    insert into public.financial_provider_adapters(adapter_key,provider,payment_method,ingest_mode,enabled,execution_mode) values('pix_fixture','fixture','pix','fixture',true,'homologation');
    insert into public.financial_payment_expectations(order_id,version_no,expected_method,expected_amount_cents,decision) values('${ids.order_id}',1,'pix',12000,'collect');
  `);
  const event=await j(`select public.record_financial_external_event_v1('pix_fixture','evt-001','payment_settled',12000,'BRL','${ids.order_id}','pix-ref-001',null,now(),'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{}') x`);assert.equal(event.ok,true);
  const match=await j(`select public.preview_financial_reconciliation_match_v1('${event.id}') x`);assert.equal(match.ok,true);assert.equal(match.decision,'matched');assert.equal(match.match_basis,'explicit_order_hint_exact_amount_method');
  const before=await one(`select count(*) c from public.financial_ledger_entries`);assert.equal(n(before.c),0);
  const evalr=await j(`select public.record_financial_reconciliation_evaluation_v1('${event.id}','eval-001') x`);assert.equal(evalr.ok,true);assert.equal(evalr.decision,'matched');
  const after=await one(`select count(*) c from public.financial_ledger_entries`);assert.equal(n(after.c),0,'reconciliation evaluation must never mutate ledger');

  const o2=await one(`insert into public.orders(status,total,confirmed_at) values('confirmed',120.00,now()) returning id`);
  await db.exec(`insert into public.financial_payment_expectations(order_id,version_no,expected_method,expected_amount_cents,decision) values('${o2.id}',1,'pix',12000,'collect');`);
  const weak=await j(`select public.record_financial_external_event_v1('pix_fixture','evt-002','payment_settled',12000,'BRL',null,null,null,now(),'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','{}') x`);assert.equal(weak.ok,true);
  const ambiguous=await j(`select public.preview_financial_reconciliation_match_v1('${weak.id}') x`);assert.equal(ambiguous.decision,'ambiguous');assert.ok(n(ambiguous.candidate_count)>=2);

  const dashboard=await j(`select public.get_financial_admin_dashboard_v1() x`);assert.equal(dashboard.ok,true);assert.equal(n(dashboard.metrics.external_events),2);
  const fiscal=await one(`select payment_status,fiscal_status from public.order_fiscal_controls where order_id='${ids.order_id}'`);assert.equal(fiscal.payment_status,'pending');assert.equal(fiscal.fiscal_status,'blocked');
  console.log('PASS: HUMAN_COPILOT mantém operador no controle; 13D reconcilia por preview sem alterar ledger/fiscal e trata ambiguidade fail-closed.');
}finally{await db.close()}
