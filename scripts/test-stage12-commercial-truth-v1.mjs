import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql=fs.readFileSync('supabase/migrations/20260908130000_stage12_commercial_truth_foundation_v1.sql','utf8');
const adminSql=fs.readFileSync('supabase/migrations/20260908130100_stage12_commercial_truth_admin_safety_v2.sql','utf8');
const adminFn=fs.readFileSync('supabase/functions/admin-commercial-truth-v1/index.ts','utf8');
const sbConfig=fs.readFileSync('supabase/config.toml','utf8');
const executableSql=(sql+'\n'+adminSql).split('\n').filter(line=>!line.trim().startsWith('--')).join('\n');
for(const table of ['commercial_truth_runtime_config','inventory_lots','inventory_lot_movements','commercial_policy_versions','promotion_rules','margin_guard_events']){
  assert.match(sql,new RegExp(`create table if not exists public\\.${table}`));
  assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`));
}
for(const gate of ['enabled','lot_tracking_enabled','fefo_enforcement_enabled','expiry_block_enabled','promotions_enabled','benefits_enabled','margin_guard_enabled','reports_enabled']){
  assert.match(sql,new RegExp(`${gate} boolean not null default false`));
}
assert.match(sql,/execution_mode text not null default 'off'/);
assert.match(sql,/canary_percent smallint not null default 0/);
assert.match(sql,/preview_fefo_allocation_v1/);
assert.match(sql,/order by l\.expires_at nulls last,l\.received_at nulls last,l\.id/,'FEFO order must be deterministic');
assert.match(sql,/l\.physically_verified=true/,'FEFO must only use verified lots');
assert.match(sql,/l\.expires_at >= p_delivery_date \+ p_min_shelf_life_days/,'delivery shelf life compatibility missing');
assert.match(sql,/evaluate_margin_guard_v1/);
assert.match(sql,/below_minimum_margin/);
assert.match(sql,/preview_expiry_offer_v2/);
assert.match(sql,/no_active_expiry_policy/,'expiry discounts must require an active versioned policy');
assert.match(sql,/'applied',false/,'offer preview must never apply automatically');
assert.match(sql,/external_side_effect',false/);

assert.match(adminSql,/kill_commercial_truth_runtime_v1/);
assert.match(adminSql,/enabled=false/);
assert.match(adminSql,/execution_mode='off'/);
assert.match(adminSql,/canary_percent=0/);
assert.match(adminSql,/create_inventory_lot_draft_v1/);
assert.match(adminSql,/values\(p_product_id,code,p_expires_at,p_quantity_received,0,0,p_unit_cost,'draft',false/,'lot drafts must start unavailable and unverified');
assert.match(adminSql,/create_commercial_policy_draft_v1/);
assert.match(adminSql,/values\(keyv,next_version,'draft'/,'policy writes must remain draft-only');
assert.match(adminSql,/create_promotion_rule_draft_v1/);
assert.match(adminSql,/values\(codev,trim\(p_name\),typev,false,'off'/,'promotion drafts must stay disabled');
assert.match(adminSql,/stage12_admin_snapshot_v1/);

assert.match(sbConfig,/\[functions\.admin-commercial-truth-v1\][\s\S]*?verify_jwt\s*=\s*true/,'commercial truth admin API must require JWT');
assert.match(adminFn,/auth\.getUser\(token\)/);
assert.match(adminFn,/admin_users/);
assert.match(adminFn,/owner_required/);
assert.match(adminFn,/runtime_activation_supported:false/);
assert.match(adminFn,/promotion_activation_supported:false/);
assert.match(adminFn,/lot_verification_supported:false/);
assert.match(adminFn,/create_inventory_lot_draft_v1/);
assert.match(adminFn,/create_commercial_policy_draft_v1/);
assert.match(adminFn,/create_promotion_rule_draft_v1/);
assert.doesNotMatch(adminFn,/execution_mode\s*:\s*["']live["']/);
assert.doesNotMatch(adminFn,/enabled\s*:\s*true/);

assert.doesNotMatch(executableSql,/https?:\/\//i,'Stage 12 SQL must not call external APIs');
assert.doesNotMatch(executableSql,/make\.com|googleapis|bling\.com|api\.openai\.com/i,'Stage 12 foundation must remain deterministic and provider-free');
console.log('stage12 commercial truth + admin safety assertions: OK');
