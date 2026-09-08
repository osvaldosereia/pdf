import {readFileSync} from 'node:fs';

const path='supabase/migrations/20260908160000_stage12_benefits_guardrails_v1.sql';
const fixPath='supabase/migrations/20260908160100_stage12_benefits_guardrails_v1_conflict_fix.sql';
const sql=readFileSync(path,'utf8');
const fixSql=readFileSync(fixPath,'utf8');
const lower=sql.toLowerCase();
const combined=(sql+'\n'+fixSql).toLowerCase();

const required=[
  'benefit_preview_enabled boolean not null default false',
  'benefit_recording_enabled boolean not null default false',
  'benefit_reservation_enabled boolean not null default false',
  'benefit_apply_enabled boolean not null default false',
  'delivered_purchase_evidence_enabled boolean not null default false',
  'create table if not exists public.customer_benefit_evaluations',
  'create table if not exists public.customer_benefit_reservations',
  'customer_benefit_one_active_scope_year_idx',
  "where status in ('reserved','applied')",
  "o.status='delivered'",
  "o.delivered_at is not null",
  "scope_key:=case when pr.rule_type='birthday' then 'birthday'",
  "birthday_month_missing",
  "outside_birthday_month",
  "benefit_already_reserved_or_used_for_year",
  "promotion_budget_missing",
  "promotion_budget_insufficient",
  'evaluate_margin_guard_v1',
  'preview_fefo_allocation_v1',
  "'applied',false",
  "'budget_spent',false",
  "'order_mutated',false",
  "'stock_mutated',false",
  'revoke all on table public.customer_benefit_evaluations,public.customer_benefit_reservations from public,anon,authenticated',
  'grant execute on function public.customer_delivered_purchase_evidence_v1',
  'to service_role'
];
for(const needle of required){
  if(!lower.includes(needle.toLowerCase()))throw new Error(`missing_required_contract:${needle}`);
}
if(!fixSql.includes('target_year'))throw new Error('runtime_fix_must_use_non_conflicting_target_year');
if(!fixSql.includes('r.benefit_year=target_year'))throw new Error('runtime_fix_must_qualify_annual_limit_comparison');

const forbidden=[
  'update public.orders',
  'update public.order_items',
  'update public.inventory_lots',
  'update public.promotion_rules set spent_cents',
  'insert into public.bling_commands',
  'insert into public.delivery_notifications',
  'insert into public.outbound_jobs',
  'http_post',
  'net.http',
  'fetch(',
  'openai',
  'make.com',
  'graph.facebook.com',
  'apply_customer_benefit_v1',
  'create or replace function public.apply_customer_benefit',
  "set plpgsql.variable_conflict"
];
for(const needle of forbidden){
  if(combined.includes(needle))throw new Error(`forbidden_side_effect_or_privileged_contract:${needle}`);
}

if(/benefit_apply_enabled\s*=\s*true/i.test(sql))throw new Error('apply_gate_must_never_be_enabled_by_migration');
if(/benefits_enabled\s*=\s*true/i.test(sql))throw new Error('benefits_gate_must_never_be_enabled_by_migration');

console.log('PASS: Stage 12 benefits guardrails are server-only, dormant, annual/idempotent, budget+margin+FEFO guarded, contain no apply/order/stock/outbound executor, and require no privileged PL/pgSQL setting.');
