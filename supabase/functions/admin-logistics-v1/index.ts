import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=300)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const obj=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const uuid=(v:unknown)=>{const s=clean(v,80);return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)?s:""};

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
  const action=clean(body?.action||"dashboard",60).toLowerCase();

  if(action==="dashboard"){
    const [{data:readiness,error:readinessError},{data:jobs,error:jobsError},{data:routes,error:routesError},{data:drivers,error:driversError},{data:vehicles,error:vehiclesError},{data:incidents,error:incidentsError}]=await Promise.all([
      sb.rpc("logistics_readiness_v1"),
      sb.from("delivery_jobs").select("id,order_id,status,customer_name,address_snapshot,geocode_status,volumes,amount_due,priority,ready_at,created_at").order("priority",{ascending:false}).order("ready_at").limit(100),
      sb.from("delivery_routes").select("id,route_code,route_date,status,driver_id,vehicle_id,optimization_status,planned_start_at,published_at,started_at,completed_at,version_no").order("route_date",{ascending:false}).limit(50),
      sb.from("drivers").select("id,display_name,status,max_active_routes,capabilities,updated_at").order("display_name").limit(100),
      sb.from("vehicles").select("id,code,label,status,vehicle_type,max_stops,max_weight_kg,max_volume_units,updated_at").order("code").limit(100),
      sb.from("delivery_incidents").select("id,delivery_job_id,route_id,stop_id,incident_type,status,notes,created_at").in("status",["open","review_required"]).order("created_at",{ascending:false}).limit(100)
    ]);
    const error=readinessError||jobsError||routesError||driversError||vehiclesError||incidentsError;
    if(error)return json({ok:false,error:"dashboard_read_failed",detail:error.message},500);
    return json({ok:true,user:{role:admin.role,display_name:admin.display_name||null},readiness,jobs:jobs||[],routes:routes||[],drivers:drivers||[],vehicles:vehicles||[],incidents:incidents||[],runtime_activation_supported:false,external_routing_supported:false});
  }

  if(action==="preview_ready_order"){
    const orderId=uuid(body?.order_id);if(!orderId)return json({ok:false,error:"invalid_order_id"},400);
    const {data,error}=await sb.rpc("preview_delivery_job_from_ready_order_v1",{p_order_id:orderId});
    if(error)return json({ok:false,error:"preview_failed",detail:error.message},400);
    return json({ok:true,preview:data,side_effect_performed:false});
  }

  if(action==="save_driver_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const displayName=clean(body?.display_name,120);if(displayName.length<2)return json({ok:false,error:"display_name_required"},400);
    const id=uuid(body?.id);
    const payload={display_name:displayName,phone_e164:clean(body?.phone_e164,32)||null,status:"inactive",max_active_routes:Math.max(1,Math.min(3,Number(body?.max_active_routes)||1)),capabilities:obj(body?.capabilities),metadata:{...obj(body?.metadata),draft_only:true}};
    const q=id?sb.from("drivers").update(payload).eq("id",id):sb.from("drivers").insert(payload);
    const {data,error}=await q.select("id,display_name,status,max_active_routes,capabilities,metadata,updated_at").single();
    if(error)return json({ok:false,error:"driver_draft_failed",detail:error.message},400);
    return json({ok:true,driver:data,activated:false});
  }

  if(action==="save_vehicle_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const code=clean(body?.code,40).toUpperCase(),label=clean(body?.label,120);if(!code||!label)return json({ok:false,error:"code_and_label_required"},400);
    const type=["car","motorcycle","van","other"].includes(clean(body?.vehicle_type,20))?clean(body?.vehicle_type,20):"car";
    const id=uuid(body?.id);
    const nullablePositive=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>0?n:null};
    const payload={code,label,status:"inactive",vehicle_type:type,max_stops:nullablePositive(body?.max_stops),max_weight_kg:nullablePositive(body?.max_weight_kg),max_volume_units:nullablePositive(body?.max_volume_units),metadata:{...obj(body?.metadata),draft_only:true}};
    const q=id?sb.from("vehicles").update(payload).eq("id",id):sb.from("vehicles").insert(payload);
    const {data,error}=await q.select("id,code,label,status,vehicle_type,max_stops,max_weight_kg,max_volume_units,metadata,updated_at").single();
    if(error)return json({ok:false,error:"vehicle_draft_failed",detail:error.message},400);
    return json({ok:true,vehicle:data,activated:false});
  }

  if(action==="save_policy_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const allowed=new Set(["approaching_eta_threshold_seconds","minimum_gps_freshness_seconds","minimum_eta_confidence","notification_cooldown_seconds","routing_batch_window_minutes","max_provider_calls_per_route","max_provider_cost_brl_per_route","location_retention_days"]);
    const patch=obj(body?.patch) as Record<string,unknown>,safe:Record<string,unknown>={};
    for(const [k,v] of Object.entries(patch))if(allowed.has(k))safe[k]=v;
    if(!Object.keys(safe).length)return json({ok:false,error:"empty_policy_patch"},400);
    // Gates operacionais e provider permanecem deliberadamente OFF nesta etapa.
    Object.assign(safe,{enabled:false,execution_mode:"off",job_creation_enabled:false,routing_enabled:false,driver_app_enabled:false,gps_tracking_enabled:false,notifications_enabled:false,external_provider_enabled:false,provider_name:"none",canary_percent:0,updated_at:new Date().toISOString(),updated_by:userData.user.id});
    const {data,error}=await sb.from("logistics_runtime_config").update(safe).eq("id",1).select().single();
    if(error)return json({ok:false,error:"policy_draft_failed",detail:error.message},400);
    return json({ok:true,config:data,activated:false,external_side_effect:false});
  }

  if(action==="kill"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const reason=clean(body?.reason,300)||"admin_kill_switch";
    const {data,error}=await sb.rpc("kill_logistics_runtime_v1",{p_reason:reason,p_actor_id:userData.user.id});
    if(error)return json({ok:false,error:"kill_failed",detail:error.message},500);
    return json({ok:true,result:data});
  }

  return json({ok:false,error:"unknown_action"},400);
});
