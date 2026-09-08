import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  INSTAGRAM_SEND_CONTRACT_V1,
  buildInstagramTextPayloadV1,
  buildInstagramPrivateReplyPayloadV1,
  buildInstagramQuickRepliesPayloadV1,
  buildInstagramGenericTemplatePayloadV1,
  buildInstagramPublishedPostPayloadV1,
  assertInstagramTransportDormantV1,
} from '../lib/omnichannel/instagram-send-contract-v1.mjs';

const migration=await readFile('supabase/migrations/20260908043100_channel_order_attribution_link_v1.sql','utf8');
const review=await readFile('supabase/migrations/20260908043200_instagram_private_reply_review_hardening_v1.sql','utf8');
const shared=await readFile('supabase/functions/_shared/instagram-send-contract-v1.mjs','utf8');
const wrapper=await readFile('lib/omnichannel/instagram-send-contract-v1.mjs','utf8');
const has=(text,re,msg)=>assert.match(text,re,msg);
const lacks=(text,re,msg)=>assert.doesNotMatch(text,re,msg);

assert.equal(INSTAGRAM_SEND_CONTRACT_V1.transportReleased,false);
assert.equal(INSTAGRAM_SEND_CONTRACT_V1.quickReplies.maxItems,13);
assert.equal(INSTAGRAM_SEND_CONTRACT_V1.quickReplies.titleMaxChars,20);
assert.equal(INSTAGRAM_SEND_CONTRACT_V1.buttons.maxItems,3);
assert.equal(assertInstagramTransportDormantV1(),true);
assert.equal(wrapper.trim(),"export * from '../../supabase/functions/_shared/instagram-send-contract-v1.mjs';");

const textPayload=buildInstagramTextPayloadV1({recipientId:'igsid-1',message:'Olá'});
assert.deepEqual(textPayload,{recipient:{id:'igsid-1'},messaging_type:'RESPONSE',message:{text:'Olá'}});

const privateReply=buildInstagramPrivateReplyPayloadV1({commentId:'comment-1',message:'Oi!'});
assert.deepEqual(privateReply,{recipient:{comment_id:'comment-1'},message:{text:'Oi!'}});

const quick=buildInstagramQuickRepliesPayloadV1({
  recipientId:'igsid-1',message:'Escolha',
  items:Array.from({length:20},(_,i)=>({title:`Opção ${i} muito longa para caber`,payload:`p${i}`})),
});
assert.equal(quick.message.quick_replies.length,13);
for(const item of quick.message.quick_replies) assert.ok(item.title.length<=20);

const generic=buildInstagramGenericTemplatePayloadV1({
  recipientId:'igsid-1',
  elements:[{
    title:'Cesta Essencial',body:'Opção para sua compra',image_url:'https://example.com/cesta.jpg',
    buttons:[
      {type:'postback',title:'Escolher',payload:'basket:1'},
      {type:'web_url',title:'Ver',url:'https://example.com/cesta'},
      {type:'postback',title:'Outra',payload:'other'},
      {type:'postback',title:'Excedente',payload:'overflow'},
    ],
  }],
});
assert.equal(generic.message.attachment.payload.template_type,'generic');
assert.equal(generic.message.attachment.payload.elements[0].buttons.length,3);

assert.throws(()=>buildInstagramPublishedPostPayloadV1({recipientId:'igsid-1',mediaId:'post-1'}),/professional_account_media_ownership_required/);
const post=buildInstagramPublishedPostPayloadV1({recipientId:'igsid-1',mediaId:'post-1',ownedByProfessionalAccount:true});
assert.equal(post.message.attachment.type,'MEDIA_SHARE');
assert.equal(post.message.attachment.payload.id,'post-1');

// Contratos são serializadores puros: nenhum transporte, token ou URL Graph embutido.
lacks(shared,/\bfetch\s*\(/,'send contracts must not perform HTTP');
lacks(shared,/net\.http_post/i,'send contracts must not perform DB HTTP');
lacks(shared,/access[_-]?token|bearer\s+/i,'send contracts must not contain credentials');
lacks(shared,/graph\.instagram\.com|graph\.facebook\.com/i,'send contracts must not embed Meta endpoints');
has(shared,/transportReleased:false/,'transport must be explicitly dormant');

// Atribuição pedido <- conversa usa somente conversation_id e last-touch temporal.
has(migration,/create table if not exists public\.order_channel_attribution_links/i);
has(migration,/unique\(order_id,attribution_model\)/i);
has(migration,/alter table public\.order_channel_attribution_links enable row level security/i);
has(migration,/revoke all on public\.order_channel_attribution_links from public,anon,authenticated/i);
has(migration,/link_order_channel_attribution_v1/i);
has(migration,/where conversation_id=v_order\.conversation_id[\s\S]*occurred_at<=v_order\.created_at[\s\S]*interval '30 days'/i);
lacks(migration,/primary_whatsapp|email_normalized|display_name|customer_id\s*=\s*v_order\.customer_id/i,'attribution must never infer identity from CRM fields');

// Ordem e touchpoint fora de ordem convergem automaticamente, sem rede externa.
has(migration,/orders_channel_attribution_v1/i);
has(migration,/after insert or update of conversation_id on public\.orders/i);
has(migration,/channel_attribution_refresh_orders_v1/i);
has(migration,/after insert or update of conversation_id,occurred_at on public\.channel_attribution_events/i);
has(migration,/perform public\.link_order_channel_attribution_v1\(v_order_id\)/i);
lacks(migration,/net\.http_post|fetch\s*\(|graph\.instagram\.com/i,'order attribution must be local-only');

// Review de private reply é humano, política revalidada e continua sem envio.
has(review,/comment\.intent not in \('purchase_interest','question','support'\)/i,'spam/unknown/other must not become outreach candidates');
has(review,/human_approval_required/i,'eligible comment must require human approval');
has(review,/review_instagram_private_reply_v1/i);
has(review,/v_admin\.role not in \('owner','operator'\)/i,'review must be RBAC protected');
has(review,/private_reply_already_sent/i);
has(review,/private_reply_not_policy_eligible/i);
has(review,/instagram_observe_gate_closed/i);
has(review,/channel_outbound_disabled/i);
has(review,/status='approved'[\s\S]*blocked_reason='dispatcher_not_released'/i,'approval must remain blocked from transport');
has(review,/'sent',false/i,'approval response must state that nothing was sent');
has(review,/instagram_private_reply_review_v1/i);
has(review,/get_instagram_stage6_metrics_v1/i);
has(review,/'transport_released',false/i);
lacks(review,/net\.http_post|fetch\s*\(|graph\.instagram\.com|graph\.facebook\.com/i,'review layer must not contain transport');

console.log('Instagram send contracts + order attribution + review hardening v1: OK');
