import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=300)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const obj=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const uuid=(v:unknown)=>{const s=clean(v,80);return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)?s:""};
const date=(v:unknown)=>{const s=clean(v,20);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:""};
const finite=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)?n:null};

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
    const {data,error}=await sb.rpc("stage12_admin_snapshot_v1");
    if(error)return json({ok:false,error:"dashboard_read_failed",detail:error.message},500);
    return json({ok:true,user:{role:admin.role,display_name:admin.display_name||null},snapshot:data,runtime_activation_supported:false,promotion_activation_supported:false,lot_verification_supported:false,external_side_effect:false});
  }

  if(action==="search_products"){
    const q=clean(body?.q,120);
    let query=sb.from("products").select("id,name,sku,gtin,price,cost,stock,validity_date,physically_verified").order("name").limit(30);
    if(q)query=query.or(`name.ilike.%${q.replace(/[%_,()]/g,'')}%,sku.ilike.%${q.replace(/[%_,()]/g,'')}%,gtin.ilike.%${q.replace(/[%_,()]/g,'')}%`);
    const {data,error}=await query;
    if(error)return json({ok:false,error:"product_search_failed",detail:error.message},500);
    return json({ok:true,products:data||[],external_side_effect:false});
  }

  if(action==="preview_fefo"){
    const productId=uuid(body?.product_id),quantity=finite(body?.quantity),deliveryDate=date(body?.delivery_date)||new Date().toISOString().slice(0,10),minDays=Math.trunc(finite(body?.min_shelf_life_days)??0);
    if(!productId||quantity==null||quantity<=0||minDays<0)return json({ok:false,error:"invalid_fefo_input"},400);
    const {data,error}=await sb.rpc("preview_fefo_allocation_v1",{p_product_id:productId,p_quantity:quantity,p_delivery_date:deliveryDate,p_min_shelf_life_days:minDays});
    if(error)return json({ok:false,error:"fefo_preview_failed",detail:error.message},400);
    return json({ok:true,preview:data,external_side_effect:false});
  }

  if(action==="preview_margin"){
    const gross=finite(body?.gross_revenue),cost=finite(body?.estimated_cost),discount=finite(body?.proposed_discount)??0,minMargin=finite(body?.minimum_margin_percent)??0;
    if(gross==null||cost==null)return json({ok:false,error:"invalid_margin_input"},400);
    const {data,error}=await sb.rpc("evaluate_margin_guard_v1",{p_gross_revenue:gross,p_estimated_cost:cost,p_proposed_discount:discount,p_minimum_margin_percent:minMargin});
    if(error)return json({ok:false,error:"margin_preview_failed",detail:error.message},400);
    return json({ok:true,preview:data,external_side_effect:false});
  }

  if(action==="preview_expiry_offer"){
    const productId=uuid(body?.product_id),lotId=uuid(body?.lot_id),today=date(body?.today)||new Date().toISOString().slice(0,10);
    if(!productId||!lotId)return json({ok:false,error:"invalid_product_or_lot"},400);
    const {data,error}=await sb.rpc("preview_expiry_offer_v2",{p_product_id:productId,p_lot_id:lotId,p_today:today});
    if(error)return json({ok:false,error:"expiry_preview_failed",detail:error.message},400);
    return json({ok:true,preview:data,applied:false,external_side_effect:false});
  }

  if(action==="create_lot_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const productId=uuid(body?.product_id),lotCode=clean(body?.lot_code,120),expires=date(body?.expires_at)||null,qty=finite(body?.quantity_received)??0,cost=body?.unit_cost==null?null:finite(body.unit_cost);
    if(!productId||!lotCode||qty<0||body?.unit_cost!=null&&cost==null)return json({ok:false,error:"invalid_lot_draft"},400);
    const {data,error}=await sb.rpc("create_inventory_lot_draft_v1",{p_product_id:productId,p_lot_code:lotCode,p_expires_at:expires,p_quantity_received:qty,p_unit_cost:cost,p_source_ref:clean(body?.source_ref,200)||null,p_notes:clean(body?.notes,500)||null});
    if(error)return json({ok:false,error:"lot_draft_failed",detail:error.message},400);
    return json({ok:true,result:data,activated:false,verified:false,external_side_effect:false});
  }

  if(action==="create_policy_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const policyKey=clean(body?.policy_key,80).toLowerCase(),policy=obj(body?.policy);
    if(!policyKey)return json({ok:false,error:"policy_key_required"},400);
    const {data,error}=await sb.rpc("create_commercial_policy_draft_v1",{p_policy_key:policyKey,p_policy:policy,p_created_by:userData.user.id});
    if(error)return json({ok:false,error:"policy_draft_failed",detail:error.message},400);
    return json({ok:true,result:data,activated:false,external_side_effect:false});
  }

  if(action==="create_promotion_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const code=clean(body?.code,80),name=clean(body?.name,120),type=clean(body?.rule_type,40).toLowerCase();
    const budget=body?.budget_cents==null?null:Math.trunc(finite(body.budget_cents)??-1);
    if(!code||!name||!type||budget!=null&&budget<0)return json({ok:false,error:"invalid_promotion_draft"},400);
    const {data,error}=await sb.rpc("create_promotion_rule_draft_v1",{p_code:code,p_name:name,p_rule_type:type,p_conditions:obj(body?.conditions),p_benefit:obj(body?.benefit),p_budget_cents:budget});
    if(error)return json({ok:false,error:"promotion_draft_failed",detail:error.message},400);
    return json({ok:true,result:data,activated:false,external_side_effect:false});
  }

  if(action==="kill"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const {data,error}=await sb.rpc("kill_commercial_truth_runtime_v1",{p_reason:clean(body?.reason,300)||"admin_kill_switch",p_actor:userData.user.id});
    if(error)return json({ok:false,error:"kill_failed",detail:error.message},500);
    return json({ok:true,result:data});
  }

  return json({ok:false,error:"unknown_action"},400);
});
