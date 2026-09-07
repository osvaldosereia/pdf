import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const HEADERS={"Content-Type":"application/json","Cache-Control":"no-store"};
const clean=(v:unknown,max=4000)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max);
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const firstNonEmpty=(...values:unknown[])=>{for(const v of values){const c=clean(v,4000);if(c)return c}return ""};

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const base=Deno.env.get("SUPABASE_URL");
  if(!base)return json({ok:false,error:"server_config"},500);
  const bridgeKey=req.headers.get("x-da-ingest-key")||"";
  if(!bridgeKey)return json({ok:false,error:"unauthorized"},401);

  let form:FormData;
  try{form=await req.formData()}catch{return json({ok:false,error:"invalid_form"},400)}
  const raw={
    waba_id:clean(form.get("waba_id"),100),
    phone_number_id:clean(form.get("phone_number_id"),100),
    display_phone_number:clean(form.get("display_phone_number"),40),
    contact_name:clean(form.get("contact_name"),160),
    from:clean(form.get("from"),40),
    message_id:clean(form.get("message_id"),240),
    timestamp:clean(form.get("timestamp"),80),
    message_type:clean(form.get("message_type"),30),
    text_body:clean(form.get("text_body"),4000),
    caption:firstNonEmpty(form.get("image_caption"),form.get("video_caption"),form.get("document_caption")),
    audio_id:clean(form.get("audio_id"),240),
    image_id:clean(form.get("image_id"),240),
    video_id:clean(form.get("video_id"),240),
    document_id:clean(form.get("document_id"),240),
    interactive_type:clean(form.get("interactive_type"),40),
    interactive_id:firstNonEmpty(form.get("button_reply_id"),form.get("list_reply_id")),
    interactive_title:firstNonEmpty(form.get("button_reply_title"),form.get("list_reply_title")),
  };
  if(!raw.phone_number_id||!raw.from||!raw.message_id)return json({ok:false,error:"not_inbound_message",should_reply:false},200);

  const target=new URL("/functions/v1/whatsapp-ingest",base).toString();
  let upstream:Response;
  try{
    upstream=await fetch(target,{method:"POST",headers:{"Content-Type":"application/json","x-da-ingest-key":bridgeKey},body:JSON.stringify(raw),signal:AbortSignal.timeout(20000),redirect:"error"});
  }catch{return json({ok:false,error:"ingest_unavailable"},502)}
  const text=await upstream.text();
  return new Response(text,{status:upstream.status,headers:HEADERS});
});
