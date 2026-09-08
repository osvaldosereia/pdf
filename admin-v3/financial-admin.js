(function(){
  'use strict';
  const C=window.DA_ADMIN_V3_CONFIG||{};
  const AUTH_KEY='da_admin_v3_auth';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money=v=>`R$ ${(Number(v||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR')};
  const state={mounted:false,loading:false,data:null};

  function auth(){try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch{return null}}
  async function refreshToken(a){
    if(!a?.refresh_token)throw new Error('Sessão expirada.');
    const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:a.refresh_token})});
    const data=await r.json().catch(()=>({}));if(!r.ok||!data.access_token)throw new Error('Sessão expirada.');localStorage.setItem(AUTH_KEY,JSON.stringify(data));return data;
  }
  async function api(action,payload={},retry=true){
    let a=auth();if(!a?.access_token)throw new Error('Faça login.');
    const fn=C.financialEdgeFunction||'admin-financial-v1';
    const r=await fetch(`${C.supabaseUrl}/functions/v1/${fn}`,{method:'POST',headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${a.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
    const data=await r.json().catch(()=>({}));if(r.status===401&&retry){a=await refreshToken(a);return api(action,payload,false)}
    if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||`Erro ${r.status}`);return data;
  }
  function toast(message,kind=''){
    const region=$('toastRegion');if(!region)return;const x=document.createElement('div');x.className=`toast ${kind}`.trim();x.textContent=message;region.appendChild(x);setTimeout(()=>x.remove(),kind==='error'?6500:3500);
  }
  function metric(value,label,help,kind=''){return `<article class="metric ${kind}"><strong>${esc(value)}</strong><span>${esc(label)}</span><small>${esc(help)}</small></article>`}
  function badge(v){const s=String(v||'').toLowerCase();const kind=s==='matched'?'success':s==='ambiguous'||s==='review_required'?'warning':s==='unmatched'?'danger':'info';return `<span class="badge ${kind}">${esc(v||'—')}</span>`}

  function renderShell(root){
    root.innerHTML=`
      <div class="fin-head"><div><div class="eyebrow">Etapa 13</div><h2>Central Financeira</h2><p>Ledger, expectativas, eventos externos e conciliação determinística. Nenhum provider real nesta versão.</p></div><button id="finRefresh" class="button secondary small" type="button">Atualizar</button></div>
      <div id="finBanner" class="ops-alert safe">Módulo financeiro dormente.</div>
      <div id="finMetrics" class="metrics"></div>
      <div class="fin-grid">
        <section class="panel"><div class="panel-head"><div><div class="eyebrow">Conciliação</div><h2>Eventos externos recentes</h2></div></div><div id="finEvents" class="list"><div class="empty">Sem dados.</div></div></section>
        <section class="panel"><div class="panel-head"><div><div class="eyebrow">Matcher</div><h2>Avaliações recentes</h2></div></div><div id="finMatches" class="list"><div class="empty">Sem dados.</div></div></section>
      </div>
      <section class="panel"><div class="panel-head"><div><div class="eyebrow">Exceções</div><h2>Casos de conciliação abertos</h2></div></div><div id="finCases" class="list"><div class="empty">Sem dados.</div></div></section>
      <div id="financialPolicyAdminMount"></div>`;
    $('finRefresh').onclick=load;
  }

  function render(data){
    const d=data?.dashboard||{},m=d.metrics||{};
    $('finBanner').textContent='Read model somente leitura. Eventos externos não alteram ledger, pedido, pagamento fiscal ou NF-e.';
    $('finMetrics').innerHTML=[
      metric(m.ledger_entries||0,'Ledger','Eventos financeiros imutáveis'),
      metric(m.payment_expectations||0,'Expectativas','Cobranças esperadas'),
      metric(m.external_events||0,'Eventos externos','Normalizados, sem provider ativo'),
      metric(m.review_required||0,'Revisão','Matcher exige revisão',m.review_required?'warning':''),
      metric(m.ambiguous_events||0,'Ambíguos','Nunca conciliados automaticamente',m.ambiguous_events?'danger':''),
      metric(m.open_cases||0,'Casos abertos','Central de exceções',m.open_cases?'warning':'')
    ].join('');
    const events=d.recent_external_events||[];
    $('finEvents').innerHTML=events.length?events.map(x=>`<div class="list-row"><div><strong>${esc(x.provider)} · ${esc(x.payment_method)}</strong><small>${money(x.amount_cents)} · ${fmt(x.received_at)}</small><small>${esc(x.external_reference||'sem referência')}</small></div>${badge(x.status)}</div>`).join(''):'<div class="empty">Nenhum evento externo registrado.</div>';
    const matches=d.recent_matches||[];
    $('finMatches').innerHTML=matches.length?matches.map(x=>`<button class="list-row fin-order-row" type="button" data-fin-order="${esc(x.order_id||'')}"><div><strong>${esc(x.match_basis)}</strong><small>observado ${money(x.observed_amount_cents)} · esperado ${x.expected_amount_cents==null?'—':money(x.expected_amount_cents)}</small><small>diferença ${x.difference_cents==null?'—':money(x.difference_cents)}</small></div>${badge(x.decision)}</button>`).join(''):'<div class="empty">Nenhuma avaliação registrada.</div>';
    const cases=d.open_reconciliation_cases||[];
    $('finCases').innerHTML=cases.length?cases.map(x=>`<button class="list-row fin-order-row" type="button" data-fin-order="${esc(x.order_id||'')}"><div><strong>${esc(x.case_type)}</strong><small>${esc(x.reason)} · ${fmt(x.created_at)}</small><small>diferença ${x.difference_cents==null?'—':money(x.difference_cents)}</small></div>${badge(x.status)}</button>`).join(''):'<div class="empty">Nenhum caso aberto.</div>';
    document.querySelectorAll('[data-fin-order]').forEach(btn=>{if(btn.dataset.finOrder)btn.onclick=()=>showOrder(btn.dataset.finOrder)});
  }

  async function showOrder(orderId){
    try{
      const data=await api('order',{order_id:orderId});const o=data.order||{};
      const modal=$('modal'),backdrop=$('modalBackdrop');if(!modal||!backdrop)return;
      $('modalEyebrow').textContent='Financeiro · pedido';$('modalTitle').textContent=`Pedido ${String(o.order?.id||orderId).slice(0,8)}`;
      $('modalBody').innerHTML=`<div class="detail-grid"><div class="detail-card"><span>Total</span><strong>${esc(o.order?.total??'—')}</strong></div><div class="detail-card"><span>Status</span><strong>${esc(o.order?.status||'—')}</strong></div><div class="detail-card"><span>Pagamento fiscal</span><strong>${esc(o.fiscal?.payment_status||'—')}</strong></div></div><pre class="fin-json">${esc(JSON.stringify({expectations:o.expectations||[],ledger:o.ledger||[],external_events:o.external_events||[],matches:o.matches||[],cases:o.cases||[]},null,2))}</pre>`;
      $('modalFooter').innerHTML='<button class="button secondary" type="button" data-close-modal>Fechar</button>';backdrop.classList.remove('hidden');modal.classList.remove('hidden');
    }catch(e){toast(e.message,'error')}
  }

  async function load(){
    if(state.loading)return;state.loading=true;
    try{const data=await api('dashboard');state.data=data;render(data)}catch(e){toast(e.message,'error');$('finBanner').className='ops-alert safe';$('finBanner').textContent=`Financeiro indisponível: ${e.message}`}
    finally{state.loading=false}
  }

  function mountPolicyModule(){
    const root=$('financialPolicyAdminMount');if(!root)return;
    if(!document.querySelector('link[data-financial-policy-admin]')){
      const link=document.createElement('link');link.rel='stylesheet';link.href='../admin-v3/financial-policy-admin.css?v=20260908-01';link.dataset.financialPolicyAdmin='1';document.head.appendChild(link);
    }
    if(!document.querySelector('script[data-financial-policy-admin]')){
      const script=document.createElement('script');script.src='../admin-v3/financial-policy-admin.js?v=20260908-01';script.dataset.financialPolicyAdmin='1';script.onload=()=>window.DAFinancialPolicyAdmin?.mount(root);document.body.appendChild(script);
    }else window.DAFinancialPolicyAdmin?.mount(root);
  }

  async function mount(root){if(state.mounted||!root)return;state.mounted=true;renderShell(root);mountPolicyModule();await load()}
  window.DAFinancialAdmin=Object.freeze({mount});
})();
