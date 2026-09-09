import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PROJECT_HOST="ssbesxgaijknwsjbsbcz.supabase.co";
const V3_URL=`https://${PROJECT_HOST}/functions/v1/conversation-worker-v3`;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
const clean=(v:unknown,max=500)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const norm=(v:unknown)=>String(v??"").normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim();
const arr=(v:unknown)=>Array.isArray(v)?v:[];
const money=(v:unknown)=>Number(v||0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const uuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(v,80))?clean(v,80):"";
async function sha256Hex(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,"0")).join("")}

function firstName(raw:unknown){
  const n=clean(raw,80).split(/\s+/)[0]||"";
  if(n.length<2||n.length>30||/\d/.test(n)||!/[A-Za-zÀ-ÿ]/.test(n))return "";
  const bad=new Set(["cliente","user","usuario","usuário","super","cestas","dona","empresa","loja","mercado"]);
  if(bad.has(n.toLowerCase()))return "";
  return n.charAt(0).toUpperCase()+n.slice(1);
}
function renderText(template:unknown,vars:Record<string,unknown>){
  return clean(String(template??"").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,(_,k)=>String(vars[k]??"")),4000);
}
function renderJson(v:any,vars:Record<string,unknown>):any{
  if(typeof v==="string")return renderText(v,vars);
  if(Array.isArray(v))return v.map(x=>renderJson(x,vars));
  if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,renderJson(x,vars)]));
  return v;
}
function itemTitle(name:string){const s=clean(name,60);return s.length<=24?s:`${s.slice(0,21)}…`}
function productListInteractive(products:any[],body:string){
  return {type:"list",body:{text:clean(body,1024)},action:{button:"Escolher",sections:[{title:"Opções",rows:products.slice(0,10).map(p=>({id:`da_add_product:${p.id}`,title:itemTitle(p.name),description:clean(`${money(p.price)} · ${p.packaging||p.brand||"Disponível"}`,72)}))}]}};
}
function basketListInteractive(baskets:any[],body:string){
  return {type:"list",body:{text:clean(body,1024)},action:{button:"Ver cestas",sections:[{title:"Cestas básicas",rows:baskets.slice(0,10).map((b:any)=>({id:`da_basket:${b.id}`,title:itemTitle(b.display_name||b.name),description:money(b.base_price)}))}]}};
}
function cartText(cart:any){
  const items=arr(cart?.items);if(!items.length)return "Seu carrinho está vazio.";
  const lines=items.slice(0,30).map((i:any)=>`• ${Number(i.quantity)}× ${clean(i.name,80)}${i.line_total==null?"":` — ${money(i.line_total)}`}`);
  return `${lines.join("\n")}\n\nTotal: ${money(cart.total)}`;
}
function deterministicProductIntent(text:string){
  const n=norm(text);
  const add=/\b(quero|coloca|coloque|adiciona|adicione|bota|manda|poe|põe)\b/.test(n);
  const search=/\b(tem|preco|quanto|procura|procurar|mostra|mostrar|vende|disponivel|disponível)\b/.test(n);
  if(add)return "add";
  if(search)return "search";
  return "";
}
function quantityFrom(text:string){
  const n=norm(text);
  const m=n.match(/\b(?:quero|coloca|coloque|adiciona|adicione|bota|manda|poe)\s+(?:mais\s+)?(\d{1,2})\b/);
  return m?Math.max(1,Math.min(99,Number(m[1]))):1;
}
function strongCandidate(rows:any[]){
  if(!rows.length)return null;
  const top=rows[0],second=rows[1];
  const score=Number(top.confidence??Number(top.score||0)/100);
  const secondScore=Number(second?.confidence??Number(second?.score||0)/100);
  return score>=.94&&(rows.length===1||score-secondScore>=.08)?top:null;
}

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const supabaseUrl=Deno.env.get("SUPABASE_URL")||"",serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!supabaseUrl||!serviceKey)return json({ok:false,error:"server_config"},500);
  const parsed=new URL(supabaseUrl);if(parsed.protocol!=="https:"||parsed.hostname!==PROJECT_HOST)return json({ok:false,error:"unexpected_supabase_project"},500);
  const suppliedKey=req.headers.get("x-da-worker-key")||"";if(!suppliedKey)return json({ok:false,error:"unauthorized"},401);
  const sb=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:secretRow,error:secretError}=await sb.from("system_secrets").select("key_hash,is_active").eq("key_name","conversation_worker_webhook_v2").maybeSingle();
  if(secretError||!secretRow?.is_active||(await sha256Hex(suppliedKey))!==secretRow.key_hash)return json({ok:false,error:"unauthorized"},401);
  let body:any={};try{body=await req.json()}catch{return json({ok:false,error:"invalid_json"},400)}
  if(body?.event==="healthcheck")return json({ok:true,event:"healthcheck",worker_version:4,architecture:"cost_first",v3_fallback:true},200);
  const expectedJobId=uuid(body?.job_id);if(!expectedJobId)return json({ok:false,error:"job_id_required"},400);

  const proxyV3=async()=>{
    const r=await fetch(V3_URL,{method:"POST",headers:{"Content-Type":"application/json","x-da-worker-key":suppliedKey},body:JSON.stringify({job_id:expectedJobId}),signal:AbortSignal.timeout(120000),redirect:"error"});
    const text=await r.text();
    return new Response(text,{status:r.status,headers:{"Content-Type":r.headers.get("content-type")||"application/json","Cache-Control":"no-store"}});
  };

  const {data:pre,error:preError}=await sb.rpc("get_whatsapp_cost_first_preflight_v1",{p_job_id:expectedJobId});
  if(preError||!pre)return proxyV3();
  if(!pre.eligible)return proxyV3();

  const messageText=clean(pre?.message?.text,4000),normalized=norm(messageText),interactiveId=clean(pre?.message?.interactive?.id,256);
  const customerFirst=firstName(pre?.first_name||pre?.customer?.name);
  const vars:Record<string,unknown>={first_name:customerFirst,name_suffix:customerFirst?`, ${customerFirst}`:""};
  const trigger=pre?.trigger?.matched?pre.trigger:null;
  const candidates=arr(pre?.product_candidates);
  const candidate=strongCandidate(candidates);
  const prodIntent=deterministicProductIntent(messageText);
  const exactCart=new Set(["carrinho","meu carrinho","ver carrinho","resumo do pedido","ver pedido"]);
  const basketIntent=/\bcestas?\b/.test(normalized);
  const deterministicHint=trigger?`trigger:${clean(trigger?.trigger?.key,80)}`:basketIntent?"baskets":exactCart.has(normalized)?"cart":candidate&&prodIntent?`product_${prodIntent}`:"";

  if(pre.shadow_mode){
    if(deterministicHint){
      await sb.rpc("record_service_trigger_event_v1",{
        p_conversation_id:pre.conversation.id,p_message_id:pre.message.id,
        p_trigger_id:uuid(trigger?.trigger?.id)||null,p_trigger_key:trigger?.trigger?.key||deterministicHint,
        p_action_type:trigger?.trigger?.action_type||deterministicHint,p_execution_mode:"shadow",
        p_result:{hint:deterministicHint,candidate: candidate?{id:candidate.id,name:candidate.name,score:candidate.score}:null},
        p_estimated_ai_calls_saved:0,p_estimated_input_tokens_avoided:0
      });
    }
    return proxyV3();
  }

  // Cliques/botões já têm execução determinística madura no worker v3.
  if(interactiveId)return proxyV3();
  if(!deterministicHint)return proxyV3();

  const workerId=`conversation-cost-first-${crypto.randomUUID()}`;
  const {data:job,error:claimError}=await sb.rpc("claim_conversation_job_v2",{p_worker:workerId,p_expected_job_id:expectedJobId});
  if(claimError)return json({ok:false,error:"claim_failed"},500);
  if(!job)return json({ok:true,skipped:true,reason:"job_not_claimable"},202);
  if(job.skipped)return json({ok:true,skipped:true,reason:clean(job.reason,100)},200);

  const finish=async(result:any,error:string|null=null)=>{
    const usage={model:"deterministic_cost_first_v1",provider_request_id:null,input_tokens:0,output_tokens:0,estimated_cost_usd:0,pricing_version:"cost_first_v1"};
    const {data,error:finishError}=await sb.rpc("finish_whatsapp_sales_job_v1",{p_job_id:job.id,p_worker:workerId,p_attempt:job.attempt,p_result:result,p_usage:usage,p_error:error});
    if(finishError)throw new Error("completion_uncertain");return data;
  };
  const queueReply=async(text:string,mode="text",imageUrl:string|null=null,interactive:any=null,action="reply",actionResult:any={},confidence=1)=>{
    const {data,error}=await sb.rpc("queue_whatsapp_sales_reply_v1",{p_conversation_id:job.conversation_id,p_source_message_id:job.message_id,p_body_text:text,p_delivery_mode:mode,p_image_url:imageUrl,p_interactive:interactive,p_action_type:action,p_action_result:actionResult,p_confidence:confidence});
    if(error)throw new Error("reply_queue_failed");return data;
  };
  const record=async(key:string,action:string,result:any,saved=1)=>sb.rpc("record_service_trigger_event_v1",{
    p_conversation_id:job.conversation_id,p_message_id:job.message_id,p_trigger_id:uuid(trigger?.trigger?.id)||null,p_trigger_key:key,
    p_action_type:action,p_execution_mode:"deterministic",p_result:result||{},p_estimated_ai_calls_saved:saved,p_estimated_input_tokens_avoided:0
  });
  const block=trigger?.block||null;

  try{
    if(trigger){
      const action=clean(trigger.trigger.action_type,80);
      if(action==="human"){
        await sb.rpc("queue_human_handoff_v1",{p_conversation_id:job.conversation_id,p_reason:"customer_requested_human",p_message_id:job.message_id,p_priority:2,p_summary:"Cliente pediu atendimento humano; contexto preservado pelo roteador cost-first.",p_context:{source:"whatsapp_cost_first_v1"}});
        const text=renderText(block?.body_template||"Vou encaminhar seu atendimento para a equipe.",vars);
        await queueReply(text,"text",null,null,"human_handoff",{trigger:trigger.trigger.key},1);
        await record(trigger.trigger.key,"human",{handoff:true},1);
        await finish({plan:{intent:"human",deterministic:true,cost_first:true},action_result:{handoff:true}});
        return json({ok:true,status:"done",worker_version:4,route:"trigger_human"});
      }
      if(action==="send_block"&&block){
        const text=renderText(block.body_template,vars);
        const mode=clean(block.delivery_mode,30)||"text";
        const imageUrl=renderText(block.image_url_template||"",vars)||null;
        const interactive=block.interactive_template?renderJson(block.interactive_template,vars):null;
        await queueReply(text,mode,imageUrl,interactive,"trigger_block",{trigger:trigger.trigger.key,block:block.key},1);
        await record(trigger.trigger.key,"send_block",{block:block.key},1);
        await finish({plan:{intent:"answer",deterministic:true,cost_first:true},action_result:{trigger:trigger.trigger.key,block:block.key}});
        return json({ok:true,status:"done",worker_version:4,route:"trigger_block",trigger:trigger.trigger.key});
      }
      await record(trigger.trigger.key,action,{fallback:"unsupported_configured_action"},0);
      return proxyV3();
    }

    if(basketIntent){
      const {data:baskets,error}=await sb.rpc("get_whatsapp_simple_baskets_v1");if(error)throw new Error("basket_search_failed");
      const rows=arr(baskets);if(!rows.length){await queueReply(`Poxa${vars.name_suffix}, ainda não há cestas liberadas no atendimento.`,"text",null,null,"baskets_unavailable",{},1)}
      else if(rows.length<=10){const text=`Claro${vars.name_suffix} 😊 Estas são as nossas cestas disponíveis hoje:`;await queueReply(text,"interactive",null,basketListInteractive(rows,text),"show_baskets",{baskets:rows},1)}
      else{const text=`Claro${vars.name_suffix} 😊 Estas são as nossas cestas disponíveis hoje:\n\n${rows.map((b:any)=>`• ${clean(b.display_name||b.name,80)} — ${money(b.base_price)}`).join("\n")}`;await queueReply(text,"text",null,null,"show_baskets",{baskets:rows},1)}
      await record("builtin_baskets_v1","show_baskets",{count:rows.length},0);
      await finish({plan:{intent:"baskets",deterministic:true,cost_first:true},action_result:{count:rows.length}});
      return json({ok:true,status:"done",worker_version:4,route:"baskets"});
    }

    if(exactCart.has(normalized)){
      const {data:cart,error}=await sb.rpc("get_whatsapp_sales_cart_v1",{p_conversation_id:job.conversation_id});if(error)throw new Error("cart_read_failed");
      const text=cartText(cart);await queueReply(text,"text",null,null,"cart_summary",cart||{},1);
      await record("builtin_cart_v1","cart",{exists:Boolean(cart?.exists)},0);
      await finish({plan:{intent:"cart",deterministic:true,cost_first:true},action_result:cart||{}});
      return json({ok:true,status:"done",worker_version:4,route:"cart"});
    }

    if(candidate&&prodIntent==="search"){
      const body=`Encontrei esta opção${vars.name_suffix}: ${clean(candidate.name,100)} — ${money(candidate.price)}.`;
      if(candidate.image_url)await queueReply(body,"image",candidate.image_url,null,"show_product",candidate,Number(candidate.confidence||1));
      else await queueReply(body,"text",null,null,"show_product",candidate,Number(candidate.confidence||1));
      await record("builtin_product_resolver_v1","search_product",{candidate_id:candidate.id,score:candidate.score},1);
      await finish({plan:{intent:"search",deterministic:true,cost_first:true},action_result:{product:candidate}});
      return json({ok:true,status:"done",worker_version:4,route:"product_search"});
    }

    if(candidate&&prodIntent==="add"){
      const qty=quantityFrom(messageText);
      const {data:added,error:addError}=await sb.rpc("add_whatsapp_sales_product_v1",{p_conversation_id:job.conversation_id,p_product_id:candidate.id,p_quantity:qty});if(addError)throw new Error("add_product_failed");
      const {data:cart,error:cartError}=await sb.rpc("get_whatsapp_sales_cart_v1",{p_conversation_id:job.conversation_id});if(cartError)throw new Error("cart_read_failed");
      const localVars={...vars,quantity:qty,product_name:candidate.name,cart_total:money(cart?.total)};
      const {data:addBlock}=await sb.from("service_message_blocks").select("body_template").eq("block_key","product_added_v1").eq("status","published").maybeSingle();
      const text=renderText(addBlock?.body_template||"Prontinho{{name_suffix}} 😊 Coloquei {{quantity}}× {{product_name}} no seu pedido. O total agora ficou em {{cart_total}}.",localVars);
      await queueReply(text,"text",null,null,"add_product",{added,cart},Number(candidate.confidence||1));
      await record("builtin_product_resolver_v1","add_product",{candidate_id:candidate.id,score:candidate.score,quantity:qty},1);
      await finish({plan:{intent:"add",deterministic:true,cost_first:true},action_result:{added,cart}});
      return json({ok:true,status:"done",worker_version:4,route:"product_add"});
    }

    return proxyV3();
  }catch(error){
    const code=clean(error instanceof Error?error.message:"cost_first_failed",100).replace(/[^a-z0-9_]+/gi,"_").toLowerCase();
    try{await finish({},code);return json({ok:false,handled:true,error:code,worker_version:4},200)}catch{return json({ok:false,error:"completion_uncertain_review_required",worker_version:4},500)}
  }
});
