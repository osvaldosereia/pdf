import fs from 'node:fs';
import assert from 'node:assert/strict';

const copilotSql=fs.readFileSync('supabase/migrations/20260908193000_human_copilot_backend_v1.sql','utf8');
const financialSql=fs.readFileSync('supabase/migrations/20260908194000_stage13_financial_reconciliation_v1.sql','utf8');
const copilotFn=fs.readFileSync('supabase/functions/admin-human-copilot-v1/index.ts','utf8');
const financialFn=fs.readFileSync('supabase/functions/admin-financial-v1/index.ts','utf8');
const config=fs.readFileSync('admin/config.js','utf8');
const panel=fs.readFileSync('admin-v3/human-copilot-panel.js','utf8');
const financialUi=fs.readFileSync('admin-v3/financial-admin.js','utf8');

assert.match(config,/humanServiceCenterUiEnabled:\s*false/);
assert.match(config,/humanCopilotEnabled:\s*false/);
assert.match(config,/financialAdminUiEnabled:\s*false/);
assert.match(config,/humanCopilotEdgeFunction:\s*'admin-human-copilot-v1'/);
assert.match(config,/financialEdgeFunction:\s*'admin-financial-v1'/);

assert.match(copilotSql,/mode in \('ai','human','human_copilot','paused'\)/);
assert.match(copilotSql,/provider_generation_enabled boolean not null default false/);
assert.match(copilotSql,/suggestion_recording_enabled boolean not null default false/);
assert.match(copilotSql,/external_side_effect boolean not null default false check \(external_side_effect=false\)/);
assert.match(copilotSql,/v_conv\.mode not in \('human','human_copilot'\)/);
assert.match(copilotSql,/allowed_during_handoff/);
assert.doesNotMatch(copilotFn,/api\.openai\.com|responses|chat\.completions|gemini/i,'copilot v1 must not call any AI provider');
assert.doesNotMatch(copilotFn,/operator_reply|queue_operator_reply|dispatch_operator_reply/i,'copilot API must never send to customer');
assert.match(copilotFn,/auto_send:false/);
assert.match(panel,/Inserir no campo/);
assert.match(panel,/Nenhuma sugestão é enviada automaticamente/);
assert.doesNotMatch(panel,/operator_reply|hscSend\.click|\.submit\(/i,'panel must not send or submit');

for(const gate of ['external_event_recording_enabled','reconciliation_preview_enabled','reconciliation_recording_enabled','financial_admin_read_enabled','batch_reconciliation_audit_enabled']){
  assert.match(financialSql,new RegExp(`${gate} boolean not null default false`));
}
assert.match(financialSql,/decision in \('matched','unmatched','ambiguous','review_required'\)/);
assert.match(financialSql,/deterministic boolean not null default true check \(deterministic=true\)/);
assert.doesNotMatch(financialSql,/insert into public\.financial_ledger_entries/i,'13D matcher must not write ledger');
assert.doesNotMatch(financialSql,/update public\.order_fiscal_controls/i,'13D matcher must not mutate fiscal controls');
assert.doesNotMatch(financialSql,/confirm_order_payment_v1/i,'13D must not confirm payment fiscal');
assert.doesNotMatch(financialFn,/record_financial_external_event|record_financial_reconciliation|fetch\(.*provider|bling|openai/i,'financial admin API must be read-only and provider-free');
assert.match(financialFn,/get_financial_admin_dashboard_v1/);
assert.match(financialFn,/get_financial_admin_order_v1/);
assert.doesNotMatch(financialUi,/record_|reconcile|confirm_order_payment|bling/i,'financial UI v1 must be read-only');

console.log('PASS: Stage 13D + HUMAN_COPILOT remain OFF, read/preview-first, provider-free and unable to send or mutate ledger/fiscal state.');
