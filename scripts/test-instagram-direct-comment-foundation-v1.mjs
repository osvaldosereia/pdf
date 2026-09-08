import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  INSTAGRAM_POLICY_SNAPSHOT_V1,
  classifyInstagramCommentIntentV1,
  evaluateInstagramPrivateReplyPolicyV1,
  evaluateInstagramFollowupPolicyV1,
  buildInstagramPrivateReplyDraftV1,
} from '../lib/omnichannel/instagram-policy-v1.mjs';

const migration = await readFile('supabase/migrations/20260908043000_instagram_direct_comment_foundation_v1.sql','utf8');
const edge = await readFile('supabase/functions/instagram-webhook-v1/index.ts','utf8');
const config = await readFile('supabase/config.toml','utf8');
const shared = await readFile('supabase/functions/_shared/instagram-policy-v1.mjs','utf8');
const wrapper = await readFile('lib/omnichannel/instagram-policy-v1.mjs','utf8');

const has=(text,re,msg)=>assert.match(text,re,msg);
const lacks=(text,re,msg)=>assert.doesNotMatch(text,re,msg);

// Snapshot de política: guardrails atuais codificados de forma explícita.
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V1.professionalAccountRequired,true);
assert.deepEqual([...INSTAGRAM_POLICY_SNAPSHOT_V1.permissions],[
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
]);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V1.privateReply.maxPerComment,1);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V1.privateReply.maxAgeSeconds,7*24*60*60);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V1.privateReply.liveRequiresVerifiedActiveBroadcast,true);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V1.privateReply.followupRequiresRecipientReply,true);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V1.privateReply.followupWindowSecondsAfterRecipientReply,24*60*60);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V1.quickReplies.maxItems,13);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V1.quickReplies.titleMaxChars,20);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V1.sharedMediaMustBelongToProfessionalAccount,true);
assert.equal(wrapper.trim(),"export * from '../../supabase/functions/_shared/instagram-policy-v1.mjs';",'Node and Edge must share one policy core');
has(shared,/meta-instagram-api-postman-2026-09-08/,'policy snapshot needs an explicit source/version marker');

// Janela de private reply: 1 mensagem por comentário, 7 dias, Live fail-closed.
const base='2026-09-01T12:00:00.000Z';
assert.equal(evaluateInstagramPrivateReplyPolicyV1({commentCreatedAt:base,now:'2026-09-08T11:59:59.000Z'}).eligible,true);
assert.equal(evaluateInstagramPrivateReplyPolicyV1({commentCreatedAt:base,now:'2026-09-08T12:00:00.001Z'}).reason,'private_reply_window_expired');
assert.equal(evaluateInstagramPrivateReplyPolicyV1({commentCreatedAt:base,now:'2026-09-02T12:00:00.000Z',alreadyReplied:true}).reason,'private_reply_already_used');
assert.equal(evaluateInstagramPrivateReplyPolicyV1({commentCreatedAt:base,isLive:true,liveStateVerifiedActive:false,now:'2026-09-01T12:01:00.000Z'}).reason,'live_state_not_verified');
assert.equal(evaluateInstagramPrivateReplyPolicyV1({commentCreatedAt:base,isLive:true,liveStateVerifiedActive:true,now:'2026-09-01T12:01:00.000Z'}).eligible,true);

// Continuação só depois de resposta real do destinatário e respeitando 24h.
assert.equal(evaluateInstagramFollowupPolicyV1({}).reason,'recipient_reply_required');
assert.equal(evaluateInstagramFollowupPolicyV1({recipientRepliedAt:'2026-09-07T12:00:00Z',now:'2026-09-08T11:59:59Z'}).eligible,true);
assert.equal(evaluateInstagramFollowupPolicyV1({recipientRepliedAt:'2026-09-07T12:00:00Z',now:'2026-09-08T12:00:01Z'}).reason,'followup_window_expired');

// Intenção em comentário é determinística/sem custo e drafts pedem explicitamente resposta.
assert.equal(classifyInstagramCommentIntentV1('Qual o preço dessa cesta?').intent,'purchase_interest');
assert.equal(classifyInstagramCommentIntentV1('Meu pedido não chegou, podem ajudar?').intent,'support');
assert.equal(classifyInstagramCommentIntentV1('ganhe seguidores com promoção no meu perfil').intent,'spam');
assert.equal(classifyInstagramCommentIntentV1('Vocês entregam em Cuiabá?').intent,'question');
for (const intent of ['purchase_interest','question','support','other']) {
  has(buildInstagramPrivateReplyDraftV1(intent),/responda esta mensagem/i,'draft must ask the recipient to reply before continuation');
}

