function text(value){return String(value??'').trim();}
function normalize(value){return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
function tags(value){if(Array.isArray(value))return value.map(text).filter(Boolean);return text(value).split(/[,;|]/).map(text).filter(Boolean);}
function addCount(map,key){const value=text(key);if(!value)return;map.set(value,(map.get(value)||0)+1);}
function rowsFromMap(map){return [...map.entries()].map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name,'pt-BR'));}

export function buildRegistrationAudit(products=[]){
  const categories=new Map(),subcategories=new Map(),subsubcategories=new Map(),brands=new Map(),suppliers=new Map(),packages=new Map(),tagMap=new Map();
  const relations=new Map();
  for(const product of products){
    addCount(categories,product.categoria);
    addCount(subcategories,product.subcategoria);
    addCount(subsubcategories,product.subsubcategoria);
    addCount(brands,product.marca);
    addCount(suppliers,product.fornecedor);
    addCount(packages,product.embalagem);
    tags(product.tags).forEach(tag=>addCount(tagMap,tag));
    const category=text(product.categoria),subcategory=text(product.subcategoria),subsubcategory=text(product.subsubcategoria);
    if(category){
      if(!relations.has(category))relations.set(category,new Map());
      const subMap=relations.get(category);
      if(subcategory){
        if(!subMap.has(subcategory))subMap.set(subcategory,new Set());
        if(subsubcategory)subMap.get(subcategory).add(subsubcategory);
      }
    }
  }
  const hierarchy=[...relations.entries()].map(([category,subMap])=>({category,subcategories:[...subMap.entries()].map(([name,children])=>({name,children:[...children].sort((a,b)=>a.localeCompare(b,'pt-BR'))})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))})).sort((a,b)=>a.category.localeCompare(b.category,'pt-BR'));
  return Object.freeze({
    categories:rowsFromMap(categories),subcategories:rowsFromMap(subcategories),subsubcategories:rowsFromMap(subsubcategories),brands:rowsFromMap(brands),suppliers:rowsFromMap(suppliers),packages:rowsFromMap(packages),tags:rowsFromMap(tagMap),hierarchy,
    missing:{category:products.filter(p=>!text(p.categoria)).length,subcategory:products.filter(p=>!text(p.subcategoria)).length,subsubcategory:products.filter(p=>!text(p.subsubcategoria)).length,brand:products.filter(p=>!text(p.marca)).length,supplier:products.filter(p=>!text(p.fornecedor)).length,package:products.filter(p=>!text(p.embalagem)).length,tags:products.filter(p=>!tags(p.tags).length).length}
  });
}

export function filterRegistrationRows(rows=[],query=''){const q=normalize(query);return q?rows.filter(row=>normalize(row.name).includes(q)):rows;}
