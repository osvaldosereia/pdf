const text=v=>String(v??'').trim();
const arr=v=>Array.isArray(v)?v:[];
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};

export function normalizeMessengerWebhook(body={}){
  const out=[];
  if(text(body.object)!=='page') return out;
  for(const entry of arr(body.entry)){
    const pageId=text(entry.id);
    if(!pageId) continue;
    for(const item of arr(entry.messaging)){
      const senderId=text(item?.sender?.id);
      const recipientId=text(item?.recipient?.id);
      const message=item?.message;
      const postback=item?.postback;
      const referral=object(item?.referral||postback?.referral);
      const timestamp=item?.timestamp?new Date(Number(item.timestamp)).toISOString():new Date().toISOString();
      if(senderId&&message?.mid){
        out.push({kind:message.is_echo===true?'echo':'message',external_account_id:pageId,external_user_id:senderId,external_message_id:text(message.mid),message_type:message.attachments?.length?'media':'text',body_text:text(message.text)||null,reply_to:text(message?.reply_to?.mid)||null,source:'facebook_messenger',referral,timestamp,context:{recipient_external_id:recipientId||null,is_echo:message.is_echo===true,quick_reply_payload:text(message?.quick_reply?.payload)||null}});
      } else if(senderId&&postback?.payload){
        out.push({kind:'postback',external_account_id:pageId,external_user_id:senderId,external_event_id:`postback:${senderId}:${item.timestamp||text(postback.payload)}`,message_type:'postback',body_text:text(postback.title)||null,source:'facebook_messenger',referral,timestamp,context:{recipient_external_id:recipientId||null,payload:text(postback.payload)}});
      } else if(senderId&&Object.keys(referral).length){
        out.push({kind:'referral',external_account_id:pageId,external_user_id:senderId,external_event_id:`referral:${senderId}:${item.timestamp||text(referral.ref)}`,message_type:'referral',body_text:null,source:'facebook_messenger_referral',referral,timestamp,context:{recipient_external_id:recipientId||null}});
      }
    }
  }
  return out;
}

export function classifyMessengerEvent(event={}){
  if(event.kind==='echo') return 'outbound_echo';
  if(event.kind==='message') return 'message_inbound';
  if(event.kind==='postback') return 'postback_inbound';
  if(event.kind==='referral') return 'referral_attribution';
  return 'unknown';
}

export function messengerAutomationGate(account={},controls={},eventKind='message'){
  if(account?.channel!=='messenger') return {allow:false,reason:'messenger_account_required'};
  if(!['observe','active'].includes(account.status)) return {allow:false,reason:'messenger_account_dormant'};
  if(account.inbound_enabled!==true) return {allow:false,reason:'messenger_inbound_disabled'};
  if(controls.webhook_ingest_enabled!==true) return {allow:false,reason:'messenger_webhook_disabled'};
  if(eventKind==='referral'&&controls.referral_observe_enabled!==true) return {allow:false,reason:'messenger_referral_observe_disabled'};
  if(['message','postback'].includes(eventKind)&&controls.message_observe_enabled!==true) return {allow:false,reason:'messenger_message_observe_disabled'};
  return {allow:true,reason:'observe_allowed'};
}

export function messengerDispatchGate(account={},controls={},payload={}){
  if(account?.channel!=='messenger') return {allow:false,reason:'messenger_account_required'};
  if(account.outbound_enabled!==true) return {allow:false,reason:'messenger_outbound_disabled'};
  if(controls.transport_send_enabled!==true) return {allow:false,reason:'messenger_transport_disabled'};
  if(controls.policy_verified_at==null||!text(controls.policy_version)) return {allow:false,reason:'meta_policy_not_verified'};
  if(!payload.recipient_id) return {allow:false,reason:'recipient_required'};
  return {allow:false,reason:'transport_not_implemented'};
}

const button=b=>({type:text(b.type)||'postback',title:text(b.title||b.label).slice(0,20),payload:text(b.payload||b.value).slice(0,1000),url:text(b.url)||null});
export function renderMessengerDecision(decision={}){
  const cards=arr(decision.cards).slice(0,10);
  if(cards.length){
    return {type:'generic_template',attachment:{type:'template',payload:{template_type:'generic',elements:cards.map(c=>({title:text(c.title).slice(0,80),subtitle:text(c.body).slice(0,80)||undefined,image_url:text(c.image_url)||undefined,buttons:arr(c.buttons).slice(0,3).map(button)}))}}};
  }
  const quick=arr(decision.quick_replies).slice(0,13);
  if(quick.length) return {type:'quick_replies',text:text(decision.text)||'Escolha uma opção:',quick_replies:quick.map(q=>({content_type:'text',title:text(q.title||q.label).slice(0,20),payload:text(q.payload||q.value).slice(0,1000)}))};
  const buttons=arr(decision.buttons).slice(0,3);
  if(buttons.length) return {type:'button_template',attachment:{type:'template',payload:{template_type:'button',text:text(decision.text).slice(0,640)||'Escolha uma opção:',buttons:buttons.map(button)}}};
  if(decision.media_url) return {type:'media',attachment:{type:text(decision.media_type)||'image',payload:{url:text(decision.media_url),is_reusable:false}}};
  return {type:'text',text:text(decision.text).slice(0,2000)||'Posso te ajudar por aqui.'};
}

export function metaAttributionFromMessenger(event={}){
  const r=object(event.referral);
  const source=text(r.source||r.ad_id||r.ref);
  if(!source) return null;
  return {channel:'messenger',source:'meta',external_account_id:text(event.external_account_id),external_user_id:text(event.external_user_id),ad_id:text(r.ad_id)||null,ref:text(r.ref)||null,source_type:text(r.source)||'unknown'};
}
