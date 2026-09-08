import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql=fs.readFileSync('supabase/migrations/20260908130000_stage12_commercial_truth_foundation_v1.sql','utf8');
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
assert.doesNotMatch(sql,/https?:\/\//i,'Stage 12 SQL must not call external APIs');
assert.doesNotMatch(sql,/openai|make\.com|googleapis|bling\.com/i,'Stage 12 foundation must remain deterministic and provider-free');
console.log('stage12 commercial truth safety assertions: OK');
