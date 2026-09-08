(function(){
  'use strict';
  const C=window.DA_ADMIN_V3_CONFIG||{};
  const AUTH_KEY='da_admin_v3_auth';
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR')};
  const scopeLabel=v=>({reconciliation:'Conciliação',route_close:'Fechamento de rota',fiscal_projection:'Projeção fiscal'}[v]||v||'—');
  const state={mounted:false,loading:false,policies:[],readiness:null};
  function auth(){try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch{return null}}
  async function refreshToken(a){
    if(!a?.refresh_token)throw new Error('Sessão expirada.');
    const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:a.refresh_token})});
    const data=await r.json().catch(()=>({}));if(!r.ok||!data.access_token)throw new Error('Sessão expirada.');localStorage.setItem(AUTH_KEY,JSON.stringify(data));return data;
  }
  async function api(action,payload={},retry=true){
    let a=auth();if(!a?.access_token)throw new Error('Faça login.');
    const fn=C.financialPolicyEdgeFunction||'admin-financial-policy-v1';
    const r=await fetch(`${C.supabaseUrl}/functions/v1/${fn}`,{method:'POST',headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${a.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
    const data=await r.json().catch(()=>({}));if(r.status===401&&retry){a=await refreshToken(a);return api(action,payload,false)}
    if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||`Erro ${r.status}`);return data;
  }
  function toast(message,kind=''){
    const region=document.getElementById('toastRegion');if(!region)return;
    const x=document.createElement('div');x.className=`toast ${kind}`.trim();x.textContent=message;region.appendChild(x);setTimeout(()=>x.remove(),kind==='error'?6500:3500);
  }
  function badge(v){const s=String(v||'').toLowerCase();const kind=s==='approved'?'success':s==='draft'?'warning':s==='retired'?'danger':'info';return `<span class="badge ${kind}">${esc(v||'—')}</span>`}
  function render(root){
    const r=state.readiness||{};
    root.innerHTML=`<section class="panel fin-policy-panel">
      <div class="panel-head"><div><div class="eyebrow">Etapa 13E</div><h2>Políticas financeiras</h2><p>Versionamento owner-only. Criar ou aprovar uma política não liga o runtime financeiro nem emite NF-e.</p></div><button id="finPolicyRefresh" class="button secondary small" type="button">Atualizar</button></div>
      <div class="fin-policy-status"><span>Financeiro: <strong>${esc(r.enabled?'ON':'OFF')}</strong></span><span>Políticas: <strong>${esc(r.financial_policy_write_enabled?'escrita habilitada':'escrita bloqueada')}</strong></span><span>Aplicação fiscal: <strong>${esc(r.fiscal_projection_apply_enabled?'habilitada':'bloqueada')}</strong></span></div>
      <form id="finPolicyForm" class="fin-policy-form">
        <label>Escopo<select id="finPolicyScope"><option value="fiscal_projection">Projeção fiscal</option><option value="reconciliation">Conciliação</option><option value="route_close">Fechamento de rota</option></select></label>
        <label>Tolerância em centavos<input id="finPolicyTolerance" type="number" min="0" step="1" placeholder="Ex.: 0"></label>
        <label class="fin-check"><input id="finPolicyExact" type="checkbox" checked> Exigir referência externa para pagamento não-dinheiro</label>
        <label class="fin-check"><input id="finPolicyDelivery" type="checkbox" checked> Exigir entrega confirmada</label>
        <label class="fin-check"><input id="finPolicyCases" type="checkbox" checked> Bloquear se houver conciliação aberta</label>
        <label class="fin-check"><input id="finPolicyApply" type="checkbox"> Política permite aplicação (runtime continua independente)</label>
        <label class="fin-policy-reason">Justificativa<input id="finPolicyReason" maxlength="1000" placeholder="Obrigatória como contexto operacional"></label>
        <button class="button" type="submit">Criar draft</button>
      </form>
      <div id="finPolicyList" class="fin-policy-list"></div>
    </section>`;
    document.getElementById('finPolicyRefresh').onclick=load;
    document.getElementById('finPolicyForm').onsubmit=createDraft;
    renderList();
  }
  function renderList(){
    const root=document.getElementById('finPolicyList');if(!root)return;
    root.innerHTML=state.policies.length?state.policies.map(p=>`<article class="fin-policy-card">
      <div><strong>${esc(scopeLabel(p.scope_key))} · v${esc(p.version)}</strong><small>Tolerância: ${p.max_difference_cents==null?'não definida':`${esc(p.max_difference_cents)} centavos`} · referência exata: ${p.require_exact_reference?'sim':'não'} · entrega: ${p.require_delivery_confirmed?'sim':'não'}</small><small>Aplicação permitida pela política: ${p.allow_apply?'sim':'não'} · vigência: ${esc(fmt(p.effective_from))} → ${esc(fmt(p.effective_to))}</small><small>${esc(p.reason||'Sem justificativa registrada.')}</small></div>
      <div class="fin-policy-actions">${badge(p.status)}${p.status==='draft'?`<button class="button secondary small" type="button" data-policy-approve="${esc(p.id)}">Aprovar</button>`:''}${p.status!=='retired'?`<button class="button secondary small" type="button" data-policy-retire="${esc(p.id)}">Retirar</button>`:''}</div>
    </article>`).join(''):'<div class="empty">Nenhuma política financeira versionada.</div>';
    root.querySelectorAll('[data-policy-approve]').forEach(b=>b.onclick=()=>approve(b.dataset.policyApprove));
    root.querySelectorAll('[data-policy-retire]').forEach(b=>b.onclick=()=>retire(b.dataset.policyRetire));
  }
  async function createDraft(ev){
    ev.preventDefault();
    const raw=document.getElementById('finPolicyTolerance').value;
    const payload={
      scope_key:document.getElementById('finPolicyScope').value,
      max_difference_cents:raw===''?null:Number(raw),
      require_exact_reference:document.getElementById('finPolicyExact').checked,
      require_delivery_confirmed:document.getElementById('finPolicyDelivery').checked,
      require_no_open_reconciliation_case:document.getElementById('finPolicyCases').checked,
      allow_apply:document.getElementById('finPolicyApply').checked,
      reason:document.getElementById('finPolicyReason').value,
    };
    try{await api('create_policy_draft',payload);toast('Draft financeiro criado.','success');await load()}catch(e){toast(e.message,'error')}
  }
  async function approve(id){
    if(!id)return;
    const reason=window.prompt('Justificativa da aprovação desta política:','Aprovada após revisão operacional.')||'';
    if(!reason)return;
    try{await api('approve_policy',{policy_id:id,reason});toast('Política aprovada. Runtime continua independente.','success');await load()}catch(e){toast(e.message,'error')}
  }
  async function retire(id){
    if(!id)return;
    const reason=window.prompt('Motivo para retirar esta política:','Substituição/revisão de política.')||'';
    if(!reason)return;
    try{await api('retire_policy',{policy_id:id,reason});toast('Política retirada.','success');await load()}catch(e){toast(e.message,'error')}
  }
  async function load(){
    if(state.loading)return;state.loading=true;
    try{
      const [a,b]=await Promise.all([api('readiness'),api('policies')]);state.readiness=a.readiness||{};state.policies=b.policies||[];
      const root=document.getElementById('financialPolicyAdminMount');if(root)render(root);
    }catch(e){toast(e.message,'error')}
    finally{state.loading=false}
  }
  async function mount(root){if(state.mounted||!root)return;state.mounted=true;await load()}
  window.DAFinancialPolicyAdmin=Object.freeze({mount});
})();
