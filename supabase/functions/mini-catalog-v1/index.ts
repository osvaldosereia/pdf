import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const text=(v:unknown,max=500)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const digits=(v:unknown)=>String(v??"").replace(/\D/g,"");
const num=(v:unknown)=>{const n=Number(String(v??"").replace(",","."));return Number.isFinite(n)?n:null};
const validToken=(v:unknown)=>/^[a-f0-9]{64}$/i.test(text(v,80));

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"server_config"},500);
  const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  let body:any;try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const action=text(body?.action||"open",40).toLowerCase();
  const token=text(body?.token,80);
  if(!validToken(token))return json({ok:false,error:"invalid_token"},400);

  const {data:session,error:se}=await sb.from("catalog_sessions").select("id,public_token,customer_id,conversation_id,cart_id,kind,title,status,expires_at,last_opened_at,metadata").eq("public_token",token).maybeSingle();
  if(se)return json({ok:false,error:"catalog_lookup_failed"},500);
  if(!session||session.status!=="open"||new Date(session.expires_at).getTime()<=Date.now())return json({ok:false,error:"catalog_unavailable"},404);

  if(action==="open"){
    const firstOpen=!session.last_opened_at||(Date.now()-new Date(session.last_opened_at).getTime())>30*60*1000;
    await sb.from("catalog_sessions").update({last_opened_at:new Date().toISOString()}).eq("id",session.id);
    if(firstOpen)await sb.from("catalog_events").insert({catalog_session_id:session.id,customer_id:session.customer_id,event_type:"catalog_open",event_data:{source:"public_catalog"}});
    const {data:items,error:ie}=await sb.from("catalog_session_items").select("product_id,rank,reason,recommendation_score,quantity,product:products(id,name,price,image_url,category,brand,packaging,stock,is_offer)").eq("catalog_session_id",session.id).order("rank",{ascending:true});
    if(ie)return json({ok:false,error:"catalog_items_failed"},500);
    let cart:any=null;if(session.cart_id){const {data:c}=await sb.from("carts").select("id,total,fiscal_subtotal,other_expenses,discount,status,version").eq("id",session.cart_id).maybeSingle();cart=c||null}
    let phone="556584491018";if(session.conversation_id){const {data:conv}=await sb.from("conversations").select("whatsapp_account:whatsapp_accounts(phone_e164)").eq("id",session.conversation_id).maybeSingle();const found=digits((conv as any)?.whatsapp_account?.phone_e164);if(found)phone=found}
    const waText=encodeURIComponent("Pronto, já escolhi os produtos no catálogo. Podemos continuar meu pedido?");
    return json({ok:true,session:{title:session.title,kind:session.kind,expires_at:session.expires_at,shopping_mode:session.metadata?.shopping_mode||null},items:items||[],cart,whatsapp_url:`https://wa.me/${phone}?text=${waText}`});
  }

  if(action==="set_quantity"){
    const productId=text(body?.product_id,80),quantity=num(body?.quantity);
    if(!/^[0-9a-f-]{36}$/i.test(productId)||quantity===null||quantity<0||quantity>999)return json({ok:false,error:"invalid_quantity"},400);
    const {data,error}=await sb.rpc("set_catalog_item_quantity",{p_public_token:token,p_product_id:productId,p_quantity:quantity});
    if(error)return json({ok:false,error:"quantity_failed",detail:error.message},400);
    return json({ok:true,...data});
  }

  if(action==="return_whatsapp"){
    await sb.from("catalog_events").insert({catalog_session_id:session.id,customer_id:session.customer_id,event_type:"catalog_checkout_return",event_data:{source:"public_catalog"}});
    let phone="556584491018";if(session.conversation_id){const {data:conv}=await sb.from("conversations").select("whatsapp_account:whatsapp_accounts(phone_e164)").eq("id",session.conversation_id).maybeSingle();const found=digits((conv as any)?.whatsapp_account?.phone_e164);if(found)phone=found}
    return json({ok:true,whatsapp_url:`https://wa.me/${phone}?text=${encodeURIComponent("Pronto, já escolhi os produtos no catálogo. Podemos continuar meu pedido?")}`});
  }
  return json({ok:false,error:"unknown_action"},400);
});
