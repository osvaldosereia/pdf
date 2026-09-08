import fs from 'node:fs';
import assert from 'node:assert/strict';

const foundation=fs.readFileSync('supabase/migrations/20260908120000_stage12_commercial_truth_foundation_v1.sql','utf8');
const fefo=fs.readFileSync('supabase/migrations/20260908120100_stage12_fefo_margin_guard_v1.sql','utf8');
const benefits=fs.readFileSync('supabase/migrations/20260908120200_stage12_promotions_benefits_v1.sql','utf8');
const reports=fs.readFileSync('supabase/migrations/20260908120300_stage12_reports_recommendations_v1.sql','utf8');
const fn=fs.readFileSync('supabase/functions/admin-commercial-truth-v1/index.ts','utf8');
const config=fs.readFileSync('supabase/config.toml','utf8');
const adminConfig=fs.readFileSync('admin/config.js','utf8');
const adminHtml=fs.readFileSync('admin/index.html','utf8');
const adminJs=fs.readFileSync('admin-v3/commercial-truth.js','utf8');
const legacyWorkflow=fs.readFileSync('.github/workflows/processar-ofertas.yml','utf8');

for(const table of ['commercial_runtime_config','inventory_lots','inventory_lot_movements','inventory_lot_reservations','commercial_policy_versions','commercial_margin_policies','expiry_discount_rules','commercial_audit_events']){
  assert.match(foundation,new RegExp(`create table if not exists public\\.${table}`),`${table} missing`);
  assert.match(foundation,new RegExp(`alter table public\\.${table} enable row level security`),`${table} RLS missing`);
}
for(const table of ['promotion_campaigns','promotion_items','promotion_budget_events','commercial_coupons','commercial_benefit_policies','customer_benefit_grants']){
  assert.match(benefits,new RegExp(`create table if not exists public\\.${table}`),`${table} missing`);
  assert.match(benefits,new RegExp(`alter table public\\.${table} enable row level security`),`${table} RLS missing`);
}
for(const source of [foundation,fefo,benefits,reports])assert.doesNotMatch(source,/https?:\/\//i,'stage12 SQL must not call external HTTP');

assert.match(foundation,/enabled boolean not null default false/);
assert.match(foundation,/execution_mode text not null default 'off'/);
assert.match(foundation,/lot_truth_enabled boolean not null default false/);
assert.match(foundation,/lot_reservations_enabled boolean not null default false/);
assert.match(foundation,/fefo_enabled boolean not null default false/);
assert.match(foundation,/expiry_discount_enabled boolean not null default false/);
assert.match(foundation,/promotion_engine_enabled boolean not null default false/);
assert.match(foundation,/benefit_engine_enabled boolean not null default false/);
assert.match(foundation,/margin_guard_enforced boolean not null default false/);
assert.match(foundation,/legacy_offer_engine_allowed boolean not null default false/);
assert.match(foundation,/default_max_discount_percent numeric\(7,4\) not null default 0/);
assert.match(foundation,/promotion_budget_brl numeric\(14,2\) not null default 0/);
assert.match(foundation,/legacy_firebase_reference/,'legacy validity tiers should be preserved as draft reference');
assert.match(foundation,/\(1,3,7,50,'draft','legacy_firebase_reference'\)/);
assert.match(foundation,/kill_commercial_runtime_v1/);
assert.match(foundation,/legacy_offer_engine_allowed=false/);

assert.match(fefo,/preview_fefo_allocation_v1/);
assert.match(fefo,/order by expires_at asc nulls last/,'FEFO must use earliest expiry first');
assert.match(fefo,/physically_verified=true/,'FEFO lots must be physically verified');
assert.match(fefo,/fefo_reservations_disabled/,'reservation runtime must fail closed');
assert.match(fefo,/release_inventory_lot_reservation_v1/,'safe release path missing');
assert.match(fefo,/margin_guard_v1/);
assert.match(fefo,/below_cost/);
assert.match(fefo,/min_margin_percent_not_met/);
assert.match(fefo,/max_discount_exceeded/);
assert.match(fefo,/promotion_budget_exhausted/);
assert.match(fefo,/preview_expiry_offer_v2/);
assert.match(fefo,/expiry_discount_disabled/);

assert.match(benefits,/enabled boolean not null default false/g);
assert.match(benefits,/execution_mode text not null default 'off'/g);
assert.match(benefits,/create_promotion_item_draft_v1/);
assert.match(benefits,/preview_coupon_v1/);
assert.match(benefits,/coupon_runtime_disabled/);
assert.match(benefits,/preview_birthday_benefit_v1/);
assert.match(benefits,/birthday_benefit_runtime_disabled/);

assert.match(reports,/delivered_customer_product_stats_v1/);
assert.match(reports,/where o\.status='delivered'/,'recommendation truth must use delivered orders');
assert.match(reports,/get_customer_recommendations_commercial_v2/);
assert.match(reports,/commercial_product_eligibility_v1/);
assert.match(reports,/margin_guard_v1/);

assert.match(config,/\[functions\.admin-commercial-truth-v1\][\s\S]*?verify_jwt\s*=\s*true/,'commercial admin edge must require JWT');
assert.match(fn,/admin_users/);
assert.match(fn,/owner_required/);
assert.match(fn,/runtime_activation_supported:false/);
assert.match(fn,/legacy_offer_activation_supported:false/);
assert.match(fn,/automatic_offer_publication_supported:false/);
assert.match(fn,/legacy_offer_engine_allowed:false/);
assert.doesNotMatch(fn,/legacy_offer_engine_allowed\s*:\s*true/);
assert.doesNotMatch(fn,/execution_mode\s*:\s*["']live["']/);
assert.doesNotMatch(fn,/enabled\s*:\s*true/);

assert.match(adminConfig,/commercialTruthUiEnabled:\s*false/);
assert.match(adminHtml,/id="commercialTruthNav" class="nav hidden"/);
assert.match(adminHtml,/id="commercialTruthMount"/);
assert.match(adminJs,/Verdade comercial em modo dormente/);
assert.match(adminJs,/Simular sem efeitos/);
assert.match(adminJs,/Salvar política sem ativar/);

assert.match(legacyWorkflow,/LEGADO DESATIVADO/,'legacy offer workflow must remain explicitly disabled');
assert.doesNotMatch(legacyWorkflow,/\bschedule\s*:/,'legacy offer workflow must not have a schedule');
assert.doesNotMatch(legacyWorkflow,/repository_dispatch\s*:/,'legacy offer workflow must not accept repository dispatch');
assert.doesNotMatch(legacyWorkflow,/workflow_run\s*:/,'legacy offer workflow must not be chained automatically');

console.log('stage12 commercial truth safety assertions: OK');
