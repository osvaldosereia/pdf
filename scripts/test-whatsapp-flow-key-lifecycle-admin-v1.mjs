import {readFileSync} from 'node:fs';

const ui=readFileSync('admin-v3/experience-orchestrator.js','utf8');
const backend=readFileSync('supabase/functions/admin-whatsapp-flow-v1/index.ts','utf8');
const config=readFileSync('admin/config.js','utf8');
const must=(condition,message)=>{if(!condition)throw new Error(message)};

must(/experienceOrchestratorUiEnabled:\s*false/.test(config),'orchestrator_ui_must_remain_dormant');
must(/admin-whatsapp-flow-v1/.test(ui),'ui_must_use_flow_admin_endpoint');
must(/GERAR_CHAVE_FLOW/.test(ui)&&/GERAR_CHAVE_FLOW/.test(backend),'key_rotation_must_require_literal_confirmation');
must(/data-flow-key-generate/.test(ui),'owner_key_control_missing');
must(/data-flow-copy-public/.test(ui),'public_key_copy_control_missing');
must(/data-flow-disable/.test(ui)&&/disable_transport/.test(ui),'safe_disable_control_missing');
must(!/enable_transport|enable_flow|ativar_transporte/i.test(ui),'ui_must_not_offer_transport_enable_action');
must(!/whatsapp_flow_(?:data_exchange|send)_enabled\s*:\s*true/i.test(ui),'ui_must_not_enable_flow_flags');
must(/public_key_pem/.test(ui),'ui_should_render_only_public_key_material');
must(/data\.private_key_pem\|\|data\.privateKey\|\|data\.private_key_returned!==false/.test(ui),'ui_must_fail_closed_if_private_key_leaks');
must(!/lastFlow\?\.config\?\.private_key|config\.private_key|readiness\.private_key_pem/.test(ui),'ui_must_not_render_private_key_material');

must(/if\(admin\.role!=="owner"\)return json\(\{ok:false,error:"owner_required"\},403\)/.test(backend),'backend_key_mutations_must_be_owner_only');
must(/runtime\.whatsapp_flow_data_exchange_enabled\|\|runtime\.whatsapp_flow_send_enabled/.test(backend),'backend_must_block_rotation_while_transport_enabled');
must(/pair\.privateKeyPem=""/.test(backend),'backend_must_clear_private_key_reference_after_vault_install');
must(/private_key_returned:false/.test(backend),'backend_must_attest_private_key_not_returned');
must(!/action==="enable_transport"|action==="enable_flow"/.test(backend),'backend_must_not_expose_enable_action');
must(/whatsapp_flow_data_exchange_enabled:false,whatsapp_flow_send_enabled:false/.test(backend),'disable_action_must_only_close_runtime');

console.log('PASS: Flow key lifecycle is owner-only, private-key non-rendering, explicit-confirmation, runtime-off-by-default, and exposes no transport enable action.');
