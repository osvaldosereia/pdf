import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const encoder=new TextEncoder();
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=500)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const arr=(v:unknown)=>Array.isArray(v)?v:[];
const asArrayBuffer=(value:Uint8Array)=>value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength) as ArrayBuffer;

async function hmacHex(secret:string,body:Uint8Array){
  const secretBytes=encoder.encode(secret);
  const key=await crypto.subtle.importKey("raw",asArrayBuffer(secretBytes),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,asArrayBuffer(body));
  return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function safeEqual(a:string,b:string){
  if(a.length!==b.length) return false;
  let diff=0;
  for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
function eventsFromWebhook(body:any){
  const out:any[]=[];
  for(const entry of arr(body?.entry) as any[]){
    const externalAccountId=clean((entry as any)?.id,200);
    if(!externalAccountId) continue;
    for(const item of arr((entry as any)?.messaging) as any[]){
      const senderId=clean(item?.sender?.id,200), mid=clean(item?.message?.mid,300);
      if(!senderId||!mid||item?.message?.is_echo===true) continue;
      out.push({kind:"direct",external_account_id:externalAccountId,event:{external_user_id:senderId,external_message_id:mid,message_type:item?.message?.attachments?.length?"image":"text",body_text:clean(item?.message?.text,4096)||null,reply_to:clean(item?.message?.reply_to?.mid,300)||null,source:"instagram_direct",referral:item?.referral&&typeof item.referral==="object"?item.referral:{},timestamp:item?.timestamp?new Date(Number(item.timestamp)).toISOString():new Date().toISOString(),context:{recipient_external_id:clean(item?.recipient?.id,200)||null}}});
    }
    for(const change of arr((entry as any)?.changes) as any[]){
      const field=clean(change?.field,40).toLowerCase();
      if(!["comments","live_comments"].includes(field)) continue;
      const value=change?.value&&typeof change.value==="object"?change.value:{};
      const commentId=clean(value?.id,300), authorId=clean(value?.from?.id,200);
      if(!commentId||!authorId) continue;
      out.push({kind:"comment",external_account_id:externalAccountId,event:{external_user_id:authorId,external_message_id:commentId,message_type:"comment",body_text:clean(value?.text,4096)||null,reply_to:clean(value?.parent_id,300)||null,source:"instagram_comment",referral:{media_id:clean(value?.media?.id||value?.media_id,300)||null,media_product_type:clean(value?.media?.media_product_type,80)||null},timestamp:value?.created_time||new Date().toISOString(),context:{username:clean(value?.from?.username,200)||null,field}}});
    }
  }
  return out;
}

Deno.serve(async(req:Request)=>{
  const runtimeEnabled=Deno.env.get("META_INSTAGRAM_WEBHOOK_RUNTIME_ENABLED")==="true";
  if(!runtimeEnabled) return json({ok:false,error:"instagram_webhook_runtime_disabled"},503);

  if(req.method==="GET"){
    const url=new URL(req.url);
    const mode=url.searchParams.get("hub.mode")||"";
    const token=url.searchParams.get("hub.verify_token")||"";
    const challenge=url.searchParams.get("hub.challenge")||"";
    const expected=Deno.env.get("META_WEBHOOK_VERIFY_TOKEN")||"";
    if(mode!=="subscribe"||!expected||!safeEqual(token,expected)) return new Response("Forbidden",{status:403});
    return new Response(challenge,{status:200,headers:{"Content-Type":"text/plain","Cache-Control":"no-store"}});
  }
  if(req.method!=="POST") return json({ok:false,error:"method_not_allowed"},405);

  const appSecret=Deno.env.get("META_APP_SECRET")||"";
  const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!appSecret||!supabaseUrl||!serviceKey) return json({ok:false,error:"server_config"},500);

  const raw=new Uint8Array(await req.arrayBuffer());
  const provided=(req.headers.get("x-hub-signature-256")||"").replace(/^sha256=/i,"").toLowerCase();
  const expected=await hmacHex(appSecret,raw);
  if(!provided||!safeEqual(provided,expected)) return json({ok:false,error:"invalid_meta_signature"},401);

  let payload:any;
  try{payload=JSON.parse(new TextDecoder().decode(raw));}catch{return json({ok:false,error:"invalid_json"},400);}
  if(payload?.object!=="instagram") return json({ok:true,ignored:true,reason:"unsupported_object"},200);

  const sb=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const events=eventsFromWebhook(payload);
  const results=[];
  for(const item of events){
    const {data:account,error:accountError}=await sb.from("channel_accounts").select("id,status,inbound_enabled").eq("channel","instagram").eq("external_account_id",item.external_account_id).maybeSingle();
    if(accountError){results.push({kind:item.kind,accepted:false,reason:"account_lookup_failed"});continue;}
    if(!account?.id){results.push({kind:item.kind,accepted:false,reason:"instagram_account_not_configured"});continue;}
    const {data,error}=await sb.rpc("ingest_instagram_observation_v1",{p_channel_account_id:account.id,p_kind:item.kind,p_event:item.event});
    results.push(error?{kind:item.kind,accepted:false,reason:"ingest_failed"}:{kind:item.kind,...(data||{})});
  }
  return json({ok:true,received:events.length,results},200);
});
