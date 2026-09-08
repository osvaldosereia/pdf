import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  INSTAGRAM_POLICY_SNAPSHOT_V2,
  classifyInstagramCommentIntentV2,
  evaluateInstagramPrivateReplyPolicyV2,
  evaluateInstagramFollowupPolicyV2,
  buildInstagramPrivateReplyDraftV2,
} from '../lib/omnichannel/instagram-policy-v2.mjs';
import {
  INSTAGRAM_SEND_CONTRACT_V2,
  buildInstagramTextPayloadV2,
  buildInstagramPrivateReplyPayloadV2,
  buildInstagramQuickRepliesPayloadV2,
  buildInstagramGenericTemplatePayloadV2,
  buildInstagramPublishedPostPayloadV2,
  assertInstagramTransportDormantV2,
} from '../lib/omnichannel/instagram-send-contract-v2.mjs';

const base=await readFile('supabase/migrations/20260908053500_instagram_direct_comment_foundation_v1.sql','utf8');
const hard=await readFile('supabase/migrations/20260908060000_instagram_stage6_human_policy_attribution_v2.sql','utf8');
const guardFix=await readFile('supabase/migrations/20260908060001_instagram_stage6_prepare_guard_fix_v2.sql','utf8');
const order=await readFile('supabase/migrations/20260908060100_instagram_stage6_order_attribution_v2.sql','utf8');
const webhook=await readFile('supabase/functions/meta-instagram-webhook-v1/index.ts','utf8');
const policyShared=await readFile('supabase/functions/_shared/instagram-policy-v2.mjs','utf8');
const sendShared=await readFile('supabase/functions/_shared/instagram-send-contract-v2.mjs','utf8');
const has=(text,re,msg)=>assert.match(text,re,msg);
const lacks=(text,re,msg)=>assert.doesNotMatch(text,re,msg);

// A fundação oficial da PR #190 continua fechada por padrão.
has(base,/webhook_ingest_enabled boolean not null default false/i);
has(base,/direct_observe_enabled boolean not null default false/i);
has(base,/comment_observe_enabled boolean not null default false/i);
has(base,/private_reply_prepare_enabled boolean not null default false/i);
has(base,/private_reply_send_enabled boolean not null default false/i);
has(base,/private_reply_window_seconds integer not null default 0/i);
has(base,/'transport_implemented',false/i);
has(base,/'customer_runtime_released',false/i);

// Snapshot atual informa regras, mas explicitamente NÃO verifica política operacional.
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V2.privateReply.maxPerComment,1);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V2.privateReply.maxAgeSeconds,7*24*60*60);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V2.privateReply.liveOnlyWhileBroadcastActive,true);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V2.privateReply.followupRequiresRecipientReply,true);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V2.privateReply.followupWindowSecondsAfterRecipientReply,24*60*60);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V2.quickReplies.maxItems,13);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V2.quickReplies.titleMaxChars,20);
assert.equal(INSTAGRAM_POLICY_SNAPSHOT_V2.operationalGatePolicyVerifiedByDefault,false);
has(policyShared,/operationalGatePolicyVerifiedByDefault:false/);

