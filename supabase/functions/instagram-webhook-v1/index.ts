import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { classifyInstagramCommentIntentV1 } from "../_shared/instagram-policy-v1.mjs";

const JSON_HEADERS={"Content-Type":"application/json","Cache-Control":"no-store"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});
const clean=(v:unknown,max=1000)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const asObj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const asArr=(v:unknown):unknown[]=>Array.isArray(v)?v:[];

function unixOrIso(value:unknown,fallback:unknown){
  const raw=value??fallback;
  if(typeof raw==='number'&&Number.isFinite(raw))return new Date(raw>10_000_000_000?raw:raw*1000).toISOString();
  const d=new Date(String(raw??''));
  return Number.isNaN(d.getTime())?new Date().toISOString():d.toISOString();
}
function hexToBytes(hex:string){
  if(!/^[a-f0-9]{64}$/i.test(hex))return null;
  const out=new Uint8Array(32);for(let i=0;i<32;i++)out[i]=Number.parseInt(hex.slice(i*2,i*2+2),16);return out;
}
async function sha256Hex(text:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function verifyMetaSignature(raw:string,header:string,secret:string){
  const match=/^sha256=([a-f0-9]{64})$/i.exec(header);if(!match)return false;
  const sig=hexToBytes(match[1]);if(!sig)return false;
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,sig,new TextEncoder().encode(raw));
}
function attachmentType(message:Record<string,unknown>){
  if(asObj(message.quick_reply).payload)return 'quick_reply';
  const first=asObj(asArr(message.attachments)[0]);const type=clean(first.type,30).toLowerCase();
  if(['image','audio','video','document'].includes(type))return type;
  if(clean(message.text,1))return 'text';
  return 'unknown';
}

