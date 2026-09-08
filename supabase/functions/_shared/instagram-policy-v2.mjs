export const INSTAGRAM_POLICY_SNAPSHOT_V2=Object.freeze({
  source:'meta-official-postman-reviewed-2026-09-08',
  professionalAccountRequired:true,
  privateReply:Object.freeze({
    maxPerComment:1,
    maxAgeSeconds:7*24*60*60,
    liveOnlyWhileBroadcastActive:true,
    followupRequiresRecipientReply:true,
    followupWindowSecondsAfterRecipientReply:24*60*60,
  }),
  quickReplies:Object.freeze({maxItems:13,titleMaxChars:20}),
  genericTemplate:Object.freeze({buttonMaxItems:3}),
  sharedMediaMustBelongToProfessionalAccount:true,
  operationalGatePolicyVerifiedByDefault:false,
});

const PURCHASE_RE=/\b(pre[cç]o|valor|quanto|comprar|compra|quero|pedido|pedir|entrega|entregam|cesta|kit|dispon[ií]vel|link)\b/i;
const SUPPORT_RE=/\b(problema|erro|atraso|reclama|troca|devolu|cancel|n[aã]o chegou|faltou)\b/i;
const QUESTION_RE=/\?|\b(como|onde|quando|qual|quais|voc[eê]s|tem|fazem|entregam)\b/i;
const SPAM_RE=/\b(ganhe seguidores|renda extra|investimento garantido|promo[cç][aã]o no meu perfil|dm me|follow me)\b/i;

export function classifyInstagramCommentIntentV2(input){
  const text=String(input??'').replace(/\s+/g,' ').trim().slice(0,2000);
  if(!text)return Object.freeze({intent:'other',confidence:0,source:'deterministic_v2'});
  if(SPAM_RE.test(text))return Object.freeze({intent:'spam',confidence:0.98,source:'deterministic_v2'});
  if(SUPPORT_RE.test(text))return Object.freeze({intent:'support',confidence:0.88,source:'deterministic_v2'});
  if(PURCHASE_RE.test(text))return Object.freeze({intent:'purchase_interest',confidence:0.86,source:'deterministic_v2'});
  if(QUESTION_RE.test(text))return Object.freeze({intent:'question',confidence:0.72,source:'deterministic_v2'});
  return Object.freeze({intent:'other',confidence:0.35,source:'deterministic_v2'});
}

export function evaluateInstagramPrivateReplyPolicyV2({commentCreatedAt,isLive=false,liveStateVerifiedActive=false,alreadyReplied=false,now=new Date()}={}){
  const created=new Date(commentCreatedAt??0),current=now instanceof Date?now:new Date(now);
  if(Number.isNaN(created.getTime())||Number.isNaN(current.getTime()))return Object.freeze({eligible:false,reason:'invalid_timestamp',eligibleUntil:null});
  if(alreadyReplied)return Object.freeze({eligible:false,reason:'private_reply_already_used',eligibleUntil:null});
  if(isLive&&!liveStateVerifiedActive)return Object.freeze({eligible:false,reason:'live_state_not_verified',eligibleUntil:null});
  const deadline=new Date(created.getTime()+INSTAGRAM_POLICY_SNAPSHOT_V2.privateReply.maxAgeSeconds*1000);
  if(current.getTime()>deadline.getTime())return Object.freeze({eligible:false,reason:'private_reply_window_expired',eligibleUntil:deadline.toISOString()});
  return Object.freeze({eligible:true,reason:'policy_snapshot_eligible',eligibleUntil:deadline.toISOString()});
}

export function evaluateInstagramFollowupPolicyV2({recipientRepliedAt,now=new Date()}={}){
  if(!recipientRepliedAt)return Object.freeze({eligible:false,reason:'recipient_reply_required',expiresAt:null});
  const replied=new Date(recipientRepliedAt),current=now instanceof Date?now:new Date(now);
  if(Number.isNaN(replied.getTime())||Number.isNaN(current.getTime()))return Object.freeze({eligible:false,reason:'invalid_timestamp',expiresAt:null});
  const expires=new Date(replied.getTime()+INSTAGRAM_POLICY_SNAPSHOT_V2.privateReply.followupWindowSecondsAfterRecipientReply*1000);
  if(current.getTime()>expires.getTime())return Object.freeze({eligible:false,reason:'followup_window_expired',expiresAt:expires.toISOString()});
  return Object.freeze({eligible:true,reason:'recipient_replied',expiresAt:expires.toISOString()});
}

export function buildInstagramPrivateReplyDraftV2(intent){
  if(intent==='purchase_interest')return 'Oi! Vi seu comentário. Posso te ajudar por aqui com opções e disponibilidade. Se quiser continuar, responda esta mensagem.';
  if(intent==='question')return 'Oi! Vi sua dúvida no comentário. Posso te explicar por aqui. Se quiser continuar, responda esta mensagem.';
  if(intent==='support')return 'Oi! Vi seu comentário e quero entender melhor para ajudar. Se puder, responda esta mensagem com os detalhes.';
  return 'Oi! Vi seu comentário. Se quiser conversar com a Dona Antônia por aqui, responda esta mensagem.';
}
