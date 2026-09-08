import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods":"POST,OPTIONS",
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=500)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const validUuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(v,80));
const bool=(v:unknown,fallback=false)=>typeof v==="boolean"?v:fallback;
const nullableNonNegativeInt=(v:unknown)=>{
  if(v==null||v==="")return null;
  const n=Number(v);
  return Number.isInteger(n)&&n>=0?n:NaN;
};
const nullableIso=(v:unknown)=>{
  const s=clean(v,80);
  if(!s)return null;
  const d=new Date(s);
  return Number.isNaN(d.getTime())?undefined:d.toISOString();
};
const objectOrEmpty=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};

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
  if(!admin?.is_active||!["owner","operator"].includes(admin.role))return json({ok:false,error:"admin_not_authorized"},403);

  let body:Record<string,unknown>={};
  try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const action=clean(body.action||"readiness",60).toLowerCase();

  if(action==="readiness"){
    const {data,error}=await sb.rpc("financial_stage13_readiness_v1");
    if(error)return json({ok:false,error:"readiness_failed",detail:error.message},500);
    return json({ok:true,user:{id:user.id,role:admin.role},readiness:data});
  }

  if(action==="dashboard"){
    const {data,error}=await sb.rpc("get_financial_admin_dashboard_v1");
    if(error)return json({ok:false,error:"financial_dashboard_failed",detail:error.message},500);
    if(!data?.ok)return json(data,409);
    return json({ok:true,user:{id:user.id,role:admin.role},dashboard:data});
  }

  if(action==="order"){
    const orderId=clean(body.order_id,80);
    if(!validUuid(orderId))return json({ok:false,error:"invalid_order_id"},400);
    const {data,error}=await sb.rpc("get_financial_admin_order_v1",{p_order_id:orderId});
    if(error)return json({ok:false,error:"financial_order_failed",detail:error.message},400);
    if(!data?.ok)return json(data,409);
    return json({ok:true,order:data});
  }

  if(action==="policies"){
    const scope=clean(body.scope_key,40).toLowerCase()||null;
    if(scope&&!['reconciliation','route_close','fiscal_projection'].includes(scope))return json({ok:false,error:"invalid_policy_scope"},400);
    const {data,error}=await sb.rpc("list_financial_policies_v1",{p_scope_key:scope});
    if(error)return json({ok:false,error:"financial_policies_failed",detail:error.message},400);
    if(!data?.ok)return json(data,409);
    return json({ok:true,user:{id:user.id,role:admin.role},policies:data.items||[]});
  }

  if(action==="projection_preview"){
    const orderId=clean(body.order_id,80);
    if(!validUuid(orderId))return json({ok:false,error:"invalid_order_id"},400);
    const {data,error}=await sb.rpc("preview_financial_fiscal_projection_v1",{p_order_id:orderId});
    if(error)return json({ok:false,error:"financial_projection_preview_failed",detail:error.message},400);
    if(!data?.ok)return json(data,409);
    return json({ok:true,preview:data});
  }

  if(action==="create_policy_draft"){
    if(admin.role!=="owner")return json({ok:false,error:"owner_required"},403);
    const scope=clean(body.scope_key,40).toLowerCase();
    if(!['reconciliation','route_close','fiscal_projection'].includes(scope))return json({ok:false,error:"invalid_policy_scope"},400);
    const maxDifference=nullableNonNegativeInt(body.max_difference_cents);
    if(Number.isNaN(maxDifference))return json({ok:false,error:"invalid_max_difference_cents"},400);
    const effectiveFrom=nullableIso(body.effective_from),effectiveTo=nullableIso(body.effective_to);
    if(effectiveFrom===undefined||effectiveTo===undefined)return json({ok:false,error:"invalid_effective_window"},400);
    const {data,error}=await sb.rpc("create_financial_policy_draft_v1",{
      p_scope_key:scope,
      p_max_difference_cents:maxDifference,
      p_require_exact_reference:bool(body.require_exact_reference,true),
      p_require_delivery_confirmed:bool(body.require_delivery_confirmed,true),
      p_require_no_open_reconciliation_case:bool(body.require_no_open_reconciliation_case,true),
      p_allow_apply:bool(body.allow_apply,false),
      p_effective_from:effectiveFrom,
      p_effective_to:effectiveTo,
      p_reason:clean(body.reason,1000)||null,
      p_config:objectOrEmpty(body.config),
      p_admin_user_id:user.id,
    });
    if(error)return json({ok:false,error:"financial_policy_draft_failed",detail:error.message},400);
    if(!data?.ok)return json(data,409);
    return json({ok:true,result:data});
  }

  if(action==="approve_policy"){
    if(admin.role!=="owner")return json({ok:false,error:"owner_required"},403);
    const policyId=clean(body.policy_id,80);
    if(!validUuid(policyId))return json({ok:false,error:"invalid_policy_id"},400);
    const effectiveFrom=nullableIso(body.effective_from);
    if(effectiveFrom===undefined)return json({ok:false,error:"invalid_effective_from"},400);
    const {data,error}=await sb.rpc("approve_financial_policy_v1",{
      p_policy_id:policyId,p_admin_user_id:user.id,p_effective_from:effectiveFrom||new Date().toISOString(),p_reason:clean(body.reason,1000)||null,
    });
    if(error)return json({ok:false,error:"financial_policy_approve_failed",detail:error.message},400);
    if(!data?.ok)return json(data,409);
    return json({ok:true,result:data});
  }

  if(action==="retire_policy"){
    if(admin.role!=="owner")return json({ok:false,error:"owner_required"},403);
    const policyId=clean(body.policy_id,80);
    if(!validUuid(policyId))return json({ok:false,error:"invalid_policy_id"},400);
    const {data,error}=await sb.rpc("retire_financial_policy_v1",{p_policy_id:policyId,p_admin_user_id:user.id,p_reason:clean(body.reason,1000)||null});
    if(error)return json({ok:false,error:"financial_policy_retire_failed",detail:error.message},400);
    if(!data?.ok)return json(data,409);
    return json({ok:true,result:data});
  }

  // Deliberadamente ausentes: apply_projection, provider_ingest, ledger_write e fiscal_issue.
  // Esta Edge Function administra leitura/política; não executa pagamento nem NF-e.
  return json({ok:false,error:"unknown_action"},400);
});
