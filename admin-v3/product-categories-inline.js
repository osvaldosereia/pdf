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
    const list=$('productCategoryAdminList');if(!list)return;
    list.innerHTML=categories.length?categories.map(c=>{
      const enabled=c.basket_showcase_enabled!==false;
      const label=txt(c.basket_showcase_label)||txt(c.name);
      const order=Number.isFinite(Number(c.basket_showcase_sort_order))?Number(c.basket_showcase_sort_order):100;
      return `<div class="category-admin-row" data-category-row="${esc(c.id)}">
        <div class="category-main-line"><input type="text" maxlength="120" value="${esc(c.name)}" data-category-name="${esc(c.id)}"><span>${Number(c.product_count||0)} produto(s)</span><button class="row-button" type="button" data-category-save="${esc(c.id)}">Salvar nome</button></div>
        <div class="showcase-settings">
          <label class="showcase-toggle"><input type="checkbox" data-showcase-enabled ${enabled?'checked':''}><span>Mostrar na vitrine</span></label>
          <label class="showcase-field"><span>Nome para o cliente</span><input type="text" maxlength="80" value="${esc(label)}" data-showcase-label></label>
          <label class="showcase-field showcase-order"><span>Ordem</span><input type="number" min="0" max="9999" step="1" value="${order}" data-showcase-order></label>
          <button class="row-button showcase-save" type="button" data-showcase-save="${esc(c.id)}">Salvar vitrine</button>
        </div>
      </div>`;
    }).join(''):'<div class="empty">Nenhuma categoria cadastrada.</div>';
  }
  function ensureManager(){
    const v=view();if(!v)return;const th=v.querySelector('thead th:nth-child(2)');if(th)th.textContent='Categoria';if($('productCategoryManager'))return;
    const box=document.createElement('section');box.id='productCategoryManager';box.className='panel product-category-manager';box.innerHTML=`<div class="panel-head product-category-head"><div><div class="eyebrow">Categorias e vitrine das cestas</div><h2>Categorias</h2><p>Edite a categoria dos produtos e escolha quais categorias a automação pode mostrar na vitrine externa das cestas. O layout da vitrine é automático.</p></div><form id="productCategoryCreateForm" class="category-create-form"><input id="newProductCategoryName" maxlength="120" placeholder="Nova categoria" required><button class="button primary small" type="submit">+ Incluir</button></form></div><div id="productCategoryAdminList" class="category-admin-list"><div class="empty">Carregando…</div></div>`;
    const toolbar=v.querySelector('.toolbar');v.insertBefore(box,toolbar||v.firstChild);
    $('productCategoryCreateForm').addEventListener('submit',async e=>{e.preventDefault();const input=$('newProductCategoryName'),name=txt(input.value);if(!name)return;const b=e.currentTarget.querySelector('button');b.disabled=true;try{await api(C.categoryEdgeFunction||'admin-product-categories-v1','create',{name});input.value='';toast('Categoria incluída.','success');await loadCategories(true)}catch(err){toast(err.message,'error')}finally{b.disabled=false}});
    $('productCategoryAdminList').addEventListener('click',async e=>{
      const rename=e.target.closest('[data-category-save]');
      if(rename){
        const id=rename.dataset.categorySave,row=rename.closest('[data-category-row]'),input=row?.querySelector('[data-category-name]'),name=txt(input?.value);if(!name)return toast('Informe o nome da categoria.','error');rename.disabled=true;try{await api(C.categoryEdgeFunction||'admin-product-categories-v1','rename',{id,name});toast('Categoria atualizada.','success');lastKey='';await loadCategories(true);$('refreshButton')?.click()}catch(err){toast(err.message,'error')}finally{rename.disabled=false}return;
      }
      const save=e.target.closest('[data-showcase-save]');
      if(save){
        const id=save.dataset.showcaseSave,row=save.closest('[data-category-row]');if(!row)return;
        const enabled=row.querySelector('[data-showcase-enabled]')?.checked!==false;
        const label=txt(row.querySelector('[data-showcase-label]')?.value);
        const sort_order=Number(row.querySelector('[data-showcase-order]')?.value||100);
        save.disabled=true;try{await api(C.categoryEdgeFunction||'admin-product-categories-v1','showcase_update',{id,enabled,label,sort_order});toast('Configuração da vitrine salva.','success');await loadCategories(true)}catch(err){toast(err.message,'error')}finally{save.disabled=false}
      }
    });
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
