(()=>{
  'use strict';
  const C=window.DA_ADMIN_V3_CONFIG||{};
  const AUTH_KEY='da_admin_v3_auth';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const txt=v=>String(v??'').replace(/\s+/g,' ').trim();
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const date=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('pt-BR')};
  let page=1,total=0,timer=null;
  const loadAuth=()=>{try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch{return null}};
  const saveAuth=a=>localStorage.setItem(AUTH_KEY,JSON.stringify(a));
  const toast=(message,kind='')=>{const host=$('toastRegion');if(!host)return;const n=document.createElement('div');n.className=`toast ${kind}`.trim();n.textContent=message;host.appendChild(n);setTimeout(()=>n.remove(),kind==='error'?6500:3300)};
  async function refreshAuth(auth){
    if(!auth?.refresh_token)throw new Error('Sessão expirada.');
    const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:auth.refresh_token})});
    const data=await r.json().catch(()=>({}));if(!r.ok||!data.access_token)throw new Error('Sessão expirada.');saveAuth(data);return data;
  }
  async function api(action,payload={},retry=true){
    let auth=loadAuth();if(!auth?.access_token)throw new Error('Faça login.');
    const r=await fetch(`${C.supabaseUrl}/functions/v1/customer-intelligence-v1`,{method:'POST',headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${auth.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
    const data=await r.json().catch(()=>({}));
    if(r.status===401&&retry){auth=await refreshAuth(auth);return api(action,payload,false)}
    if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||`Erro ${r.status}`);return data;
  }
  const modeLabel=m=>({catalog_first:'Catálogo primeiro',hybrid:'Híbrido',whatsapp_only:'Somente WhatsApp',auto:'Automático'})[m]||m||'—';
  const modeClass=m=>m==='catalog_first'?'success':m==='hybrid'?'warning':'info';
  const isCustomerRoute=()=>document.querySelector('[data-view="customers"]')?.classList.contains('active');
  function setHeader(){if(!isCustomerRoute())return;$('pageTitle').textContent='Clientes';$('pageSubtitle').textContent='Histórico de compras, perfil digital e recomendações para cada cliente.'}

  async function loadCustomers(){
    if(!isCustomerRoute())return;setHeader();
    const rows=$('customerRows');if(!rows)return;rows.innerHTML='<tr><td colspan="5">Carregando…</td></tr>';
    try{
      const data=await api('customers',{page,limit:40,q:$('customerSearch')?.value||''});total=data.total||0;
      $('customerCount').textContent=`${total} cliente(s)`;$('customerPage').textContent=`Página ${data.page||page}`;
      $('prevCustomers').disabled=page<=1;$('nextCustomers').disabled=page*40>=total;
      const filter=$('customerModeFilter')?.value||'';
      const list=(data.customers||[]).filter(c=>!filter||c.resolved_shopping_mode===filter);
      rows.innerHTML=list.length?list.map(c=>`<tr>
        <td><div class="customer-cell"><div class="customer-avatar">${esc((txt(c.name)||'?').slice(0,1).toUpperCase())}</div><div><strong>${esc(c.name||'Cliente sem nome')}</strong><small>${esc(c.primary_whatsapp_e164||'Sem WhatsApp')}</small></div></div></td>
        <td><span class="badge ${modeClass(c.resolved_shopping_mode)}">${esc(modeLabel(c.resolved_shopping_mode))}</span><small>habilidade ${esc(c.catalog_skill_score||0)}/100</small></td>
        <td><strong>${esc(c.order_count||0)}</strong><small>${money(c.lifetime_value||0)}</small></td>
        <td><strong>${esc(date(c.last_order_at))}</strong><small>${c.last_catalog_at?'catálogo '+date(c.last_catalog_at):'sem uso do catálogo'}</small></td>
        <td><button class="row-button" data-open-customer="${esc(c.id)}" type="button">Abrir</button></td>
      </tr>`).join(''):'<tr><td colspan="5" class="empty">Nenhum cliente encontrado.</td></tr>';
    }catch(e){rows.innerHTML=`<tr><td colspan="5" class="empty">${esc(e.message)}</td></tr>`}
  }

  function openModal(){ $('modalBackdrop')?.classList.remove('hidden');$('modal')?.classList.remove('hidden') }
  function section(title,body){return `<section class="ci-section"><div class="ci-section-head"><h3>${esc(title)}</h3></div>${body}</section>`}
  async function openCustomer(id){
    openModal();$('modalEyebrow').textContent='Cliente';$('modalTitle').textContent='Carregando…';$('modalBody').innerHTML='<div class="empty">Carregando histórico…</div>';$('modalFooter').innerHTML='';
    try{
      const data=await api('customer',{id}),c=data.customer||{},plan=data.sales_plan||{};$('modalTitle').textContent=c.name||'Cliente';
      const mode=data.resolved_shopping_mode||'whatsapp_only';
      const planText=plan.try_catalog_first?'Começar oferecendo o catálogo e permitir voltar ao WhatsApp.':plan.offer_catalog_as_option?'Oferecer a escolha entre catálogo e conversa no WhatsApp.':'Conduzir a compra no WhatsApp e usar catálogo apenas como opção.';
      const bought=(data.purchased_products||[]).slice(0,18).map(x=>`<div class="ci-product"><img src="${esc(x.product?.image_url||'')}" onerror="this.style.display='none'" alt=""><div><strong>${esc(x.product?.name||'Produto')}</strong><small>${esc(x.purchase_count||0)} compra(s) · ${esc(x.total_quantity||0)} un. · última ${esc(date(x.last_purchase_at))}</small></div><b>${money(x.total_spent||0)}</b></div>`).join('')||'<div class="empty">Ainda não há compras registradas.</div>';
      const recs=(data.recommendations||[]).slice(0,15).map((x,i)=>`<div class="ci-product"><span class="ci-rank">${i+1}</span><div><strong>${esc(x.name)}</strong><small>${esc(x.reason||'Sugestão')}</small></div><b>${money(x.price||0)}</b></div>`).join('')||'<div class="empty">Ainda não existem produtos habilitados para recomendação.</div>';
      const orders=(data.orders||[]).slice(0,12).map(o=>`<div class="ci-order"><span>${esc(date(o.confirmed_at||o.created_at))}</span><strong>${money(o.total||0)}</strong><small>${esc(o.status||'')}</small></div>`).join('')||'<div class="empty">Sem pedidos registrados.</div>';
      $('modalBody').innerHTML=`
        <div class="ci-metrics"><div><span>Compras</span><strong>${esc(c.order_count||0)}</strong></div><div><span>Valor histórico</span><strong>${money(c.lifetime_value||0)}</strong></div><div><span>Catálogo</span><strong>${esc(c.catalog_skill_score||0)}/100</strong></div><div><span>Resposta</span><strong>${esc(c.preferred_reply||'auto')}</strong></div></div>
        ${section('Como vender para este cliente',`<div class="ci-sales-plan"><span class="badge ${modeClass(mode)}">${esc(modeLabel(mode))}</span><p>${esc(planText)}</p><label>Preferência de compra<select id="ciModeSelect"><option value="auto" ${c.shopping_mode==='auto'?'selected':''}>Automático</option><option value="catalog_first" ${c.shopping_mode==='catalog_first'?'selected':''}>Catálogo primeiro</option><option value="hybrid" ${c.shopping_mode==='hybrid'?'selected':''}>Híbrido</option><option value="whatsapp_only" ${c.shopping_mode==='whatsapp_only'?'selected':''}>Somente WhatsApp</option></select></label></div>`)}
        ${section('Produtos que já compra',`<div class="ci-products">${bought}</div>`)}
        ${section('Sugestões calculadas',`<div class="ci-products">${recs}</div>`)}
        ${section('Pedidos recentes',`<div class="ci-orders">${orders}</div>`)}
        <section id="ciCatalogResult" class="ci-section hidden"></section>`;
      $('modalFooter').innerHTML=`<button class="button secondary" data-close-modal type="button">Fechar</button><button class="button secondary" data-create-offer-catalog="${esc(id)}" type="button">Catálogo de ofertas</button><button class="button primary" data-create-catalog="${esc(id)}" type="button">Criar catálogo personalizado</button>`;
      $('ciModeSelect').addEventListener('change',async e=>{try{await api('set_shopping_mode',{id,mode:e.target.value});toast('Preferência do cliente atualizada.','success')}catch(err){toast(err.message,'error')}});
    }catch(e){$('modalBody').innerHTML=`<div class="empty">${esc(e.message)}</div>`}
  }
  async function createCatalog(id,kind){
    const btn=document.querySelector(kind==='offers'?`[data-create-offer-catalog="${CSS.escape(id)}"]`:`[data-create-catalog="${CSS.escape(id)}"]`);if(btn)btn.disabled=true;
    try{
      const data=await api('create_catalog',{id,kind,limit:30});
      const host=$('ciCatalogResult');host.classList.remove('hidden');host.innerHTML=`<div class="ci-section-head"><h3>${kind==='offers'?'Catálogo de ofertas':'Catálogo personalizado'}</h3></div><div class="ci-catalog-result"><p><strong>${esc(data.item_count||0)} produto(s)</strong> selecionados.</p><input id="ciCatalogLink" value="${esc(data.link||'')}" readonly><textarea id="ciCatalogText" readonly>${esc(data.whatsapp_text||'')}</textarea><div class="ci-inline"><button class="button secondary small" id="ciCopyLink" type="button">Copiar link</button><button class="button secondary small" id="ciCopyText" type="button">Copiar mensagem</button><a class="button primary small" href="${esc(data.link||'#')}" target="_blank" rel="noopener">Abrir catálogo</a></div><div class="ci-voice"><strong>Sugestão para áudio da vendedora</strong><p>${esc(data.voice_intro||'')}</p></div></div>`;
      $('ciCopyLink').onclick=()=>navigator.clipboard.writeText(data.link||'').then(()=>toast('Link copiado.','success'));
      $('ciCopyText').onclick=()=>navigator.clipboard.writeText(data.whatsapp_text||'').then(()=>toast('Mensagem copiada.','success'));
      host.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(e){toast(e.message,'error')}finally{if(btn)btn.disabled=false}
  }

  function bind(){
    $('nav')?.addEventListener('click',e=>{const b=e.target.closest('[data-route="customers"]');if(b)setTimeout(()=>{setHeader();loadCustomers()},0)});
    $('customerSearch')?.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;loadCustomers()},220)});
    $('customerModeFilter')?.addEventListener('change',()=>{page=1;loadCustomers()});
    $('prevCustomers')?.addEventListener('click',()=>{if(page>1){page--;loadCustomers()}});$('nextCustomers')?.addEventListener('click',()=>{if(page*40<total){page++;loadCustomers()}});
    $('customerRows')?.addEventListener('click',e=>{const b=e.target.closest('[data-open-customer]');if(b)openCustomer(b.dataset.openCustomer)});
    $('refreshButton')?.addEventListener('click',()=>{if(isCustomerRoute())setTimeout(()=>{setHeader();loadCustomers()},0)});
    document.body.addEventListener('click',e=>{const p=e.target.closest('[data-create-catalog]');if(p)createCatalog(p.dataset.createCatalog,'personalized');const o=e.target.closest('[data-create-offer-catalog]');if(o)createCatalog(o.dataset.createOfferCatalog,'offers')});
  }
  bind();
})();