// Persistência é server-only e idempotente.
for (const table of ['channel_attribution_events','instagram_comment_events','instagram_private_reply_jobs','instagram_conversation_windows']) {
  has(migration,new RegExp(`alter table public\\.${table} enable row level security`,'i'),`${table} must have RLS`);
  has(migration,new RegExp(`revoke all on public\\.${table} from public,anon,authenticated`,'i'),`${table} must be server-only`);
}
has(migration,/comment_event_id uuid not null unique/i,'a comment can have only one private-reply job');
has(migration,/unique\(channel_account_id,external_comment_id\)/i,'provider comment id must be idempotent per account');
has(migration,/normalized_event_id uuid not null unique/i,'attribution/comment events must be replay-safe');
has(migration,/conversations_instagram_open_identity_uidx/i,'only one active Instagram conversation per account/user is allowed');

// Attribution deve manter post/Reel/anúncio até conversa/pedido futuro.
has(migration,/campaign_id text/);
has(migration,/adset_id text/);
has(migration,/ad_id text/);
has(migration,/creative_id text/);
has(migration,/touchpoint_type[\s\S]*'comment','direct','share','post','reel','story','live','ad','unknown'/i);
has(migration,/record_instagram_attribution_v1/);
has(migration,/occurred_at>=v_event\.occurred_at-interval '7 days'/,'recent comment attribution should attach when the Direct starts');

// Direct inbound é humano primeiro; observe/inbound precisam estar explicitamente abertos.
has(migration,/ensure_instagram_direct_human_v1/i);
has(migration,/v_account\.status not in \('observe','active'\) or not v_account\.inbound_enabled/i,'Direct must remain held until observe/inbound gate opens');
has(migration,/status='needs_human'/i);
has(migration,/'human',now\(\),'instagram','human_control'/i,'new Instagram Direct must start under human control');
has(migration,/instagram_direct_human_first/i);
has(migration,/verification_status='verified'/i,'customer resolution may only reuse already verified identity');
lacks(migration,/display_name/i,'identity linking must never rely on profile/display name');

// Private reply é somente candidato/draft; nesta etapa nenhum dispatcher existe.
has(migration,/evaluate_instagram_private_reply_candidate_v1/i);
has(migration,/interval '7 days'/i);
has(migration,/live_state_not_verified/i);
has(migration,/channel_outbound_disabled/i);
has(migration,/human_approval_required/i);
has(migration,/dispatcher_not_released/i);
lacks(migration,/net\.http_post/i,'DB foundation must not dispatch anything');
lacks(migration,/graph\.instagram\.com/i,'DB foundation must not call Meta');
lacks(migration,/insert\s+into\s+public\.channel_accounts/i,'migration must never create a Meta channel account');
lacks(migration,/update\s+public\.automation_config/i,'migration must never open global gates/canary');

// Webhook: verificação Meta custom, raw payload não persistido e conta deve preexistir.
has(edge,/META_INSTAGRAM_VERIFY_TOKEN/);
has(edge,/META_APP_SECRET/);
has(edge,/x-hub-signature-256/i);
has(edge,/HMAC/);
has(edge,/SHA-256/);
has(edge,/payloadHash=await sha256Hex\(raw\)/,'only payload hash should reach raw-event storage');
has(edge,/from\('channel_accounts'\)[\s\S]*eq\('channel','instagram'\)[\s\S]*external_account_id/i,'webhook must resolve a preconfigured account');
has(edge,/if\(!account\?\.id\)\{ignored\+\+;continue\}/,'unknown Meta account must be ignored fail-closed');
has(edge,/ingest_normalized_channel_event_v1/);
has(edge,/ensure_instagram_direct_human_v1/);
has(edge,/record_instagram_comment_event_v1/);
has(edge,/classifyInstagramCommentIntentV1/);
lacks(edge,/from\('channel_accounts'\)\.insert/i,'webhook must never auto-create channel accounts');
lacks(edge,/graph\.instagram\.com/i,'webhook must not contain a Meta Send API path yet');
lacks(edge,/private[_-]?reply[^\n]{0,80}(fetch|http|post)/i,'webhook must not send private replies');

// Supabase gateway JWT is intentionally off only because Meta uses custom webhook signatures.
has(config,/\[functions\.instagram-webhook-v1\][\s\S]*verify_jwt = false/);
has(config,/x-hub-signature-256 HMAC-SHA256 válido/i);
has(config,/nenhuma subscription Meta é criada/i);

console.log('Instagram Direct/comment dormant foundation v1: OK');
