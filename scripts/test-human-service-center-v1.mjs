import fs from 'node:fs';
import assert from 'node:assert/strict';

const config=fs.readFileSync('admin/config.js','utf8');
const center=fs.readFileSync('admin-v3/human-service-center.js','utf8');
const css=fs.readFileSync('admin-v3/human-service-center.css','utf8');
const api=fs.readFileSync('supabase/functions/admin-whatsapp-ops-v1/index.ts','utf8');
const doc=fs.readFileSync('docs/CENTRAL-ATENDIMENTO-HUMANO-COPILOTO-IA-2026-09-08.md','utf8');

assert.match(config,/humanServiceCenterUiEnabled:\s*false/,'service center must be OFF by default');
assert.match(config,/humanCopilotEnabled:\s*false/,'copilot must be OFF by default');
assert.match(config,/if\(!cfg\?\.humanServiceCenterUiEnabled\)return/,'loader must fail closed');
assert.match(center,/api\('claim_handoff'/,'claim must use existing governed API');
assert.match(center,/api\('operator_reply'/,'reply must use existing governed API');
assert.match(center,/api\('resolve_handoff'/,'resolve must use existing governed API');
assert.doesNotMatch(center,/api\('resume_ai'/,'human center must never auto-resume AI');
assert.match(center,/row\?\.handoff_status==='claimed'.*row\.claimed_by===state\.user\?\.id.*row\.mode==='human'/s,'composer must require claimed ownership + human mode');
assert.match(center,/Nenhum envio automático do copiloto/);
assert.match(center,/Copiloto dormente/);
assert.doesNotMatch(center,/openai|responses\.create|chat\.completions|gemini/i,'foundation must not call an AI provider');
assert.doesNotMatch(center,/configure_release|canary_percent|whatsapp_flow|bling_order_sync/i,'UI must not mutate rollout gates');
assert.match(css,/grid-template-columns:minmax\(230px,28%\) minmax\(360px,1fr\) minmax\(250px,30%\)/,'desktop must use three-column service center');
assert.match(css,/@media\(max-width:760px\)/,'mobile adaptation missing');

assert.match(api,/if \(action === "operator_reply"\)/);
assert.match(api,/queue_operator_reply_v1/);
assert.match(api,/if \(action === "claim_handoff"\)/);
assert.match(api,/if \(action === "resolve_handoff"\)/);

for(const mode of ['`AI`','`HUMAN`','`HUMAN_COPILOT`'])assert.match(doc,new RegExp(mode.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
assert.match(doc,/Humano tem precedência absoluta sobre IA, Flow e automações/);
assert.match(doc,/WhatsApp `live=1%`/);
assert.match(doc,/não cria um sistema paralelo|não criar um sistema paralelo/i);

console.log('PASS: Central humana usa Inbox/API existentes, composer explícito e copiloto dormente, sem alterar rollout ou introduzir provider IA.');
