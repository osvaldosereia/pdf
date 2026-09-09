const requiredFields=Object.freeze([
  ['nome','Nome'],['codigo','Código'],['gtin','GTIN / EAN'],['ncm','NCM'],['categoria','Categoria'],['subcategoria','Subcategoria'],['marca','Marca'],['embalagem','Embalagem'],['preco','Preço de venda'],['imagem','Imagem']
]);

function present(value){return !(value===null||value===undefined||String(value).trim()===''||Number.isNaN(value));}

export function auditProduct(product={}){
  const missing=[];
  for(const [field,label] of requiredFields){
    const value=field==='imagem'?product.imagem:product[field];
    if(field==='preco'?Number(value)<=0:!present(value))missing.push({field,label});
  }
  return Object.freeze({
    complete:missing.length===0,
    missing:Object.freeze(missing),
    score:Math.round((requiredFields.length-missing.length)/requiredFields.length*100)
  });
}

export function auditProducts(products=[]){
  const rows=(products||[]).map(product=>Object.freeze({product,audit:auditProduct(product)}));
  const incomplete=rows.filter(row=>!row.audit.complete);
  const fieldCounts={};
  for(const row of incomplete){for(const item of row.audit.missing)fieldCounts[item.field]=(fieldCounts[item.field]||0)+1;}
  return Object.freeze({
    rows:Object.freeze(rows),
    incomplete:Object.freeze(incomplete),
    completeCount:rows.length-incomplete.length,
    incompleteCount:incomplete.length,
    averageScore:rows.length?Math.round(rows.reduce((sum,row)=>sum+row.audit.score,0)/rows.length):0,
    fieldCounts:Object.freeze(fieldCounts)
  });
}

export function filterProducts(products=[],filters={}){
  const query=String(filters.query||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const quality=String(filters.quality||'');
  const category=String(filters.category||'');
  return (products||[]).filter(product=>{
    const audit=auditProduct(product);
    const haystack=[product.nome,product.codigo,product.gtin,product.marca,product.categoria,product.subcategoria].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    if(query&&!haystack.includes(query))return false;
    if(category&&product.categoria!==category)return false;
    if(quality==='complete'&&!audit.complete)return false;
    if(quality==='incomplete'&&audit.complete)return false;
    if(quality&&quality.startsWith('missing:')&&!audit.missing.some(item=>item.field===quality.slice(8)))return false;
    return true;
  });
}

export { requiredFields };
