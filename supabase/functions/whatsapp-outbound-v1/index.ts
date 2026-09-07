import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Headers": "content-type,x-da-ingest-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const clean=(v:unknown,max=500)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
async function sha256Hex(value:string){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:HEADERS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);

  const url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!serviceKey)return json({ok:false,error:"server_config"},500);
  const sb=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

  const supplied=req.headers.get("x-da-ingest-key")||"";
  if(!supplied)return json({ok:false,error:"unauthorized"},401);
  const {data:secret,error:secretError}=await sb.from("system_secrets").select("key_hash,is_active").eq("key_name","make_whatsapp_ingest").maybeSingle();
  if(secretError||!secret?.is_active||(await sha256Hex(supplied))!==secret.key_hash)return json({ok:false,error:"unauthorized"},401);

  let body:any={};
  try{body=await req.json()}catch{body={};}
  const action=clean(body?.action,30).toLowerCase();

  if(action==="health"||action==="status"||!action){
    const {data:cfg}=await sb.from("automation_config")
      .select("automation_enabled,outbound_enabled,ai_enabled,conversation_worker_enabled,whatsapp_inbound_enabled,whatsapp_auto_reply_enabled")
      .eq("id",1).maybeSingle();
    const {count}=await sb.from("outbound_jobs")
      .select("id",{count:"exact",head:true})
      .eq("job_type","seller_message")
      .in("status",["pending","processing","error"]);
    return json({
      ok:true,
      transport:"pg_net_make_webhook_response_v3",
      legacy_claim_finish_disabled:true,
      active_seller_message_jobs:count??0,
      gates:cfg??null,
    });
  }

  if(action==="claim"||action==="finish"){
    return json({ok:false,error:"deprecated_event_driven_v3",transport:"pg_net_make_webhook_response_v3"},410);
  }

  return json({ok:false,error:"unknown_action"},400);
});
