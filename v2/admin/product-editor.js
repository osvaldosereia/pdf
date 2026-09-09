import { APP_CONFIG } from '../shared/config.js';

const STORAGE_KEY=`${APP_CONFIG.cache.namespace}:product-edit-drafts`;
const HISTORY_KEY=`${APP_CONFIG.cache.namespace}:product-edit-history`;

export const EDITABLE_FIELDS=Object.freeze([
  ['nome','Nome','text'],['descricao','Descrição','textarea'],['codigo','Código','text'],['gtin','EAN / GTIN','text'],['ncm','NCM','text'],
  ['categoria','Categoria','text'],['subcategoria','Subcategoria','text'],['subsubcategoria','Subsubcategoria','text'],['marca','Marca','text'],
  ['fornecedor','Fornecedor','text'],['embalagem','Embalagem','text'],['tags','Tags','text'],['preco_custo','Custo','number'],['preco','Preço de venda','number'],
  ['estoque','Estoque','number'],['validade','Validade','date'],['gondola','Gôndola','text'],['prateleira','Prateleira','text'],['imagem','URL da imagem','url']
]);

const text=value=>String(value??'').trim();
const number=value=>{const n=Number(value);return Number.isFinite(n)?n:0;};
const clone=value=>JSON.parse(JSON.stringify(value));

export function productIdentity(product={}){return text(product.firebaseKey||product.id||product.codigo||product.gtin);}

export function normalizeDraft(product={},values={}){
  const draft={};
  for(const [field,,type] of EDITABLE_FIELDS){
    let value=values[field]??product[field]??'';
    if(type==='number')value=number(value);
    else value=text(value);
    draft[field]=value;
  }
  draft.tags=Array.isArray(values.tags)?values.tags.map(text).filter(Boolean).join(', '):text(values.tags??product.tags);
  return draft;
}

export function validateProductDraft(draft={}){
  const errors=[];
  if(!text(draft.nome))errors.push('Nome é obrigatório.');
  if(!text(draft.codigo)&&!text(draft.gtin))errors.push('Informe código interno ou EAN.');
  if(number(draft.preco)<0)errors.push('Preço de venda não pode ser negativo.');
  if(number(draft.preco_custo)<0)errors.push('Custo não pode ser negativo.');
  if(number(draft.estoque)<0)errors.push('Estoque não pode ser negativo.');
  if(text(draft.ncm)&&!/^\d{8}$/.test(text(draft.ncm).replace(/\D/g,'')))errors.push('NCM deve conter 8 dígitos.');
  if(text(draft.gtin)&&!/^\d{8,14}$/.test(text(draft.gtin).replace(/\D/g,'')))errors.push('EAN/GTIN deve conter entre 8 e 14 dígitos.');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}

export function diffProduct(original={},draft={}){
  return Object.freeze(EDITABLE_FIELDS.flatMap(([field,label,type])=>{
    const before=type==='number'?number(original[field]):text(Array.isArray(original[field])?original[field].join(', '):original[field]);
    const after=type==='number'?number(draft[field]):text(draft[field]);
    return String(before)===String(after)?[]:[Object.freeze({field,label,before,after})];
  }));
}

export function createProductEditorSession(product={}){
  const id=productIdentity(product);
  if(!id)throw new Error('Produto sem identificação segura.');
  let draft=normalizeDraft(product);
  return Object.freeze({
    id,
    original:Object.freeze(clone(product)),
    getDraft:()=>Object.freeze(clone(draft)),
    update(values={}){draft=normalizeDraft(product,{...draft,...values});return this.getDraft();},
    reset(){draft=normalizeDraft(product);return this.getDraft();},
    changes(){return diffProduct(product,draft);},
    isDirty(){return this.changes().length>0;},
    validate(){return validateProductDraft(draft);}
  });
}

function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback;}catch{return fallback;}}
function writeJson(key,value){localStorage.setItem(key,JSON.stringify(value));}

export function readProductDrafts(){return readJson(STORAGE_KEY,{});}
export function readProductEditHistory(){return readJson(HISTORY_KEY,[]);}

export function saveProductDraft(product={},draft={}){
  const id=productIdentity(product);if(!id)throw new Error('Produto sem identificação segura.');
  const validation=validateProductDraft(draft);if(!validation.valid)throw new Error(validation.errors.join(' '));
  const changes=diffProduct(product,draft);if(!changes.length)throw new Error('Nenhuma alteração foi identificada.');
  const saved=Object.freeze({id,environment:'homologation-local',savedAt:new Date().toISOString(),original:clone(product),draft:clone(draft),changes});
  const drafts=readProductDrafts();drafts[id]=saved;writeJson(STORAGE_KEY,drafts);
  const history=[saved,...readProductEditHistory()].slice(0,50);writeJson(HISTORY_KEY,history);
  return saved;
}

export function discardProductDraft(product={}){const id=productIdentity(product);const drafts=readProductDrafts();delete drafts[id];writeJson(STORAGE_KEY,drafts);}
