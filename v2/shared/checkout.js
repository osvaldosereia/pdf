import { APP_CONFIG } from './config.js';

const STORAGE_KEY = `${APP_CONFIG.cache.namespace}:checkout-draft`;

function text(value){return String(value??'').trim();}
function digits(value){return text(value).replace(/\D/g,'');}
function safeParse(value,fallback){try{return JSON.parse(value);}catch{return fallback;}}

export function emptyCheckout(){
  return {cliente:{nome:'',cpf:'',telefone:'',email:''},entrega:{cidade:'Cuiabá',bairro:'',logradouro:'',numero:'',complemento:'',referencia:'',agendamento:''},pagamento:{tipo:'dinheiro',trocoPara:''},observacoes:''};
}

export function readCheckoutDraft(){
  const raw=safeParse(localStorage.getItem(STORAGE_KEY),null);
  return raw&&typeof raw==='object'?{...emptyCheckout(),...raw,cliente:{...emptyCheckout().cliente,...raw.cliente},entrega:{...emptyCheckout().entrega,...raw.entrega},pagamento:{...emptyCheckout().pagamento,...raw.pagamento}}:emptyCheckout();
}

export function saveCheckoutDraft(value){localStorage.setItem(STORAGE_KEY,JSON.stringify(value));return value;}
export function clearCheckoutDraft(){localStorage.removeItem(STORAGE_KEY);return emptyCheckout();}

export function validateCheckout(draft,cartSummary){
  const errors=[];
  const cliente=draft?.cliente||{};
  const entrega=draft?.entrega||{};
  const pagamento=draft?.pagamento||{};
  if(text(cliente.nome).length<3)errors.push('Informe o nome completo.');
  if(digits(cliente.telefone).length<10)errors.push('Informe um telefone válido.');
  if(cliente.cpf&&digits(cliente.cpf).length!==11)errors.push('CPF inválido.');
  if(!text(entrega.cidade))errors.push('Informe a cidade.');
  if(!text(entrega.bairro))errors.push('Informe o bairro.');
  if(!text(entrega.logradouro))errors.push('Informe o endereço.');
  if(!text(entrega.numero))errors.push('Informe o número.');
  if(!['dinheiro','pix','cartao'].includes(text(pagamento.tipo)))errors.push('Forma de pagamento inválida.');
  if(!cartSummary?.rows?.length)errors.push('A compra está vazia.');
  if(Number(cartSummary?.total||0)<APP_CONFIG.commerce.minimumOrder)errors.push(`Pedido mínimo de R$ ${APP_CONFIG.commerce.minimumOrder.toFixed(2).replace('.',',')}.`);
  return Object.freeze({valid:errors.length===0,errors});
}

export function buildOrderDraft(draft,cartSummary){
  const validation=validateCheckout(draft,cartSummary);
  if(!validation.valid)return Object.freeze({valid:false,errors:validation.errors,order:null});
  const order={
    ambiente:'homologation',
    criadoEm:new Date().toISOString(),
    cliente:{nome:text(draft.cliente.nome),cpf:digits(draft.cliente.cpf),telefone:digits(draft.cliente.telefone),email:text(draft.cliente.email)},
    entrega:{cidade:text(draft.entrega.cidade),bairro:text(draft.entrega.bairro),logradouro:text(draft.entrega.logradouro),numero:text(draft.entrega.numero),complemento:text(draft.entrega.complemento),referencia:text(draft.entrega.referencia),agendamento:text(draft.entrega.agendamento)},
    pagamento:{tipo:text(draft.pagamento.tipo),trocoPara:Number(String(draft.pagamento.trocoPara||'').replace(',','.'))||0},
    observacoes:text(draft.observacoes),
    itens:cartSummary.rows.map(({product,quantity,subtotal})=>({firebaseKey:product.firebaseKey,id:product.id,codigo:product.codigo,nome:product.nome,quantidade:quantity,precoUnitario:subtotal/quantity,subtotal})),
    total:Number(cartSummary.total||0),
    status:'rascunho_homologacao'
  };
  return Object.freeze({valid:true,errors:[],order:Object.freeze(order)});
}
