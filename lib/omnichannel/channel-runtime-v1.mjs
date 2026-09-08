const CHANNELS=['whatsapp','web','instagram','messenger'];

export const CAPABILITY_REGISTRY=Object.freeze({
  whatsapp:Object.freeze({text:true,image:true,audio:true,buttons:true,quick_replies:false,cards:false,carousel:true,flow:true,max_buttons:3,max_carousel_items:10}),
  web:Object.freeze({text:true,image:true,audio:true,buttons:true,quick_replies:true,cards:true,carousel:true,flow:false,max_buttons:8,max_carousel_items:20}),
  instagram:Object.freeze({text:true,image:true,audio:false,buttons:true,quick_replies:true,cards:true,carousel:true,flow:false,max_buttons:3,max_carousel_items:10}),
  messenger:Object.freeze({text:true,image:true,audio:true,buttons:true,quick_replies:true,cards:true,carousel:true,flow:false,max_buttons:3,max_carousel_items:10})
});

const text=v=>String(v??'').trim();
const arr=v=>Array.isArray(v)?v:[];
const safeChannel=v=>CHANNELS.includes(v)?v:'web';

export function normalizeInboundEnvelope(channel,payload={}){
  const c=safeChannel(channel);
  const base={channel:c,external_user_id:text(payload.external_user_id),external_message_id:text(payload.external_message_id)||null,external_event_id:text(payload.external_event_id)||null,direction:'inbound',message_type:text(payload.message_type)||'unknown',reply_to:text(payload.reply_to)||null,source:text(payload.source)||'unknown',referral:payload.referral&&typeof payload.referral==='object'?payload.referral:{},timestamp:payload.timestamp||new Date().toISOString(),body_text:text(payload.body_text)||null,media_refs:arr(payload.media_refs),context:payload.context&&typeof payload.context==='object'?payload.context:{}};
  if(!base.external_user_id) throw new Error('external_user_id_required');
  if(!base.external_message_id&&!base.external_event_id) throw new Error('external_message_or_event_required');
  return base;
}

export const adapters=Object.freeze({
  whatsapp:payload=>normalizeInboundEnvelope('whatsapp',payload),
  web:payload=>normalizeInboundEnvelope('web',payload),
  instagram:payload=>normalizeInboundEnvelope('instagram',payload),
  messenger:payload=>normalizeInboundEnvelope('messenger',payload)
});

export function canAutomate(account={},direction='inbound'){
  if(!account||!['observe','active'].includes(account.status)) return false;
  if(direction==='inbound') return account.inbound_enabled===true;
  if(direction==='outbound') return account.outbound_enabled===true;
  return false;
}

export function canUseAi(account={}){
  return canAutomate(account,'inbound')&&account.ai_enabled===true;
}

export function canAutoReply(account={}){
  return canUseAi(account)&&account.auto_reply_enabled===true;
}

function limited(items,max){return arr(items).slice(0,Math.max(0,max||0));}
function asText(decision){
  if(text(decision.text)) return text(decision.text);
  if(text(decision.title)&&text(decision.body)) return `${text(decision.title)}\n${text(decision.body)}`;
  if(text(decision.title)) return text(decision.title);
  return 'Posso te ajudar com isso por aqui.';
}

export function renderDecision(channel,decision={},account={}){
  const c=safeChannel(channel);
  const cap=CAPABILITY_REGISTRY[c];
  const mission=text(decision.mission)||'reply';
  const result={channel:c,mission,render_type:'text',payload:{text:asText(decision)},fallbacks:[]};

  if(!canAutomate(account,'outbound')){
    return {...result,blocked:true,block_reason:'channel_outbound_disabled'};
  }

  const cards=arr(decision.cards);
  const buttons=arr(decision.buttons);
  const quick=arr(decision.quick_replies);

  if(cards.length>1&&cap.carousel){
    result.render_type='carousel';
    result.payload={items:limited(cards,cap.max_carousel_items).map(card=>({title:text(card.title),body:text(card.body),image_url:text(card.image_url)||null,buttons:cap.buttons?limited(card.buttons,cap.max_buttons):[]}))};
    return result;
  }
  if(cards.length===1&&cap.cards){
    result.render_type='card';
    const card=cards[0];
    result.payload={title:text(card.title),body:text(card.body),image_url:text(card.image_url)||null,buttons:cap.buttons?limited(card.buttons,cap.max_buttons):[]};
    return result;
  }
  if(quick.length&&cap.quick_replies){
    result.render_type='quick_replies';
    result.payload={text:asText(decision),items:limited(quick,13)};
    return result;
  }
  if(buttons.length&&cap.buttons){
    result.render_type='buttons';
    result.payload={text:asText(decision),items:limited(buttons,cap.max_buttons)};
    return result;
  }
  if(text(decision.image_url)&&cap.image){
    result.render_type='image';
    result.payload={image_url:text(decision.image_url),caption:asText(decision)};
    return result;
  }

  if(cards.length) result.fallbacks.push('cards_to_text');
  if(quick.length) result.fallbacks.push('quick_replies_to_text');
  if(buttons.length) result.fallbacks.push('buttons_to_text');
  return result;
}

export function commercialMissionShowBaskets(baskets=[]){
  return {
    mission:'show_three_baskets',
    text:'Separei algumas opções para você.',
    cards:arr(baskets).slice(0,3).map(b=>({id:b.id,title:text(b.name),body:text(b.description),image_url:text(b.image_url)||null,buttons:[{type:'select_basket',label:'Escolher',value:b.id}]}))
  };
}

export function assertIndependentGates(account={}){
  for(const key of ['inbound_enabled','ai_enabled','auto_reply_enabled','outbound_enabled']) if(typeof account[key]!=='boolean') throw new Error(`missing_gate:${key}`);
  if(!Number.isInteger(account.canary_percent)||account.canary_percent<0||account.canary_percent>100) throw new Error('invalid_canary_percent');
  return true;
}
