export type CompilerContext={
  instruction:string;
  actionKeys:Set<string>;
  triggerTypes:Set<string>;
  strategies:Set<string>;
  conditionFields:Set<string>;
  conditionOps:Set<string>;
};

export type CompilerResult={
  draft:Record<string,unknown>;
  provider:string;
  model:string;
  input_tokens:number;
  output_tokens:number;
  estimated_cost_usd:number;
  cost_cap_usd:number;
  response_id:string|null;
};

const clean=(v:unknown,max=300)=>String(v??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,max);
const obj=(v:unknown)=>v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};
const arr=(v:unknown)=>Array.isArray(v)?v:[];

const envNumber=(name:string,fallback:number)=>{
  const raw=Deno.env.get(name);
  if(raw==null||raw==="")return fallback;
  const n=Number(raw);
  return Number.isFinite(n)&&n>=0?n:fallback;
};

function outputText(payload:any){
  if(typeof payload?.output_text==="string"&&payload.output_text.trim())return payload.output_text;
  for(const item of arr(payload?.output))for(const c of arr((item as any)?.content))if(typeof (c as any)?.text==="string"&&(c as any).text.trim())return (c as any).text;
  return "";
}

function normalizeAiDraft(raw:unknown,ctx:CompilerContext){
  const d=obj(raw);
  const trigger=clean(d.trigger_type,30);
  if(!ctx.triggerTypes.has(trigger))throw new Error("compiler_invalid_trigger");
  const strategy=clean(d.execution_strategy,40);
  if(!ctx.strategies.has(strategy))throw new Error("compiler_invalid_strategy");

  const conditions=[] as Record<string,unknown>[];
  for(const item of arr(d.conditions)){
    const c=obj(item),field=clean(c.field,80),operator=clean(c.operator,20);
    if(!ctx.conditionFields.has(field)||!ctx.conditionOps.has(operator))throw new Error("compiler_invalid_condition");
    conditions.push({field,operator,value:c.value??null});
  }

  const actions=[] as Record<string,unknown>[];
  for(const item of arr(d.actions)){
    const a=obj(item),actionKey=clean(a.action_key,80).toLowerCase();
    if(!ctx.actionKeys.has(actionKey))throw new Error("compiler_unknown_action");
    actions.push({action_key:actionKey,role:"system"});
  }

  return {
    trigger_type:trigger,
    trigger_config:obj(d.trigger_config),
    conditions,
    actions,
    execution_strategy:strategy,
    source_kind:"natural_language",
    natural_language_source:ctx.instruction,
    enabled:false,
    execution_mode:"off",
    kill_switch:true,
    canary_percent:0,
    review_required:true,
    runtime_activation_supported:false,
    compiler:"openai_strict_review_only",
    compiler_summary:clean(d.summary,500),
  };
}

export async function compileWithOpenAI(ctx:CompilerContext):Promise<CompilerResult>{
  if(Deno.env.get("AUTOMATION_OPENAI_COMPILER_ENABLED")!=="true")throw new Error("openai_compiler_disabled");
  const apiKey=Deno.env.get("OPENAI_API_KEY")||"";
  if(!apiKey)throw new Error("openai_compiler_key_missing");

  const model=clean(Deno.env.get("AUTOMATION_OPENAI_COMPILER_MODEL")||"gpt-5.6-luna",80);
  const capUsd=envNumber("AUTOMATION_OPENAI_COMPILER_MAX_COST_USD",0.01);
  const inputPerM=envNumber("AUTOMATION_OPENAI_INPUT_USD_PER_MILLION",0.20);
  const outputPerM=envNumber("AUTOMATION_OPENAI_OUTPUT_USD_PER_MILLION",1.20);
  const maxOutputTokens=Math.max(200,Math.min(1600,Math.floor(envNumber("AUTOMATION_OPENAI_MAX_OUTPUT_TOKENS",900))));
  const estimatedInputTokens=Math.ceil(ctx.instruction.length/3)+700;
  const preflightUsd=(estimatedInputTokens/1_000_000)*inputPerM+(maxOutputTokens/1_000_000)*outputPerM;
  if(preflightUsd>capUsd)throw new Error("openai_compiler_preflight_budget_exceeded");

  const schema={
    type:"object",
    additionalProperties:false,
    required:["trigger_type","trigger_config","conditions","actions","execution_strategy","summary"],
    properties:{
      trigger_type:{type:"string",enum:[...ctx.triggerTypes]},
      trigger_config:{type:"object",additionalProperties:true},
      conditions:{type:"array",maxItems:12,items:{type:"object",additionalProperties:false,required:["field","operator","value"],properties:{field:{type:"string",enum:[...ctx.conditionFields]},operator:{type:"string",enum:[...ctx.conditionOps]},value:{type:["string","number","boolean","null"]}}}},
      actions:{type:"array",maxItems:8,items:{type:"object",additionalProperties:false,required:["action_key"],properties:{action_key:{type:"string",enum:[...ctx.actionKeys]}}}},
      execution_strategy:{type:"string",enum:[...ctx.strategies]},
      summary:{type:"string",maxLength:500},
    }
  };

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12_000);
  let response:Response;
  try{
    response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
      signal:controller.signal,
      body:JSON.stringify({
        model,
        max_output_tokens:maxOutputTokens,
        reasoning:{effort:"none"},
        instructions:"Transforme a instrução em um rascunho de workflow. Não invente actions fora do catálogo. Não calcule preço, estoque, margem, financeiro, rota ou ETA. Para batch determinístico/não urgente prefira github_action. Para qualquer ambiguidade use manual_review. Produza apenas o objeto do schema.",
        input:[{role:"user",content:[{type:"input_text",text:`INSTRUÇÃO:\n${ctx.instruction}\n\nCATÁLOGO DE ACTIONS PERMITIDAS:\n${[...ctx.actionKeys].join(", ")}`}]}],
        text:{format:{type:"json_schema",name:"dona_antonia_workflow_draft",strict:true,schema}},
      })
    });
  }finally{clearTimeout(timeout)}

  if(!response.ok){
    const detail=clean(await response.text().catch(()=>""),500);
    throw new Error(`openai_compiler_http_${response.status}${detail?`:${detail}`:""}`);
  }
  const payload=await response.json();
  const text=outputText(payload);
  if(!text)throw new Error("openai_compiler_empty_output");
  let parsed:unknown;try{parsed=JSON.parse(text)}catch{throw new Error("openai_compiler_invalid_json")}
  const draft=normalizeAiDraft(parsed,ctx);
  const inputTokens=Math.max(0,Number(payload?.usage?.input_tokens)||0),outputTokens=Math.max(0,Number(payload?.usage?.output_tokens)||0);
  const actualUsd=(inputTokens/1_000_000)*inputPerM+(outputTokens/1_000_000)*outputPerM;
  if(actualUsd>capUsd)throw new Error("openai_compiler_actual_budget_exceeded");
  console.log(JSON.stringify({event:"automation_openai_compiler",stage:10,model,response_id:clean(payload?.id,120)||null,input_tokens:inputTokens,output_tokens:outputTokens,estimated_cost_usd:Number(actualUsd.toFixed(6)),side_effect:false,persisted:false}));
  return {draft,provider:"openai",model,input_tokens:inputTokens,output_tokens:outputTokens,estimated_cost_usd:Number(actualUsd.toFixed(6)),cost_cap_usd:capUsd,response_id:clean(payload?.id,120)||null};
}
