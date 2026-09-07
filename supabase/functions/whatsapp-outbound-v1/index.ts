import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const WORKER = "make-whatsapp-outbound-v1";
const HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Headers": "content-type,x-da-ingest-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const clean=(v:unknown,max=500)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const validUuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(v,80));
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

  const requestUrl=new URL(req.url);
  const query=requestUrl.searchParams;
  let body:any={};
  const bodyLength=Number(req.headers.get("content-length")||0);
  const contentType=req.headers.get("content-type")||"";
  if(bodyLength>0||contentType.includes("application/json")){
    try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  }
  const action=clean(query.get("action")||body?.action,30).toLowerCase();

  if(action==="claim"){
    const {data,error}=await sb.rpc("claim_whatsapp_conversation_outbound",{p_worker:WORKER});
    if(error)return json({ok:false,error:"claim_failed"},500);
    if(!data)return json({ok:true,job:null});
    if(data?.skipped)return json({ok:true,job:null,skipped:data.reason||"unavailable"});
    return json({ok:true,job:data});
  }

  if(action==="finish"){
    const jobId=clean(query.get("job_id")||body?.job_id,80);
    const successRaw=query.get("success");
    const success=successRaw!==null ? successRaw==="true" : body?.success===true;
    if(!validUuid(jobId))return json({ok:false,error:"invalid_job_id"},400);
    const providerMessageId=clean(query.get("provider_message_id")||body?.provider_message_id,300)||null;
    const errorText=success?null:(clean(query.get("error")||body?.error,1000)||"whatsapp_send_failed");
    const {data,error}=await sb.rpc("finish_whatsapp_conversation_outbound",{
      p_job_id:jobId,p_worker:WORKER,p_success:success,p_provider_message_id:providerMessageId,p_error:errorText
    });
    if(error)return json({ok:false,error:"finish_failed"},409);
    return json({ok:true,result:data});
  }

  return json({ok:false,error:"unknown_action"},400);
});
