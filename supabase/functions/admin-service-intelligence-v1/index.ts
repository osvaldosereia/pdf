import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=2000)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const uuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(v,80))?clean(v,80):"";
const strArray=(v:unknown,max=30)=>Array.isArray(v)?v.map(x=>clean(x,120)).filter(Boolean).slice(0,max):[];
const obj=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const entityTable=(type:string)=>({knowledge:"service_knowledge_items",guidance:"service_guidance_rules",procedure:"service_procedures",media:"service_media_library",regression_case:"service_regression_cases"} as Record<string,string>)[type]||"";

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!key)return json({ok:false,error:"server_config"},500);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return json({ok:false,error:"missing_token"},401);
  const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:userData,error:userError}=await sb.auth.getUser(token);if(userError||!userData?.user?.id)return json({ok:false,error:"invalid_user"},401);
  const {data:admin,error:adminError}=await sb.from("admin_users").select("role,is_active,display_name").eq("user_id",userData.user.id).maybeSingle();if(adminError)return json({ok:false,error:"admin_lookup_failed"},500);if(!admin?.is_active)return json({ok:false,error:"admin_not_authorized"},403);
  const isOwner=admin.role==="owner";const canEdit=isOwner||["admin","manager"].includes(admin.role);
  let body:any={};try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const action=clean(body?.action||"dashboard",60).toLowerCase();

  if(action==="dashboard"){
    const [{data:runtime},{count:knowledge},{count:guidance},{count:procedures},{count:tests},{count:verified},{count:sellable}]=await Promise.all([
      sb.from("service_intelligence_runtime_config").select("*").eq("id",1).maybeSingle(),
      sb.from("service_knowledge_items").select("id",{count:"exact",head:true}),
      sb.from("service_guidance_rules").select("id",{count:"exact",head:true}),
      sb.from("service_procedures").select("id",{count:"exact",head:true}),
      sb.from("service_regression_cases").select("id",{count:"exact",head:true}).eq("status","active"),
      sb.from("products").select("id",{count:"exact",head:true}).eq("physically_verified",true).eq("is_active",true),
      sb.from("products").select("id",{count:"exact",head:true}).eq("physically_verified",true).eq("is_active",true).gt("stock",0).gte("price",0)
    ]);
    const {data:cfg}=await sb.from("automation_config").select("whatsapp_sales_mvp_enabled,whatsapp_sales_catalog_source,whatsapp_sales_images_enabled,whatsapp_sales_interactive_enabled,whatsapp_sales_order_submit_enabled,whatsapp_sales_bling_submit_enabled,whatsapp_live_canary_percent,bling_order_sync_enabled,bling_order_homologation_only").eq("id",1).maybeSingle();
    return json({ok:true,user:{role:admin.role,display_name:admin.display_name||null},runtime,whatsapp:cfg,counts:{knowledge:knowledge||0,guidance:guidance||0,procedures:procedures||0,tests:tests||0,verified_products:verified||0,sellable_products:sellable||0},catalog_source:"counter_verified"});
  }

  if(action==="list"){
    const type=clean(body?.type,40),table=entityTable(type);if(!table)return json({ok:false,error:"invalid_entity_type"},400);
    const status=clean(body?.status,30),q=clean(body?.q,120);let query:any=sb.from(table).select("*").order("updated_at",{ascending:false}).limit(200);
    if(status)query=query.eq("status",status);
    if(q){const field=type==="knowledge"?"title":type==="guidance"?"title":type==="procedure"?"title":type==="media"?"title":"title";query=query.ilike(field,`%${q.replace(/[%_,()]/g,'')}%`)}
    const {data,error}=await query;if(error)return json({ok:false,error:"list_failed",detail:error.message},500);return json({ok:true,items:data||[]});
  }

  if(action==="save"){
    if(!canEdit)return json({ok:false,error:"editor_required"},403);
    const type=clean(body?.type,40),table=entityTable(type);if(!table)return json({ok:false,error:"invalid_entity_type"},400);const id=uuid(body?.id);let row:any={updated_by:userData.user.id,updated_at:new Date().toISOString()};
    if(type==="knowledge")row={...row,knowledge_key:clean(body?.knowledge_key,100).toLowerCase(),category:clean(body?.category,80),title:clean(body?.title,180),content:clean(body?.content,12000),keywords:strArray(body?.keywords),channel_scope:strArray(body?.channel_scope).length?strArray(body?.channel_scope):["whatsapp"],priority:Math.max(0,Math.min(100,Number(body?.priority??50)||50)),source_note:clean(body?.source_note,500)||null};
    if(type==="guidance")row={...row,rule_key:clean(body?.rule_key,100).toLowerCase(),title:clean(body?.title,180),instruction:clean(body?.instruction,8000),intent_scope:strArray(body?.intent_scope),stage_scope:strArray(body?.stage_scope),channel_scope:strArray(body?.channel_scope).length?strArray(body?.channel_scope):["whatsapp"],behavior_tags:strArray(body?.behavior_tags),priority:Math.max(0,Math.min(100,Number(body?.priority??50)||50))};
    if(type==="procedure")row={...row,procedure_key:clean(body?.procedure_key,100).toLowerCase(),title:clean(body?.title,180),trigger_description:clean(body?.trigger_description,2000),steps:Array.isArray(body?.steps)?body.steps.slice(0,30):[],allowed_actions:strArray(body?.allowed_actions),confirmation_actions:strArray(body?.confirmation_actions),fallback:clean(body?.fallback,2000)||null,priority:Math.max(0,Math.min(100,Number(body?.priority??50)||50))};
    if(type==="media")row={...row,media_key:clean(body?.media_key,100).toLowerCase(),media_type:clean(body?.media_type,40),title:clean(body?.title,180),product_id:uuid(body?.product_id)||null,basket_id:uuid(body?.basket_id)||null,media_url:clean(body?.media_url,1000)||null,caption_template:clean(body?.caption_template,1000)||null,use_when:clean(body?.use_when,2000)||null};
    if(type==="regression_case")row={...row,case_key:clean(body?.case_key,100).toLowerCase(),title:clean(body?.title,180),customer_message:clean(body?.customer_message,4000),setup:obj(body?.setup),expected_intent:clean(body?.expected_intent,80)||null,expected_action:clean(body?.expected_action,80)||null,expected_assertions:obj(body?.expected_assertions),priority:Math.max(0,Math.min(100,Number(body?.priority??50)||50))};
    const required=type==="knowledge"?[row.knowledge_key,row.category,row.title,row.content]:type==="guidance"?[row.rule_key,row.title,row.instruction]:type==="procedure"?[row.procedure_key,row.title,row.trigger_description]:type==="media"?[row.media_key,row.media_type,row.title]:[row.case_key,row.title,row.customer_message];if(required.some((x:any)=>!x))return json({ok:false,error:"required_fields_missing"},400);
    let result:any,error:any;if(id){({data:result,error}=await sb.from(table).update(row).eq("id",id).select("*").single())}else{row.created_by=userData.user.id;({data:result,error}=await sb.from(table).insert(row).select("*").single())}
    if(error)return json({ok:false,error:"save_failed",detail:error.message},400);return json({ok:true,item:result});
  }

  if(action==="set_status"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);const type=clean(body?.type,40),table=entityTable(type),id=uuid(body?.id),status=clean(body?.status,30);if(!table||!id)return json({ok:false,error:"invalid_entity"},400);
    const allowed=type==="regression_case"?["active","disabled","archived"]:["draft","published","archived"];if(!allowed.includes(status))return json({ok:false,error:"invalid_status"},400);
    const {data:before}=await sb.from(table).select("status").eq("id",id).maybeSingle();if(!before)return json({ok:false,error:"entity_not_found"},404);
    const {data:item,error}=await sb.from(table).update({status,updated_by:userData.user.id,updated_at:new Date().toISOString()}).eq("id",id).select("*").single();if(error)return json({ok:false,error:"status_update_failed",detail:error.message},400);
    await sb.from("service_intelligence_publication_events").insert({entity_type:type,entity_id:id,from_status:before.status,to_status:status,actor_user_id:userData.user.id,note:clean(body?.note,500)||null});return json({ok:true,item});
  }

  if(action==="runtime"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);const patch:any={updated_at:new Date().toISOString()};for(const k of ["enabled","knowledge_enabled","guidance_enabled","procedures_enabled","media_enabled","regression_suite_enabled"])if(typeof body?.[k]==="boolean")patch[k]=body[k];if(["off","homologation","live"].includes(body?.execution_mode))patch.execution_mode=body.execution_mode;
    const {data,error}=await sb.from("service_intelligence_runtime_config").update(patch).eq("id",1).select("*").single();if(error)return json({ok:false,error:"runtime_update_failed",detail:error.message},400);return json({ok:true,runtime:data});
  }

  if(action==="preview_bundle"){
    const {data,error}=await sb.rpc("get_service_intelligence_bundle_v1",{p_channel:"whatsapp",p_intent:clean(body?.intent,80)||null,p_stage:clean(body?.stage,80)||null});if(error)return json({ok:false,error:"preview_failed",detail:error.message},400);return json({ok:true,bundle:data});
  }

  if(action==="product_search"){
    const {data,error}=await sb.rpc("search_whatsapp_sellable_products_v1",{p_query:clean(body?.q,120),p_limit:Math.max(1,Math.min(20,Number(body?.limit||10)))});if(error)return json({ok:false,error:"product_search_failed",detail:error.message},400);return json({ok:true,products:data||[],source:"counter_verified"});
  }

  return json({ok:false,error:"unknown_action"},400);
});
