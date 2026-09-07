import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS=new Set(['https://donaantonia.com.br','https://www.donaantonia.com.br']);
const CORS_BASE={"Access-Control-Allow-Headers":"content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const TERMINAL_EVENTS=['added','rejected','ignored'];
const clean=(v:unknown,max=200)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const validToken=(v:unknown)=>/^[a-f0-9]{64}$/i.test(clean(v,80));
const validUuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(v,80));
const cors=(req:Request)=>{const origin=req.headers.get('origin');if(origin&&!ALLOWED_ORIGINS.has(origin))return null;return {...CORS_BASE,'Access-Control-Allow-Origin':origin||'https://donaantonia.com.br',Vary:'Origin'}};
const json=(req:Request,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...(cors(req)||CORS_BASE),'Content-Type':'application/json','Cache-Control':'no-store'}});
async function sha256(input:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function rateKey(req:Request,suffix:string){const ip=(req.headers.get('x-forwarded-for')||req.headers.get('cf-connecting-ip')||'unknown').split(',')[0].trim();return sha256(`${ip}|${req.headers.get('user-agent')||''}|${suffix}`)}

Deno.serve(async(req:Request)=>{
  const ch=cors(req);if(!ch)return new Response('forbidden',{status:403});
  if(req.method==='OPTIONS')return new Response('ok',{headers:ch});
  if(req.method!=='POST')return json(req,{ok:false,error:'method_not_allowed'},405);
  let body:any;try{body=await req.json()}catch{return json(req,{ok:false,error:'invalid_json'},400)}
  const token=clean(body?.token,80),action=clean(body?.action||'preview',40).toLowerCase();
  if(!validToken(token))return json(req,{ok:false,error:'invalid_token'},400);
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!key)return json(req,{ok:false,error:'server_config'},500);
  const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:session,error:sessionError}=await sb.from('catalog_sessions').select('id,conversation_id,status,expires_at').eq('public_token',token).maybeSingle();
  if(sessionError)return json(req,{ok:false,error:'room_lookup_failed'},500);if(!session)return json(req,{ok:false,error:'room_not_found'},404);
  if(session.status==='closed')return json(req,{ok:false,error:'room_closed'},409);if(new Date(session.expires_at).getTime()<=Date.now())return json(req,{ok:false,error:'room_expired'},410);
  const rk=await rateKey(req,session.id);const {data:allowed}=await sb.rpc('consume_public_rate_limit',{p_rate_key:rk,p_bucket:'room_sales',p_limit:120,p_window_seconds:3600});if(!allowed)return json(req,{ok:false,error:'rate_limited'},429);

  if(action==='preview'){
    const {data:plan,error}=await sb.rpc('plan_next_sales_move',{p_conversation_id:session.conversation_id});if(error)return json(req,{ok:false,error:'sales_plan_failed'},500);
    return json(req,{ok:true,plan});
  }

  if(action==='next_offer'){
    const since=new Date(Date.now()-30*60*1000).toISOString();
    const {data:recent}=await sb.from('sales_offer_events').select('id,product_id,occurred_at,context').eq('conversation_id',session.conversation_id).eq('event_type','offered').gte('occurred_at',since).order('occurred_at',{ascending:false}).limit(1).maybeSingle();
    if(recent?.product_id){
      const {data:response}=await sb.from('sales_offer_events').select('id,event_type').eq('conversation_id',session.conversation_id).eq('product_id',recent.product_id).in('event_type',TERMINAL_EVENTS).gt('occurred_at',recent.occurred_at).order('occurred_at',{ascending:false}).limit(1).maybeSingle();
      if(!response){const {data:p}=await sb.from('products').select('id,name,price,image_url,brand,packaging,sales_category,stock,is_offer').eq('id',recent.product_id).eq('is_active',true).eq('is_whatsapp_active',true).gt('stock',0).maybeSingle();if(p)return json(req,{ok:true,action:'offer_suggestions',offer:{...p,product_id:p.id,reason:clean(recent.context?.reason||'',200)},event_id:recent.id,reused:true});}
    }
    const {data:plan,error}=await sb.rpc('plan_next_sales_move',{p_conversation_id:session.conversation_id});if(error)return json(req,{ok:false,error:'sales_plan_failed'},500);
    if(plan?.action!=='offer_suggestions'||!Array.isArray(plan?.recommendations)||!plan.recommendations.length)return json(req,{ok:true,action:plan?.action||'none',reason:plan?.reason||'no_offer',offer:null,plan});
    const offer=plan.recommendations[0];if(!validUuid(offer?.product_id))return json(req,{ok:true,action:'none',reason:'invalid_recommendation',offer:null});
    const {data:event,error:eventError}=await sb.rpc('record_sales_offer_event',{p_conversation_id:session.conversation_id,p_event_type:'offered',p_product_id:offer.product_id,p_source:'shopping_room',p_context:{surface:'shopping_room',slot:'smart_offer',reason:clean(offer.reason,200)}});if(eventError)return json(req,{ok:false,error:'sales_event_failed'},500);
    return json(req,{ok:true,action:'offer_suggestions',offer,event_id:event?.id||null,reused:false,remaining:Math.max(0,2-Number(plan.proactive_offer_count||0)-1)});
  }

  if(action==='event'){
    const eventType=clean(body?.event_type,30),productId=clean(body?.product_id,80);if(!['viewed',...TERMINAL_EVENTS].includes(eventType))return json(req,{ok:false,error:'invalid_sales_event'},400);if(!validUuid(productId))return json(req,{ok:false,error:'invalid_product'},400);
    const {data:offered}=await sb.from('sales_offer_events').select('id,occurred_at').eq('conversation_id',session.conversation_id).eq('product_id',productId).eq('event_type','offered').order('occurred_at',{ascending:false}).limit(1).maybeSingle();if(!offered)return json(req,{ok:false,error:'offer_not_found'},409);
    if(TERMINAL_EVENTS.includes(eventType)){
      const {data:terminal}=await sb.from('sales_offer_events').select('id,event_type').eq('conversation_id',session.conversation_id).eq('product_id',productId).in('event_type',TERMINAL_EVENTS).gt('occurred_at',offered.occurred_at).order('occurred_at',{ascending:false}).limit(1).maybeSingle();
      if(terminal)return json(req,{ok:true,event:terminal,duplicate:true});
    }
    if(eventType==='added'){
      const {data:cart}=await sb.from('carts').select('id').eq('conversation_id',session.conversation_id).eq('status','draft').order('updated_at',{ascending:false}).limit(1).maybeSingle();if(!cart)return json(req,{ok:false,error:'cart_not_found'},409);
      const {data:item}=await sb.from('cart_items').select('product_id,quantity').eq('cart_id',cart.id).eq('product_id',productId).gt('quantity',0).maybeSingle();if(!item)return json(req,{ok:false,error:'product_not_in_cart'},409);
    }
    if(eventType==='viewed'){
      const dedupeSince=new Date(Date.now()-5*60*1000).toISOString();const {data:duplicate}=await sb.from('sales_offer_events').select('id,event_type').eq('conversation_id',session.conversation_id).eq('product_id',productId).eq('event_type','viewed').gte('occurred_at',dedupeSince).limit(1).maybeSingle();if(duplicate)return json(req,{ok:true,event:duplicate,duplicate:true});
    }
    const {data:event,error}=await sb.rpc('record_sales_offer_event',{p_conversation_id:session.conversation_id,p_event_type:eventType,p_product_id:productId,p_source:'shopping_room',p_context:{surface:'shopping_room',slot:'smart_offer'}});if(error)return json(req,{ok:false,error:'sales_event_failed'},500);
    return json(req,{ok:true,event,duplicate:false});
  }

  return json(req,{ok:false,error:'unknown_action'},400);
});
