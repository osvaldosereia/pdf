import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const migration=readFileSync('supabase/migrations/20260908174000_stage13_driver_financial_context_v1.sql','utf8');
const edge=readFileSync('supabase/functions/driver-logistics-v1/index.ts','utf8');
const app=readFileSync('driver-app/app.js','utf8');
const html=readFileSync('driver-app/index.html','utf8');
const config=readFileSync('driver-app/config.js','utf8');

for(const needle of [
  'driver_financial_context_enabled boolean not null default false',
  'driver_collection_recording_enabled boolean not null default false',
  'driver_delivery_financial_guard_enabled boolean not null default false',
  'create or replace function public.preview_driver_order_collection_v1',
  'create or replace function public.get_driver_route_snapshot_v2',
  'create or replace function public.driver_deliver_stop_v3',
  'public.record_payment_receipt_v1',
  "recognition:='operational_confirmed'",
  "recognition:='observed'",
  "'fiscal_payment_confirmed_by_driver',false",
  "'financial_review_required'",
  "'collection_required_before_delivery'",
  "'collection_amount_mismatch'",
  'revoke all on function public.driver_deliver_stop_v3',
  'grant execute on function public.driver_deliver_stop_v3'
]) assert.ok(migration.includes(needle),`missing migration contract: ${needle}`);

assert.ok(!/confirm_order_payment_v1\s*\(/.test(migration),'driver v3 must never call confirm_order_payment_v1');
assert.match(edge,/get_driver_route_snapshot_v2/);
assert.match(edge,/driver_deliver_stop_v3/);
assert.match(edge,/p_collection:collection/);
assert.doesNotMatch(edge,/p_payment_status/);
assert.doesNotMatch(edge,/p_settled_amount/);
assert.match(app,/Já pago/i);
assert.match(app,/Receber e entregar/);
assert.match(app,/aguardando conciliação/i);
assert.match(app,/change_required_cents/);
assert.match(html,/collectionSheet/);
assert.match(html,/nenhuma NF-e é liberada/i);
assert.match(config,/enabled:false/);
assert.match(config,/gpsEnabled:false/);

console.log('PASS: Stage 13C contract keeps Driver App financial context dormant, ledger-first and separated from fiscal confirmation.');
