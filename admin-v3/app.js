(function(){
  'use strict';

  const C = window.DA_ADMIN_V3_CONFIG || {};
  const AUTH_KEY = 'da_admin_v3_auth';
  const $ = id => document.getElementById(id);
  const txt = v => String(v ?? '').replace(/\s+/g,' ').trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = v => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v||0));
  const fmtDate = v => { if(!v) return '—'; const d=new Date(v); return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR'); };
  const img = v => { const raw=txt(v); if(!raw)return ''; if(/^https?:\/\//i.test(raw)||/^data:/i.test(raw))return raw; return `../${raw.replace(/^\/+/, '')}`; };

  let auth = load(AUTH_KEY,null);
  let currentUser = null;
  let route = 'dashboard';
  let productPage = 1;
  let productTotal = 0;
  let productTimer = null;
  let productRequest = 0;

  function load(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch{return fallback}}
  function save(key,value){localStorage.setItem(key,JSON.stringify(value))}
  function toast(message,kind=''){const n=document.createElement('div');n.className=`toast ${kind}`.trim();n.textContent=message;$('toastRegion').appendChild(n);setTimeout(()=>n.remove(),kind==='error'?6500:3300)}

  async function signIn(email,password){
    const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    const data=await r.json().catch(()=>({})); if(!r.ok||!data.access_token)throw new Error(data.error_description||data.msg||'Login inválido.'); auth=data;save(AUTH_KEY,data);
  }
  async function refresh(){
    if(!auth?.refresh_token)throw new Error('Sessão expirada.');
    const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:auth.refresh_token})});
    const data=await r.json().catch(()=>({})); if(!r.ok||!data.access_token)throw new Error('Sessão expirada.'); auth=data;save(AUTH_KEY,data);
  }
  async function api(action,payload={},retry=true){
    if(!auth?.access_token)throw new Error('Faça login.');
    const r=await fetch(`${C.supabaseUrl}/functions/v1/${C.edgeFunction}`,{method:'POST',headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${auth.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
    const data=await r.json().catch(()=>({}));
    if(r.status===401&&retry){await refresh();return api(action,payload,false)}
    if(!r.ok||data.ok===false){const e=new Error(data.detail||data.error||`Erro ${r.status}`);e.code=data.error;e.status=r.status;throw e}
    return data;
  }
  function logout(){auth=null;currentUser=null;localStorage.removeItem(AUTH_KEY);$('adminApp').classList.add('hidden');$('loginView').classList.remove('hidden');$('passwordInput').value='';closeModal()}

  function badge(status){
    const s=txt(status).toLowerCase();
    const kind=s.includes('error')?'danger':s.includes('pending')||s.includes('open')?'warning':s.includes('sync')||s==='done'||s==='closed'?'success':'info';
    const labels={pending_bling:'Pendente Bling',synced:'Sincronizado',error_bling:'Erro Bling',pending:'Pendente',processing:'Processando',done:'Concluído',error:'Erro',cancelled:'Cancelado',open:'Aberta',closed:'Fechada'};
    return `<span class="badge ${kind}">${esc(labels[s]||status||'—')}</span>`;
  }

  async function boot(){
    const data=await api('health'); currentUser=data.user;
    $('loginView').classList.add('hidden');$('adminApp').classList.remove('hidden');
    $('sideUser').textContent=currentUser.display_name||currentUser.email||'Usuário';$('sideRole').textContent=currentUser.role||'';
    renderDashboard(data);setRoute(route,false);
  }

  function metric(value,label,help,kind=''){return `<article class="metric ${kind}"><strong>${esc(value)}</strong><span>${esc(label)}</span><small>${esc(help)}</small></article>`}
  function renderDashboard(data){
    const m=data.metrics||{};
    $('metrics').innerHTML=[
      metric(m.verified_products||0,'Produtos conferidos','Catálogo operacional','success'),
      metric(m.counted_today||0,'Contados hoje','Itens verificados fisicamente'),
      metric(m.pending_bling||0,'Pendentes Bling','Aguardando worker',m.pending_bling?'warning':''),
      metric(m.bling_errors||0,'Erros Bling','Precisam de atenção',m.bling_errors?'danger':''),
      metric(m.whatsapp_active||0,'No WhatsApp','Publicação autorizada'),
      metric(m.open_counts||0,'Contagens abertas','Sessões em andamento')
    ].join('');
    $('recentCounts').innerHTML=(data.recent_counts||[]).length?(data.recent_counts||[]).map(c=>`<div class="list-row"><div><strong>${esc(c.device_label||'Sessão de contagem')}</strong><small>${fmtDate(c.started_at)} · ${c.item_count||0} item(ns) · ${c.pending_sync||0} pendente(s)</small></div>${badge(c.status)}</div>`).join(''):'<div class="empty">Nenhuma contagem ainda.</div>';
    $('recentErrors').innerHTML=(data.recent_errors||[]).length?(data.recent_errors||[]).map(c=>`<div class="list-row"><div><strong>${esc(c.product?.name||c.command_type||'Comando')}</strong><small>${esc(c.error_message||'Erro sem detalhe')}</small></div><button class="row-button" data-retry-command="${esc(c.id)}" type="button">Tentar de novo</button></div>`).join(''):'<div class="empty">Nenhum erro de integração.</div>';
  }

  const titles={dashboard:['Visão geral','Estado operacional do novo sistema.'],products:['Produtos conferidos','Somente itens adotados depois de conferência física.'],counts:['Contagens','Histórico das sessões de inventário físico.'],queue:['Fila Bling','Comandos assíncronos enviados ao ERP.']};
  function setRoute(next,loadData=true){
    route=next;document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.dataset.view===next));document.querySelectorAll('.nav[data-route]').forEach(n=>n.classList.toggle('active',n.dataset.route===next));
    const [title,sub]=titles[next]||titles.dashboard;$('pageTitle').textContent=title;$('pageSubtitle').textContent=sub;$('sidebar').classList.remove('open');
    if(!loadData)return;
    if(next==='dashboard')reloadDashboard();if(next==='products')loadProducts();if(next==='counts')loadCounts();if(next==='queue')loadQueue();
  }
  async function reloadDashboard(){try{renderDashboard(await api('health'))}catch(e){toast(e.message,'error')}}

  async function loadProducts(){
    const request=++productRequest;
    $('productRows').innerHTML='<tr><td colspan="7">Carregando…</td></tr>';
    try{
      const data=await api('products',{page:productPage,limit:40,q:$('productSearch').value,status:$('productStatus').value,sync_status:$('productSync').value,expiry:$('productExpiry')?.value||'',sort:$('productSort')?.value||'',category:$('productCategory')?.value||'',brand:$('productBrand')?.value||'',gondola:$('productGondola')?.value||'',shelf:$('productShelf')?.value||''});
      if(request!==productRequest)return;
      productTotal=data.total||0;$('productCount').textContent=`${productTotal} produto(s)`;$('productPage').textContent=`Página ${data.page||1}`;
      $('prevProducts').disabled=productPage<=1;$('nextProducts').disabled=productPage*40>=productTotal;
      $('productRows').innerHTML=(data.products||[]).length?(data.products||[]).map(p=>`<tr>
        <td><div class="product-cell"><img loading="lazy" decoding="async" src="${esc(img(p.image_url))}" alt="" onerror="this.style.visibility='hidden'"><div><strong>${esc(p.name)}</strong><small>${esc([p.brand,p.packaging,p.category].filter(Boolean).join(' · '))}</small></div></div></td>
        <td><strong>${esc(p.gtin||'—')}</strong><small>${esc(p.sku||'')}</small></td>
        <td><strong>${esc(p.stock??0)}</strong><small>${p.price!=null?money(p.price):''}</small></td>
        <td><strong>${esc(p.validity_date||'—')}</strong><small>${esc([p.gondola,p.shelf].filter(Boolean).join(' / '))}</small></td>
        <td><label class="switch"><input type="checkbox" data-whatsapp-toggle="${esc(p.id)}" ${p.is_whatsapp_active?'checked':''}><span>${p.is_whatsapp_active?'Ativo':'Não'}</span></label></td>
        <td>${badge(p.sync_status)}</td>
        <td><button class="row-button" data-open-product="${esc(p.id)}" type="button">Abrir</button></td>
      </tr>`).join(''):'<tr><td colspan="7" class="empty">Nenhum produto conferido.</td></tr>';
    }catch(e){if(request!==productRequest)return;$('productRows').innerHTML=`<tr><td colspan="7" class="empty">${esc(e.message)}</td></tr>`}
  }

  async function toggleWhatsapp(input){
    const id=input.dataset.whatsappToggle;input.disabled=true;
    try{await api('update_merchandising',{id,is_whatsapp_active:input.checked});input.nextElementSibling.textContent=input.checked?'Ativo':'Não';toast('Publicação do produto atualizada.','success')}
    catch(e){input.checked=!input.checked;toast(e.message,'error')}
    finally{input.disabled=false}
  }

  async function openProduct(id){
    openModal('Produto','Carregando…','');
    try{
      const data=await api('product',{id});const p=data.product; $('modalTitle').textContent=p.name||'Produto';$('modalEyebrow').textContent='Produto conferido';
      $('modalBody').innerHTML=`<div class="detail-grid">
        <div class="detail-card"><span>EAN</span><strong>${esc(p.gtin||'—')}</strong></div><div class="detail-card"><span>SKU</span><strong>${esc(p.sku||'—')}</strong></div><div class="detail-card"><span>Bling ID</span><strong>${esc(p.bling_product_id||'Ainda não vinculado')}</strong></div>
        <div class="detail-card"><span>Estoque</span><strong>${esc(p.stock??0)}</strong></div><div class="detail-card"><span>Validade</span><strong>${esc(p.validity_date||'—')}</strong></div><div class="detail-card"><span>Sincronização</span><strong>${esc(p.sync_status||'—')}</strong></div>
        <div class="detail-card"><span>Preço</span><strong>${p.price!=null?money(p.price):'—'}</strong></div><div class="detail-card"><span>Custo</span><strong>${p.cost!=null?money(p.cost):'—'}</strong></div><div class="detail-card"><span>Local</span><strong>${esc([p.gondola,p.shelf].filter(Boolean).join(' / ')||'—')}</strong></div>
      </div><div class="panel-head" style="padding-left:0;padding-right:0"><div><div class="eyebrow">Histórico</div><h2>Últimas contagens</h2></div></div><div class="history">${(data.count_history||[]).length?(data.count_history||[]).map(h=>`<div class="history-row"><span>${fmtDate(h.counted_at)}</span><span>${esc(h.previous_stock??'—')} → <strong>${esc(h.counted_stock)}</strong></span>${badge(h.sync_status)}</div>`).join(''):'<div class="empty">Sem histórico.</div>'}</div>`;
      $('modalFooter').innerHTML=`<button class="button secondary" type="button" data-close-modal>Fechar</button>`;
    }catch(e){$('modalBody').innerHTML=`<div class="empty">${esc(e.message)}</div>`}
  }

  async function loadCounts(){
    $('countRows').innerHTML='<div class="empty">Carregando…</div>';
    try{const data=await api('counts',{limit:80});$('countRows').innerHTML=(data.counts||[]).length?(data.counts||[]).map(c=>`<div class="list-row"><div><strong>${esc(c.device_label||'Sessão')}</strong><small>${fmtDate(c.started_at)} · ${c.item_count||0} item(ns) · ${c.pending_sync||0} pendente(s)</small></div><div class="list-actions">${badge(c.status)}<button class="row-button" data-open-count="${esc(c.id)}" type="button">Itens</button></div></div>`).join(''):'<div class="empty">Nenhuma sessão de contagem.</div>'}catch(e){$('countRows').innerHTML=`<div class="empty">${esc(e.message)}</div>`}
  }
  async function openCount(id){
    openModal('Contagem','Carregando…','');
    try{const data=await api('count_items',{id});$('modalTitle').textContent='Itens da contagem';$('modalBody').innerHTML=(data.items||[]).length?`<div class="history">${data.items.map(i=>`<div class="history-row"><span><strong>${esc(i.product?.name||'Produto')}</strong><small>${esc(i.ean||'')}</small></span><span>${esc(i.previous_stock??'—')} → <strong>${esc(i.counted_stock)}</strong></span>${badge(i.sync_status)}</div>`).join('')}</div>`:'<div class="empty">Sessão sem itens.</div>';$('modalFooter').innerHTML='<button class="button secondary" data-close-modal type="button">Fechar</button>'}catch(e){$('modalBody').innerHTML=`<div class="empty">${esc(e.message)}</div>`}
  }

  async function loadQueue(){
    $('queueRows').innerHTML='<div class="empty">Carregando…</div>';
    try{const data=await api('queue',{limit:100,status:$('queueStatus').value});$('queueRows').innerHTML=(data.commands||[]).length?(data.commands||[]).map(c=>`<div class="list-row"><div><strong>${esc(c.product?.name||c.command_type)}</strong><small>${esc(c.command_type)} · tentativa ${c.attempts||0}/${c.max_attempts||5}${c.error_message?' · '+c.error_message:''}</small></div><div class="list-actions">${badge(c.status)}${c.status==='error'?`<button class="row-button" data-retry-command="${esc(c.id)}" type="button">Reprocessar</button>`:''}</div></div>`).join(''):'<div class="empty">Fila vazia para este filtro.</div>'}catch(e){$('queueRows').innerHTML=`<div class="empty">${esc(e.message)}</div>`}
  }
  async function retryCommand(id){try{await api('retry_command',{id});toast('Comando devolvido à fila.','success');if(route==='queue')loadQueue();else reloadDashboard()}catch(e){toast(e.message,'error')}}

  function openModal(title,body='',footer=''){$('modalTitle').textContent=title;$('modalBody').innerHTML=body;$('modalFooter').innerHTML=footer;$('modalBackdrop').classList.remove('hidden');$('modal').classList.remove('hidden')}
  function closeModal(){$('modalBackdrop').classList.add('hidden');$('modal').classList.add('hidden')}

  function bind(){
    $('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginButton').disabled=true;$('loginStatus').textContent='Entrando…';try{await signIn($('emailInput').value.trim(),$('passwordInput').value);await boot();$('loginStatus').textContent=''}catch(err){$('loginStatus').textContent=err.code==='admin_not_authorized'?'Conta válida, mas não autorizada no Admin.':err.message}finally{$('loginButton').disabled=false}});
    $('logoutButton').onclick=logout;$('refreshButton').onclick=()=>setRoute(route,true);$('menuButton').onclick=()=> $('sidebar').classList.toggle('open');
    $('nav').addEventListener('click',e=>{const b=e.target.closest('[data-route]');if(b)setRoute(b.dataset.route,true)});
    for(const id of ['productExpiry','productSort'])$(id)?.addEventListener('change',()=>{productPage=1;loadProducts()});
    for(const id of ['productCategory','productBrand','productGondola','productShelf'])$(id)?.addEventListener('input',()=>{clearTimeout(productTimer);productTimer=setTimeout(()=>{productPage=1;loadProducts()},300)});
    $('productSearch').addEventListener('input',()=>{clearTimeout(productTimer);productTimer=setTimeout(()=>{productPage=1;loadProducts()},220)});$('productStatus').onchange=()=>{productPage=1;loadProducts()};$('productSync').onchange=()=>{productPage=1;loadProducts()};
    $('prevProducts').onclick=()=>{if(productPage>1){productPage--;loadProducts()}};$('nextProducts').onclick=()=>{if(productPage*40<productTotal){productPage++;loadProducts()}};
    $('productRows').addEventListener('change',e=>{const i=e.target.closest('[data-whatsapp-toggle]');if(i)toggleWhatsapp(i)});$('productRows').addEventListener('click',e=>{const b=e.target.closest('[data-open-product]');if(b)openProduct(b.dataset.openProduct)});
    $('countRows').addEventListener('click',e=>{const b=e.target.closest('[data-open-count]');if(b)openCount(b.dataset.openCount)});$('queueStatus').onchange=loadQueue;$('reloadQueue').onclick=loadQueue;
    document.body.addEventListener('click',e=>{const r=e.target.closest('[data-retry-command]');if(r)retryCommand(r.dataset.retryCommand);if(e.target.closest('[data-close-modal]'))closeModal()});$('modalClose').onclick=closeModal;$('modalBackdrop').onclick=closeModal;
  }

  async function init(){bind();if(auth?.access_token){try{await boot()}catch{auth=null;localStorage.removeItem(AUTH_KEY);$('loginStatus').textContent='Entre para acessar o Admin.'}}}
  init();
})();

