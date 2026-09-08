import fs from 'node:fs';
import assert from 'node:assert/strict';

const sql1=fs.readFileSync('supabase/migrations/20260908200000_stage13_financial_projection_policy_v1.sql','utf8');
const sql2=fs.readFileSync('supabase/migrations/20260908201000_stage13_financial_policy_admin_hardening_v2.sql','utf8');
const financialFn=fs.readFileSync('supabase/functions/admin-financial-v1/index.ts','utf8');
const policyFn=fs.readFileSync('supabase/functions/admin-financial-policy-v1/index.ts','utf8');
const financialUi=fs.readFileSync('admin-v3/financial-admin.js','utf8');
const policyUi=fs.readFileSync('admin-v3/financial-policy-admin.js','utf8');
const config=fs.readFileSync('admin/config.js','utf8');
const batch=fs.readFileSync('scripts/run-stage13-financial-batch-audit-v1.mjs','utf8');

assert.match(config,/financialAdminUiEnabled:\s*false/,'financial UI must remain OFF');
for(const gate of ['fiscal_projection_preview_enabled','fiscal_projection_recording_enabled','fiscal_projection_apply_enabled','financial_policy_preview_enabled']){
  assert.match(sql1,new RegExp(`${gate} boolean not null default false`));
}
assert.match(sql2,/financial_policy_write_enabled boolean not null default false/);
assert.match(sql1,/status text not null default 'draft'/);
assert.match(sql1,/allow_apply boolean not null default false/);
assert.match(sql1,/external_side_effect boolean not null default false check \(external_side_effect=false\)/);
assert.match(sql2,/financial_policy_events_append_only/);
assert.match(sql2,/security invoker/);
assert.match(sql2,/a\.role='owner'/);
assert.match(sql2,/reconciled_external_reference_missing/);
assert.match(sql2,/payment_method not in \('cash'\)/);
assert.match(sql1,/recognition_status='reconciled'/);
assert.match(sql1,/open_reconciliation_case/);
assert.match(sql1,/delivery_not_confirmed/);
assert.match(sql1,/approved_apply_policy_required/);
assert.match(sql1,/projection_state_changed/);
assert.match(sql1,/projection_policy_changed/);
assert.match(sql2,/projection_apply_not_fiscal_ready/);
assert.match(sql1,/confirm_order_payment_v1/,'projection must reuse the existing deterministic fiscal payment gate');
assert.doesNotMatch(sql1,/bling|sefaz|https?:\/\//i,'projection SQL must not call external fiscal/provider transports');
assert.doesNotMatch(sql2,/bling|sefaz|https?:\/\//i,'policy SQL must not call external transports');
assert.doesNotMatch(sql1,/insert into public\.financial_ledger_entries/i,'projection must not fabricate ledger events');
assert.doesNotMatch(sql2,/insert into public\.financial_ledger_entries/i,'policy admin must not write ledger');

// 13D boundary must stay read-only even after 13E.
assert.doesNotMatch(financialFn,/create_financial_policy|approve_financial_policy|retire_financial_policy|apply_financial_fiscal_projection|confirm_order_payment|record_payment/i);
assert.match(financialFn,/get_financial_admin_dashboard_v1/);
assert.match(financialFn,/get_financial_admin_order_v1/);

// Policy endpoint can only manage policy/preview. It cannot apply payment/fiscal or ingest providers.
assert.match(policyFn,/admin\.role!=="owner"/);
assert.match(policyFn,/create_financial_policy_draft_v1/);
assert.match(policyFn,/approve_financial_policy_v1/);
assert.match(policyFn,/retire_financial_policy_v1/);
assert.doesNotMatch(policyFn,/apply_financial_fiscal_projection_v1|confirm_order_payment_v1|record_payment_receipt|record_financial_external_event|bling|sefaz|openai|gemini/i);
assert.match(policyFn,/Deliberadamente ausentes: apply_projection/);

assert.match(financialUi,/financialPolicyAdminMount/);
assert.match(policyUi,/Criar draft/);
assert.match(policyUi,/Aprovar/);
assert.doesNotMatch(policyUi,/apply_projection|confirm_order_payment|emitir|bling|sefaz/i,'Admin policy UI must not expose financial/fiscal execution');

assert.match(batch,/preview_financial_reconciliation_batch_v1/);
assert.match(batch,/preview_financial_projection_batch_v1/);
assert.doesNotMatch(batch,/record_|apply_|confirm_order_payment|insert|update|delete/i,'batch audit must be read-only');

console.log('PASS: Stage 13E keeps policy/admin/batch governance OFF-by-default and separates read-only audit from deterministic fiscal projection apply.');