Deno.serve(async(req:Request)=>{
  const verifyToken=Deno.env.get('META_INSTAGRAM_VERIFY_TOKEN')||'';
  const appSecret=Deno.env.get('META_APP_SECRET')||'';
  const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';

  if(req.method==='GET'){
    const u=new URL(req.url),mode=u.searchParams.get('hub.mode')||'',token=u.searchParams.get('hub.verify_token')||'',challenge=u.searchParams.get('hub.challenge')||'';
    if(!verifyToken)return json({ok:false,error:'instagram_webhook_not_configured'},503);
    if(mode==='subscribe'&&token===verifyToken&&challenge)return new Response(challenge,{status:200,headers:{'Content-Type':'text/plain','Cache-Control':'no-store'}});
    return json({ok:false,error:'verification_failed'},403);
  }
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  if(!appSecret||!supabaseUrl||!serviceKey)return json({ok:false,error:'instagram_webhook_not_configured'},503);

  const raw=await req.text();
  const signature=req.headers.get('x-hub-signature-256')||'';
  if(!(await verifyMetaSignature(raw,signature,appSecret)))return json({ok:false,error:'invalid_signature'},401);

  let payload:Record<string,unknown>={};
  try{payload=asObj(JSON.parse(raw))}catch{return json({ok:false,error:'invalid_json'},400)}
  if(clean(payload.object,30).toLowerCase()!=='instagram')return json({ok:true,ignored:'unsupported_object'});

  const sb=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const payloadHash=await sha256Hex(raw);
  let accepted=0,held=0,comments=0,directs=0,ignored=0,errors=0;

  async function rawEvent(accountId:string,externalEventId:string,kind:string){
    const existing=await sb.from('channel_raw_events').select('id').eq('channel','instagram').eq('channel_account_id',accountId).eq('external_event_id',externalEventId).maybeSingle();
    if(existing.data?.id)return existing.data.id as string;
    const inserted=await sb.from('channel_raw_events').insert({channel:'instagram',channel_account_id:accountId,external_event_id:externalEventId,payload_sha256:payloadHash,metadata:{event_kind:kind,source:'meta_webhook'}}).select('id').maybeSingle();
    if(inserted.data?.id)return inserted.data.id as string;
    const raced=await sb.from('channel_raw_events').select('id').eq('channel','instagram').eq('channel_account_id',accountId).eq('external_event_id',externalEventId).maybeSingle();
    return raced.data?.id as string|undefined;
  }

  for(const entryRaw of asArr(payload.entry)){
    const entry=asObj(entryRaw),externalAccountId=clean(entry.id,200);
    if(!externalAccountId){ignored++;continue}
    const accountResult=await sb.from('channel_accounts').select('id,status,inbound_enabled').eq('channel','instagram').eq('external_account_id',externalAccountId).maybeSingle();
    if(accountResult.error){errors++;continue}
    const account=accountResult.data;
    if(!account?.id){ignored++;continue} // nunca auto-cadastra conta Meta

    for(const messagingRaw of asArr(entry.messaging)){
      const m=asObj(messagingRaw),sender=asObj(m.sender),recipient=asObj(m.recipient),message=asObj(m.message),postback=asObj(m.postback);
      const senderId=clean(sender.id,200),recipientId=clean(recipient.id,200);
      const direction=senderId===externalAccountId?'outbound':'inbound';
      const externalUserId=direction==='inbound'?senderId:recipientId;
      if(!externalUserId){ignored++;continue}
      const mid=clean(message.mid||postback.mid,500);
      const eventId=mid||`direct:${externalAccountId}:${clean(m.timestamp,50)}:${externalUserId}`;
      const type=Object.keys(postback).length?'button':asObj(m.reaction).reaction?'reaction':attachmentType(message);
      const referral={...asObj(m.referral),...asObj(message.referral)};
      const rawId=await rawEvent(account.id,eventId,'direct');
      const ingested=await sb.rpc('ingest_normalized_channel_event_v1',{p_event:{
        channel:'instagram',channel_account_id:account.id,external_user_id:externalUserId,
        external_message_id:mid||null,external_event_id:eventId,direction,message_type:type,
        source:'instagram_direct',timestamp:unixOrIso(m.timestamp,entry.time),raw_event_id:rawId||null,
        body_text:clean(message.text||postback.title,4000)||null,referral,
        context:{touchpoint_type:referral.ad_id?'ad':'direct',postback_payload:clean(postback.payload,1000)||null},
      }});
      if(ingested.error){errors++;continue}
      const normalizedId=ingested.data?.id;
      if(ingested.data?.status==='accepted')accepted++;else held++;
      directs++;
      if(direction==='inbound'&&normalizedId){
        const human=await sb.rpc('ensure_instagram_direct_human_v1',{p_normalized_event_id:normalizedId});
        if(human.error)errors++;
      }
    }

    for(const changeRaw of asArr(entry.changes)){
      const change=asObj(changeRaw),field=clean(change.field,50).toLowerCase();
      if(field!=='comments'&&field!=='live_comments'){ignored++;continue}
      const value=asObj(change.value),from=asObj(value.from),media=asObj(value.media);
      const commentId=clean(value.id||value.comment_id,500),externalUserId=clean(from.id,200);
      if(!commentId||!externalUserId){ignored++;continue}
      const intent=classifyInstagramCommentIntentV1(value.text);
      const referral={
        media_id:clean(media.id||value.media_id,500)||null,
        media_product_type:clean(media.media_product_type||value.media_product_type,100)||null,
        parent_id:clean(value.parent_id,500)||null,
        ad_id:clean(value.ad_id,500)||null,
        campaign_id:clean(value.campaign_id,500)||null,
        adset_id:clean(value.adset_id,500)||null,
        creative_id:clean(value.creative_id,500)||null,
      };
      const rawId=await rawEvent(account.id,commentId,field);
      const ingested=await sb.rpc('ingest_normalized_channel_event_v1',{p_event:{
        channel:'instagram',channel_account_id:account.id,external_user_id:externalUserId,
        external_event_id:commentId,direction:'inbound',message_type:'comment',source:'instagram_comment',
        timestamp:unixOrIso(value.created_time||value.timestamp,entry.time),raw_event_id:rawId||null,
        body_text:clean(value.text,4000)||null,referral,
        context:{touchpoint_type:field==='live_comments'?'live':'comment',is_live:field==='live_comments',comment_intent:intent.intent,comment_intent_confidence:intent.confidence,comment_intent_source:intent.source},
      }});
      if(ingested.error){errors++;continue}
      if(ingested.data?.status==='accepted')accepted++;else held++;
      comments++;
      if(ingested.data?.id){
        const recorded=await sb.rpc('record_instagram_comment_event_v1',{p_normalized_event_id:ingested.data.id});
        if(recorded.error)errors++;
      }
    }
  }

  return json({ok:true,accepted,held,comments,directs,ignored,errors});
});
