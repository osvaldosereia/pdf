function number(value){const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;}
function price(product){const regular=number(product?.preco),offer=number(product?.precoOferta);return offer>0&&offer<regular?offer:regular;}
function key(value){return String(value??'').trim().toLowerCase();}

export function auditBasket(basket,productIndex){
  const rows=[],missing=[],unavailable=[],insufficient=[];
  let retailTotal=0;
  for(const item of basket?.items||[]){
    const product=productIndex instanceof Map?productIndex.get(key(item.ref)):null;
    if(!product){missing.push(item.ref);continue;}
    const quantity=Math.max(1,Math.floor(number(item.quantidade)||1));
    const unitPrice=price(product);
    const stock=number(product.estoque);
    if(product.situacao==='I'||unitPrice<=0){unavailable.push(product.id||item.ref);continue;}
    if(stock<quantity)insufficient.push({ref:product.id||item.ref,required:quantity,stock});
    const subtotal=unitPrice*quantity;
    retailTotal+=subtotal;
    rows.push(Object.freeze({product,quantity,unitPrice,subtotal,stock}));
  }
  const commercialPrice=number(basket?.preco);
  const difference=commercialPrice-retailTotal;
  const discount=retailTotal>0&&commercialPrice>0?Math.round((1-commercialPrice/retailTotal)*10000)/100:0;
  const valid=(basket?.items||[]).length>0&&missing.length===0&&unavailable.length===0&&insufficient.length===0;
  return Object.freeze({basket,rows,missing,unavailable,insufficient,retailTotal,commercialPrice,difference,discount,valid});
}

export function auditBaskets(baskets=[],productIndex){
  const rows=baskets.map(basket=>auditBasket(basket,productIndex));
  return Object.freeze({rows,total:rows.length,valid:rows.filter(row=>row.valid).length,blocked:rows.filter(row=>!row.valid).length,missingItems:rows.reduce((sum,row)=>sum+row.missing.length,0),insufficientItems:rows.reduce((sum,row)=>sum+row.insufficient.length,0)});
}

export function filterBasketAudits(rows=[],query='',status=''){
  const normalized=key(query).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  return rows.filter(row=>{
    const haystack=key(`${row.basket?.nome||''} ${row.basket?.id||''}`).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const statusOk=!status||(status==='valid'?row.valid:!row.valid);
    return (!normalized||haystack.includes(normalized))&&statusOk;
  });
}
