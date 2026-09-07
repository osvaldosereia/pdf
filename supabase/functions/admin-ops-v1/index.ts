import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const text=(v:unknown,max=500)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const digits=(v:unknown)=>String(v??"").replace(/\D/g,"");
const int=(v:unknown,min=0,max=500)=>Math.min(max,Math.max(min,Number.parseInt(String(v??min),10)||min));
const num=(v:unknown)=>{if(v===null||v===undefined||v==="")return null;const n=Number(String(v).replace(",","."));return Number.isFinite(n)?n:null};
const validGtin=(value:unknown)=>{const g=digits(value);if(![8,12,13,14].includes(g.length))return false;const expected=Number(g.at(-1));let sum=0;for(let i=g.length-2,o=0;i>=0;i--,o++)sum+=Number(g[i])*(o%2===0?3:1);return(10-(sum%10))%10===expected};
const isoDate=(v:unknown)=>{const s=text(v,10);if(!s)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return undefined;const d=new Date(`${s}T00:00:00Z`);return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s?s:undefined};
const ERP_KEYS=new Set(["name","sku","gtin","ncm","price","brand","unit","validity_date","image_url","description_short","description_long"]);
const pick=(obj:any,keys:string[])=>Object.fromEntries(keys.map(k=>[k,obj?.[k]??null]));

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"server_config"},500);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return json({ok:false,error:"missing_token"},401);
  const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:ud,error:ue}=await sb.auth.getUser(token);if(ue||!ud?.user?.id)return json({ok:false,error:"invalid_user"},401);
  const user=ud.user;
  const {data:admin,error:ae}=await sb.from("admin_users").select("role,is_active,display_name,email").eq("user_id",user.id).maybeSingle();
  if(ae)return json({ok:false,error:"admin_lookup_failed"},500);if(!admin?.is_active)return json({ok:false,error:"admin_not_authorized"},403);
  await sb.from("admin_users").update({last_login_at:new Date().toISOString()}).eq("user_id",user.id);
  let body:any;try{body=await req.json()}catch{body={}}const action=text(body?.action||"health",60).toLowerCase();
  const canWrite=admin.role==="owner"||admin.role==="operator";const isOwner=admin.role==="owner";

  if(action==="health"){
    const today=new Date();today.setUTCHours(0,0,0,0);const thirty=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    const [verified,pending,errors,openCounts,countedToday,whatsapp,inactive,lowStock,expiring]=await Promise.all([
      sb.from("products").select("id",{count:"exact",head:true}).eq("physically_verified",true),
      sb.from("bling_commands").select("id",{count:"exact",head:true}).eq("status","pending"),
      sb.from("bling_commands").select("id",{count:"exact",head:true}).eq("status","error"),
      sb.from("inventory_counts").select("id",{count:"exact",head:true}).eq("status","open"),
      sb.from("inventory_count_items").select("id",{count:"exact",head:true}).gte("counted_at",today.toISOString()),
      sb.from("products").select("id",{count:"exact",head:true}).eq("physically_verified",true).eq("is_whatsapp_active",true),
      sb.from("products").select("id",{count:"exact",head:true}).eq("physically_verified",true).eq("is_active",false),
      sb.from("products").select("id",{count:"exact",head:true}).eq("physically_verified",true).lte("stock",0),
      sb.from("products").select("id",{count:"exact",head:true}).eq("physically_verified",true).not("validity_date","is",null).lte("validity_date",thirty)
    ]);
    const {data:recentCounts}=await sb.from("inventory_counts").select("id,status,item_count,pending_sync,device_label,started_at,closed_at").order("started_at",{ascending:false}).limit(6);
    const {data:recentErrors}=await sb.from("bling_commands").select("id,command_type,status,attempts,max_attempts,error_message,created_at,updated_at,product:products(id,name,gtin)").eq("status","error").order("updated_at",{ascending:false}).limit(6);
    return json({ok:true,user:{id:user.id,email:user.email||null,role:admin.role,display_name:admin.display_name||null},metrics:{verified_products:verified.count||0,pending_bling:pending.count||0,bling_errors:errors.count||0,open_counts:openCounts.count||0,counted_today:countedToday.count||0,whatsapp_active:whatsapp.count||0,inactive_products:inactive.count||0,no_stock:lowStock.count||0,expiring_30d:expiring.count||0},recent_counts:recentCounts||[],recent_errors:recentErrors||[]});
  }
  if(action==="products"){
    const limit=int(body?.limit,10,100),page=int(body?.page,1,100000),from=(page-1)*limit,to=from+limit-1,q=text(body?.q,100),sync=text(body?.sync_status,50),status=text(body?.status,30);
    let query=sb.from("products").select("id,bling_product_id,sku,name,gtin,ncm,price,cost,stock,image_url,brand,category,subcategory,packaging,validity_date,gondola,shelf,is_active,is_whatsapp_active,is_offer,is_upsell,min_stock,physically_verified,last_counted_at,sync_status,sync_error,updated_at",{count:"exact"}).eq("physically_verified",true).order("last_counted_at",{ascending:false}).range(from,to);
    if(q){const safe=q.replace(/[,%()]/g," ").trim();if(safe)query=query.or(`name.ilike.%${safe}%,gtin.ilike.%${safe}%,sku.ilike.%${safe}%,brand.ilike.%${safe}%`)}
    if(sync)query=query.eq("sync_status",sync);if(status==="whatsapp")query=query.eq("is_whatsapp_active",true);if(status==="offer")query=query.eq("is_offer",true);if(status==="no-stock")query=query.lte("stock",0);if(status==="inactive")query=query.eq("is_active",false);if(status==="upsell")query=query.eq("is_upsell",true);
    const {data,error,count}=await query;if(error)return json({ok:false,error:"products_failed",detail:error.message},400);return json({ok:true,products:data||[],total:count||0,page,limit});
  }
  if(action==="product"){
    const id=text(body?.id,80);if(!id)return json({ok:false,error:"id_required"},400);const {data:product,error}=await sb.from("products").select("*").eq("id",id).maybeSingle();if(error||!product)return json({ok:false,error:"product_not_found"},404);
    const [{data:history},{data:changes},{data:commands}]=await Promise.all([sb.from("inventory_count_items").select("id,previous_stock,counted_stock,previous_validity_date,validity_date,counted_at,sync_status,sync_error,gondola,shelf").eq("product_id",id).order("counted_at",{ascending:false}).limit(20),sb.from("product_changes").select("id,change_type,before_state,after_state,created_at,changed_by").eq("product_id",id).order("created_at",{ascending:false}).limit(20),sb.from("bling_commands").select("id,command_type,status,attempts,max_attempts,error_message,result,created_at,finished_at").eq("product_id",id).order("created_at",{ascending:false}).limit(15)]);
    return json({ok:true,product,count_history:history||[],changes:changes||[],commands:commands||[]});
  }
  if(action==="update_product"){
    if(!canWrite)return json({ok:false,error:"read_only"},403);const id=text(body?.id,80);if(!id)return json({ok:false,error:"id_required"},400);
    const {data:before}=await sb.from("products").select("*").eq("id",id).maybeSingle();if(!before)return json({ok:false,error:"product_not_found"},404);
    const src=body?.patch&&typeof body.patch==="object"?body.patch:{};const patch:any={};const putText=(k:string,max=500)=>{if(src[k]!==undefined)patch[k]=text(src[k],max)||null};
    ["name","sku","brand","category","subcategory","subsubcategory","packaging","supplier","unit","gondola","shelf","whatsapp_category","image_url"].forEach(k=>putText(k,k==="image_url"?1200:300));["description_short","description_long"].forEach(k=>putText(k,k==="description_long"?5000:1000));
    if(src.gtin!==undefined){const g=digits(src.gtin);if(g&&!validGtin(g))return json({ok:false,error:"invalid_gtin"},400);patch.gtin=g||null}if(src.ncm!==undefined){const n=digits(src.ncm);if(n&&n.length!==8)return json({ok:false,error:"invalid_ncm"},400);patch.ncm=n||null}
    for(const k of ["price","cost","min_stock"]){if(src[k]!==undefined){const n=num(src[k]);if(n!==null&&n<0)return json({ok:false,error:`invalid_${k}`},400);patch[k]=n}}if(src.sort_order!==undefined)patch.sort_order=int(src.sort_order,-100000,100000);for(const k of ["is_active","is_whatsapp_active","is_offer","is_upsell"]){if(typeof src[k]==="boolean")patch[k]=src[k]}
    if(src.validity_date!==undefined){const d=isoDate(src.validity_date);if(d===undefined)return json({ok:false,error:"invalid_validity_date"},400);patch.validity_date=d}if(src.tags!==undefined){if(!Array.isArray(src.tags))return json({ok:false,error:"invalid_tags"},400);patch.tags=[...new Set(src.tags.map((v:any)=>text(v,80)).filter(Boolean))].slice(0,50)}if(patch.name!==undefined&&!patch.name)return json({ok:false,error:"name_required"},400);
    const changedKeys=Object.keys(patch).filter(k=>JSON.stringify((before as any)[k]??null)!==JSON.stringify(patch[k]??null));if(!changedKeys.length)return json({ok:true,product:before,changed:[],commands:[]});const erpChanged=changedKeys.filter(k=>ERP_KEYS.has(k)),statusChanged=changedKeys.includes("is_active");
    patch.last_admin_edit_at=new Date().toISOString();patch.last_admin_edit_by=user.id;patch.updated_at=new Date().toISOString();if(patch.is_active!==undefined)patch.desired_bling_status=patch.is_active?"A":"I";if(erpChanged.length||statusChanged){patch.sync_status="pending_bling";patch.sync_error=null}
    const {data:after,error:updateError}=await sb.from("products").update(patch).eq("id",id).select("*").single();if(updateError)return json({ok:false,error:"update_failed",detail:updateError.message},400);await sb.from("product_changes").insert({product_id:id,changed_by:user.id,change_type:"admin_edit",before_state:pick(before,changedKeys),after_state:pick(after,changedKeys)});const commands:any[]=[];
    if(erpChanged.length){const {data:c}=await sb.from("bling_commands").insert({command_type:"update_product",product_id:id,payload:{changed_fields:erpChanged,source:"admin_v3"},status:"pending",created_by:user.id}).select("id,command_type,status").single();if(c)commands.push(c)}if(statusChanged){const type=after.is_active?"activate_product":"inactivate_product";const {data:c}=await sb.from("bling_commands").insert({command_type:type,product_id:id,payload:{desired_status:after.is_active?"A":"I",source:"admin_v3"},status:"pending",created_by:user.id}).select("id,command_type,status").single();if(c)commands.push(c)}return json({ok:true,product:after,changed:changedKeys,commands});
  }
  if(action==="update_merchandising"){
    if(!canWrite)return json({ok:false,error:"read_only"},403);const id=text(body?.id,80);if(!id)return json({ok:false,error:"id_required"},400);const patch:any={updated_at:new Date().toISOString(),last_admin_edit_at:new Date().toISOString(),last_admin_edit_by:user.id};if(typeof body?.is_whatsapp_active==="boolean")patch.is_whatsapp_active=body.is_whatsapp_active;if(typeof body?.is_offer==="boolean")patch.is_offer=body.is_offer;if(typeof body?.is_upsell==="boolean")patch.is_upsell=body.is_upsell;if(body?.whatsapp_category!==undefined)patch.whatsapp_category=text(body.whatsapp_category,120)||null;const {data,error}=await sb.from("products").update(patch).eq("id",id).select("id,is_whatsapp_active,is_offer,is_upsell,whatsapp_category,updated_at").single();if(error)return json({ok:false,error:"update_failed",detail:error.message},400);return json({ok:true,product:data});
  }
  if(action==="queue_create_product"){
    if(!canWrite)return json({ok:false,error:"read_only"},403);const id=text(body?.id,80);if(!id)return json({ok:false,error:"id_required"},400);const {data:p}=await sb.from("products").select("id,name,sku,gtin,bling_product_id").eq("id",id).maybeSingle();if(!p)return json({ok:false,error:"product_not_found"},404);if(p.bling_product_id)return json({ok:false,error:"already_in_bling"},409);if(!text(p.name)||!text(p.sku))return json({ok:false,error:"product_incomplete",detail:"Nome e SKU são obrigatórios para criar no Bling."},400);const {data:c,error}=await sb.from("bling_commands").insert({command_type:"create_product",product_id:id,payload:{source:"admin_v3",explicit:true},status:"pending",created_by:user.id}).select("id,status").single();if(error)return json({ok:false,error:"queue_failed",detail:error.message},400);await sb.from("products").update({sync_status:"pending_bling",sync_error:null,updated_at:new Date().toISOString()}).eq("id",id);return json({ok:true,command:c});
  }
  if(action==="counts"){const limit=int(body?.limit,10,100);const {data,error}=await sb.from("inventory_counts").select("id,status,device_label,item_count,pending_sync,started_at,closed_at,opened_by").order("started_at",{ascending:false}).limit(limit);if(error)return json({ok:false,error:"counts_failed",detail:error.message},400);return json({ok:true,counts:data||[]})}
  if(action==="count_items"){const id=text(body?.id,80);if(!id)return json({ok:false,error:"id_required"},400);const {data,error}=await sb.from("inventory_count_items").select("id,ean,previous_stock,counted_stock,previous_validity_date,validity_date,counted_at,sync_status,sync_error,gondola,shelf,product:products(id,name,image_url,brand,packaging)").eq("inventory_count_id",id).order("counted_at",{ascending:false}).limit(500);if(error)return json({ok:false,error:"count_items_failed",detail:error.message},400);return json({ok:true,items:data||[]})}
  if(action==="queue"){const limit=int(body?.limit,10,200),status=text(body?.status,30);let query=sb.from("bling_commands").select("id,command_type,status,attempts,max_attempts,available_at,locked_at,finished_at,error_message,result,created_at,updated_at,product:products(id,name,gtin,stock,bling_product_id)").order("created_at",{ascending:false}).limit(limit);if(status)query=query.eq("status",status);const {data,error}=await query;if(error)return json({ok:false,error:"queue_failed",detail:error.message},400);return json({ok:true,commands:data||[]})}
  if(action==="retry_command"){if(!canWrite)return json({ok:false,error:"read_only"},403);const id=text(body?.id,80);if(!id)return json({ok:false,error:"id_required"},400);const {data,error}=await sb.from("bling_commands").update({status:"pending",available_at:new Date().toISOString(),error_message:null,locked_at:null,locked_by:null,finished_at:null,updated_at:new Date().toISOString()}).eq("id",id).eq("status","error").select("id,status").maybeSingle();if(error)return json({ok:false,error:"retry_failed",detail:error.message},400);if(!data)return json({ok:false,error:"command_not_retryable"},409);return json({ok:true,command:data})}
  if(action==="cancel_command"){if(!canWrite)return json({ok:false,error:"read_only"},403);const id=text(body?.id,80);const {data,error}=await sb.from("bling_commands").update({status:"cancelled",finished_at:new Date().toISOString(),error_message:"cancelled_by_admin",updated_at:new Date().toISOString()}).eq("id",id).eq("status","pending").select("id,status").maybeSingle();if(error)return json({ok:false,error:"cancel_failed",detail:error.message},400);return json({ok:true,command:data})}
  if(action==="admins"){if(!isOwner)return json({ok:false,error:"owner_required"},403);const {data,error}=await sb.from("admin_users").select("user_id,role,is_active,display_name,email,created_at,last_login_at,updated_at").order("created_at",{ascending:true});if(error)return json({ok:false,error:"admins_failed"},400);return json({ok:true,admins:data||[]})}
  return json({ok:false,error:"unknown_action"},400);
});
