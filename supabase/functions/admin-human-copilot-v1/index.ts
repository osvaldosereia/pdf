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

function deterministicSummary(plan:any){
  const ctx=plan?.context||{};
  const customer=ctx.customer||{};
  const cart=ctx.cart||{};
  const order=ctx.last_order||{};
  const timeline=Array.isArray(ctx.timeline)?ctx.timeline:[];
  const latestInbound=[...timeline].reverse().find((x:any)=>String(x?.direction||"").toLowerCase()==="inbound");
  const parts=[] as string[];
  if(customer?.name)parts.push(`Cliente: ${clean(customer.name,120)}.`);
  if(latestInbound?.text)parts.push(`Última mensagem: “${clean(latestInbound.text,280)}”.`);
  if(Number(cart?.total||0)>0)parts.push(`Carrinho atual: R$ ${Number(cart.total).toFixed(2).replace('.',',')}.`);
  if(order?.id)parts.push(`Último pedido: ${clean(order.status,40)}; pagamento ${clean(order.payment_status||'pendente',40)}.`);
  const risks=Array.isArray(ctx?.risks)?ctx.risks:[];
  if(risks.length)parts.push(`Alertas: ${risks.map((x:any)=>clean(x,80)).join(', ')}.`);
  return clean(parts.join(' ')||'Contexto disponível para revisão do operador.',1200);
}

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
    const {data,error}=await sb.rpc("human_copilot_readiness_v1");
    if(error)return json({ok:false,error:"readiness_failed",detail:error.message},500);
    return json({ok:true,user:{id:user.id,role:admin.role},readiness:data});
  }

  const conversationId=clean(body.conversation_id,80);
  if(!validUuid(conversationId))return json({ok:false,error:"invalid_conversation_id"},400);

  if(action==="context_plan"){
    const {data,error}=await sb.rpc("preview_human_copilot_nba_v1",{p_conversation_id:conversationId,p_admin_user_id:user.id});
    if(error)return json({ok:false,error:"copilot_plan_failed",detail:error.message},400);
    if(!data?.ok)return json(data,409);
    const channel=clean(data?.context?.conversation?.channel||"",20);
    const {data:policy,error:policyError}=await sb.rpc("preview_safe_commercial_action_v3",{
      p_tool_key:"HUMAN_COPILOT_GENERATE",
      p_confidence:1,
      p_has_confirmation:false,
      p_has_open_handoff:true,
      p_confidence_scope:"human_copilot",
      p_role:admin.role,
      p_context_channel:channel||null,
    });
    return json({
      ok:true,
      summary:deterministicSummary(data),
      next_best_action:{code:data.recommended_action,reason:data.reason,priority:data.priority},
      deterministic_draft:data.deterministic_draft||null,
      context:data.context,
      provider_generation:{allowed:!!policy?.allowed,decision:policy?.decision||"blocked",reason:policy?.reason||policy?.error||policyError?.message||"policy_unavailable",policy:policy||{}},
      auto_send:false,
      external_side_effect:false,
    });
  }

  if(action==="set_mode"){
    const enabled=body.enabled===true;
    const {data,error}=await sb.rpc("set_human_copilot_mode_v1",{p_conversation_id:conversationId,p_admin_user_id:user.id,p_enabled:enabled});
    if(error)return json({ok:false,error:"mode_change_failed",detail:error.message},400);
    return json({ok:!!data?.ok,result:data,auto_send:false,external_side_effect:false},data?.ok?200:409);
  }

  if(action==="record_draft"){
    const idempotencyKey=clean(body.idempotency_key,200);
    const nbaCode=clean(body.nba_code,80),nbaReason=clean(body.nba_reason,300);
    if(!idempotencyKey||!nbaCode||!nbaReason)return json({ok:false,error:"draft_contract_required"},400);
    const {data,error}=await sb.rpc("record_human_copilot_suggestion_v1",{
      p_conversation_id:conversationId,
      p_admin_user_id:user.id,
      p_idempotency_key:idempotencyKey,
      p_nba_code:nbaCode,
      p_nba_reason:nbaReason,
      p_suggestion_text:clean(body.suggestion_text,4096)||null,
      p_summary:clean(body.summary,1200)||null,
      p_intent:clean(body.intent,160)||null,
      p_confidence:body.confidence==null?null:Number(body.confidence),
      p_provider:clean(body.provider||"deterministic",40),
      p_model:clean(body.model,120)||null,
      p_provider_response_id:clean(body.provider_response_id,160)||null,
      p_input_tokens:Math.max(0,Math.trunc(Number(body.input_tokens)||0)),
      p_output_tokens:Math.max(0,Math.trunc(Number(body.output_tokens)||0)),
      p_estimated_cost_brl:Math.max(0,Number(body.estimated_cost_brl)||0),
      p_policy_snapshot:body.policy_snapshot&&typeof body.policy_snapshot==="object"?body.policy_snapshot:{},
      p_context_snapshot:body.context_snapshot&&typeof body.context_snapshot==="object"?body.context_snapshot:{},
    });
    if(error)return json({ok:false,error:"draft_record_failed",detail:error.message},400);
    return json({ok:!!data?.ok,result:data,auto_send:false,external_side_effect:false},data?.ok?200:409);
  }

  return json({ok:false,error:"unknown_action"},400);
});
