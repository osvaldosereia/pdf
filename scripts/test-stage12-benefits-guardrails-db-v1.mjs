import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async q=>(await db.query(q)).rows?.[0]||null;
try{
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create table public.commercial_truth_runtime_config(
      id smallint primary key check(id=1),enabled boolean not null default false,
      execution_mode text not null default 'off',benefits_enabled boolean not null default false,
      canary_percent smallint not null default 0
    );
    insert into public.commercial_truth_runtime_config(id) values(1);
    create table public.customers(
      id uuid primary key default gen_random_uuid(),birthday_day smallint,birthday_month smallint,is_active boolean not null default true
    );
    create table public.products(
      id uuid primary key default gen_random_uuid(),cost numeric,is_active boolean not null default true
    );
    create table public.promotion_rules(
      id uuid primary key default gen_random_uuid(),code text not null unique,name text not null,rule_type text not null,
      enabled boolean not null default false,execution_mode text not null default 'off',priority integer not null default 100,
      conditions jsonb not null default '{}',benefit jsonb not null default '{}',budget_cents bigint,spent_cents bigint not null default 0,
      starts_at timestamptz,ends_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
    );
    create table public.orders(
      id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),status text not null,
      delivered_at timestamptz,created_at timestamptz not null default now()
    );
    create table public.order_items(
      id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),product_id uuid references public.products(id),
      quantity numeric not null,sku_snapshot text,name_snapshot text not null
    );
    create or replace function public.evaluate_margin_guard_v1(
      p_gross_revenue numeric,p_estimated_cost numeric,p_proposed_discount numeric default 0,p_minimum_margin_percent numeric default 0
    ) returns jsonb language plpgsql immutable as $$
    declare net numeric:=p_gross_revenue-p_proposed_discount; margin_amount numeric; margin_pct numeric; decision text; reason text;
    begin
      margin_amount:=net-p_estimated_cost;
      margin_pct:=case when net=0 then null else round((margin_amount/net)*100,4) end;
      if net<=0 then decision:='block';reason:='zero_net_revenue';
      elsif margin_amount<0 then decision:='block';reason:='negative_margin';
      elsif margin_pct<p_minimum_margin_percent then decision:='block';reason:='below_minimum_margin';
      else decision:='allow';reason:=null;end if;
      return jsonb_build_object('ok',true,'decision',decision,'reason',reason,'margin_percent',margin_pct,'net_revenue',net,'margin_amount',margin_amount);
    end;$$;
    create or replace function public.preview_fefo_allocation_v1(
      p_product_id uuid,p_quantity numeric,p_delivery_date date,p_min_shelf_life_days integer default 0
    ) returns jsonb language sql as $$
      select jsonb_build_object('ok',true,'product_id',p_product_id,'requested_quantity',p_quantity,'sufficient',exists(select 1 from public.products where id=p_product_id and is_active=true),'lines','[]'::jsonb,'external_side_effect',false);
    $$;
  `);
  await db.exec(readFileSync('supabase/migrations/20260908160000_stage12_benefits_guardrails_v1.sql','utf8'));

  let r=await one(`select public.stage12_benefits_readiness_v1() x`);
  for(const k of ['enabled','benefits_enabled','benefit_preview_enabled','benefit_recording_enabled','benefit_reservation_enabled','benefit_apply_enabled','delivered_purchase_evidence_enabled'])if(r.x[k]!==false)throw new Error(`unsafe_default_${k}`);
  if(r.x.execution_mode!=='off'||Number(r.x.canary_percent)!==0)throw new Error('unsafe_runtime_default');

  const customer=(await one(`insert into public.customers(birthday_day,birthday_month) values(10,9) returning id`)).id;
  const product=(await one(`insert into public.products(cost,is_active) values(8,true) returning id`)).id;
  await db.exec(`
    insert into public.orders(customer_id,status,delivered_at) values('${customer}','confirmed',null);
    with o as (insert into public.orders(customer_id,status,delivered_at) values('${customer}','delivered','2026-09-01T12:00:00Z') returning id)
      insert into public.order_items(order_id,product_id,quantity,sku_snapshot,name_snapshot) select id,'${product}',2,'SKU1','Produto teste' from o;
  `);

  r=await one(`select public.preview_customer_benefit_v1('${customer}',gen_random_uuid(),'2026-09-15','2026-09-16',10000,6000) x`);
  if(r.x.error!=='benefit_preview_disabled')throw new Error('benefit_preview_must_fail_closed');
  r=await one(`select public.customer_delivered_purchase_evidence_v1('${customer}',null,20) x`);
  if(r.x.error!=='delivered_purchase_evidence_disabled')throw new Error('purchase_evidence_must_fail_closed');

  await db.exec(`update public.commercial_truth_runtime_config set enabled=true,execution_mode='observe',benefits_enabled=true,benefit_preview_enabled=true,delivered_purchase_evidence_enabled=true where id=1`);
  r=await one(`select public.customer_delivered_purchase_evidence_v1('${customer}',null,20) x`);
  if(r.x.ok!==true||Number(r.x.delivered_order_count)!==1||Number(r.x.delivered_item_units)!==2)throw new Error('delivered_purchase_evidence_failed');
  if(r.x.evidence.some(x=>x.delivered_at==null))throw new Error('non_delivered_order_leaked_into_evidence');

  const birthday=(await one(`insert into public.promotion_rules(code,name,rule_type,enabled,execution_mode,conditions,benefit,budget_cents,spent_cents)
    values('BDAY10','Aniversario 10','birthday',true,'observe','{"minimum_margin_percent":20,"require_delivered_purchase":true}','{"kind":"discount_percent","value_percent":10}',5000,0) returning id`)).id;
  r=await one(`select public.preview_customer_benefit_v1('${customer}','${birthday}','2026-09-15','2026-09-16',10000,6000) x`);
  if(r.x.ok!==true||r.x.decision!=='allow'||r.x.benefit_scope_key!=='birthday'||Number(r.x.benefit.discount_cents)!==1000||Number(r.x.budget.remaining_cents)!==5000||r.x.applied!==false)throw new Error('birthday_allow_preview_failed');
  if(r.x.margin_guard.decision!=='allow')throw new Error('birthday_margin_guard_should_allow');

  r=await one(`select public.preview_customer_benefit_v1('${customer}','${birthday}','2026-08-15','2026-08-16',10000,6000) x`);
  if(r.x.decision!=='block'||r.x.reason!=='outside_birthday_month')throw new Error('birthday_month_guard_failed');

  r=await one(`select public.preview_customer_benefit_v1('${customer}','${birthday}','2026-09-15','2026-09-16',10000,8500) x`);
  if(r.x.decision!=='block'||r.x.reason!=='margin_guard_block')throw new Error('margin_guard_block_failed');

  const lowBudget=(await one(`insert into public.promotion_rules(code,name,rule_type,enabled,execution_mode,conditions,benefit,budget_cents,spent_cents)
    values('CPLOW','Cupom baixo','coupon',true,'observe','{"minimum_margin_percent":10}','{"kind":"discount_fixed","value_cents":1500}',1000,0) returning id`)).id;
  r=await one(`select public.preview_customer_benefit_v1('${customer}','${lowBudget}','2026-09-15','2026-09-16',10000,5000) x`);
  if(r.x.decision!=='block'||r.x.reason!=='promotion_budget_insufficient')throw new Error('budget_insufficient_guard_failed');

  const noBudget=(await one(`insert into public.promotion_rules(code,name,rule_type,enabled,execution_mode,conditions,benefit,budget_cents,spent_cents)
    values('CPNOB','Cupom sem budget','coupon',true,'observe','{"minimum_margin_percent":10}','{"kind":"discount_fixed","value_cents":500}',null,0) returning id`)).id;
  r=await one(`select public.preview_customer_benefit_v1('${customer}','${noBudget}','2026-09-15','2026-09-16',10000,5000) x`);
  if(r.x.decision!=='review'||r.x.reason!=='promotion_budget_missing')throw new Error('missing_budget_must_review');

  const giftProduct=(await one(`insert into public.products(cost,is_active) values(5,true) returning id`)).id;
  const giftRule=(await one(`insert into public.promotion_rules(code,name,rule_type,enabled,execution_mode,conditions,benefit,budget_cents,spent_cents)
    values('GIFT1','Brinde','gift',true,'observe','{"minimum_margin_percent":20,"min_shelf_life_days":5}','{"kind":"gift_product","product_id":"${giftProduct}","quantity":1}',3000,0) returning id`)).id;
  r=await one(`select public.preview_customer_benefit_v1('${customer}','${giftRule}','2026-09-15','2026-09-16',10000,5000) x`);
  if(r.x.decision!=='allow'||r.x.gift_inventory.sufficient!==true||r.x.benefit.gift_product_id!==giftProduct)throw new Error('gift_fefo_preview_failed');

  r=await one(`select public.reserve_customer_benefit_v1('${customer}','${birthday}','2026-09-15','2026-09-16',10000,6000,'reserve:bday:000001') x`);
  if(r.x.error!=='benefit_reservation_disabled')throw new Error('reservation_must_fail_closed');
  await db.exec(`update public.commercial_truth_runtime_config set execution_mode='homologation',benefit_reservation_enabled=true where id=1`);
  r=await one(`select public.reserve_customer_benefit_v1('${customer}','${birthday}','2026-09-15','2026-09-16',10000,6000,'reserve:bday:000001') x`);
  if(r.x.ok!==true||r.x.reserved!==true||r.x.status!=='reserved'||r.x.budget_spent!==false||r.x.order_mutated!==false||r.x.stock_mutated!==false||r.x.applied!==false)throw new Error('safe_reservation_failed');
  r=await one(`select public.reserve_customer_benefit_v1('${customer}','${birthday}','2026-09-15','2026-09-16',10000,6000,'reserve:bday:000001') x`);
  if(r.x.replay!==true)throw new Error('reservation_idempotency_failed');
  r=await one(`select public.preview_customer_benefit_v1('${customer}','${birthday}','2026-09-20','2026-09-21',10000,6000) x`);
  if(r.x.decision!=='block'||r.x.reason!=='benefit_already_reserved_or_used_for_year')throw new Error('birthday_annual_limit_failed');

  const state=await one(`select spent_cents from public.promotion_rules where id='${birthday}'`);
  if(Number(state.spent_cents)!==0)throw new Error('reservation_must_not_spend_budget');
  const counts=await one(`select (select count(*)::int from public.customer_benefit_reservations) reservations,(select count(*)::int from public.customer_benefit_evaluations) evaluations`);
  if(Number(counts.reservations)!==1||Number(counts.evaluations)!==0)throw new Error('unexpected_benefit_audit_counts');

  console.log('PASS: birthday/coupon/gift eligibility, delivered-purchase evidence, margin, budget, FEFO, annual limit and reservation idempotency are deterministic and side-effect-safe.');
}finally{await db.close();}
