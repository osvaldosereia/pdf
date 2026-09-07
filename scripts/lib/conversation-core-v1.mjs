// Pure routing: models classify requests; this module owns the allowed responses.
export const INTENTS = ['greeting','baskets','offers','search','checkout','decline_upsell','fast_checkout','human','clarify'];
export const intentSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    intent: {type:'string', enum:INTENTS},
    query: {type:'string'},
    confidence: {type:'number'},
    description: {type:'string'}
  }, required:['intent','query','confidence','description']
};
const clean = (v,max=500) => String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const normalized = v => clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
export function deterministicIntent(value) {
  const s=normalized(value);
  if (/\b(atendente|humano|pessoa de verdade|reclamacao)\b/.test(s)) return {intent:'human',query:''};
  if (/\b(nao quero|so a cesta|somente a cesta|sem mais nada)\b/.test(s)) return {intent:'decline_upsell',query:''};
  if (/\b(pressa|finaliza logo|estou correndo)\b/.test(s)) return {intent:'fast_checkout',query:''};
  if (/\b(finalizar|fechar pedido|concluir|confirmar pedido)\b/.test(s)) return {intent:'checkout',query:''};
  if (/^(oi|ola|bom dia|boa tarde|boa noite)[!.? ]*$/.test(s)) return {intent:'greeting',query:''};
  if (/^(oferta|ofertas|promocao|promocoes)[!.? ]*$/.test(s)) return {intent:'offers',query:''};
  if (/^(cesta|cestas|cestas basicas)[!.? ]*$/.test(s)) return {intent:'baskets',query:''};
  return null;
}
export function validateIntent(value) {
  if (!value || typeof value!=='object' || !INTENTS.includes(value.intent) ||
      typeof value.query!=='string' || typeof value.description!=='string' ||
      typeof value.confidence!=='number' || !Number.isFinite(value.confidence) ||
      value.confidence<0 || value.confidence>1 ||
      Object.keys(value).some(k=>!['intent','query','confidence','description'].includes(k))) throw new Error('invalid_model_intent');
  return {intent:value.confidence>=0.75?value.intent:'clarify',query:clean(value.query,100),description:clean(value.description,1000),confidence:value.confidence};
}
export function renderDecision(value, {channel='shopping_room'}={}) {
  const intent=value?.intent, q=clean(value?.query,100), whatsapp=channel==='whatsapp';
  const base={intent:INTENTS.includes(intent)?intent:'clarify',ui:{type:'none'}};
  switch(base.intent) {
    case 'greeting': return whatsapp
      ? {...base,reply:'Oi! Posso te ajudar com as cestas, produtos ou ofertas. Se preferir, pode mandar um áudio também.'}
      : {...base,reply:'Olá! Você pode escolher uma cesta, procurar produtos ou me enviar uma foto ou áudio.'};
    case 'baskets': return whatsapp
      ? {...base,reply:'Claro. Posso te mostrar as cestas disponíveis e ajudar a personalizar os itens.',ui:{type:'baskets'}}
      : {...base,reply:'Você pode conferir as cestas e personalizar os itens.',ui:{type:'baskets'}};
    case 'offers': return whatsapp
      ? {...base,reply:'Temos ofertas disponíveis. Me diga o que você procura que eu separo as opções mais relevantes.',ui:{type:'products',offers:true}}
      : {...base,reply:'Confira as ofertas disponíveis na seleção abaixo.',ui:{type:'products',offers:true}};
    case 'search': return q
      ? (whatsapp
          ? {...base,reply:`Vou procurar ${q} para você.`,ui:{type:'products',q}}
          : {...base,reply:'Confira os resultados da busca e escolha os produtos que deseja.',ui:{type:'products',q}})
      : renderDecision({intent:'clarify'},{channel});
    case 'checkout': return whatsapp
      ? {...base,reply:'Vamos conferir os itens e os dados de entrega antes de confirmar o pedido.',ui:{type:'checkout'}}
      : {...base,reply:'Vamos conferir os itens e os dados de entrega. O pedido só será enviado quando você tocar em Confirmar pedido.',ui:{type:'checkout'}};
    case 'decline_upsell': return {...base,reply:'Perfeito. Vou focar somente no que você já escolheu.',ui:{type:'checkout'}};
    case 'fast_checkout': return whatsapp
      ? {...base,reply:'Claro. Vamos direto para a conferência do pedido.',ui:{type:'checkout'}}
      : {...base,reply:'Claro. Vamos direto para a conferência do pedido.',ui:{type:'checkout'}};
    case 'human': return whatsapp
      ? {...base,reply:'Claro. Vou deixar seu atendimento com a nossa equipe. O que você já informou fica salvo.',ui:{type:'human'}}
      : {...base,reply:'Para falar com nossa equipe, toque em Continuar pelo WhatsApp. Seu pedido permanece salvo.',ui:{type:'human'}};
    default: return whatsapp
      ? {...base,intent:'clarify',reply:'Me diz o nome do produto ou o que você quer fazer? Se preferir, posso deixar o atendimento com a nossa equipe.'}
      : {...base,intent:'clarify',reply:'Pode me dizer o nome do produto ou o que deseja fazer? Se preferir, continue com nossa equipe pelo WhatsApp.'};
  }
}
export function parseResponse(data) {
  if(data?.status!=='completed') throw new Error('model_response_incomplete');
  const content=(data.output||[]).flatMap(x=>x.content||[]);
  if(content.some(x=>x.type==='refusal')) throw new Error('model_refusal');
  const output=content.filter(x=>x.type==='output_text').map(x=>x.text).join('');
  return validateIntent(JSON.parse(output));
}
export function validateMedia(media,job) {
  if(!media || media.message_id!==job.message_id || media.conversation_id!==job.conversation_id || media.bucket!=='shopping-room-media') throw new Error('media_scope_mismatch');
  const prefix=`sessions/${media.catalog_session_id}/${media.kind}/`;
  if(!media.object_path?.startsWith(prefix) || media.object_path.includes('..') || !/^[a-zA-Z0-9/_.-]+$/.test(media.object_path)) throw new Error('invalid_media_path');
  if(!Number.isFinite(Number(media.bytes)) || Number(media.bytes)<=0 || Number(media.bytes)>10485760) throw new Error('media_size_limit');
  if(!(Date.parse(media.expires_at)>Date.now())) throw new Error('media_expired');
  const mime=String(media.mime_type).split(';')[0].trim().toLowerCase();
  // O WhatsApp Cloud normalmente entrega notas de voz como OGG/Opus. O endpoint de transcrição aceita OGG.
  const allowed=job.job_type==='transcription'?['audio/webm','audio/mpeg','audio/mp4','audio/ogg']:['image/jpeg','image/png','image/webp'];
  if(!allowed.includes(mime) || media.kind!==(job.job_type==='transcription'?'audio':'image')) throw new Error('media_conversion_required');
  return mime;
}
export async function readLimited(response,maxBytes) {
  if(Number(response.headers.get('content-length'))>maxBytes) throw new Error('media_size_limit');
  if(!response.body) throw new Error('empty_media');
  const reader=response.body.getReader(),chunks=[]; let total=0;
  try { while(true) {const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes)throw new Error('media_size_limit');chunks.push(value);} }
  finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  return new Blob(chunks);
}
