import { APP_CONFIG, firebaseNodeUrl } from '../shared/config.js';

const text=value=>String(value??'').trim();
const mask=value=>{const raw=text(value);if(!raw)return'';if(raw.length<=8)return'••••';return `${raw.slice(0,4)}••••${raw.slice(-4)}`;};

export function buildIntegrationRegistry(config=APP_CONFIG){
  const firebaseBase=text(config?.firebase?.baseUrl);
  const nodes=config?.firebase?.nodes||{};
  const snapshots=config?.snapshots||{};
  return Object.freeze([
    Object.freeze({id:'firebase',name:'Firebase',kind:'database',configured:Boolean(firebaseBase),endpoint:firebaseBase?new URL(firebaseBase).host:'',checks:Object.keys(nodes).map(key=>({label:key,target:firebaseNodeUrl(nodes[key]),safeMethod:'GET'})),writesBlocked:true}),
    Object.freeze({id:'github',name:'GitHub',kind:'repository',configured:Boolean(Object.keys(snapshots).length),endpoint:'github.com/osvaldosereia/SUCEDOAN12',checks:Object.entries(snapshots).map(([key,target])=>({label:key,target,safeMethod:'GET'})),writesBlocked:true}),
    Object.freeze({id:'make',name:'Make',kind:'automation',configured:false,endpoint:'Não armazenado na V2',checks:[],writesBlocked:true,reason:'Webhooks não são executados no diagnóstico para evitar disparos reais.'}),
    Object.freeze({id:'bling',name:'Bling',kind:'erp',configured:false,endpoint:'Não armazenado na V2',checks:[],writesBlocked:true,reason:'Tokens e endpoints autenticados não podem ficar no front-end.'}),
    Object.freeze({id:'openai',name:'OpenAI / IA',kind:'ai',configured:false,endpoint:'Somente via Make/servidor',checks:[],writesBlocked:true,reason:'A chave da API não deve ser exposta no navegador.'})
  ]);
}

export async function safeGetProbe(target,timeoutMs=5000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  const started=performance.now();
  try{
    const response=await fetch(target,{method:'GET',cache:'no-store',headers:{Accept:'application/json'},signal:controller.signal});
    return Object.freeze({ok:response.ok,status:response.status,latencyMs:Math.round(performance.now()-started),error:response.ok?'':`HTTP ${response.status}`});
  }catch(error){return Object.freeze({ok:false,status:0,latencyMs:Math.round(performance.now()-started),error:text(error?.name==='AbortError'?'Tempo limite excedido.':error?.message||error)});}finally{clearTimeout(timer);}
}

export function summarizeIntegrationResults(registry=[],results=new Map()){
  const rows=registry.map(item=>{
    const probes=item.checks.map(check=>results.get(`${item.id}:${check.label}`)).filter(Boolean);
    const passed=probes.filter(result=>result.ok).length;
    const failed=probes.filter(result=>!result.ok).length;
    const status=!item.configured?'not-configured':!probes.length?'not-tested':failed?'warning':'healthy';
    return Object.freeze({...item,passed,failed,status,probeCount:probes.length});
  });
  return Object.freeze({rows,total:rows.length,healthy:rows.filter(row=>row.status==='healthy').length,warnings:rows.filter(row=>row.status==='warning').length,notConfigured:rows.filter(row=>row.status==='not-configured').length});
}

export function describeTarget(value){return mask(value)||'Não informado';}
