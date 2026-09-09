import { APP_CONFIG } from './config.js';

function text(value){return String(value??'').trim();}
function number(value){const n=Number(value);return Number.isFinite(n)?n:0;}
function entries(raw){return Array.isArray(raw)?raw:Object.values(raw||{});}
async function fetchJson(url,timeoutMs=6000){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);try{const response=await fetch(url,{cache:'no-cache',headers:{Accept:'application/json'},signal:controller.signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);return await response.json();}finally{clearTimeout(timer);}}

function normalizeCollectionItems(rawItems){
  return (Array.isArray(rawItems)?rawItems:[]).map(item=>{
    if(item&&typeof item==='object'){
      return Object.freeze({
        ref:text(item.firebaseKey||item.id||item.codigo||item.gtin||item.ean),
        quantidade:Math.max(1,Math.floor(number(item.quantidade||item.qtd||item.quantity||1)))
      });
    }
    return Object.freeze({ref:text(item),quantidade:1});
  }).filter(item=>item.ref);
}

export function normalizeBasket(raw={}){
  const id=text(raw.id||raw.codigo);
  const items=normalizeCollectionItems(raw.produtos);
  return Object.freeze({id,nome:text(raw.nome||'Cesta básica'),descricao:text(raw.descricao),imagem:text(raw.imagem||raw.url_imagem),preco:number(raw.preco),precoOriginal:number(raw.preco_original||raw.precoOriginal),items,productRefs:items.map(item=>item.ref),ativo:raw.ativo!==false});
}

export function normalizeKit(raw={}){
  const id=text(raw.id||raw.codigo);
  const items=normalizeCollectionItems(raw.produtos);
  const carouselPath=text(raw.carrossel_path||raw.carrosselPath||raw.instagram_carrossel_path||raw.dados_carrossel);
  const carouselQueued=raw.carrossel_gerado===true||raw.carouselGenerated===true||raw.gerado_para_fila===true||Boolean(carouselPath);
  const carouselStatus=text(raw.carrossel_status||raw.carouselStatus||raw.status_carrossel||(carouselQueued?'gerado':''));
  return Object.freeze({
    id,
    nome:text(raw.nome||'Kit promocional'),
    descricao:text(raw.descricao),
    imagem:text(raw.imagem||raw.url_imagem),
    preco:number(raw.preco||raw.preco_promocional),
    precoOriginal:number(raw.preco_original||raw.precoOriginal||raw.soma_avulsa),
    items,
    productRefs:items.map(item=>item.ref),
    ativo:raw.ativo!==false,
    inicio:text(raw.data_inicio||raw.dataInicio||raw.inicio),
    fim:text(raw.data_fim||raw.dataFim||raw.fim),
    carousel:Object.freeze({generated:carouselQueued,status:carouselStatus,path:carouselPath})
  });
}

export function resolveCollection(collection,productIndex){
  const rows=[];
  const missing=[];
  const unavailable=[];
  for(const item of collection?.items||[]){
    const product=productIndex instanceof Map?productIndex.get(String(item.ref).toLowerCase()):null;
    if(!product){missing.push(item.ref);continue;}
    if(product.situacao==='I'||product.estoque<=0||product.preco<=0){unavailable.push(product.id);continue;}
    rows.push(Object.freeze({product,quantidade:item.quantidade}));
  }
  const requested=(collection?.items||[]).length;
  return Object.freeze({collection,rows,requested,resolved:rows.length,missing,unavailable,valid:requested>0&&rows.length===requested&&missing.length===0&&unavailable.length===0});
}

export function currentOffers(products=[]){
  const now=Date.now();
  return products.filter(product=>{
    if(!(product.precoOferta>0&&product.precoOferta<product.preco))return false;
    if(!product.validadeOferta)return true;
    const end=new Date(`${product.validadeOferta}T23:59:59`).getTime();
    return Number.isNaN(end)||end>=now;
  });
}

async function loadCollection(url,normalizer){
  try{return entries(await fetchJson(url)).map(normalizer).filter(item=>item.id&&item.ativo);}catch{return [];}
}

export async function loadHomeCollections(){
  const [baskets,kits]=await Promise.all([
    loadCollection(APP_CONFIG.snapshots.baskets,normalizeBasket),
    loadCollection(APP_CONFIG.snapshots.kits,normalizeKit)
  ]);
  return Object.freeze({baskets,kits});
}
