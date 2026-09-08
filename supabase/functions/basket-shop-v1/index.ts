import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=500)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const validToken=(v:unknown)=>/^[a-f0-9]{64}$/i.test(clean(v,80));
const validUuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(v,80));
const digits=(v:unknown)=>String(v??"").replace(/\D/g,"");

async function whatsappUrl(sb:any,conversationId:string,message:string){
  let phone="556584491018";
  if(conversationId){
    const {data:conv}=await sb.from("conversations").select("whatsapp_account:whatsapp_accounts(phone_e164)").eq("id",conversationId).maybeSingle();
    const found=digits((conv as any)?.whatsapp_account?.phone_e164);if(found)phone=found;
  }
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const url=Deno.env.get("SUPABASE_URL")||"",key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!key)return json({ok:false,error:"server_config"},500);
  const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  let body:any={};try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  const action=clean(body?.action||"open",40).toLowerCase();
  const token=clean(body?.token,80);
  if(!validToken(token))return json({ok:false,error:"invalid_token"},400);

  const {data:session,error:sessionError}=await sb.from("catalog_sessions")
    .select("id,public_token,customer_id,conversation_id,cart_id,kind,title,status,expires_at,metadata,current_view")
    .eq("public_token",token).maybeSingle();
  if(sessionError)return json({ok:false,error:"session_lookup_failed"},500);
  if(!session||session.status!=="open"||new Date(session.expires_at).getTime()<=Date.now())return json({ok:false,error:"catalog_unavailable"},404);
  const flow=clean(session.metadata?.flow,40);
  if(!["basket_basic_v1","basket_extras_v1"].includes(flow))return json({ok:false,error:"wrong_catalog_flow"},404);

  if(action==="open"){
    await sb.from("catalog_sessions").update({last_opened_at:new Date().toISOString(),last_activity_at:new Date().toISOString()}).eq("id",session.id);
    let basket:any=null;
    if(flow==="basket_basic_v1"){
      const basketId=clean(session.metadata?.basket_id,80);
      const {data:b}=await sb.from("basket_templates").select("id,name,base_price,image_url").eq("id",basketId).maybeSingle();basket=b||null;
      const {data:rows,error:itemsError}=await sb.from("catalog_session_items")
        .select("product_id,rank,quantity,metadata,product:products(id,name)").eq("catalog_session_id",session.id).order("rank");
      if(itemsError)return json({ok:false,error:"items_failed"},500);
      const items=(rows||[]).map((r:any)=>({product_id:r.product_id,name:r.product?.name||"Produto",quantity:Number(r.quantity||0),base_quantity:Number(r.metadata?.base_quantity??r.quantity??0),removable:Boolean(r.metadata?.removable),quantity_editable:Boolean(r.metadata?.quantity_editable),min_quantity:Number(r.metadata?.min_quantity??0),max_quantity:Number(r.metadata?.max_quantity??20)}));
      return json({ok:true,flow,session:{id:session.id,title:session.title,expires_at:session.expires_at},basket,items,commercial_policy:{component_prices_visible:false,basket_price_is_commercial_price:true,quantity_changes_reviewed_by_human:true}});
    }

    const parentId=clean(session.metadata?.parent_basket_session_id,80);
    if(validUuid(parentId)){
      const {data:parent}=await sb.from("catalog_sessions").select("metadata").eq("id",parentId).maybeSingle();
      const bid=clean(parent?.metadata?.basket_id,80);if(validUuid(bid)){const {data:b}=await sb.from("basket_templates").select("id,name,base_price,image_url").eq("id",bid).maybeSingle();basket=b||null}
    }
    const {data:rows,error:itemsError}=await sb.from("catalog_session_items")
      .select("product_id,rank,quantity,metadata,product:products(id,name,price,image_url,category,stock)").eq("catalog_session_id",session.id).order("rank");
    if(itemsError)return json({ok:false,error:"items_failed"},500);
    let cart:any=null;if(session.cart_id){const {data:c}=await sb.from("carts").select("id,total,base_commercial_price,version").eq("id",session.cart_id).maybeSingle();cart=c||null}
    const items=(rows||[]).map((r:any)=>({product_id:r.product_id,name:r.product?.name||"Produto",price:Number(r.product?.price||0),image_url:r.product?.image_url||null,category:r.product?.category||r.metadata?.category||null,stock:Number(r.product?.stock||0),quantity:Number(r.quantity||0)}));
    return json({ok:true,flow,session:{id:session.id,title:session.title,expires_at:session.expires_at,categories:session.metadata?.categories||[]},basket,items,cart});
  }

  if(action==="set_quantity"){
    const productId=clean(body?.product_id,80),quantity=Number(body?.quantity);
    if(!validUuid(productId)||!Number.isInteger(quantity)||quantity<0)return json({ok:false,error:"invalid_quantity"},400);
    const rpc=flow==="basket_basic_v1"?"set_whatsapp_basket_component_quantity_v1":"set_whatsapp_basket_extra_quantity_v1";
    const {data,error}=await sb.rpc(rpc,{p_public_token:token,p_product_id:productId,p_quantity:quantity});
    if(error)return json({ok:false,error:"quantity_failed",detail:clean(error.message,120)},400);
    return json({ok:true,result:data});
  }

  if(action==="return"){
    const intent=clean(body?.intent,30).toLowerCase();
    const allowed=flow==="basket_basic_v1"?["order","extras"]:["extras_done"];
    if(!allowed.includes(intent))return json({ok:false,error:"invalid_return_intent"},400);
    const {data,error}=await sb.rpc("mark_whatsapp_basket_return_v1",{p_public_token:token,p_intent:intent});
    if(error)return json({ok:false,error:"return_failed"},400);
    const message=intent==="order"?"Quero encomendar a cesta que escolhi.":intent==="extras"?"Quero adicionar mais produtos à minha cesta.":"Terminei de escolher os produtos adicionais da minha cesta.";
    return json({ok:true,intent,whatsapp_url:await whatsappUrl(sb,session.conversation_id,message),message,result:data});
  }

  return json({ok:false,error:"unknown_action"},400);
});