(function(){
  'use strict';
  const C=window.DA_ADMIN_V3_CONFIG||{};
  const AUTH_KEY='da_admin_v3_auth';
  const $=id=>document.getElementById(id);
  const txt=v=>String(v??'').replace(/\s+/g,' ').trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  let categories=[],products=new Map(),lastKey='',timer=null,loading=false;

  function token(){try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')?.access_token||''}catch{return ''}}
  async function api(fn,action,payload={}){
    const access=token();if(!access)throw new Error('Faça login para editar categorias.');
    const r=await fetch(`${C.supabaseUrl}/functions/v1/${fn}`,{method:'POST',headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||`Erro ${r.status}`);
    return data;
  }
  function toast(message,kind=''){
    const region=$('toastRegion');if(!region)return;const n=document.createElement('div');n.className=`toast ${kind}`.trim();n.textContent=message;region.appendChild(n);setTimeout(()=>n.remove(),kind==='error'?6500:3300);
  }
  function view(){return document.querySelector('.view[data-view="products"]')}
  function active(){return view()?.classList.contains('active')===true}
  function page(){const m=txt($('productPage')?.textContent).match(/(\d+)/);return m?Number(m[1]):1}
  function payload(){return{page:page(),limit:40,q:$('productSearch')?.value||'',status:$('productStatus')?.value||'',sync_status:$('productSync')?.value||'',expiry:$('productExpiry')?.value||'',sort:$('productSort')?.value||'',category:$('productCategory')?.value||'',brand:$('productBrand')?.value||'',gondola:$('productGondola')?.value||'',shelf:$('productShelf')?.value||''}}

  function options(current){
    const cur=txt(current),names=categories.map(c=>txt(c.name)).filter(Boolean);if(cur&&!names.some(n=>n.toLocaleLowerCase('pt-BR')===cur.toLocaleLowerCase('pt-BR')))names.push(cur);
    const unique=[...new Map(names.map(n=>[n.toLocaleLowerCase('pt-BR'),n])).values()].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    return '<option value="">Sem categoria</option>'+unique.map(n=>`<option value="${esc(n)}" ${n===cur?'selected':''}>${esc(n)}</option>`).join('');
  }
  function renderRows(){
    const v=view();if(!v)return;const th=v.querySelector('thead th:nth-child(2)');if(th)th.textContent='Categoria';
    $('productRows')?.querySelectorAll('tr').forEach(row=>{const open=row.querySelector('[data-open-product]'),cells=row.querySelectorAll('td');if(!open||cells.length<2)return;const p=products.get(open.dataset.openProduct);if(!p)return;const current=txt(p.category),cell=cells[1],existing=cell.querySelector('[data-inline-category]');if(existing&&existing.dataset.current===current)return;cell.innerHTML=`<select class="inline-category-select" data-inline-category="${esc(p.id)}" data-current="${esc(current)}" aria-label="Categoria de ${esc(p.name||'produto')}">${options(current)}</select>`;});
  }
  async function loadProducts(force=false){
    if(!active()||loading)return;const p=payload(),key=JSON.stringify(p);if(!force&&key===lastKey&&products.size){renderRows();return}loading=true;
    try{const data=await api(C.edgeFunction||'admin-ops-v1','products',p);products=new Map((data.products||[]).map(item=>[String(item.id),item]));lastKey=key;renderRows()}catch(e){}finally{loading=false}
  }
  function renderManager(){
    const list=$('productCategoryAdminList');if(!list)return;list.innerHTML=categories.length?categories.map(c=>`<div class="category-admin-row"><input type="text" maxlength="120" value="${esc(c.name)}" data-category-name="${esc(c.id)}"><span>${Number(c.product_count||0)} produto(s)</span><button class="row-button" type="button" data-category-save="${esc(c.id)}">Salvar</button></div>`).join(''):'<div class="empty">Nenhuma categoria cadastrada.</div>';
  }
  function ensureManager(){
    const v=view();if(!v)return;const th=v.querySelector('thead th:nth-child(2)');if(th)th.textContent='Categoria';if($('productCategoryManager'))return;
    const box=document.createElement('section');box.id='productCategoryManager';box.className='panel product-category-manager';box.innerHTML=`<div class="panel-head product-category-head"><div><div class="eyebrow">Categorias dos produtos</div><h2>Categorias</h2><p>Mantemos as categorias que chegam com os produtos. Aqui você pode renomear ou incluir outras.</p></div><form id="productCategoryCreateForm" class="category-create-form"><input id="newProductCategoryName" maxlength="120" placeholder="Nova categoria" required><button class="button primary small" type="submit">+ Incluir</button></form></div><div id="productCategoryAdminList" class="category-admin-list"><div class="empty">Carregando…</div></div>`;
    const toolbar=v.querySelector('.toolbar');v.insertBefore(box,toolbar||v.firstChild);
    $('productCategoryCreateForm').addEventListener('submit',async e=>{e.preventDefault();const input=$('newProductCategoryName'),name=txt(input.value);if(!name)return;const b=e.currentTarget.querySelector('button');b.disabled=true;try{await api(C.categoryEdgeFunction||'admin-product-categories-v1','create',{name});input.value='';toast('Categoria incluída.','success');await loadCategories(true)}catch(err){toast(err.message,'error')}finally{b.disabled=false}});
    $('productCategoryAdminList').addEventListener('click',async e=>{const b=e.target.closest('[data-category-save]');if(!b)return;const id=b.dataset.categorySave,input=box.querySelector(`[data-category-name="${CSS.escape(id)}"]`),name=txt(input?.value);if(!name)return toast('Informe o nome da categoria.','error');b.disabled=true;try{await api(C.categoryEdgeFunction||'admin-product-categories-v1','rename',{id,name});toast('Categoria atualizada.','success');lastKey='';await loadCategories(true);$('refreshButton')?.click()}catch(err){toast(err.message,'error')}finally{b.disabled=false}});
  }
  async function loadCategories(force=false){
    if(!force&&categories.length){renderManager();renderRows();return}try{const data=await api(C.categoryEdgeFunction||'admin-product-categories-v1','list');categories=data.categories||[];renderManager();renderRows()}catch(e){const list=$('productCategoryAdminList');if(list)list.innerHTML=`<div class="empty">${esc(e.message)}</div>`}
  }
  async function changeCategory(select){
    const id=select.dataset.inlineCategory,previous=select.dataset.current||'',next=select.value||'';if(next===previous)return;select.disabled=true;try{await api(C.edgeFunction||'admin-ops-v1','update_product',{id,patch:{category:next||null}});const p=products.get(id);if(p)p.category=next||null;select.dataset.current=next;toast('Categoria do produto atualizada.','success')}catch(e){select.value=previous;toast(e.message,'error')}finally{select.disabled=false}
  }
  function schedule(force=false){clearTimeout(timer);timer=setTimeout(async()=>{ensureManager();await loadCategories(false);await loadProducts(force)},100)}
  function bind(){
    ensureManager();$('productRows')?.addEventListener('change',e=>{const s=e.target.closest('[data-inline-category]');if(s)changeCategory(s)});
    if($('productRows'))new MutationObserver(()=>schedule(false)).observe($('productRows'),{childList:true,subtree:true});if(view())new MutationObserver(()=>{if(active())schedule(true)}).observe(view(),{attributes:true,attributeFilter:['class']});
    ['productSearch','productStatus','productSync','productExpiry','productSort','productCategory','productBrand','productGondola','productShelf','prevProducts','nextProducts','refreshButton'].forEach(id=>{const el=$(id);if(!el)return;['input','change','click'].forEach(type=>el.addEventListener(type,()=>{lastKey='';schedule(true)}))});schedule(true);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();