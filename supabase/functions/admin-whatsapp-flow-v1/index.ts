import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(value:unknown,max=200)=>String(value??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);

function bytesToBase64(bytes:Uint8Array){let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,Math.min(i+0x8000,bytes.length)));return btoa(s)}
function derToPem(bytes:Uint8Array,label:"PRIVATE KEY"|"PUBLIC KEY"){const b64=bytesToBase64(bytes);return `-----BEGIN ${label}-----\n${(b64.match(/.{1,64}/g)||[]).join("\n")}\n-----END ${label}-----`}
async function generatePair(){
  const pair=await crypto.subtle.generateKey({name:"RSA-OAEP",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["encrypt","decrypt"]) as CryptoKeyPair;
  const privateDer=new Uint8Array(await crypto.subtle.exportKey("pkcs8",pair.privateKey));
  const publicDer=new Uint8Array(await crypto.subtle.exportKey("spki",pair.publicKey));
  return {privateKeyPem:derToPem(privateDer,"PRIVATE KEY"),publicKeyPem:derToPem(publicDer,"PUBLIC KEY")};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"),serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!serviceKey)return json({ok:false,error:"server_config"},500);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return json({ok:false,error:"missing_token"},401);
  const sb=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await sb.auth.getUser(token);
  if(userError||!userData?.user?.id)return json({ok:false,error:"invalid_user"},401);
  const {data:admin,error:adminError}=await sb.from("admin_users").select("role,is_active,display_name").eq("user_id",userData.user.id).maybeSingle();
  if(adminError)return json({ok:false,error:"admin_lookup_failed"},500);
  if(!admin?.is_active)return json({ok:false,error:"admin_not_authorized"},403);
  let body:any={};try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const action=clean(body?.action||"dashboard",60).toLowerCase();

  if(action==="dashboard"){
    const [{data:readiness,error:readinessError},{data:config,error:configError}]=await Promise.all([
      sb.rpc("get_whatsapp_flow_transport_readiness_v1"),
      sb.from("whatsapp_flow_transport_config").select("key_version,public_key_pem,public_key_fingerprint,meta_signature_status,meta_signature_checked_at,protocol_version,updated_at").eq("id",1).maybeSingle(),
    ]);
    if(readinessError||configError)return json({ok:false,error:"dashboard_failed",detail:readinessError?.message||configError?.message},500);
    return json({ok:true,user:{role:admin.role,display_name:admin.display_name||null},readiness,config});
  }

  if(admin.role!=="owner")return json({ok:false,error:"owner_required"},403);

  if(action==="generate_keypair"){
    if(clean(body?.confirmation,80)!=="GERAR_CHAVE_FLOW")return json({ok:false,error:"confirmation_required"},400);
    const {data:runtime,error:runtimeError}=await sb.from("automation_config").select("whatsapp_flow_data_exchange_enabled,whatsapp_flow_send_enabled").eq("id",1).single();
    if(runtimeError)return json({ok:false,error:"runtime_lookup_failed"},500);
    if(runtime.whatsapp_flow_data_exchange_enabled||runtime.whatsapp_flow_send_enabled)return json({ok:false,error:"disable_flow_transport_before_key_rotation"},409);
    const pair=await generatePair();
    const {data:installed,error:installError}=await sb.rpc("install_whatsapp_flow_private_key_v1",{p_private_key_pkcs8:pair.privateKeyPem,p_public_key_pem:pair.publicKeyPem});
    pair.privateKeyPem="";
    if(installError)return json({ok:false,error:"key_install_failed",detail:installError.message},500);
    return json({ok:true,result:installed,public_key_pem:pair.publicKeyPem,private_key_returned:false});
  }

  if(action==="disable_transport"){
    const {data,error}=await sb.from("automation_config").update({whatsapp_flow_data_exchange_enabled:false,whatsapp_flow_send_enabled:false,updated_at:new Date().toISOString()}).eq("id",1).select("whatsapp_flow_data_exchange_enabled,whatsapp_flow_send_enabled").single();
    if(error)return json({ok:false,error:"disable_failed"},500);
    return json({ok:true,result:data});
  }

  return json({ok:false,error:"unknown_action"},400);
});
