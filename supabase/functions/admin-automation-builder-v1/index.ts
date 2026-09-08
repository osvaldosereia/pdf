import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { compileWithOpenAI } from "./openai-compiler.ts";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=300)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const obj=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const arr=(v:unknown)=>Array.isArray(v)?v:[];
const keyOf=(v:unknown)=>{const s=clean(v,80).toLowerCase();return /^[a-z][a-z0-9_]{2,79}$/.test(s)?s:""};
const triggerTypes=new Set(["order","customer","inventory","expiry","delivery","payment","conversation","campaign","supplier","schedule","anomaly","manual"]);
const strategies=new Set(["github_action","supabase_realtime","supabase_cron","edge_function","make","manual_review"]);
const conditionOps=new Set(["eq","neq","in","not_in","gt","gte","lt","lte","exists","contains"]);
const conditionFields=new Set(["order.status","order.total","order.region","customer.id","customer.consent","customer.score","inventory.stock","inventory.days_to_expiry","delivery.status","payment.status","conversation.channel","conversation.handoff_open","campaign.id","supplier.id","risk.score","margin.percent"]);

function normalizeConditions(v:unknown){
  const out=[] as Record<string,unknown>[];
  for(const raw of arr(v)){
    const c=obj(raw) as Record<string,unknown>; const field=clean(c.field,80),op=clean(c.operator||c.op,20);
    if(!conditionFields.has(field)||!conditionOps.has(op))continue;
    out.push({field,operator:op,value:c.value??null});
  }
  return out;
}
function deterministicDraft(instruction:string,actionKeys:Set<string>){
  const l=instruction.toLowerCase();
  let trigger="manual";
  if(/todo dia|diari|seman|agend|schedule/.test(l))trigger="schedule"; else if(/validade|venc/.test(l))trigger="expiry"; else if(/estoque|ruptura/.test(l))trigger="inventory"; else if(/entrega|rota/.test(l))trigger="delivery"; else if(/pagamento|receb/.test(l))trigger="payment"; else if(/pedido/.test(l))trigger="order"; else if(/cliente/.test(l))trigger="customer"; else if(/conversa|whatsapp|mensagem/.test(l))trigger="conversation";
  const strategy=["schedule","inventory","expiry","anomaly","supplier","campaign"].includes(trigger)?"github_action":trigger==="conversation"?"manual_review":"manual_review";
  const candidates=["get_order","get_customer","search_products"].filter(k=>actionKeys.has(k));
  const actions=[] as Record<string,unknown>[];
  if(/pedido/.test(l)&&candidates.includes("get_order"))actions.push({action_key:"get_order",role:"system"});
  if(/cliente/.test(l)&&candidates.includes("get_customer"))actions.push({action_key:"get_customer",role:"system"});
  if(/produto|estoque|validade/.test(l)&&candidates.includes("search_products"))actions.push({action_key:"search_products",role:"system"});
  return {trigger_type:trigger,trigger_config:{source:"natural_language_draft"},conditions:[],actions,execution_strategy:strategy,source_kind:"natural_language",natural_language_source:instruction,enabled:false,execution_mode:"off",kill_switch:true,canary_percent:0,review_required:true,runtime_activation_supported:false,compiler:"deterministic_safe_fallback"};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!service)return json({ok:false,error:"server_config"},500);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return json({ok:false,error:"missing_token"},401);
  const sb=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await sb.auth.getUser(token);
  if(userError||!userData?.user?.id)return json({ok:false,error:"invalid_user"},401);
  const {data:admin,error:adminError}=await sb.from("admin_users").select("role,is_active,display_name").eq("user_id",userData.user.id).maybeSingle();
  if(adminError)return json({ok:false,error:"admin_lookup_failed"},500);
  if(!admin?.is_active)return json({ok:false,error:"admin_not_authorized"},403);
  const isOwner=admin.role==="owner";
  let body:any={};try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const op=clean(body?.action||"list",60).toLowerCase();

  if(op==="list"){
    const {data,error}=await sb.from("automation_workflows").select("id,workflow_key,display_name,description,enabled,execution_mode,execution_strategy,trigger_type,trigger_config,conditions,actions,budget_config,cooldown_seconds,canary_percent,kill_switch,requires_handoff_clear,source_kind,natural_language_source,metadata,current_version,updated_at").order("updated_at",{ascending:false});
    if(error)return json({ok:false,error:"workflow_read_failed",detail:error.message},500);
    return json({ok:true,user:{role:admin.role,display_name:admin.display_name||null},workflows:data||[],runtime_activation_supported:false});
  }

  if(op==="catalog"){
    const [{data:actions,error:aErr},{data:workflows,error:wErr}]=await Promise.all([
      sb.from("ai_action_registry").select("action_key,display_name,description,category,enabled,execution_mode,autonomy_level,confirmation_required,cost_class").order("category").order("action_key"),
      sb.from("automation_workflows").select("workflow_key,display_name,trigger_type,execution_strategy,enabled,execution_mode").order("workflow_key")
    ]);
    if(aErr||wErr)return json({ok:false,error:"catalog_failed",detail:aErr?.message||wErr?.message},500);
    return json({ok:true,actions:actions||[],workflows:workflows||[],trigger_types:[...triggerTypes],strategies:[...strategies],condition_operators:[...conditionOps],condition_fields:[...conditionFields],runtime_activation_supported:false});
  }

  if(op==="compile_draft"){
    const instruction=clean(body?.instruction,4000); if(instruction.length<8)return json({ok:false,error:"instruction_too_short"},400);
    const {data:actionRows,error}=await sb.from("ai_action_registry").select("action_key");
    if(error)return json({ok:false,error:"action_catalog_failed",detail:error.message},500);
    const actionKeys=new Set((actionRows||[]).map((x:any)=>String(x.action_key)));
    const requestedCompiler=clean(body?.compiler||"deterministic",30).toLowerCase();
    if(requestedCompiler==="openai"){
      if(!isOwner)return json({ok:false,error:"owner_required_for_paid_compiler"},403);
      try{
        const compiled=await compileWithOpenAI({instruction,actionKeys,triggerTypes,strategies,conditionFields,conditionOps});
        return json({ok:true,draft:compiled.draft,side_effect_performed:false,persisted:false,requires_human_review:true,openai_execution_performed:true,compiler:{provider:compiled.provider,model:compiled.model,input_tokens:compiled.input_tokens,output_tokens:compiled.output_tokens,estimated_cost_usd:compiled.estimated_cost_usd,cost_cap_usd:compiled.cost_cap_usd,response_id:compiled.response_id},note:"Rascunho OpenAI estrito; revisão humana obrigatória e nenhuma persistência/ativação automática."});
      }catch(e){
        const reason=clean(e instanceof Error?e.message:e,500);
        console.warn(JSON.stringify({event:"automation_openai_compiler_blocked",stage:10,reason:reason.split(":")[0],side_effect:false,persisted:false}));
        return json({ok:false,error:"openai_compiler_unavailable",detail:reason,fallback_available:true,side_effect_performed:false,persisted:false},409);
      }
    }
    if(requestedCompiler!=="deterministic")return json({ok:false,error:"invalid_compiler"},400);
    const draft=deterministicDraft(instruction,actionKeys);
    return json({ok:true,draft,side_effect_performed:false,persisted:false,requires_human_review:true,openai_execution_performed:false,compiler:{provider:"deterministic",estimated_cost_usd:0},note:"Fallback determinístico sem custo externo. OpenAI exige solicitação explícita do owner e gate server-side."});
  }

  if(op==="recommend_strategy"){
    const trigger=clean(body?.trigger_type,30);
    if(!triggerTypes.has(trigger))return json({ok:false,error:"invalid_trigger_type"},400);
    const {data,error}=await sb.rpc("recommend_automation_execution_strategy_v1",{p_trigger_type:trigger,p_requires_realtime:Boolean(body?.requires_realtime),p_external_connector:Boolean(body?.external_connector),p_deterministic:body?.deterministic!==false});
    if(error)return json({ok:false,error:"strategy_recommendation_failed",detail:error.message},400);
    return json({ok:true,recommendation:data});
  }

  if(op==="create_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const workflowKey=keyOf(body?.workflow_key);if(!workflowKey)return json({ok:false,error:"invalid_workflow_key"},400);
    const trigger=clean(body?.trigger_type,30);if(!triggerTypes.has(trigger))return json({ok:false,error:"invalid_trigger_type"},400);
    const strategy=clean(body?.execution_strategy||"manual_review",40);if(!strategies.has(strategy))return json({ok:false,error:"invalid_execution_strategy"},400);
    const metadata={...obj(body?.metadata),stage:10}; if(strategy==="make"&&!clean((metadata as any).make_justification,500))return json({ok:false,error:"make_requires_justification"},400);
    const row={workflow_key:workflowKey,display_name:clean(body?.display_name,120)||workflowKey,description:clean(body?.description,1000),trigger_type:trigger,trigger_config:obj(body?.trigger_config),conditions:normalizeConditions(body?.conditions),actions:arr(body?.actions),execution_strategy:strategy,enabled:false,execution_mode:"off",kill_switch:true,canary_percent:0,source_kind:clean(body?.source_kind||"admin",30),natural_language_source:body?.natural_language_source?clean(body.natural_language_source,4000):null,metadata,created_by:userData.user.id,updated_by:userData.user.id};
    const {data,error}=await sb.from("automation_workflows").insert(row).select("*").single();
    if(error)return json({ok:false,error:"workflow_create_failed",detail:error.message},400);
    const snapshot={...data};delete snapshot.created_at;delete snapshot.updated_at;
    await sb.from("automation_workflow_versions").insert({workflow_id:data.id,version:1,snapshot,status:"draft",change_reason:"initial_draft",created_by:userData.user.id});
    return json({ok:true,workflow:data,activated:false,kill_switch:true});
  }

  if(op==="update_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const id=clean(body?.workflow_id,80);if(!id)return json({ok:false,error:"workflow_id_required"},400);
    const allowed=new Set(["display_name","description","trigger_config","conditions","actions","budget_config","cooldown_seconds","requires_handoff_clear","natural_language_source","metadata"]);
    const patch=obj(body?.patch) as Record<string,unknown>;const safe:Record<string,unknown>={updated_by:userData.user.id};
    for(const [k,v] of Object.entries(patch))if(allowed.has(k))safe[k]=k==="conditions"?normalizeConditions(v):v;
    const {data,error}=await sb.from("automation_workflows").update(safe).eq("id",id).select("*").single();
    if(error)return json({ok:false,error:"workflow_update_failed",detail:error.message},400);
    const nextVersion=(Number(data.current_version)||1)+1;const snapshot={...data,current_version:nextVersion};delete snapshot.created_at;delete snapshot.updated_at;
    const {error:vErr}=await sb.from("automation_workflow_versions").insert({workflow_id:id,version:nextVersion,snapshot,status:"draft",change_reason:clean(body?.change_reason,500)||"draft_update",created_by:userData.user.id});
    if(vErr)return json({ok:false,error:"workflow_version_failed",detail:vErr.message},500);
    await sb.from("automation_workflows").update({current_version:nextVersion,updated_by:userData.user.id}).eq("id",id);
    return json({ok:true,workflow:{...data,current_version:nextVersion},activated:false});
  }

  if(op==="simulate"){
    const id=clean(body?.workflow_id,80);if(!id)return json({ok:false,error:"workflow_id_required"},400);
    const {data,error}=await sb.rpc("simulate_automation_workflow_v1",{p_workflow_id:id,p_input:obj(body?.input),p_has_open_handoff:Boolean(body?.has_open_handoff),p_idempotency_key:body?.idempotency_key?clean(body.idempotency_key,160):null});
    if(error)return json({ok:false,error:"simulation_failed",detail:error.message},400);
    return json({ok:true,simulation:data,side_effect_performed:false});
  }

  if(op==="validate"){
    const id=clean(body?.workflow_id,80);if(!id)return json({ok:false,error:"workflow_id_required"},400);
    const {data,error}=await sb.rpc("validate_automation_workflow_v1",{p_workflow_id:id});
    if(error)return json({ok:false,error:"validation_failed",detail:error.message},400);
    return json({ok:true,validation:data});
  }

  if(op==="kill"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const id=clean(body?.workflow_id,80);if(!id)return json({ok:false,error:"workflow_id_required"},400);
    const {data,error}=await sb.from("automation_workflows").update({enabled:false,execution_mode:"off",kill_switch:true,canary_percent:0,updated_by:userData.user.id}).eq("id",id).select("id,workflow_key,enabled,execution_mode,kill_switch,canary_percent").single();
    if(error)return json({ok:false,error:"kill_failed",detail:error.message},400);
    return json({ok:true,workflow:data});
  }
  return json({ok:false,error:"unknown_action"},400);
});
