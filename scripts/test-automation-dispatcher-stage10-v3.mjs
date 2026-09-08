import fs from 'node:fs';
import assert from 'node:assert/strict';

const dispatcher=fs.readFileSync('supabase/functions/automation-dispatcher-v1/index.ts','utf8');
const config=fs.readFileSync('supabase/config.toml','utf8');

assert.match(config,/\[functions\.automation-dispatcher-v1\][\s\S]*verify_jwt\s*=\s*true/,'dispatcher must require JWT');
assert.match(config,/\[functions\.admin-automation-builder-v1\][\s\S]*verify_jwt\s*=\s*true/,'builder must require JWT');
assert.match(dispatcher,/new Set\(\["observe","dry_run"\]\)/,'dispatcher must be limited to observe/dry_run');
assert.match(dispatcher,/mode_not_observe_or_dry_run/,'unsafe modes must fail closed');
assert.match(dispatcher,/workflow_disabled/,'disabled workflow must block');
assert.match(dispatcher,/kill_switch_on/,'kill switch must block');
assert.match(dispatcher,/human_handoff_open/,'open human handoff must block');
assert.match(dispatcher,/runs_per_hour_budget_exceeded/,'run budget must be revalidated');
assert.match(dispatcher,/simulate_automation_workflow_v1/,'dispatcher must revalidate through workflow simulator');
assert.match(dispatcher,/automation_workflow_executions/,'execution audit table missing');
assert.match(dispatcher,/automation_workflow_events/,'event audit table missing');
assert.match(dispatcher,/idempotency_key/,'idempotency guard missing');
assert.match(dispatcher,/external_side_effect:false/g,'dispatcher must hard-code no external side effects');
assert.match(dispatcher,/action_execution_supported:false/,'action execution must remain unsupported');
assert.match(dispatcher,/live_supported:false/,'live mode must remain unsupported');
assert.match(dispatcher,/openai_called:false/,'dispatcher cannot spend OpenAI');
assert.doesNotMatch(dispatcher,/fetch\s*\(\s*["'`]https?:\/\//,'dispatcher must not call external HTTP providers');
assert.doesNotMatch(dispatcher,/execution_mode\s*[:=]\s*["']live["']/,'dispatcher must never set live mode');

console.log('stage10 dispatcher guardrails: ok');