const t0='2026-09-01T12:00:00Z';
assert.equal(evaluateInstagramPrivateReplyPolicyV2({commentCreatedAt:t0,now:'2026-09-08T11:59:59Z'}).eligible,true);
assert.equal(evaluateInstagramPrivateReplyPolicyV2({commentCreatedAt:t0,now:'2026-09-08T12:00:01Z'}).reason,'private_reply_window_expired');
assert.equal(evaluateInstagramPrivateReplyPolicyV2({commentCreatedAt:t0,alreadyReplied:true,now:'2026-09-02T00:00:00Z'}).reason,'private_reply_already_used');
assert.equal(evaluateInstagramPrivateReplyPolicyV2({commentCreatedAt:t0,isLive:true,liveStateVerifiedActive:false,now:'2026-09-02T00:00:00Z'}).reason,'live_state_not_verified');
assert.equal(evaluateInstagramFollowupPolicyV2({}).reason,'recipient_reply_required');
assert.equal(evaluateInstagramFollowupPolicyV2({recipientRepliedAt:'2026-09-07T12:00:00Z',now:'2026-09-08T11:59:59Z'}).eligible,true);
assert.equal(evaluateInstagramFollowupPolicyV2({recipientRepliedAt:'2026-09-07T12:00:00Z',now:'2026-09-08T12:00:01Z'}).reason,'followup_window_expired');
assert.equal(classifyInstagramCommentIntentV2('Qual o preço dessa cesta?').intent,'purchase_interest');
assert.equal(classifyInstagramCommentIntentV2('Meu pedido não chegou').intent,'support');
assert.equal(classifyInstagramCommentIntentV2('ganhe seguidores com promoção no meu perfil').intent,'spam');
for(const intent of ['purchase_interest','question','support'])has(buildInstagramPrivateReplyDraftV2(intent),/responda esta mensagem/i);

