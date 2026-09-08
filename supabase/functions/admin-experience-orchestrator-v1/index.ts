import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(value:unknown,max=500)=>String(value??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const uuid=(value:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value,80));
const int=(value:unknown,min:number,max:number)=>Math.max(min,Math.min(max,Math.trunc(Number(value)||0)));
const object=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value:{};
const allowedTasks=new Set(["basket_customize","build_purchase","recommendations","product_search","browse","upsell","payment","delivery","hours","faq","order_status","checkout","confirm_order","conversation"]);

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"server_config"},500);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return json({ok:false,error:"missing_token"},401);
  const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await sb.auth.getUser(token);
  if(userError||!userData?.user?.id)return json({ok:false,error:"invalid_user"},401);
  const user=userData.user;
  const {data:admin,error:adminError}=await sb.from("admin_users").select("role,is_active,display_name").eq("user_id",user.id).maybeSingle();
  if(adminError)return json({ok:false,error:"admin_lookup_failed"},500);
  if(!admin?.is_active)return json({ok:false,error:"admin_not_authorized"},403);
  const canWrite=admin.role==="owner"||admin.role==="operator";
  const isOwner=admin.role==="owner";
  let body:any={};try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const action=clean(body?.action||"dashboard",60).toLowerCase();

  if(action==="dashboard"){
    const [{data:dashboard,error:dashError},{data:flowReadiness,error:flowError},{data:conversations,error:convError}]=await Promise.all([
      sb.rpc("get_experience_orchestrator_dashboard_v1"),
      sb.rpc("get_flow_contract_readiness_v1"),
      sb.from("conversations").select("id,channel,mode,status,stage,automation_cohort,human_required,updated_at").order("updated_at",{ascending:false}).limit(20),
    ]);
    if(dashError||flowError||convError)return json({ok:false,error:"dashboard_failed",detail:dashError?.message||flowError?.message||convError?.message},500);
    return json({ok:true,user:{id:user.id,role:admin.role,display_name:admin.display_name||null},dashboard,flow_readiness:flowReadiness,conversations:conversations||[]});
  }

  if(action==="preview"){
    const conversationId=clean(body?.conversation_id,80);
    if(!uuid(conversationId))return json({ok:false,error:"invalid_conversation_id"},400);
    const task=clean(body?.task,60).toLowerCase();
    if(!allowedTasks.has(task))return json({ok:false,error:"invalid_task"},400);
    const {data,error}=await sb.rpc("plan_next_experience_v1",{
      p_conversation_id:conversationId,
      p_task:task,
      p_candidate_count:int(body?.candidate_count,0,1000),
      p_structured_choice_count:int(body?.structured_choice_count,0,1000),
      p_visual_required:Boolean(body?.visual_required),
      p_context:object(body?.context),
    });
    if(error)return json({ok:false,error:"preview_failed",detail:error.message},400);
    return json({ok:true,plan:data});
  }

  if(!canWrite)return json({ok:false,error:"read_only"},403);

  if(action==="save_feature_config"){
    const featureKey=clean(body?.feature_key,80).toLowerCase();
    if(!/^[a-z0-9_]{3,80}$/.test(featureKey))return json({ok:false,error:"invalid_feature_key"},400);
    const config=object(body?.config);
    const {data,error}=await sb.from("experience_feature_flags").update({config,updated_at:new Date().toISOString()}).eq("key",featureKey).select("key,experience_type,enabled,rollout_percent,channel,config,updated_at").maybeSingle();
    if(error||!data)return json({ok:false,error:"feature_update_failed",detail:error?.message},400);
    return json({ok:true,feature:data});
  }

  if(action==="save_definition"){
    const id=clean(body?.id,80);if(!uuid(id))return json({ok:false,error:"invalid_definition_id"},400);
    const status=clean(body?.status||"draft",20).toLowerCase();
    if(!new Set(["draft","ready","paused","retired"]).has(status))return json({ok:false,error:"invalid_definition_status"},400);
    const purpose=clean(body?.purpose,2000);if(!purpose)return json({ok:false,error:"purpose_required"},400);
    const providerId=clean(body?.provider_id,200)||null;
    const providerVersion=clean(body?.provider_version,100)||null;
    const schemaVersion=int(body?.schema_version,1,1000)||1;
    const config=object(body?.config);
    const {data,error}=await sb.from("experience_definitions").update({status,purpose,provider_id:providerId,provider_version:providerVersion,schema_version:schemaVersion,config,updated_at:new Date().toISOString()}).eq("id",id).select("id,slug,feature_key,experience_type,purpose,status,provider,provider_id,provider_version,schema_version,config,updated_at").maybeSingle();
    if(error||!data)return json({ok:false,error:"definition_update_failed",detail:error?.message},400);
    return json({ok:true,definition:data});
  }

  // Kill switch global do orquestrador. Não há botão no Admin nesta fase.
  if(action==="configure_orchestrator"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const enabled=Boolean(body?.enabled);
    const confirmation=clean(body?.confirmation,80);
    if(enabled&&confirmation!=="ATIVAR_ORQUESTRADOR")return json({ok:false,error:"confirmation_required"},400);
    const {data,error}=await sb.from("automation_config").update({experience_orchestrator_enabled:enabled,updated_at:new Date().toISOString()}).eq("id",1).select("experience_orchestrator_enabled").single();
    if(error)return json({ok:false,error:"orchestrator_config_failed"},500);
    return json({ok:true,result:data});
  }

  return json({ok:false,error:"unknown_action"},400);
});
