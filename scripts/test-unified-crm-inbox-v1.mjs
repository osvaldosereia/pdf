import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile('supabase/migrations/20260908040000_unified_crm_inbox_v1.sql','utf8');
const edge = await readFile('supabase/functions/admin-whatsapp-ops-v1/index.ts','utf8');
const ui = await readFile('admin-v3/whatsapp-ops.js','utf8');

const has=(text,re,msg)=>assert.match(text,re,msg);
const lacks=(text,re,msg)=>assert.doesNotMatch(text,re,msg);

// Conversas realmente podem ser multicanal sem criar conta Meta por migration.
has(migration,/alter column whatsapp_account_id drop not null/i,'WhatsApp account must stop being a structural requirement');
has(migration,/add column if not exists channel_account_id uuid references public\.channel_accounts/i,'conversation needs generic channel account');
has(migration,/channel in \('instagram','messenger'\)[\s\S]*channel_account_id is not null[\s\S]*external_user_id/i,'Meta conversations must require explicit account + external identity');
lacks(migration,/insert\s+into\s+public\.channel_accounts/i,'migration must not activate/create channel accounts');

// Identidade segura: observação não equivale a vínculo; confirmação exige evidência forte e auditável.
has(migration,/alter column customer_id drop not null/i,'observed channel identity must be allowed before linking');
has(migration,/create table if not exists public\.customer_emails/i,'CRM needs email identities');
has(migration,/create table if not exists public\.customer_channel_consents/i,'consents must be channel-aware');
has(migration,/create table if not exists public\.customer_identity_link_events/i,'identity links must be audited');
has(migration,/evidence_ref_hash text not null check \(evidence_ref_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/i,'link evidence must be stored as safe hash/reference');
has(migration,/unsafe_identity_evidence/i,'unsafe identity evidence must fail closed');
has(migration,/identity_already_linked/i,'identity cannot silently move between customers');
lacks(migration,/display_name[\s\S]{0,120}(link|customer_id)/i,'display name must never be identity-link evidence');

// Handoff generalizado e SLA, sem alterar/resolver estados existentes.
has(migration,/add column if not exists channel text/i,'handoff needs channel');
has(migration,/add column if not exists sla_due_at timestamptz/i,'handoff needs SLA deadline');
has(migration,/human_handoffs_unified_inbox_idx/i,'active inbox needs indexed handoffs');
lacks(migration,/update public\.human_handoffs[\s\S]{0,220}set[\s\S]{0,120}status\s*=/i,'migration must not auto-resolve or claim existing handoffs');

// Timeline/inbox únicas.
has(migration,/create or replace view public\.customer_timeline_v1/i,'customer timeline view required');
has(migration,/normalized_channel_events/i,'timeline must include normalized channel events');
has(migration,/operator_reply_jobs/i,'timeline must include human operator replies');
has(migration,/create or replace view public\.unified_inbox_v1/i,'unified inbox view required');
has(migration,/get_unified_inbox_metrics_v1/i,'SLA/handoff metrics required');

// Resposta humana é separada da IA, ownership explícito, janela de serviço e sem retry cego.
has(migration,/create table if not exists public\.operator_reply_jobs/i,'operator reply queue required');
has(migration,/v_conv\.mode<>'human'/i,'operator reply must require human control');
has(migration,/v_handoff\.status<>'claimed'/i,'operator reply must require claimed handoff');
has(migration,/claimed_by is distinct from v_job\.admin_user_id/i,'dispatcher must recheck handoff ownership');
has(migration,/service_window_expires_at[^;]+<=now\(\)/i,'WhatsApp human reply must honor service window');
has(migration,/channel_transport_not_enabled/i,'channels without transport must remain held');
has(migration,/delivery_uncertain_review_required/i,'uncertain delivery must go to manual review');
lacks(migration,/retry_operator_reply|redispatch_operator_reply/i,'operator replies must not receive blind retries');
lacks(migration,/update public\.automation_config/i,'stage 5 must not change live gates/canary');

// Server-only data surfaces.
for (const table of ['customer_emails','customer_channel_consents','customer_identity_link_events','operator_reply_jobs']) {
  has(migration,new RegExp(`alter table public\\.${table} enable row level security`,'i'),`${table} must use RLS`);
  has(migration,new RegExp(`revoke all on public\\.${table} from public,anon,authenticated`,'i'),`${table} must be server-only`);
}

// Admin API exposes read paths + deliberate operator reply, while preserving explicit manual lifecycle.
has(edge,/action === "inbox"/,'Admin API must expose unified inbox');
has(edge,/action === "timeline"/,'Admin API must expose timeline');
has(edge,/action === "customer_identity_summary"/,'Admin API must expose CRM identity summary');
has(edge,/action === "operator_reply"/,'Admin API must expose operator reply action');
has(edge,/queue_operator_reply_v1/,'operator reply must go through DB gate/RPC');
has(edge,/const canWrite = admin\.role === "owner" \|\| admin\.role === "operator"/,'writes need RBAC');

// UI becomes a true inbox and no longer offers one-click automatic IA resume after resolving.
has(ui,/Inbox omnichannel/,'Admin navigation should expose unified inbox');
has(ui,/Todos os canais/,'inbox requires channel filter');
has(ui,/data-inbox-timeline/,'timeline must be reachable from inbox');
has(ui,/data-inbox-crm/,'CRM identities must be reachable from inbox');
has(ui,/data-inbox-reply/,'claimed handoff must allow operator reply');
has(ui,/IA não foi retomada automaticamente/i,'resolution must explicitly preserve human/AI safety');
lacks(ui,/data-wa-resume/,'unified inbox must not expose accidental resolve+AI shortcut');

console.log('Unified CRM/inbox v1 safety contract: OK');
