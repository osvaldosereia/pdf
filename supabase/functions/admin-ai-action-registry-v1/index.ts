import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=300)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const obj=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const actionKey=(v:unknown)=>{const s=clean(v,80).toLowerCase();return /^[a-z][a-z0-9_]{2,79}$/.test(s)?s:""};

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
  const {data:admin,error:adminError}=await sb.from("admin_users").select("role,is_active,display_name").eq("user_id",userData.user.id).maybeSingle();
  if(adminError)return json({ok:false,error:"admin_lookup_failed"},500);
  if(!admin?.is_active)return json({ok:false,error:"admin_not_authorized"},403);
  const isOwner=admin.role==="owner";
  let body:any={};try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const op=clean(body?.action||"list",60).toLowerCase();

  if(op==="list"){
    const {data,error}=await sb.from("ai_action_registry").select("action_key,version,display_name,description,category,implementation_kind,implementation_ref,input_schema,output_schema,preconditions,side_effects,compensation,confirmation_required,autonomy_level,max_amount_brl,allowed_channels,allowed_roles,idempotency_strategy,cost_class,enabled,execution_mode,requires_human_handoff_clear,metadata,updated_at").order("category").order("action_key");
    if(error)return json({ok:false,error:"registry_read_failed",detail:error.message},500);
    return json({ok:true,user:{role:admin.role,display_name:admin.display_name||null},actions:data||[],runtime_activation_supported:false});
  }

  if(op==="simulate"){
    const keyName=actionKey(body?.action_key);if(!keyName)return json({ok:false,error:"invalid_action_key"},400);
    const amount=body?.amount_brl===null||body?.amount_brl===undefined?null:Number(body.amount_brl);
    if(amount!==null&&(!Number.isFinite(amount)||amount<0))return json({ok:false,error:"invalid_amount"},400);
    const {data,error}=await sb.rpc("simulate_ai_action_v1",{
      p_action_key:keyName,
      p_input:obj(body?.input),
      p_channel:clean(body?.channel,30)||null,
      p_role:clean(body?.role||admin.role,30),
      p_amount_brl:amount,
      p_has_open_handoff:Boolean(body?.has_open_handoff),
    });
    if(error)return json({ok:false,error:"simulation_failed",detail:error.message},400);
    return json({ok:true,simulation:data,side_effect_performed:false});
  }

  if(op==="save_policy_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const keyName=actionKey(body?.action_key);if(!keyName)return json({ok:false,error:"invalid_action_key"},400);
    const {data:latest,error:latestError}=await sb.from("ai_action_policy_versions").select("version").eq("action_key",keyName).order("version",{ascending:false}).limit(1);
    if(latestError)return json({ok:false,error:"policy_version_lookup_failed",detail:latestError.message},500);
    const version=(latest?.[0]?.version||0)+1;
    const {data,error}=await sb.from("ai_action_policy_versions").insert({action_key:keyName,version,policy:obj(body?.policy),status:"draft",created_by:userData.user.id}).select("id,action_key,version,policy,status,created_at").single();
    if(error)return json({ok:false,error:"policy_draft_failed",detail:error.message},400);
    return json({ok:true,policy:data,activated:false});
  }

  if(op==="update_metadata"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const keyName=actionKey(body?.action_key);if(!keyName)return json({ok:false,error:"invalid_action_key"},400);
    const allowed=new Set(["display_name","description","input_schema","output_schema","preconditions","side_effects","compensation","confirmation_required","autonomy_level","max_amount_brl","allowed_channels","allowed_roles","idempotency_strategy","cost_class","requires_human_handoff_clear","metadata"]);
    const patch=obj(body?.patch) as Record<string,unknown>;
    const safePatch:Record<string,unknown>={};
    for(const [k,v] of Object.entries(patch))if(allowed.has(k))safePatch[k]=v;
    if(!Object.keys(safePatch).length)return json({ok:false,error:"empty_patch"},400);
    // Intencionalmente não permite enabled/execution_mode/implementation_ref: esta etapa não ativa runtime.
    const {data,error}=await sb.from("ai_action_registry").update(safePatch).eq("action_key",keyName).select("action_key,version,display_name,description,category,preconditions,side_effects,confirmation_required,autonomy_level,max_amount_brl,allowed_channels,allowed_roles,idempotency_strategy,cost_class,enabled,execution_mode,requires_human_handoff_clear,metadata,updated_at").single();
    if(error)return json({ok:false,error:"metadata_update_failed",detail:error.message},400);
    return json({ok:true,action:data,activated:false});
  }

  return json({ok:false,error:"unknown_action"},400);
});