// Serializadores são puros e o transporte continua explicitamente não liberado.
assert.equal(INSTAGRAM_SEND_CONTRACT_V2.transportReleased,false);
assert.equal(assertInstagramTransportDormantV2(),true);
assert.deepEqual(buildInstagramTextPayloadV2({recipientId:'u1',message:'Olá'}),{recipient:{id:'u1'},messaging_type:'RESPONSE',message:{text:'Olá'}});
assert.deepEqual(buildInstagramPrivateReplyPayloadV2({commentId:'c1',message:'Oi'}),{recipient:{comment_id:'c1'},message:{text:'Oi'}});
const quick=buildInstagramQuickRepliesPayloadV2({recipientId:'u1',message:'Escolha',items:Array.from({length:20},(_,i)=>({title:`Opção ${i} que é longa`,payload:`p${i}`}))});
assert.equal(quick.message.quick_replies.length,13);
for(const item of quick.message.quick_replies)assert.ok(item.title.length<=20);
const generic=buildInstagramGenericTemplatePayloadV2({recipientId:'u1',elements:[{title:'Cesta',buttons:[{type:'postback',title:'A',payload:'a'},{type:'postback',title:'B',payload:'b'},{type:'postback',title:'C',payload:'c'},{type:'postback',title:'D',payload:'d'}]}]});
assert.equal(generic.message.attachment.payload.template_type,'generic');
assert.equal(generic.message.attachment.payload.elements[0].buttons.length,3);
assert.throws(()=>buildInstagramPublishedPostPayloadV2({recipientId:'u1',mediaId:'m1'}),/professional_account_media_ownership_required/);
assert.equal(buildInstagramPublishedPostPayloadV2({recipientId:'u1',mediaId:'m1',ownedByProfessionalAccount:true}).message.attachment.type,'MEDIA_SHARE');
lacks(sendShared,/\bfetch\s*\(|net\.http_post|graph\.instagram\.com|graph\.facebook\.com|access[_-]?token|bearer\s+/i,'payload contracts must never transport');

// Hardening é incremental sobre as tabelas da PR #190, sem redefinir a fila base.
lacks(hard,/create table if not exists public\.instagram_private_reply_jobs/i,'must extend PR190 table instead of creating a competing schema');
has(hard,/alter table public\.instagram_private_reply_jobs/i);
has(hard,/create table if not exists public\.instagram_conversation_windows/i);
has(hard,/create table if not exists public\.channel_attribution_events/i);
for(const table of ['instagram_conversation_windows','channel_attribution_events']){
  has(hard,new RegExp(`alter table public\\.${table} enable row level security`,'i'));
  has(hard,new RegExp(`revoke all on public\\.${table} from public,anon,authenticated`,'i'));
}
lacks(hard,/insert\s+into\s+public\.channel_accounts/i,'hardening must never create Instagram accounts');
lacks(hard,/update\s+public\.automation_config/i,'hardening must not touch global release gates');
lacks(hard,/net\.http_post|graph\.instagram\.com|graph\.facebook\.com/i,'hardening must not transport');

// Direct é human-first e vínculo CRM só usa identidade previamente verificada.
has(hard,/ensure_instagram_direct_human_v2/i);
has(hard,/status='needs_human',mode='human',human_required=true/i);
has(hard,/'instagram','human_control'/i);
has(hard,/instagram_direct_human_first/i);
has(hard,/verification_status='verified'/i);
has(hard,/values\(null,'instagram'.*'igsid','observed'/is,'IGSID must start observed');
lacks(hard,/display_name/i,'identity must never be linked by display name');

// Comentários têm intenção; spam/other não são private outreach elegível.
has(hard,/comment_intent/i);
has(hard,/v_obs\.intent not in \('purchase_interest','question','support'\)/i);
has(hard,/comment_intent_not_eligible/i);
has(hard,/live_state_not_verified/i);
has(hard,/human_approval_required/i);

// Aprovação humana não envia e não muda o job para ready/dispatching.
has(hard,/review_instagram_private_reply_v2/i);
has(hard,/v_admin\.role not in \('owner','operator'\)/i);
has(hard,/set state='held',hold_reason='instagram_transport_not_enabled',review_decision='approved'/i);
has(hard,/'sent',false/i);
lacks(hard,/set state='ready'/i,'human approval must not release transport');
lacks(hard,/set state='dispatching'/i,'human approval must not dispatch');

// Verificar snapshot de política é owner-only e não abre nenhum gate.
has(hard,/verify_instagram_policy_snapshot_v2/i);
has(hard,/v_admin\.role<>'owner'/i);
has(hard,/CONFIRMAR_POLITICA_INSTAGRAM/i);
has(hard,/'gates_changed',false/i);
lacks(hard,/webhook_ingest_enabled\s*=\s*true|direct_observe_enabled\s*=\s*true|comment_observe_enabled\s*=\s*true|private_reply_prepare_enabled\s*=\s*true|private_reply_send_enabled\s*=\s*true/i,'policy verification must not open gates');

// Patch final corrige ausência de controls e mantém sent=false.
has(guardFix,/v_controls\.channel_account_id is null or not coalesce\(v_controls\.private_reply_prepare_enabled,false\)/i);
has(guardFix,/v_event\.occurred_at\+make_interval/i);
has(guardFix,/'sent',false/i);

// Atribuição conteúdo -> conversa -> pedido é determinística pela mesma conversation_id.
has(hard,/record_instagram_attribution_v2/i);
has(hard,/campaign_id text/);has(hard,/adset_id text/);has(hard,/ad_id text/);has(hard,/creative_id text/);
has(order,/create table if not exists public\.order_channel_attribution_links/i);
has(order,/where conversation_id=v_order\.conversation_id[\s\S]*occurred_at<=v_order\.created_at[\s\S]*interval '30 days'/i);
has(order,/orders_channel_attribution_v2/i);
has(order,/channel_attribution_refresh_orders_v2/i);
lacks(order,/primary_whatsapp|email_normalized|display_name|customer_id\s*=\s*v_order\.customer_id/i,'order attribution must not guess identity');
lacks(order,/net\.http_post|graph\.instagram\.com|graph\.facebook\.com/i,'order attribution must stay local');

// Webhook continua desativado por ambiente, assinado e sem Send API.
has(webhook,/META_INSTAGRAM_WEBHOOK_RUNTIME_ENABLED/);
has(webhook,/x-hub-signature-256/i);
has(webhook,/HMAC/);
has(webhook,/classifyInstagramCommentIntentV2/);
has(webhook,/authorId===externalAccountId/,'self-comments must be ignored');
has(webhook,/campaign_id/);has(webhook,/creative_id/);
lacks(webhook,/graph\.instagram\.com|graph\.facebook\.com/i,'webhook must not contain Meta transport');
lacks(webhook,/fetch\s*\(/i,'webhook must not make arbitrary HTTP requests');

console.log('Instagram Stage 6 hardening v2: OK');
