import { APP_CONFIG, firebaseNodeUrl } from './config.js';

const text=value=>String(value??'').trim();
const entries=raw=>Array.isArray(raw)?raw:Object.values(raw||{});

async function fetchJson(url,timeoutMs=6000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{cache:'no-cache',headers:{Accept:'application/json'},signal:controller.signal});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return await response.json();
  }finally{clearTimeout(timer);}
}

function refOf(raw){
  if(raw==null)return'';
  if(typeof raw==='string'||typeof raw==='number')return text(raw);
  return text(raw.firebaseKey||raw.id||raw.codigo||raw.gtin||raw.ean);
}

function normalizeItem(raw={},index=0){
  const refs=entries(raw.produtos||raw.opcoes||raw.products).map(refOf).filter(Boolean);
  return Object.freeze({
    id:text(raw.id||`item-${index+1}`),
    titulo:text(raw.titulo||raw.nome||`Item ${index+1}`),
    descricao:text(raw.descricao),
    ordem:Number(raw.ordem??index),
    essencial:raw.essencial===true,
    ativo:raw.ativo!==false,
    productRefs:Object.freeze(refs)
  });
}

function normalizeSection(raw={},index=0){
  const items=entries(raw.itens||raw.items).map((item,itemIndex)=>normalizeItem(item,itemIndex)).filter(item=>item.ativo&&item.productRefs.length);
  return Object.freeze({
    id:text(raw.id||`secao-${index+1}`),
    titulo:text(raw.titulo||raw.nome||`Seção ${index+1}`),
    descricao:text(raw.descricao),
    ordem:Number(raw.ordem??index),
    ativo:raw.ativo!==false,
    items:Object.freeze(items.sort((a,b)=>a.ordem-b.ordem))
  });
}

export function normalizeQuickPurchase(raw={}){
  const sections=entries(raw.secoes||raw.sections).map((section,index)=>normalizeSection(section,index)).filter(section=>section.ativo&&section.items.length).sort((a,b)=>a.ordem-b.ordem);
  return Object.freeze({
    titulo:text(raw.titulo||'Compra rápida'),
    subtitulo:text(raw.subtitulo||'Escolha os produtos essenciais em poucos minutos.'),
    ativo:raw.ativo!==false,
    sections:Object.freeze(sections)
  });
}

export function resolveQuickPurchase(config,productMap){
  const missing=[];
  const sections=(config?.sections||[]).map(section=>({
    ...section,
    items:section.items.map(item=>{
      const products=[];
      for(const ref of item.productRefs){
        const product=productMap instanceof Map?productMap.get(String(ref).toLowerCase()):null;
        if(product&&product.situacao!=='I'&&product.estoque>0&&product.preco>0)products.push(product);
        else missing.push({sectionId:section.id,itemId:item.id,ref});
      }
      return Object.freeze({...item,products:Object.freeze(products)});
    }).filter(item=>item.products.length)
  })).filter(section=>section.items.length);
  return Object.freeze({config:Object.freeze({...config,sections:Object.freeze(sections)}),missing:Object.freeze(missing),valid:sections.length>0});
}

export async function loadQuickPurchase(){
  const sources=[
    firebaseNodeUrl(APP_CONFIG.firebase.nodes.quickPurchase),
    '../../site/compra-rapida.json'
  ];
  const errors=[];
  for(const url of sources){
    try{
      const normalized=normalizeQuickPurchase(await fetchJson(url));
      if(!normalized.ativo||!normalized.sections.length)throw new Error('Configuração vazia ou inativa.');
      return normalized;
    }catch(error){errors.push(`${url}: ${error.message||error}`);}
  }
  throw new Error(`Compra rápida indisponível. ${errors.join(' | ')}`);
}
