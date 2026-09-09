function normalize(value){return String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function number(value){const parsed=Number(value);return Number.isFinite(parsed)?parsed:0;}
function dateValue(value){if(!value)return 0;const parsed=new Date(`${value}T23:59:59`).getTime();return Number.isNaN(parsed)?0:parsed;}

export function auditKit(kit,productIndex,now=Date.now()){
  const rows=[];
  const missing=[];
  const unavailable=[];
  const insufficient=[];
  for(const item of kit?.items||[]){
    const product=productIndex instanceof Map?productIndex.get(String(item.ref).toLowerCase()):null;
    if(!product){missing.push(item.ref);continue;}
    const stock=number(product.estoque),quantity=Math.max(1,number(item.quantidade)||1),unitPrice=number(product.precoOferta)>0&&number(product.precoOferta)<number(product.preco)?number(product.precoOferta):number(product.preco);
    if(product.situacao==='I'||unitPrice<=0){unavailable.push(item.ref);continue;}
    if(stock<quantity)insufficient.push(Object.freeze({ref:item.ref,stock,required:quantity}));
    rows.push(Object.freeze({product,quantity,stock,unitPrice,subtotal:unitPrice*quantity}));
  }
  const retailTotal=rows.reduce((sum,row)=>sum+row.subtotal,0);
  const commercialPrice=number(kit?.preco);
  const savings=Math.max(0,retailTotal-commercialPrice);
  const discount=retailTotal>0&&commercialPrice>0?Math.max(0,Math.round((1-commercialPrice/retailTotal)*10000)/100):0;
  const start=dateValue(kit?.inicio),end=dateValue(kit?.fim);
  const periodStatus=end&&end<now?'expired':start&&start>now?'scheduled':'active';
  const periodValid=!start||!end||start<=end;
  const compositionValid=(kit?.items||[]).length>0&&missing.length===0&&unavailable.length===0&&insufficient.length===0&&rows.length===(kit?.items||[]).length;
  const priceValid=commercialPrice>0&&retailTotal>0;
  return Object.freeze({
    kit,
    rows,
    missing,
    unavailable,
    insufficient,
    retailTotal,
    commercialPrice,
    savings,
    discount,
    periodStatus,
    periodValid,
    carouselGenerated:Boolean(kit?.carousel?.generated),
    carouselStatus:String(kit?.carousel?.status||''),
    valid:compositionValid&&priceValid&&periodValid
  });
}

export function auditKits(kits=[],productIndex,now=Date.now()){
  const rows=kits.map(kit=>auditKit(kit,productIndex,now));
  return Object.freeze({
    rows,
    total:rows.length,
    valid:rows.filter(row=>row.valid).length,
    blocked:rows.filter(row=>!row.valid).length,
    active:rows.filter(row=>row.periodStatus==='active').length,
    expired:rows.filter(row=>row.periodStatus==='expired').length,
    carouselGenerated:rows.filter(row=>row.carouselGenerated).length
  });
}

export function filterKitAudits(rows=[],query='',status=''){
  const term=normalize(query);
  return rows.filter(row=>{
    const matchesQuery=!term||normalize(`${row.kit.nome} ${row.kit.id}`).includes(term);
    const matchesStatus=!status||(status==='valid'&&row.valid)||(status==='blocked'&&!row.valid)||(status==='active'&&row.periodStatus==='active')||(status==='expired'&&row.periodStatus==='expired')||(status==='carousel'&&row.carouselGenerated)||(status==='no-carousel'&&!row.carouselGenerated);
    return matchesQuery&&matchesStatus;
  });
}
