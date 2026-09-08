import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=300)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const obj=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v:{};
const uuid=(v:unknown)=>{const s=clean(v,80);return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)?s:""};
const num=(v:unknown,min:number,max:number)=>{const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):null};

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
  const action=clean(body?.action||"dashboard",70).toLowerCase();

  if(action==="dashboard"){
    const [{data:readiness,error:e1},{data:summary,error:e2},{data:expiry,error:e3},{data:risks,error:e4},{data:lots,error:e5},{data:campaigns,error:e6}]=await Promise.all([
      sb.rpc("commercial_readiness_v1"),
      sb.rpc("commercial_report_summary_v1"),
      sb.from("commercial_expiry_report_v1").select("product_id,name,sku,category,effective_stock,effective_expiry,days_remaining,expiry_bucket").order("effective_expiry",{ascending:true,nullsFirst:false}).limit(100),
      sb.from("commercial_product_health_v1").select("product_id,name,sku,category,price,cost,effective_stock,effective_expiry,base_margin_percent,base_margin_brl,commercial_health").in("commercial_health",["margin_risk","cost_unknown","expired","stockout","lot_truth_missing","no_verified_available_lot"]).order("name").limit(100),
      sb.from("inventory_lots").select("id,product_id,lot_code,status,quantity_on_hand,quantity_reserved,unit_cost,expires_at,expiry_handling,physically_verified,updated_at").order("expires_at",{ascending:true,nullsFirst:false}).limit(100),
      sb.from("promotion_campaigns").select("id,campaign_key,display_name,campaign_type,status,enabled,execution_mode,budget_brl,spent_brl,updated_at").order("updated_at",{ascending:false}).limit(50)
    ]);
    const error=e1||e2||e3||e4||e5||e6;if(error)return json({ok:false,error:"dashboard_read_failed",detail:error.message},500);
    return json({ok:true,user:{role:admin.role,display_name:admin.display_name||null},readiness,summary,expiry:expiry||[],risks:risks||[],lots:lots||[],campaigns:campaigns||[],runtime_activation_supported:false,legacy_offer_activation_supported:false,automatic_offer_publication_supported:false});
  }

  if(action==="simulate_margin"){
    const productId=uuid(body?.product_id),sale=num(body?.sale_price,0.01,1000000),qty=num(body?.quantity??1,0.001,1000000);
    if(!productId||sale===null||qty===null)return json({ok:false,error:"invalid_margin_input"},400);
    const {data,error}=await sb.rpc("margin_guard_v1",{p_product_id:productId,p_sale_price:sale,p_quantity:qty,p_context:clean(body?.context,30)||"sale"});
    if(error)return json({ok:false,error:"margin_simulation_failed",detail:error.message},400);
    return json({ok:true,simulation:data,side_effect_performed:false});
  }
  if(action==="preview_fefo"){
    const productId=uuid(body?.product_id),qty=num(body?.quantity,0.001,1000000);if(!productId||qty===null)return json({ok:false,error:"invalid_fefo_input"},400);
    const {data,error}=await sb.rpc("preview_fefo_allocation_v1",{p_product_id:productId,p_quantity:qty,p_delivery_date:body?.delivery_date||null});
    if(error)return json({ok:false,error:"fefo_preview_failed",detail:error.message},400);
    return json({ok:true,preview:data,side_effect_performed:false});
  }
  if(action==="preview_expiry_offer"){
    const productId=uuid(body?.product_id);if(!productId)return json({ok:false,error:"invalid_product_id"},400);
    const {data,error}=await sb.rpc("preview_expiry_offer_v2",{p_product_id:productId,p_delivery_date:body?.delivery_date||null,p_today:body?.today||null});
    if(error)return json({ok:false,error:"expiry_preview_failed",detail:error.message},400);
    return json({ok:true,preview:data,side_effect_performed:false});
  }
  if(action==="preview_birthday"){
    const customerId=uuid(body?.customer_id);if(!customerId)return json({ok:false,error:"invalid_customer_id"},400);
    const {data,error}=await sb.rpc("preview_birthday_benefit_v1",{p_customer_id:customerId,p_reference_date:body?.reference_date||null});
    if(error)return json({ok:false,error:"birthday_preview_failed",detail:error.message},400);
    return json({ok:true,preview:data,side_effect_performed:false});
  }

  if(action==="save_lot_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const productId=uuid(body?.product_id),lotCode=clean(body?.lot_code,80);if(!productId||!lotCode)return json({ok:false,error:"product_and_lot_required"},400);
    const onHand=num(body?.quantity_on_hand??0,0,100000000),unitCost=body?.unit_cost==null?null:num(body.unit_cost,0,1000000);
    if(onHand===null||(body?.unit_cost!=null&&unitCost===null))return json({ok:false,error:"invalid_lot_values"},400);
    const expiresAt=clean(body?.expires_at,20)||null;
    const requestedExpiryHandling=clean(body?.expiry_handling,30).toLowerCase();
    const expiryHandling=expiresAt?"known":requestedExpiryHandling==="not_required"?"not_required":"unknown";
    const payload={product_id:productId,lot_code:lotCode,status:"draft",quantity_on_hand:onHand,quantity_reserved:0,unit_cost:unitCost,manufactured_at:body?.manufactured_at||null,expires_at:expiresAt,expiry_handling:expiryHandling,received_at:body?.received_at||null,warehouse_location:clean(body?.warehouse_location,120)||null,source_system:"admin_draft",source_ref:clean(body?.source_ref,120)||null,physically_verified:false,metadata:{...obj(body?.metadata),draft_only:true},updated_at:new Date().toISOString()};
    const {data,error}=await sb.from("inventory_lots").upsert(payload,{onConflict:"product_id,lot_code"}).select("id,product_id,lot_code,status,quantity_on_hand,quantity_reserved,unit_cost,expires_at,expiry_handling,physically_verified,updated_at").single();
    if(error)return json({ok:false,error:"lot_draft_failed",detail:error.message},400);
    return json({ok:true,lot:data,activated:false,stock_truth_changed:false});
  }

  if(action==="save_margin_policy_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const scope=["global","category","product"].includes(clean(body?.scope,20))?clean(body?.scope,20):"global";
    const productId=scope==="product"?uuid(body?.product_id):null,category=scope==="category"?clean(body?.category,120):null;
    if((scope==="product"&&!productId)||(scope==="category"&&!category))return json({ok:false,error:"invalid_policy_scope"},400);
    const minPct=num(body?.min_margin_percent??0,0,100),minBrl=num(body?.min_margin_brl??0,0,1000000),maxDisc=num(body?.max_discount_percent??0,0,100);
    if(minPct===null||minBrl===null||maxDisc===null)return json({ok:false,error:"invalid_margin_policy"},400);
    const {data,error}=await sb.from("commercial_margin_policies").insert({version:Math.max(1,Number(body?.version)||1),scope,product_id:productId,category,priority:Number(body?.priority)||0,min_margin_percent:minPct,min_margin_brl:minBrl,max_discount_percent:maxDisc,status:"draft",created_by:userData.user.id}).select().single();
    if(error)return json({ok:false,error:"margin_policy_draft_failed",detail:error.message},400);
    return json({ok:true,policy:data,activated:false});
  }

  if(action==="save_expiry_rule_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const minDays=num(body?.min_days_remaining,0,3650),maxDays=num(body?.max_days_remaining,0,3650),discount=num(body?.discount_percent,0.0001,90);
    if(minDays===null||maxDays===null||discount===null||maxDays<minDays)return json({ok:false,error:"invalid_expiry_rule"},400);
    const version=Math.max(1,Number(body?.version)||1);
    const {data,error}=await sb.from("expiry_discount_rules").upsert({version,min_days_remaining:Math.floor(minDays),max_days_remaining:Math.floor(maxDays),discount_percent:discount,status:"draft",source:"admin_draft",created_by:userData.user.id},{onConflict:"version,min_days_remaining,max_days_remaining"}).select().single();
    if(error)return json({ok:false,error:"expiry_rule_draft_failed",detail:error.message},400);
    return json({ok:true,rule:data,activated:false});
  }

  if(action==="save_runtime_policy_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const patch=obj(body?.patch) as Record<string,unknown>,safe:Record<string,unknown>={};
    const allowed=new Set(["default_min_margin_percent","default_min_margin_brl","default_max_discount_percent","promotion_budget_brl","minimum_delivery_shelf_life_days"]);
    for(const [k,v] of Object.entries(patch))if(allowed.has(k))safe[k]=v;
    if(!Object.keys(safe).length)return json({ok:false,error:"empty_policy_patch"},400);
    Object.assign(safe,{enabled:false,execution_mode:"off",lot_truth_enabled:false,lot_reservations_enabled:false,fefo_enabled:false,expiry_discount_enabled:false,promotion_engine_enabled:false,benefit_engine_enabled:false,margin_guard_enforced:false,recommendation_guard_enabled:false,legacy_offer_engine_allowed:false,canary_percent:0,updated_at:new Date().toISOString(),updated_by:userData.user.id});
    const {data,error}=await sb.from("commercial_runtime_config").update(safe).eq("id",1).select().single();
    if(error)return json({ok:false,error:"runtime_policy_draft_failed",detail:error.message},400);
    return json({ok:true,config:data,activated:false,legacy_offer_engine_allowed:false});
  }

  if(action==="create_promotion_item_draft"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const campaignId=uuid(body?.campaign_id),productId=uuid(body?.product_id),price=num(body?.proposed_price,0.01,1000000);
    if(!campaignId||!productId||price===null)return json({ok:false,error:"invalid_promotion_draft"},400);
    const {data,error}=await sb.rpc("create_promotion_item_draft_v1",{p_campaign_id:campaignId,p_product_id:productId,p_proposed_price:price,p_reason:clean(body?.reason,300)||null,p_actor_id:userData.user.id});
    if(error)return json({ok:false,error:"promotion_item_draft_failed",detail:error.message},400);
    return json({ok:true,draft:data,activated:false,external_side_effect:false});
  }

  if(action==="kill"){
    if(!isOwner)return json({ok:false,error:"owner_required"},403);
    const {data,error}=await sb.rpc("kill_commercial_runtime_v1",{p_reason:clean(body?.reason,300)||"admin_commercial_kill_switch",p_actor_id:userData.user.id});
    if(error)return json({ok:false,error:"kill_failed",detail:error.message},500);
    return json({ok:true,result:data});
  }
  return json({ok:false,error:"unknown_action"},400);
});
