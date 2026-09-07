import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=p=>fs.readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const main=read('supabase/migrations/20260907213000_whatsapp_operational_release_v1.sql');
const fix=read('supabase/migrations/20260907213100_whatsapp_operational_release_v1_fix.sql');
const hard=read('supabase/migrations/20260907213200_whatsapp_operational_release_v1_dispatch_hardening.sql');
const providerVault=read('supabase/migrations/20260907223000_conversation_worker_provider_vault_v1.sql');
const worker=read('supabase/functions/conversation-worker-v2/index.ts');
const adminEdge=read('supabase/functions/admin-whatsapp-ops-v1/index.ts');
const adminHtml=read('admin/index.html');
const adminJs=read('admin-v3/whatsapp-ops.js');
const config=read('supabase/config.toml');
const nodeCore=read('scripts/lib/conversation-core-v1.mjs');

function has(text,pattern,message){assert.match(text,pattern,message)}

test('deploy defaults remain closed and observe can never auto-reply',()=>{
  has(main,/conversation_worker_dispatch_enabled boolean not null default false/,'dispatcher must be closed by default');
  has(main,/whatsapp_live_canary_percent smallint not null default 0/,'live canary must start at zero');
  has(main,/whatsapp_release_mode in \('off','observe'\) and whatsapp_auto_reply_enabled/,'DB must reject auto reply in off/observe');
  has(main,/set conversation_worker_dispatch_enabled=false,[\s\S]*whatsapp_live_canary_percent=0/,'migration must finish with dispatcher/canary closed when not already live');
});

test('gradual release ingests non-canary traffic but sends it to human control',()=>{
  has(main,/observe_human_only/);
  has(main,/live_canary_human_control/);
  has(main,/live_new_conversation_cap_human_control/);
  has(main,/auto_reply_allowed',false/);
  has(main,/queue_human_handoff_v1/);
  has(main,/Atendimento retido pela liberação gradual/);
  has(main,/jsonb_set\(v_result,'\{should_reply\}','false'/);
});

test('live release requires explicit server-side confirmation and canary',()=>{
  has(main,/LIBERAR_ATENDIMENTO_REAL/);
  has(main,/live_confirmation_required/);
  has(main,/p_canary_percent<1 or p_canary_percent>100/);
  has(main,/whatsapp_live_max_new_conversations_per_hour/);
  has(main,/whatsapp_live_max_ai_jobs_per_hour/);
  has(main,/whatsapp_live_max_outbound_per_hour/);
});

test('worker dispatch is exact-id, event-driven and does not blindly replay processing jobs',()=>{
  has(main,/dispatch_conversation_worker_job_v2/);
  has(main,/net\.http_post/);
  has(main,/conversation-worker-v2/);
  has(fix,/p_expected_job_id is null or a\.id=p_expected_job_id/);
  has(fix,/status='processing'[\s\S]*lease_expired_review_required/);
  assert.doesNotMatch(fix,/status='pending'[^;]*lease_expired_review_required/,'expired paid lease must never return to pending');
  has(hard,/timeout_milliseconds:=120000/);
});

test('human-mode media stays held rather than waking AI',()=>{
  has(hard,/v_mode='ai' then 'pending' else 'held'/);
});

test('budgets and outbound guard fall back to human',()=>{
  has(main,/ai_daily_input_tokens_soft_limit/);
  has(main,/ai_daily_output_tokens_soft_limit/);
  has(main,/ai_hourly_cap_human_required/);
  has(main,/ai_daily_token_budget_human_required/);
  has(main,/outbound_hourly_cap_human_required/);
  has(main,/guard_whatsapp_ai_outbound_rate_v1/);
});

test('edge worker authenticates internally and processes exactly one claimed job',()=>{
  has(worker,/x-da-worker-key/);
  has(worker,/conversation_worker_webhook_v2/);
  has(worker,/job_id_required/);
  has(worker,/claim_conversation_job_v2/);
  has(worker,/p_expected_job_id: expectedJobId/);
  has(worker,/completion_uncertain_review_required/);
  has(worker,/gpt-4o-mini-transcribe/);
  has(worker,/gpt-4o-mini/);
  has(worker,/detail: "low"/);
});

test('provider secret is Vault-backed, service-role only and health exposes only configured boolean',()=>{
  has(providerVault,/vault\.create_secret/);
  has(providerVault,/vault\.update_secret/);
  has(providerVault,/get_conversation_worker_provider_secret_v1/);
  has(providerVault,/revoke all on function public\.get_conversation_worker_provider_secret_v1\(\) from public,anon,authenticated/);
  has(providerVault,/grant execute on function public\.get_conversation_worker_provider_secret_v1\(\) to service_role/);
  has(worker,/get_conversation_worker_provider_secret_v1/);
  has(worker,/provider_configured: Boolean\(openaiKey\)/);
  assert.doesNotMatch(worker,/provider_configured:\s*openaiKey/,'health must never return provider secret');
});

test('node and edge workers share one deterministic conversation core',()=>{
  assert.equal(nodeCore.trim(),"export * from '../../supabase/functions/_shared/conversation-core-v1.mjs';");
});

test('admin exposes observability, handoff and emergency stop but no live-release button',()=>{
  has(adminHtml,/data-route="whatsapp"/);
  has(adminHtml,/Atendimento IA/);
  has(adminHtml,/waEmergencyStop/);
  has(adminJs,/claim_handoff/);
  has(adminJs,/resolve_handoff/);
  has(adminJs,/resume_ai/);
  has(adminJs,/emergency_stop/);
  assert.doesNotMatch(adminHtml,/LIBERAR_ATENDIMENTO_REAL/);
  assert.doesNotMatch(adminJs,/configure_release/,'live rollout must not be one-click UI in v1');
});

test('admin operations edge is JWT/admin gated and live change is owner-only',()=>{
  has(adminEdge,/auth\.getUser/);
  has(adminEdge,/admin_users/);
  has(adminEdge,/owner_required/);
  has(adminEdge,/configure_whatsapp_release_v1/);
  has(config,/\[functions\.conversation-worker-v2\][\s\S]*verify_jwt = false/);
  has(config,/\[functions\.admin-whatsapp-ops-v1\][\s\S]*verify_jwt = true/);
});
