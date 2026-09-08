import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=300)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const obj=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const uuid=(v:unknown)=>{const s=clean(v,80);return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)?s:""};
const safeModes=new Set(["observe","dry_run"]);

type Workflow={id:string;workflow_key:string;current_version:number;trigger_type:string;execution_mode:string;execution_strategy:string;enabled:boolean;kill_switch:boolean;requires_handoff_clear:boolean;budget_config:Record<string,unknown>;actions:unknown[]};

function budgetInt(v:unknown){const n=Number(v);return Number.isFinite(n)&&n>=0?Math.floor(n):0}

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
  const {data:admin,error:adminError}=await sb.from("admin_users").select("role,is_active").eq("user_id",userData.user.id).maybeSingle();
  if(adminError)return json({ok:false,error:"admin_lookup_failed"},500);
  if(!admin?.is_active)return json({ok:false,error:"admin_not_authorized"},403);

  let body:Record<string,unknown>={};try{body=obj(await req.json())}catch{return json({ok:false,error:"invalid_json"},400)}
  const workflowId=uuid(body.workflow_id);if(!workflowId)return json({ok:false,error:"workflow_id_required"},400);
  const idempotencyKey=clean(body.idempotency_key,160);if(idempotencyKey.length<8)return json({ok:false,error:"idempotency_key_required"},400);
  const input=obj(body.input);const triggerRef=clean(body.trigger_ref,180)||null;

  const {data:w,error:wErr}=await sb.from("automation_workflows").select("id,workflow_key,current_version,trigger_type,execution_mode,execution_strategy,enabled,kill_switch,requires_handoff_clear,budget_config,actions").eq("id",workflowId).maybeSingle();
  if(wErr)return json({ok:false,error:"workflow_read_failed",detail:wErr.message},500);
  if(!w)return json({ok:false,error:"workflow_not_found"},404);
  const wf=w as Workflow;

  const {data:existing}=await sb.from("automation_workflow_executions").select("id,status,decision,external_side_effect,created_at,finished_at").eq("workflow_id",workflowId).eq("idempotency_key",idempotencyKey).maybeSingle();
  if(existing)return json({ok:true,idempotent_replay:true,execution:existing,external_side_effect:false});

  let handoffOpen=false;
  const conversationId=uuid(input.conversation_id);
  if(conversationId){
    const {count,error:hErr}=await sb.from("human_handoffs").select("id",{count:"exact",head:true}).eq("conversation_id",conversationId).eq("status","open");
    if(hErr)return json({ok:false,error:"handoff_revalidation_failed",detail:hErr.message},500);
    handoffOpen=(count||0)>0;
  }

  const budget=obj(wf.budget_config);const maxRunsHour=budgetInt(budget.max_runs_per_hour);
  let runsHour=0;
  if(maxRunsHour>0){
    const since=new Date(Date.now()-60*60*1000).toISOString();
    const {count,error:bErr}=await sb.from("automation_workflow_executions").select("id",{count:"exact",head:true}).eq("workflow_id",workflowId).gte("created_at",since);
    if(bErr)return json({ok:false,error:"budget_revalidation_failed",detail:bErr.message},500);
    runsHour=count||0;
  }

  const hardReasons:string[]=[];
  if(!safeModes.has(wf.execution_mode))hardReasons.push("mode_not_observe_or_dry_run");
  if(!wf.enabled)hardReasons.push("workflow_disabled");
  if(wf.kill_switch)hardReasons.push("kill_switch_on");
  if(handoffOpen&&wf.requires_handoff_clear)hardReasons.push("human_handoff_open");
  if(maxRunsHour>0&&runsHour>=maxRunsHour)hardReasons.push("runs_per_hour_budget_exceeded");

  const {data:simulation,error:sErr}=await sb.rpc("simulate_automation_workflow_v1",{p_workflow_id:workflowId,p_input:input,p_has_open_handoff:handoffOpen,p_idempotency_key:idempotencyKey});
  if(sErr)return json({ok:false,error:"workflow_simulation_failed",detail:sErr.message},500);
  const sim=obj(simulation);
  const simReasons=Array.isArray(sim.reasons)?sim.reasons.map(x=>clean(x,160)).filter(Boolean):[];
  const reasons=[...new Set([...hardReasons,...simReasons])];
  const allowed=reasons.length===0&&sim.allowed===true;
  const status=allowed?"simulated":"blocked";
  const decision={allowed,mode:wf.execution_mode,reasons,simulation:sim,guardrails:{external_side_effect:false,action_execution_supported:false,live_supported:false,handoff_revalidated:true,idempotency_revalidated:true,budget_revalidated:true,openai_called:false}};

  const row={workflow_id:workflowId,workflow_version:wf.current_version,trigger_type:wf.trigger_type,trigger_ref:triggerRef,idempotency_key:idempotencyKey,mode:wf.execution_mode,strategy:wf.execution_strategy,status,decision,input,output:{actions_simulated:Array.isArray(sim.actions)?sim.actions.length:0},estimated_cost_brl:0,actual_cost_brl:0,external_side_effect:false,finished_at:new Date().toISOString()};
  const {data:execution,error:iErr}=await sb.from("automation_workflow_executions").insert(row).select("id,status,decision,external_side_effect,created_at,finished_at").single();
  if(iErr){
    if(String(iErr.code)==="23505"){
      const {data:replay}=await sb.from("automation_workflow_executions").select("id,status,decision,external_side_effect,created_at,finished_at").eq("workflow_id",workflowId).eq("idempotency_key",idempotencyKey).maybeSingle();
      return json({ok:true,idempotent_replay:true,execution:replay,external_side_effect:false});
    }
    return json({ok:false,error:"execution_audit_failed",detail:iErr.message},500);
  }
  await sb.from("automation_workflow_events").insert({execution_id:execution.id,workflow_id:workflowId,event_type:allowed?"dry_run_simulated":"dispatch_blocked",detail:{reasons,mode:wf.execution_mode,external_side_effect:false}});
  return json({ok:true,idempotent_replay:false,execution,allowed,external_side_effect:false,action_execution_performed:false});
});
