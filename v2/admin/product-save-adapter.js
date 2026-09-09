import { validateProductDraft, diffProduct, productIdentity } from './product-editor.js';
import { canWriteExternally } from '../shared/environment.js';

export const SAVE_ENVIRONMENT='homologation';

function clone(value){return JSON.parse(JSON.stringify(value??null));}
function text(value){return String(value??'').trim();}

export function buildProductChangeRequest(original={},draft={}){
  const productId=productIdentity(original)||productIdentity(draft);
  if(!productId)throw new Error('Produto sem identificação segura para preparar alteração.');

  const validation=validateProductDraft(draft);
  if(!validation.valid)throw new Error(validation.errors.join(' '));

  const changes=diffProduct(original,draft);
  if(!changes.length)throw new Error('Nenhuma alteração foi identificada.');

  return Object.freeze({
    version:1,
    environment:SAVE_ENVIRONMENT,
    mode:'draft_only',
    productId,
    firebaseKey:text(original.firebaseKey||draft.firebaseKey||productId),
    before:clone(original),
    after:Object.freeze({...clone(original),...clone(draft)}),
    changes,
    createdAt:new Date().toISOString(),
    externalWriteAllowed:false
  });
}

export function validateProductChangeRequest(request={}){
  const errors=[];
  if(!text(request.productId))errors.push('Requisição sem identificador do produto.');
  if(request.mode!=='draft_only')errors.push('Modo de salvamento inválido para homologação.');
  if(!request.after||typeof request.after!=='object')errors.push('Payload final do produto ausente.');
  if(!Array.isArray(request.changes)||request.changes.length===0)errors.push('Nenhuma alteração informada.');
  if(request.externalWriteAllowed===true)errors.push('Escrita externa não pode estar habilitada na homologação.');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors)});
}

export function canSendExternalWrite(request={}){
  return canWriteExternally()===true&&request.environment==='production-enabled'&&request.externalWriteAllowed===true;
}

export function prepareProductSave(original={},draft={}){
  const request=buildProductChangeRequest(original,draft);
  const validation=validateProductChangeRequest(request);
  if(!validation.valid)throw new Error(validation.errors.join(' '));
  return Object.freeze({request,validation,canWrite:canSendExternalWrite(request)});
}
