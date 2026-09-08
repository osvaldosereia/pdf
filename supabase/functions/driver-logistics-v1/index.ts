import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=300)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const uuid=(v:unknown)=>{const s=clean(v,80);return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)?s:""};
const eventId=(v:unknown)=>{const s=clean(v,160);return /^[A-Za-z0-9._:-]{8,160}$/.test(s)?s:""};

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
  const userId=userData.user.id;
  const {data:driver,error:driverError}=await sb.from("drivers").select("id,display_name,status,auth_user_id").eq("auth_user_id",userId).maybeSingle();
  if(driverError)return json({ok:false,error:"driver_lookup_failed"},500);
  if(!driver||driver.status==='suspended'||driver.status==='inactive')return json({ok:false,error:"driver_not_authorized"},403);
  const {data:cfg,error:cfgError}=await sb.from("logistics_runtime_config").select("enabled,execution_mode,driver_app_enabled,gps_tracking_enabled").eq("id",1).single();
  if(cfgError)return json({ok:false,error:"logistics_config_failed"},500);
  if(!cfg?.enabled||!cfg?.driver_app_enabled||!["homologation","canary","live"].includes(cfg.execution_mode))return json({ok:false,error:"driver_runtime_disabled"},423);
  let body:any={};try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const action=clean(body?.action||"route",40).toLowerCase();

  if(action==="route"){
    const {data,error}=await sb.rpc("get_driver_route_snapshot_v1",{p_auth_user_id:userId});
    if(error)return json({ok:false,error:"route_read_failed",detail:error.message},500);
    return json({ok:true,driver:{id:driver.id,display_name:driver.display_name,status:driver.status},snapshot:data});
  }

  if(action==="start_route"){
    const routeId=uuid(body?.route_id),clientEventId=eventId(body?.client_event_id);if(!routeId||!clientEventId)return json({ok:false,error:"route_id_and_client_event_id_required"},400);
    const {data,error}=await sb.rpc("driver_start_route_v1",{p_auth_user_id:userId,p_route_id:routeId,p_client_event_id:clientEventId});
    if(error)return json({ok:false,error:"start_route_failed",detail:error.message},400);
    return json(data);
  }

  if(action==="arrived"){
    const stopId=uuid(body?.stop_id),clientEventId=eventId(body?.client_event_id);if(!stopId||!clientEventId)return json({ok:false,error:"stop_id_and_client_event_id_required"},400);
    const {data,error}=await sb.rpc("driver_arrive_stop_v1",{p_auth_user_id:userId,p_stop_id:stopId,p_client_event_id:clientEventId});
    if(error)return json({ok:false,error:"arrive_failed",detail:error.message},400);
    return json(data);
  }

  if(action==="delivered"){
    const stopId=uuid(body?.stop_id),clientEventId=eventId(body?.client_event_id);if(!stopId||!clientEventId)return json({ok:false,error:"stop_id_and_client_event_id_required"},400);
    const proof=(body?.proof&&typeof body.proof==="object"&&!Array.isArray(body.proof))?body.proof:{};
    const {data,error}=await sb.rpc("driver_deliver_stop_v1",{p_auth_user_id:userId,p_stop_id:stopId,p_client_event_id:clientEventId,p_proof:proof});
    if(error)return json({ok:false,error:"delivery_confirmation_failed",detail:error.message},400);
    return json(data);
  }

  if(action==="failed"){
    const stopId=uuid(body?.stop_id),clientEventId=eventId(body?.client_event_id);if(!stopId||!clientEventId)return json({ok:false,error:"stop_id_and_client_event_id_required"},400);
    const {data,error}=await sb.rpc("driver_fail_stop_v1",{p_auth_user_id:userId,p_stop_id:stopId,p_client_event_id:clientEventId,p_incident_type:clean(body?.incident_type,40)||"other",p_notes:clean(body?.notes,500)||null});
    if(error)return json({ok:false,error:"stop_failure_failed",detail:error.message},400);
    return json(data);
  }

  if(action==="location"){
    if(!cfg.gps_tracking_enabled)return json({ok:false,error:"gps_tracking_disabled"},423);
    const routeId=uuid(body?.route_id),clientEventId=eventId(body?.client_event_id);const lat=Number(body?.latitude),lng=Number(body?.longitude),accuracy=body?.accuracy_m==null?null:Number(body.accuracy_m);const captured=clean(body?.captured_at,60);
    if(!routeId||!clientEventId||!Number.isFinite(lat)||!Number.isFinite(lng)||!captured)return json({ok:false,error:"invalid_location_payload"},400);
    const {data,error}=await sb.rpc("record_driver_location_v1",{p_driver_id:driver.id,p_route_id:routeId,p_latitude:lat,p_longitude:lng,p_accuracy_m:Number.isFinite(accuracy as number)?accuracy:null,p_captured_at:captured,p_client_event_id:clientEventId});
    if(error)return json({ok:false,error:"location_write_failed",detail:error.message},400);
    return json(data);
  }

  return json({ok:false,error:"unknown_action"},400);
});
