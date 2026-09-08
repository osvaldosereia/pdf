import fs from 'node:fs';
import assert from 'node:assert/strict';

const migration=fs.readFileSync(new URL('../supabase/migrations/20260908062000_ai_action_registry_stage9_v1.sql',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../supabase/functions/admin-ai-action-registry-v1/index.ts',import.meta.url),'utf8');

for(const table of ['ai_action_registry','ai_action_policy_versions','ai_action_executions']){
  assert.match(migration,new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration,new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration,new RegExp(`revoke all on public\\.${table} from anon, authenticated`));
}
for(const action of ['get_customer','get_order','search_products','create_cart','change_delivery_address','cancel_order','reschedule_delivery','create_return','create_purchase_draft']){
  assert.match(migration,new RegExp(`'${action}'`));
}
assert.match(migration,/autonomy_level text not null default 'D' check \(autonomy_level in \('A','B','C','D'\)\)/);
assert.match(migration,/enabled boolean not null default false/);
assert.match(migration,/execution_mode text not null default 'off'/);
assert.match(migration,/human_handoff_open/);
assert.match(migration,/financial_limit_exceeded/);
assert.match(migration,/action_disabled/);
assert.match(edge,/runtime_activation_supported:false/);
assert.match(edge,/side_effect_performed:false/);
assert.match(edge,/não permite enabled\/execution_mode\/implementation_ref/);
assert.doesNotMatch(edge,/\.update\(\{[^}]*enabled:/s);
assert.doesNotMatch(edge,/execution_mode\s*:/);
assert.match(edge,/if\(!isOwner\)return json\(\{ok:false,error:"owner_required"\},403\)/);

console.log('OK stage9 AI Action Registry: server-only, fail-closed, simulator sem side effect e Admin sem ativação de runtime.');
