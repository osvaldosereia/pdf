const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

export function auditQuickPurchase(config,productMap){
  const sections=[];
  const missing=[];
  const emptyItems=[];
  let groups=0;
  let references=0;
  let availableReferences=0;
  for(const section of config?.sections||[]){
    const items=[];
    for(const item of section.items||[]){
      groups+=1;
      const products=[];
      const unavailable=[];
      for(const ref of item.productRefs||[]){
        references+=1;
        const product=productMap instanceof Map?productMap.get(String(ref).toLowerCase()):null;
        if(product&&product.situacao!=='I'&&Number(product.estoque)>0&&Number(product.preco)>0){products.push(product);availableReferences+=1;}
        else{const issue=Object.freeze({sectionId:section.id,itemId:item.id,ref:String(ref)});missing.push(issue);unavailable.push(issue);}
      }
      if(!products.length)emptyItems.push(Object.freeze({sectionId:section.id,itemId:item.id,titulo:item.titulo}));
      items.push(Object.freeze({...item,products:Object.freeze(products),unavailable:Object.freeze(unavailable),valid:products.length>0}));
    }
    sections.push(Object.freeze({...section,items:Object.freeze(items),valid:items.some(item=>item.valid)}));
  }
  return Object.freeze({
    config,
    sections:Object.freeze(sections),
    missing:Object.freeze(missing),
    emptyItems:Object.freeze(emptyItems),
    sectionCount:sections.length,
    groups,
    references,
    availableReferences,
    coverage:references?Math.round(availableReferences/references*100):0,
    valid:sections.length>0&&emptyItems.length===0
  });
}

export function filterQuickSections(sections=[],query=''){
  const q=norm(query);
  if(!q)return sections;
  return sections.filter(section=>norm([section.titulo,section.descricao,...section.items.flatMap(item=>[item.titulo,item.descricao,...item.products.map(product=>product.nome)])].join(' ')).includes(q));
}