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
    const {data,error}=await sb.rpc("financial_reconciliation_readiness_v1");
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

  // Nenhuma action de escrita ou chamada externa existe nesta versão.
  return json({ok:false,error:"unknown_action"},400);
});
