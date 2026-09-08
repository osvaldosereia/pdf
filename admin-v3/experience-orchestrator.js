(function(){
  'use strict';
  const C=window.DA_ADMIN_V3_CONFIG||{};
  const AUTH_KEY='da_admin_v3_auth';
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const n=v=>new Intl.NumberFormat('pt-BR').format(Number(v||0));
  const pct=v=>v===null||v===undefined?'—':`${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(v))}%`;
  const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR')};
  let root=null,last=null,loading=false;
  function auth(){try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch{return null}}
  async function refreshToken(a){
    if(!a?.refresh_token)throw new Error('Sessão expirada.');
    const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:a.refresh_token})});
    const data=await r.json().catch(()=>({}));if(!r.ok||!data.access_token)throw new Error('Sessão expirada.');localStorage.setItem(AUTH_KEY,JSON.stringify(data));return data;
  }
  async function api(action,payload={},retry=true){
    let a=auth();if(!a?.access_token)throw new Error('Faça login.');
    const fn=C.experienceOrchestratorEdgeFunction||'admin-experience-orchestrator-v1';
    const r=await fetch(`${C.supabaseUrl}/functions/v1/${fn}`,{method:'POST',headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${a.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
    const data=await r.json().catch(()=>({}));
    if(r.status===401&&retry){a=await refreshToken(a);return api(action,payload,false)}
    if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||`Erro ${r.status}`);return data;
  }
  function toast(message,kind=''){const region=document.getElementById('toastRegion');if(!region)return;const x=document.createElement('div');x.className=`toast ${kind}`.trim();x.textContent=message;region.appendChild(x);setTimeout(()=>x.remove(),kind==='error'?6500:3500)}
  function actionLabel(v){return ({conversation:'Conversa',deterministic:'Resposta oficial',carousel:'Carrossel',whatsapp_flow:'WhatsApp Flow',shopping_room:'Sala de Compra',human:'Humano'})[v]||v||'—'}
  function statusBadge(v){const s=String(v||'');const kind=s==='active'?'success':s==='ready'?'info':s==='draft'?'warning':'muted';return `<span class="exp-badge ${kind}">${esc(s||'—')}</span>`}
  function metric(value,label,help){return `<article class="exp-metric"><strong>${esc(value)}</strong><span>${esc(label)}</span><small>${esc(help)}</small></article>`}
  function shell(){return `
    <section class="exp-shell">
      <div class="exp-alert"><strong>Orquestrador de interfaces</strong><span>Fundação segura para decidir entre conversa, resposta oficial, carrossel, WhatsApp Flow, Sala de Compra e humano. O kill switch global nasce desligado.</span></div>
      <div id="expMetrics" class="exp-metrics"></div>
      <div class="exp-grid">
        <section class="exp-card"><header><div><small>Feature flags</small><h3>Interfaces disponíveis</h3></div><button id="expReload" class="button secondary small" type="button">Atualizar</button></header><div id="expFeatures" class="exp-list"><div class="empty">Carregando…</div></div></section>
        <section class="exp-card"><header><div><small>WhatsApp Flows</small><h3>Definições preparadas</h3></div></header><div id="expDefinitions" class="exp-list"><div class="empty">Carregando…</div></div></section>
      </div>
      <div class="exp-grid">
        <section class="exp-card"><header><div><small>Readiness</small><h3>Contrato do Flow de cesta</h3></div></header><div id="expFlowReadiness" class="exp-list"><div class="empty">Carregando…</div></div></section>
        <section class="exp-card"><header><div><small>Últimos 7 dias</small><h3>Funil por experiência</h3></div></header><div id="expFunnel" class="exp-list"><div class="empty">Nenhuma sessão.</div></div></section>
      </div>
      <section class="exp-card"><header><div><small>Simulador sem efeitos</small><h3>Qual interface seria escolhida?</h3></div></header>
        <form id="expPreviewForm" class="exp-form">
          <label>Conversa<select id="expConversation" required></select></label>
          <label>Tarefa<select id="expTask"><option value="basket_customize">Personalizar cesta</option><option value="build_purchase">Montar compra</option><option value="recommendations">Recomendações</option><option value="product_search">Busca de produto</option><option value="upsell">Upsell</option><option value="payment">Pagamento</option><option value="delivery">Entrega</option><option value="hours">Horários</option><option value="checkout">Checkout</option></select></label>
          <label>Candidatos<input id="expCandidates" type="number" min="0" max="1000" value="0"></label>
          <label>Escolhas estruturadas<input id="expChoices" type="number" min="0" max="1000" value="0"></label>
          <label class="exp-check"><input id="expVisual" type="checkbox"> Precisa de experiência visual rica</label>
          <button class="button primary" type="submit">Simular decisão</button>
        </form>
        <pre id="expPreviewResult" class="exp-preview">A simulação não cria sessão, não chama OpenAI, não envia WhatsApp e não toca no Bling.</pre>
      </section>
      <section class="exp-card"><header><div><small>Auditoria</small><h3>Eventos de experiência</h3></div></header><div id="expEvents" class="exp-list"><div class="empty">Nenhum evento.</div></div></section>
    </section>`}
  function render(data){
    last=data;const d=data.dashboard||{},cfg=d.config||{},m=d.metrics_24h||{};
    const readiness=data.flow_readiness?.basket_personalization_v1||{};
    root.querySelector('#expMetrics').innerHTML=[
      metric(cfg.orchestrator_enabled?'LIGADO':'DESLIGADO','Kill switch','Não existe ativação por botão nesta fase'),
      metric(n((d.features||[]).filter(x=>x.enabled).length),'Features ligadas','Todas nasceram desligadas'),
      metric(n(d.active_sessions||0),'Sessões ativas','Flows/Sala gerenciados pelo orquestrador'),
      metric(n(m.completed||0),'Concluídas 24h','Conclusões auditadas'),
      metric(String(cfg.whatsapp_release_mode||'off').toUpperCase(),'WhatsApp','Release atual não é alterado por este painel')
    ].join('');
    const features=d.features||[];
    root.querySelector('#expFeatures').innerHTML=features.length?features.map(f=>`<div class="exp-row"><div><strong>${esc(f.key)}</strong><small>${esc(actionLabel(f.experience_type))} · canal ${esc(f.channel)} · rollout ${n(f.rollout_percent)}%</small></div><div>${f.enabled?'<span class="exp-badge success">enabled</span>':'<span class="exp-badge muted">off</span>'}<button class="row-button" data-exp-feature="${esc(f.key)}" type="button">Editar rascunho</button></div></div>`).join(''):'<div class="empty">Nenhuma feature cadastrada.</div>';
    const defs=d.definitions||[];
    root.querySelector('#expDefinitions').innerHTML=defs.length?defs.map(x=>`<div class="exp-row"><div><strong>${esc(x.slug)}</strong><small>${esc(x.purpose)}</small><small>${esc(x.provider||'interno')} · schema v${n(x.schema_version)}${x.provider_id?' · provider configurado':''}</small></div><div>${statusBadge(x.status)}<button class="row-button" data-exp-definition="${esc(x.id)}" type="button">Editar</button></div></div>`).join(''):'<div class="empty">Nenhuma definição cadastrada.</div>';
    root.querySelector('#expFlowReadiness').innerHTML=`
      <div class="exp-row"><div><strong>Contrato interno</strong><small>Payload/validação de personalização sem preço individual dos componentes.</small></div>${readiness.contract_ready?'<span class="exp-badge success">pronto</span>':'<span class="exp-badge warning">pendente</span>'}</div>
      <div class="exp-row"><div><strong>Transporte Meta</strong><small>Provider ID + definição pronta/publicada. Não ativa rollout.</small></div>${readiness.transport_ready?'<span class="exp-badge success">pronto</span>':'<span class="exp-badge muted">não configurado</span>'}</div>
      <div class="exp-row"><div><strong>Exposição de componentes</strong><small>Preço individual permanece oculto por contrato.</small></div>${readiness.component_prices_visible?'<span class="exp-badge warning">revisar</span>':'<span class="exp-badge success">seguro</span>'}</div>`;
    const funnel=data.funnel?.definitions||[];
    root.querySelector('#expFunnel').innerHTML=funnel.length?funnel.map(x=>`<div class="exp-row"><div><strong>${esc(x.slug)}</strong><small>${n(x.sessions)} sessões · ${n(x.completed)} concluídas · ${n(x.abandoned)} abandonos · ${n(x.expired)} expiradas</small></div><div><span class="exp-badge info">abertura ${esc(pct(x.open_rate))}</span><span class="exp-badge ${Number(x.completion_rate||0)>=70?'success':'muted'}">conclusão ${esc(pct(x.completion_rate))}</span></div></div>`).join(''):'<div class="empty">Nenhuma sessão no período.</div>';
    const conv=data.conversations||[];root.querySelector('#expConversation').innerHTML=conv.length?conv.map(c=>`<option value="${esc(c.id)}">${esc(c.channel)} · ${esc(c.stage||c.status)} · ${esc(c.automation_cohort||'sem cohort')} · ${esc(c.id.slice(0,8))}</option>`).join(''):'<option value="">Nenhuma conversa disponível</option>';
    const events=d.recent_events||[];root.querySelector('#expEvents').innerHTML=events.length?events.map(e=>`<div class="exp-row"><div><strong>${esc(e.event_type)}</strong><small>${esc(actionLabel(e.interface_type))} · ${esc(e.cohort||'—')} · ${fmt(e.created_at)}</small></div></div>`).join(''):'<div class="empty">Nenhum evento de experiência registrado.</div>';
  }
  async function load(){if(!root||loading)return;loading=true;try{render(await api('dashboard'))}catch(e){toast(e.message,'error');root.querySelector('#expFeatures').innerHTML=`<div class="empty">${esc(e.message)}</div>`}finally{loading=false}}
  async function preview(e){e.preventDefault();const conversation_id=root.querySelector('#expConversation').value;if(!conversation_id)return toast('Selecione uma conversa.','error');const payload={conversation_id,task:root.querySelector('#expTask').value,candidate_count:Number(root.querySelector('#expCandidates').value||0),structured_choice_count:Number(root.querySelector('#expChoices').value||0),visual_required:root.querySelector('#expVisual').checked};try{const data=await api('preview',payload);const p=data.plan||{};root.querySelector('#expPreviewResult').textContent=`Interface: ${actionLabel(p.action)}\nMotivo: ${p.reason||'—'}\nDefinição: ${p.definition_slug||'—'}\nValidação backend: ${p.requires_backend_validation?'sim':'não'}\nEfeitos colaterais: não`; }catch(err){toast(err.message,'error')}}
  async function editFeature(key){const f=(last?.dashboard?.features||[]).find(x=>x.key===key);if(!f)return;const raw=window.prompt(`Config JSON de ${key}. Isto NÃO liga a feature nem altera rollout.`,JSON.stringify(f.config||{},null,2));if(raw===null)return;let config;try{config=JSON.parse(raw)}catch{return toast('JSON inválido.','error')}try{await api('save_feature_config',{feature_key:key,config});toast('Rascunho da feature atualizado.','success');await load()}catch(e){toast(e.message,'error')}}
  async function editDefinition(id){const d=(last?.dashboard?.definitions||[]).find(x=>x.id===id);if(!d)return;const purpose=window.prompt('Missão da experiência:',d.purpose||'');if(purpose===null)return;const status=window.prompt('Status: draft, ready, paused ou retired',d.status||'draft');if(status===null)return;const provider_id=window.prompt('ID do provider/Flow na Meta (opcional):',d.provider_id||'');if(provider_id===null)return;const provider_version=window.prompt('Versão do provider (opcional):',d.provider_version||'');if(provider_version===null)return;const raw=window.prompt('Config JSON:',JSON.stringify(d.config||{},null,2));if(raw===null)return;let config;try{config=JSON.parse(raw)}catch{return toast('JSON inválido.','error')}try{await api('save_definition',{id,purpose,status,provider_id,provider_version,schema_version:d.schema_version||1,config});toast('Definição atualizada.','success');await load()}catch(e){toast(e.message,'error')}}
  function bind(){root.querySelector('#expReload').addEventListener('click',load);root.querySelector('#expPreviewForm').addEventListener('submit',preview);root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.expFeature)editFeature(b.dataset.expFeature);if(b.dataset.expDefinition)editDefinition(b.dataset.expDefinition)});}
  function mount(target){root=typeof target==='string'?document.querySelector(target):target;if(!root)throw new Error('experience_orchestrator_mount_missing');root.innerHTML=shell();bind();load();}
  window.DAExperienceOrchestrator=Object.freeze({mount,load:()=>load()});
})();
