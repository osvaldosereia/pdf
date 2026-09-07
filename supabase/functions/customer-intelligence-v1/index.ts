import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,"Content-Type":"application/json","Cache-Control":"no-store"}});
const text=(v:unknown,max=500)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const int=(v:unknown,min=1,max=100)=>Math.min(max,Math.max(min,Number.parseInt(String(v??min),10)||min));
const money=(v:unknown)=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const firstName=(v:unknown)=>text(v,120).split(/\s+/)[0]||'Oi';

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({ok:false,error:"server_config"},500);
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return json({ok:false,error:"missing_token"},401);
  const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:ud,error:ue}=await sb.auth.getUser(token);if(ue||!ud?.user?.id)return json({ok:false,error:"invalid_user"},401);
  const user=ud.user;const {data:admin,error:ae}=await sb.from("admin_users").select("role,is_active,display_name").eq("user_id",user.id).maybeSingle();if(ae)return json({ok:false,error:"admin_lookup_failed"},500);if(!admin?.is_active)return json({ok:false,error:"admin_not_authorized"},403);
  const canWrite=admin.role==='owner'||admin.role==='operator';let body:any;try{body=await req.json()}catch{body={}}const action=text(body?.action||'customers',60).toLowerCase();

  if(action==='customers'){
    const limit=int(body?.limit,10,80),page=int(body?.page,1,100000),from=(page-1)*limit,to=from+limit-1,q=text(body?.q,100).replace(/[,%()]/g,' ').trim();
    let query=sb.from('customers').select('id,name,primary_whatsapp_e164,preferred_reply,shopping_mode,catalog_skill_score,catalog_open_count,catalog_success_count,order_count,lifetime_value,last_order_at,last_catalog_at,is_active,updated_at',{count:'exact'}).order('last_order_at',{ascending:false,nullsFirst:false}).range(from,to);if(q)query=query.or(`name.ilike.%${q}%,primary_whatsapp_e164.ilike.%${q}%`);
    const {data,error,count}=await query;if(error)return json({ok:false,error:'customers_failed',detail:error.message},400);const rows=[];for(const c of data||[]){const {data:mode}=await sb.rpc('resolve_customer_shopping_mode',{p_customer_id:c.id});rows.push({...c,resolved_shopping_mode:mode||'whatsapp_only'})}return json({ok:true,customers:rows,total:count||0,page,limit});
  }
  if(action==='customer'){
    const id=text(body?.id,80);if(!id)return json({ok:false,error:'id_required'},400);const {data:customer,error}=await sb.from('customers').select('*').eq('id',id).maybeSingle();if(error||!customer)return json({ok:false,error:'customer_not_found'},404);
    const [{data:mode},{data:stats},{data:orders},{data:addresses},{data:recommendations,error:re}]=await Promise.all([
      sb.rpc('resolve_customer_shopping_mode',{p_customer_id:id}),
      sb.from('customer_product_stats').select('purchase_count,total_quantity,total_spent,first_purchase_at,last_purchase_at,product:products(id,name,price,image_url,category,brand,packaging,stock,is_offer)').eq('customer_id',id).order('last_purchase_at',{ascending:false}).limit(50),
      sb.from('orders').select('id,bling_order_id,status,total,confirmed_at,created_at,other_expenses,discount').eq('customer_id',id).order('created_at',{ascending:false}).limit(30),
      sb.from('customer_addresses').select('id,label,street,number,neighborhood,city,state,postal_code,is_default,is_active,last_confirmed_at').eq('customer_id',id).eq('is_active',true).order('is_default',{ascending:false}),
      sb.rpc('get_customer_recommendations',{p_customer_id:id,p_limit:30,p_kind:'personalized'})
    ]);if(re)return json({ok:false,error:'recommendations_failed',detail:re.message},400);
    const salesPlan={shopping_mode:mode||'whatsapp_only',preferred_reply:customer.preferred_reply||'auto',try_catalog_first:(mode==='catalog_first'),offer_catalog_as_option:(mode==='hybrid'),keep_whatsapp_primary:(mode==='whatsapp_only'),seller_audio_candidate:(customer.preferred_reply==='audio'||customer.preferred_reply==='auto')};
    return json({ok:true,customer,resolved_shopping_mode:mode||'whatsapp_only',sales_plan:salesPlan,purchased_products:stats||[],orders:orders||[],addresses:addresses||[],recommendations:recommendations||[]});
  }
  if(action==='set_shopping_mode'){
    if(!canWrite)return json({ok:false,error:'read_only'},403);const id=text(body?.id,80),mode=text(body?.mode,30);if(!['auto','catalog_first','whatsapp_only','hybrid'].includes(mode))return json({ok:false,error:'invalid_mode'},400);const {data,error}=await sb.from('customers').update({shopping_mode:mode,updated_at:new Date().toISOString()}).eq('id',id).select('id,shopping_mode,catalog_skill_score').single();if(error)return json({ok:false,error:'update_failed',detail:error.message},400);return json({ok:true,customer:data});
  }
  if(action==='record_signal'){
    if(!canWrite)return json({ok:false,error:'read_only'},403);const id=text(body?.id,80),eventType=text(body?.event_type,60);const allowed=['catalog_capable_signal','catalog_preferred_explicit','whatsapp_only_explicit','hybrid_preferred_explicit'];if(!allowed.includes(eventType))return json({ok:false,error:'invalid_event'},400);
    const {error}=await sb.from('customer_behavior_events').insert({customer_id:id,conversation_id:body?.conversation_id||null,event_type:eventType,event_data:body?.event_data&&typeof body.event_data==='object'?body.event_data:{}});if(error)return json({ok:false,error:'event_failed',detail:error.message},400);
    const {data:s}=await sb.from('catalog_sessions').select('id').eq('customer_id',id).order('created_at',{ascending:false}).limit(1).maybeSingle();if(s?.id)await sb.from('catalog_events').insert({catalog_session_id:s.id,customer_id:id,event_type:eventType,event_data:{source:'admin_signal'}});else{if(eventType==='catalog_preferred_explicit')await sb.from('customers').update({shopping_mode:'catalog_first',catalog_skill_score:60}).eq('id',id);if(eventType==='whatsapp_only_explicit')await sb.from('customers').update({shopping_mode:'whatsapp_only',catalog_skill_score:0}).eq('id',id);if(eventType==='hybrid_preferred_explicit')await sb.from('customers').update({shopping_mode:'hybrid'}).eq('id',id);if(eventType==='catalog_capable_signal')await sb.from('customers').update({catalog_skill_score:15}).eq('id',id).lt('catalog_skill_score',15)}return json({ok:true});
  }
  if(action==='create_catalog'){
    if(!canWrite)return json({ok:false,error:'read_only'},403);const id=text(body?.id,80),kind=text(body?.kind||'personalized',30),limit=int(body?.limit,1,30);if(!id)return json({ok:false,error:'id_required'},400);const {data:customer}=await sb.from('customers').select('id,name').eq('id',id).maybeSingle();if(!customer)return json({ok:false,error:'customer_not_found'},404);
    const {data:session,error}=await sb.rpc('create_customer_catalog_session',{p_customer_id:id,p_conversation_id:body?.conversation_id||null,p_cart_id:body?.cart_id||null,p_kind:kind,p_limit:limit,p_created_by:user.id});if(error)return json({ok:false,error:'catalog_create_failed',detail:error.message},400);
    const {data:items}=await sb.from('catalog_session_items').select('rank,reason,product:products(name,price)').eq('catalog_session_id',session.id).order('rank',{ascending:true});const link=`https://donaantonia.com.br/catalogo/?c=${session.token}`;
    const lines=(items||[]).slice(0,30).map((x:any,i:number)=>`${i+1}. ${text(x.product?.name,70)} — ${money(x.product?.price)}`);const intro=kind==='offers'?`${firstName(customer.name)}, hoje estou com vários produtos em oferta. Separei uma lista para você:`:`${firstName(customer.name)}, separei alguns produtos que podem combinar com sua compra:`;const whatsappText=[intro,'',...lines,'',`Para ver as fotos e adicionar ao pedido: ${link}`].join('\n');const voiceIntro=kind==='offers'?`${firstName(customer.name)}, hoje eu estou com vários produtos em oferta. Vou te mandar a lista, tá? Dá uma olhadinha porque tem coisa bem em conta.`:`${firstName(customer.name)}, eu separei algumas sugestões com base no que você costuma comprar. Vou te mandar a lista e você escolhe o que quiser.`;
    return json({ok:true,session,link,whatsapp_text:whatsappText,voice_intro:voiceIntro,item_count:session.item_count||0});
  }
  return json({ok:false,error:'unknown_action'},400);
});
