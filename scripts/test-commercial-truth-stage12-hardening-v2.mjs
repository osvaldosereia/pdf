import fs from 'node:fs';
import assert from 'node:assert/strict';

const expiry=fs.readFileSync('supabase/migrations/20260908120500_stage12_fefo_expiry_idempotency_v3.sql','utf8');
const replay=fs.readFileSync('supabase/migrations/20260908120600_stage12_reservation_idempotency_fix_v4.sql','utf8');
const edge=fs.readFileSync('supabase/functions/admin-commercial-truth-v1/index.ts','utf8');

for(const source of [expiry,replay])assert.doesNotMatch(source,/https?:\/\//i,'hardening SQL must not call external HTTP');
assert.match(expiry,/expiry_handling text not null default 'unknown'/);
assert.match(expiry,/expiry_handling in \('unknown','known','not_required'\)/);
assert.match(expiry,/physically_verified=true and l\.expiry_handling in \('known','not_required'\)/,'sellable lot stock must exclude unverified/unknown expiry');
assert.match(expiry,/unverified_or_unknown_quantity/);
assert.match(expiry,/unknown_expiry_excluded',true/);
assert.match(expiry,/order by case when expiry_handling='known' then 0 else 1 end,expires_at asc nulls last/,'FEFO must prefer known nearest expiry and put non-expiring last');
assert.match(expiry,/max_verified_unit_cost/);
assert.match(expiry,/cost_source:='product_and_verified_lots'/);
assert.match(expiry,/commercial_turnover_report_v1/);
assert.match(expiry,/where o\.status='delivered'/,'turnover must use delivered orders only');
assert.match(replay,/idempotency_conflict/);
assert.match(replay,/reservation_key_corrupted/);
assert.doesNotMatch(replay,/min\(product_id\)|min\(order_id\)/,'UUID aggregates min/max must not be used');
assert.match(replay,/existing_quantity<>p_quantity/,'idempotency replay must bind quantity');
assert.match(edge,/expiryHandling=expiresAt\?"known":requestedExpiryHandling==="not_required"\?"not_required":"unknown"/);
assert.match(edge,/stock_truth_changed:false/);
assert.doesNotMatch(edge,/physically_verified:true/,'Admin drafts must not self-verify a lot');
console.log('stage12 hardening safety assertions: OK');
