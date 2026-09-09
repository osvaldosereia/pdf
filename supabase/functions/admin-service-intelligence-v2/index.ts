import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=4000)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const uuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(v,80))?clean(v,80):"";
const strArray=(v:unknown,max=50)=>Array.isArray(v)?v.map(x=>clean(x,240)).filter(Boolean).slice(0,max):[];
const obj=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const priority=(v:unknown)=>Math.max(0,Math.min(100,Number(v??50)||50));
const norm=(v:unknown)=>String(v??"").normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const entityTable=(type:string)=>({
  knowledge:"service_knowledge_items",guidance:"service_guidance_rules",procedure:"service_procedures",
  block:"service_message_blocks",trigger:"service_trigger_rules",alias:"product_aliases",
  media:"service_media_library",regression_case:"service_regression_cases"
} as Record<string,string>)[type]||"";

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({ok:false,error:"server_config"},500);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return json({ok:false,error:"missing_token"},401);
  const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await sb.auth.getUser(token);if(userError||!userData?.user?.id)return json({ok:false,error:"invalid_user"},401);
  const {data:admin,error:adminError}=await sb.from("admin_users").select("role,is_active,display_name").eq("user_id",userData.user.id).maybeSingle();
  if(adminError)return json({ok:false,error:"admin_lookup_failed"},500);if(!admin?.is_active)return json({ok:false,error:"admin_not_authorized"},403);
  const isOwner=admin.role==="owner",canEdit=isOwner||["admin","manager"].includes(admin.role);
  let body:any={};try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const action=clean(body?.action||"dashboard",60).toLowerCase();

  if(action==="dashboard"){
    const results=await Promise.all([
      sb.from("service_intelligence_runtime_config").select("*").eq("id",1).maybeSingle(),
      sb.from("service_knowledge_items").select("id",{count:"exact",head:true}),
      sb.from("service_guidance_rules").select("id",{count:"exact",head:true}),
      sb.from("service_procedures").select("id",{count:"exact",head:true}),
      sb.from("service_message_blocks").select("id",{count:"exact",head:true}),
      sb.from("service_trigger_rules").select("id",{count:"exact",head:true}),
      sb.from("product_aliases").select("id",{count:"exact",head:true}),
      sb.from("products").select("id",{count:"exact",head:true}).eq("physically_verified",true).eq("is_active",true).gt("stock",0).gte("price",0)
    ]);
    const [{data:runtime},{count:knowledge},{count:guidance},{count:procedures},{count:blocks},{count:triggers},{count:aliases},{count:sellable}]=results as any;
    const {data:cfg}=await sb.from("automation_config").select("whatsapp_sales_mvp_enabled,whatsapp_sales_interactive_enabled,whatsapp_live_canary_percent,whatsapp_cost_first_router_enabled,whatsapp_cost_first_shadow_mode").eq("id",1).maybeSingle();
    return json({ok:true,user:{role:admin.role,display_name:admin.display_name||null},runtime,whatsapp:cfg,counts:{knowledge:knowledge||0,guidance:guidance||0,procedures:procedures||0,blocks:blocks||0,triggers:triggers||0,aliases:aliases||0,sellable_products:sellable||0}});
  }

  if(action==="list"){
    const type=clean(body?.type,40),table=entityTable(type);if(!table)return json({ok:false,error:"invalid_entity_type"},400);
    const status=clean(body?.status,30),q=clean(body?.q,120);let query:any=sb.from(table).select("*").order("updated_at",{ascending:false}).limit(300);
    if(status)query=query.eq("status",status);
    if(q){const field=type==="alias"?"alias":"title";query=query.ilike(field,`%${q.replace(/[%_,()]/g,'')}%`)}
    const {data,error}=await query;if(error)return json({ok:false,error:"list_failed",detail:error.message},500);return json({ok:true,items:data||[]});
  }

  if(action==="save"){
    if(!canEdit)return json({ok:false,error:"editor_required"},403);
    const type=clean(body?.type,40),table=entityTable(type);if(!table)return json({ok:false,error:"invalid_entity_type"},400);
    const id=uuid(body?.id);let row:any={updated_by:userData.user.id,updated_at:new Date().toISOString()};
    if(type==="knowledge")row={...row,knowledge_key:clean(body?.knowledge_key,100).toLowerCase(),category:clean(body?.category,80),title:clean(body?.title,180),content:clean(body?.content,12000),keywords:strArray(body?.keywords),channel_scope:strArray(body?.channel_scope).length?strArray(body?.channel_scope):["whatsapp"],priority:priority(body?.priority),source_note:clean(body?.source_note,500)||null};
    if(type==="guidance")row={...row,rule_key:clean(body?.rule_key,100).toLowerCase(),title:clean(body?.title,180),instruction:clean(body?.instruction,8000),intent_scope:strArray(body?.intent_scope),stage_scope:strArray(body?.stage_scope),channel_scope:strArray(body?.channel_scope).length?strArray(body?.channel_scope):["whatsapp"],behavior_tags:strArray(body?.behavior_tags),priority:priority(body?.priority)};
    if(type==="procedure")row={...row,procedure_key:clean(body?.procedure_key,100).toLowerCase(),title:clean(body?.title,180),trigger_description:clean(body?.trigger_description,2000),steps:Array.isArray(body?.steps)?body.steps.slice(0,30):[],allowed_actions:strArray(body?.allowed_actions),confirmation_actions:strArray(body?.confirmation_actions),fallback:clean(body?.fallback,2000)||null,intent_scope:strArray(body?.intent_scope),stage_scope:strArray(body?.stage_scope),priority:priority(body?.priority)};
    if(type==="block")row={...row,block_key:clean(body?.block_key,100).toLowerCase(),title:clean(body?.title,180),body_template:clean(body?.body_template,12000),delivery_mode:["text","image","interactive"].includes(body?.delivery_mode)?body.delivery_mode:"text",image_url_template:clean(body?.image_url_template,1200)||null,interactive_template:obj(body?.interactive_template),variables:strArray(body?.variables),channel_scope:strArray(body?.channel_scope).length?strArray(body?.channel_scope):["whatsapp"],priority:priority(body?.priority)};
    if(type==="trigger")row={...row,trigger_key:clean(body?.trigger_key,100).toLowerCase(),title:clean(body?.title,180),event_type:"inbound_message",match_mode:["exact","contains","regex","stage","always"].includes(body?.match_mode)?body.match_mode:"contains",patterns:strArray(body?.patterns),intent_scope:strArray(body?.intent_scope),stage_scope:strArray(body?.stage_scope),channel_scope:strArray(body?.channel_scope).length?strArray(body?.channel_scope):["whatsapp"],action_type:clean(body?.action_type,80)||"send_block",message_block_key:clean(body?.message_block_key,100)||null,action_payload:obj(body?.action_payload),priority:priority(body?.priority),stop_on_match:body?.stop_on_match!==false,once_per_conversation:Boolean(body?.once_per_conversation),cooldown_seconds:Math.max(0,Math.min(2592000,Number(body?.cooldown_seconds)||0)),requires_ai_mode:body?.requires_ai_mode!==false};
    if(type==="alias"){const alias=clean(body?.alias,180),normalized=clean(body?.normalized_alias,180).toLowerCase()||norm(alias);row={...row,alias,normalized_alias:normalized,canonical_query:clean(body?.canonical_query,180)||null,product_id:uuid(body?.product_id)||null,priority:priority(body?.priority),source_note:clean(body?.source_note,500)||null}}
    if(type==="media")row={...row,media_key:clean(body?.media_key,100).toLowerCase(),media_type:clean(body?.media_type,40),title:clean(body?.title,180),product_id:uuid(body?.product_id)||null,basket_id:uuid(body?.basket_id)||null,media_url:clean(body?.media_url,1000)||null,caption_template:clean(body?.caption_template,1000)||null,use_when:clean(body?.use_when,2000)||null};
    if(type==="regression_case")row={...row,case_key:clean(body?.case_key,100).toLowerCase(),title:clean(body?.title,180),customer_message:clean(body?.customer_message,4000),setup:obj(body?.setup),expected_intent:clean(body?.expected_intent,80)||null,expected_action:clean(body?.expected_action,80)||null,expected_assertions:obj(body?.expected_assertions),priority:priority(body?.priority)};
    const required=type==="knowledge"?[row.knowledge_key,row.category,row.title,row.content]:type==="guidance"?[row.rule_key,row.title,row.instruction]:type==="procedure"?[row.procedure_key,row.title,row.trigger_description]:type==="block"?[row.block_key,row.title,row.body_template]:type==="trigger"?[row.trigger_key,row.title,row.action_type]:type==="alias"?[row.alias,row.normalized_alias,row.product_id||row.canonical_query]:type==="media"?[row.media_key,row.media_type,row.title]:[row.case_key,row.title,row.customer_message];
    if(required.some((x:any)=>!x))return json({ok:false,error:"required_fields_missing"},400);
    let result:any,error:any;if(id){({data:result,error}=await sb.from(table).update(row).eq("id",id).select("*").single())}else{row.created_by=userData.user.id;({data:result,error}=await sb.from(table).insert(row).select("*").single())}
    if(error)return json({ok:false,error:"save_failed",detail:error.message},400);return json({ok:true,item:result});
  }

  if(action==="set_status"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const type=clean(body?.type,40),table=entityTable(type),id=uuid(body?.id),status=clean(body?.status,30);if(!table||!id)return json({ok:false,error:"invalid_entity"},400);
    const allowed=type==="regression_case"?["active","disabled","archived"]:["draft","published","archived"];if(!allowed.includes(status))return json({ok:false,error:"invalid_status"},400);
    const {data:item,error}=await sb.from(table).update({status,updated_by:userData.user.id,updated_at:new Date().toISOString()}).eq("id",id).select("*").single();if(error)return json({ok:false,error:"status_update_failed",detail:error.message},400);return json({ok:true,item});
  }

  if(action==="runtime"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const patch:any={updated_at:new Date().toISOString()};for(const k of ["enabled","knowledge_enabled","guidance_enabled","procedures_enabled","media_enabled","regression_suite_enabled","trigger_engine_enabled","dynamic_selection_enabled"])if(typeof body?.[k]==="boolean")patch[k]=body[k];
    for(const k of ["max_core_guidance_items","max_dynamic_guidance_items","max_dynamic_knowledge_items","max_dynamic_procedure_items"])if(Number.isFinite(Number(body?.[k])))patch[k]=Math.max(1,Math.min(20,Number(body[k])));
    if(["off","homologation","live"].includes(body?.execution_mode))patch.execution_mode=body.execution_mode;
    const {data,error}=await sb.from("service_intelligence_runtime_config").update(patch).eq("id",1).select("*").single();if(error)return json({ok:false,error:"runtime_update_failed",detail:error.message},400);return json({ok:true,runtime:data});
  }

  if(action==="router"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const patch:any={updated_at:new Date().toISOString()};if(typeof body?.enabled==="boolean")patch.whatsapp_cost_first_router_enabled=body.enabled;if(typeof body?.shadow_mode==="boolean")patch.whatsapp_cost_first_shadow_mode=body.shadow_mode;
    const {data,error}=await sb.from("automation_config").update(patch).eq("id",1).select("whatsapp_cost_first_router_enabled,whatsapp_cost_first_shadow_mode,whatsapp_live_canary_percent").single();if(error)return json({ok:false,error:"router_update_failed",detail:error.message},400);return json({ok:true,router:data});
  }

  if(action==="preview_bundle"){
    const {data,error}=await sb.rpc("get_service_intelligence_bundle_v2",{p_channel:"whatsapp",p_intent:clean(body?.intent,80)||null,p_stage:clean(body?.stage,80)||null,p_topic:clean(body?.topic,80)||null});if(error)return json({ok:false,error:"preview_failed",detail:error.message},400);return json({ok:true,bundle:data});
  }

  if(action==="product_search"){
    const {data,error}=await sb.rpc("resolve_whatsapp_product_candidates_v2",{p_text:clean(body?.q,240),p_limit:Math.max(1,Math.min(20,Number(body?.limit||10)))});if(error)return json({ok:false,error:"product_search_failed",detail:error.message},400);return json({ok:true,products:data||[],source:"counter_verified_cost_first"});
  }

  if(action==="simulate"){
    const message=clean(body?.message,4000),stage=clean(body?.stage,80)||"new",mode=clean(body?.mode,20)||"ai";
    if(!message)return json({ok:false,error:"message_required"},400);
    const [{data:trigger,error:tErr},{data:products,error:pErr},{data:bundle,error:bErr}]=await Promise.all([
      sb.rpc("get_service_trigger_match_v1",{p_channel:"whatsapp",p_text:message,p_stage:stage,p_mode:mode,p_conversation_id:null,p_intent:null}),
      sb.rpc("resolve_whatsapp_product_candidates_v2",{p_text:message,p_limit:8}),
      sb.rpc("get_service_intelligence_bundle_v2",{p_channel:"whatsapp",p_intent:clean(body?.intent,80)||null,p_stage:stage,p_topic:clean(body?.topic,80)||null})
    ]);
    if(tErr||pErr||bErr)return json({ok:false,error:"simulation_failed",detail:tErr?.message||pErr?.message||bErr?.message},400);
    return json({ok:true,simulation:{message,stage,trigger,products:products||[],bundle,estimated_ai_needed:!(trigger?.matched)}});
  }

  if(action==="cost_metrics"){
    const hours=Math.max(1,Math.min(720,Number(body?.hours||24)));
    const since=new Date(Date.now()-hours*3600000).toISOString();
    const [{data:events},{data:usage}]=await Promise.all([
      sb.from("service_trigger_events").select("execution_mode,estimated_ai_calls_saved,estimated_input_tokens_avoided,created_at").gte("created_at",since),
      sb.from("ai_usage_events").select("model,input_tokens,output_tokens,estimated_cost_usd,status,created_at").gte("created_at",since).eq("status","done")
    ]);
    const ev=events||[],u=usage||[];return json({ok:true,metrics:{hours,deterministic_events:ev.filter((x:any)=>x.execution_mode==="deterministic").length,shadow_events:ev.filter((x:any)=>x.execution_mode==="shadow").length,estimated_ai_calls_saved:ev.reduce((s:number,x:any)=>s+Number(x.estimated_ai_calls_saved||0),0),input_tokens:u.reduce((s:number,x:any)=>s+Number(x.input_tokens||0),0),output_tokens:u.reduce((s:number,x:any)=>s+Number(x.output_tokens||0),0),estimated_cost_usd:u.reduce((s:number,x:any)=>s+Number(x.estimated_cost_usd||0),0)}});
  }

  return json({ok:false,error:"unknown_action"},400);
});
