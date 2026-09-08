import fs from 'node:fs';
import assert from 'node:assert/strict';

const migration=fs.readFileSync('supabase/migrations/20260908070000_automation_engine_stage10_v1.sql','utf8');
const fn=fs.readFileSync('supabase/functions/admin-automation-builder-v1/index.ts','utf8');

for(const table of ['automation_workflows','automation_workflow_versions','automation_workflow_executions','automation_workflow_events']){
  assert.match(migration,new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`));
}
assert.match(migration,/enabled boolean not null default false/);
assert.match(migration,/execution_mode text not null default 'off'/);
assert.match(migration,/kill_switch boolean not null default true/);
assert.match(migration,/canary_percent smallint not null default 0/);
assert.match(migration,/github_action/);
assert.match(migration,/make_requires_justification/);
assert.match(migration,/simulate_ai_action_v1/);
assert.match(migration,/side_effects_performed',false/);
assert.match(migration,/revoke all on public\.automation_workflows from anon, authenticated/);
assert.match(migration,/grant execute on function public\.simulate_automation_workflow_v1.*to service_role/s);

assert.match(fn,/verify_jwt/,{message:'function source should be deployed with verify_jwt externally'});
assert.doesNotMatch(fn,/enabled\s*:\s*true/);
assert.doesNotMatch(fn,/execution_mode\s*:\s*["']live["']/);
assert.match(fn,/enabled:false,execution_mode:"off",kill_switch:true,canary_percent:0/);
assert.match(fn,/runtime_activation_supported:false/);
assert.match(fn,/owner_required/);
assert.match(fn,/make_requires_justification/);
assert.match(fn,/side_effect_performed:false/);
assert.match(fn,/update\(\{enabled:false,execution_mode:"off",kill_switch:true,canary_percent:0/);

console.log('stage10 automation engine safety assertions: OK');
