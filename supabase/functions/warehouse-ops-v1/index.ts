import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=200)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
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
  const {data:ctx,error:ctxError}=await sb.rpc("warehouse_staff_context_v1",{p_auth_user_id:userId});
  if(ctxError)return json({ok:false,error:"staff_lookup_failed"},500);
  if(!ctx?.ok||!["available","busy"].includes(ctx.status))return json({ok:false,error:"warehouse_staff_not_active"},403);
  const staffId=uuid(ctx.staff_id);if(!staffId)return json({ok:false,error:"warehouse_staff_invalid"},403);
  const {data:cfg,error:cfgError}=await sb.from("fulfillment_runtime_config").select("enabled,execution_mode,order_creation_enabled,picking_enabled,checking_enabled,packing_enabled,ready_release_enabled,loading_enabled,fefo_enforced,require_independent_checker,barcode_required").eq("id",1).single();
  if(cfgError)return json({ok:false,error:"fulfillment_config_failed"},500);
  let body:any={};try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const action=clean(body?.action||"me",40).toLowerCase();
  if(action==="me")return json({ok:true,staff:ctx,runtime:cfg,external_side_effect:false});
  if(!cfg?.enabled||!["homologation","canary","live"].includes(cfg.execution_mode))return json({ok:false,error:"fulfillment_runtime_disabled"},423);

  if(action==="queue"){
    const states=ctx.can_check?["picked","checking"]:ctx.can_pick?["pending","picking"]:["checked","packed","ready"];
    const {data,error}=await sb.from("fulfillment_orders").select("id,order_id,status,picker_id,checker_id,created_at,updated_at").in("status",states).order("created_at",{ascending:true}).limit(100);
    if(error)return json({ok:false,error:"queue_read_failed"},500);
    return json({ok:true,items:data||[],external_side_effect:false});
  }
  const fulfillmentId=uuid(body?.fulfillment_order_id);if(!fulfillmentId)return json({ok:false,error:"fulfillment_order_id_required"},400);
  if(action==="snapshot"){
    const {data,error}=await sb.rpc("fulfillment_snapshot_v2",{p_fulfillment_order_id:fulfillmentId});
    if(error)return json({ok:false,error:"snapshot_failed",detail:error.message},500);return json({ok:true,snapshot:data,external_side_effect:false});
  }
  if(action==="start_picking"){
    if(!ctx.can_pick)return json({ok:false,error:"pick_permission_required"},403);const ce=eventId(body?.client_event_id);if(!ce)return json({ok:false,error:"client_event_id_required"},400);
    const {data,error}=await sb.rpc("start_fulfillment_picking_v2",{p_fulfillment_order_id:fulfillmentId,p_staff_id:staffId,p_client_event_id:ce});if(error)return json({ok:false,error:"start_picking_failed",detail:error.message},400);return json(data);
  }
  if(action==="scan"){
    const phase=clean(body?.phase,20).toLowerCase();if(phase==="picking"&&!ctx.can_pick)return json({ok:false,error:"pick_permission_required"},403);if(phase==="checking"&&!ctx.can_check)return json({ok:false,error:"check_permission_required"},403);
    const bc=clean(body?.barcode,120),ce=eventId(body?.client_event_id),qty=Number(body?.quantity??1);if(!bc||!ce||!Number.isFinite(qty)||qty<=0)return json({ok:false,error:"invalid_scan_payload"},400);
    const {data,error}=await sb.rpc("scan_fulfillment_item_v2",{p_fulfillment_order_id:fulfillmentId,p_staff_id:staffId,p_phase:phase,p_barcode:bc,p_quantity:qty,p_client_event_id:ce,p_device_id:clean(body?.device_id,120)||null});if(error)return json({ok:false,error:"scan_failed",detail:error.message},400);return json(data);
  }
  if(action==="complete_phase"){
    const phase=clean(body?.phase,20).toLowerCase(),ce=eventId(body?.client_event_id);if(!ce)return json({ok:false,error:"client_event_id_required"},400);if(phase==="picking"&&!ctx.can_pick)return json({ok:false,error:"pick_permission_required"},403);if(phase==="checking"&&!ctx.can_check)return json({ok:false,error:"check_permission_required"},403);
    const {data,error}=await sb.rpc("finalize_fulfillment_phase_v2",{p_fulfillment_order_id:fulfillmentId,p_staff_id:staffId,p_phase:phase,p_client_event_id:ce});if(error)return json({ok:false,error:"complete_phase_failed",detail:error.message},400);return json(data);
  }
  if(action==="pack"){
    if(!ctx.can_pack)return json({ok:false,error:"pack_permission_required"},403);const no=Number(body?.package_no),count=Number(body?.package_count),bc=clean(body?.barcode,120),ce=eventId(body?.client_event_id);if(!Number.isInteger(no)||!Number.isInteger(count)||no<=0||count<=0||!bc||!ce)return json({ok:false,error:"invalid_package_payload"},400);
    const {data,error}=await sb.rpc("pack_fulfillment_order_v2",{p_fulfillment_order_id:fulfillmentId,p_staff_id:staffId,p_package_no:no,p_package_count:count,p_barcode:bc,p_client_event_id:ce});if(error)return json({ok:false,error:"pack_failed",detail:error.message},400);return json(data);
  }
  if(action==="release_ready"){
    if(!ctx.can_pack&&!ctx.can_load&&!ctx.can_resolve_exceptions)return json({ok:false,error:"release_permission_required"},403);const ce=eventId(body?.client_event_id);if(!ce)return json({ok:false,error:"client_event_id_required"},400);
    const {data,error}=await sb.rpc("release_fulfillment_ready_v2",{p_fulfillment_order_id:fulfillmentId,p_staff_id:staffId,p_client_event_id:ce});if(error)return json({ok:false,error:"release_ready_failed",detail:error.message},400);return json(data);
  }
  return json({ok:false,error:"unknown_action"},400);
});
