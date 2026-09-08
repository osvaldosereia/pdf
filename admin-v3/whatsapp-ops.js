(function(){
  'use strict';
  const C=window.DA_ADMIN_V3_CONFIG||{};
  const AUTH_KEY='da_admin_v3_auth';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR')};
  const n=v=>new Intl.NumberFormat('pt-BR').format(Number(v||0));
  const usd=v=>`US$ ${new Intl.NumberFormat('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:6}).format(Number(v||0))}`;
  const channelLabel=v=>({whatsapp:'WhatsApp',web:'Sala',hybrid:'Híbrido',instagram:'Instagram',messenger:'Messenger'}[String(v||'').toLowerCase()]||String(v||'—'));
  let loading=false;
  let lastData=null;

  function auth(){try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch{return null}}
  async function refreshToken(a){
    if(!a?.refresh_token)throw new Error('Sessão expirada.');
    const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:a.refresh_token})});
    const data=await r.json().catch(()=>({}));if(!r.ok||!data.access_token)throw new Error('Sessão expirada.');localStorage.setItem(AUTH_KEY,JSON.stringify(data));return data;
  }
  async function api(action,payload={},retry=true){
    let a=auth();if(!a?.access_token)throw new Error('Faça login.');
    const fn=C.whatsappOpsEdgeFunction||'admin-whatsapp-ops-v1';
    const r=await fetch(`${C.supabaseUrl}/functions/v1/${fn}`,{method:'POST',headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${a.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
    const data=await r.json().catch(()=>({}));
    if(r.status===401&&retry){a=await refreshToken(a);return api(action,payload,false)}
    if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||`Erro ${r.status}`);return data;
  }
  function toast(message,kind=''){
    const region=$('toastRegion');if(!region)return;
    const x=document.createElement('div');x.className=`toast ${kind}`.trim();x.textContent=message;region.appendChild(x);setTimeout(()=>x.remove(),kind==='error'?6500:3500);
  }
  function metric(value,label,help,kind=''){return `<article class="metric ${kind}"><strong>${esc(value)}</strong><span>${esc(label)}</span><small>${esc(help)}</small></article>`}
  function badge(v,force=''){const s=String(v||'').toLowerCase();const kind=force||s==='open'?'warning':s==='claimed'?'info':s==='live'?'danger':s==='off'?'success':s==='sent'?'success':s==='review_required'?'danger':'info';return `<span class="badge ${kind}">${esc(v||'—')}</span>`}
  function channelBadge(v){return `<span class="badge info">${esc(channelLabel(v))}</span>`}
  function openModal(title,body){
    if(!$('modal')||!$('modalBackdrop'))return;
    $('modalEyebrow').textContent='CRM omnichannel';$('modalTitle').textContent=title;$('modalBody').innerHTML=body;$('modalFooter').innerHTML='<button class="button secondary" type="button" data-close-modal>Fechar</button>';
    $('modalBackdrop').classList.remove('hidden');$('modal').classList.remove('hidden');
  }

  function ensureUnifiedInboxUi(){
    const nav=document.querySelector('.nav[data-route="whatsapp"]');
    if(nav)nav.innerHTML='<span>IN</span>Inbox omnichannel';
    const list=$('waHandoffRows');if(!list||$('unifiedInboxFilters'))return;
    const panel=list.closest('.panel');const head=panel?.querySelector('.panel-head');
    const h2=head?.querySelector('h2');const eyebrow=head?.querySelector('.eyebrow');
    if(h2)h2.textContent='Caixa de entrada única';if(eyebrow)eyebrow.textContent='Humano · todos os canais';
    const filters=document.createElement('div');filters.id='unifiedInboxFilters';filters.className='toolbar';
    filters.innerHTML=`
      <select id="inboxChannel" aria-label="Canal"><option value="">Todos os canais</option><option value="whatsapp">WhatsApp</option><option value="web">Sala</option><option value="hybrid">Híbrido</option><option value="instagram">Instagram</option><option value="messenger">Messenger</option></select>
      <select id="inboxStatus" aria-label="Estado"><option value="">Abertos + assumidos</option><option value="open">Aguardando</option><option value="claimed">Assumidos</option></select>
      <select id="inboxPriority" aria-label="Prioridade"><option value="">Todas as prioridades</option><option value="3">Prioridade 3</option><option value="2">Prioridade 2</option><option value="1">Prioridade 1</option></select>
      <button id="reloadUnifiedInbox" class="button secondary small" type="button">Filtrar</button>`;
    head?.insertAdjacentElement('afterend',filters);
  }

  function renderInbox(rows,metrics={}){
    const items=rows||[];
    if($('waHandoffCount'))$('waHandoffCount').textContent=`${items.length} visível(is) · ${n(metrics.sla_overdue||0)} SLA vencido(s)`;
    if(!$('waHandoffRows'))return;
    $('waHandoffRows').innerHTML=items.length?items.map(x=>{
      const claimed=x.handoff_status==='claimed';
      const overdue=!!x.sla_overdue;
      const preview=x.last_preview||x.handoff_reason||'Sem prévia de mensagem';
      const sla=x.sla_due_at?`SLA ${overdue?'VENCIDO':'até'} ${fmt(x.sla_due_at)}`:'SLA —';
      return `<div class="list-row ops-handoff">
        <div>
          <div class="list-actions" style="justify-content:flex-start">${channelBadge(x.channel)}${badge(x.handoff_status)}${overdue?'<span class="badge danger">SLA</span>':''}</div>
          <strong>${esc(x.customer_name||'Cliente')}</strong>
          <small>${esc(x.handoff_reason||'handoff')} · prioridade ${n(x.priority)} · ${esc(sla)}</small>
          <small>${esc(preview)}</small>
        </div>
        <div class="list-actions">
          <button class="row-button" data-inbox-timeline="${esc(x.conversation_id)}" data-customer="${esc(x.customer_id||'')}" type="button">Histórico</button>
          ${x.customer_id?`<button class="row-button" data-inbox-crm="${esc(x.customer_id)}" type="button">CRM</button>`:''}
          ${claimed?`<button class="row-button" data-inbox-reply="${esc(x.conversation_id)}" data-channel="${esc(x.channel)}" type="button">Responder</button><button class="row-button" data-wa-resolve="${esc(x.handoff_id)}" data-conversation="${esc(x.conversation_id)}" type="button">Resolver</button>`:`<button class="row-button" data-wa-claim="${esc(x.handoff_id)}" type="button">Assumir</button>`}
        </div>
      </div>`;
    }).join(''):'<div class="empty">Nenhum atendimento humano para estes filtros.</div>';
  }

  function render(data){
    lastData=data;
    const d=data.dashboard||{},cfg=d.config||{},q=d.queues||{},h=d.last_hour||{},u=d.today_usage||{},im=data.inbox_metrics||{};
    const release=String(cfg.release_mode||'off');
    const costStatus=String(u.cost_status||'unpriced');
    const costValue=costStatus==='priced'?usd(u.estimated_cost_usd):costStatus==='no_usage'?'—':'não precificado';
    const costHelp=costStatus==='unpriced'
      ? `${n(u.unpriced_events||0)} chamada(s) com tokens, mas sem tabela de preço registrada`
      : costStatus==='priced'?`${n(u.priced_events||0)} chamada(s) com estimativa registrada`:'Nenhuma chamada concluída hoje';
    const banner=$('waReleaseBanner');
    if(banner){
      banner.className=`ops-alert ${release==='live'?'live':release==='observe'?'observe':'safe'}`;
      banner.textContent=release==='live'
        ? `WhatsApp live em ${n(cfg.canary_percent)}%. Inbox humana é multicanal; Instagram/Messenger continuam dormentes até gates próprios serem liberados.`
        : 'Inbox omnichannel disponível para operação humana; canais automáticos continuam sujeitos aos respectivos gates.';
    }
    if($('waOpsMetrics'))$('waOpsMetrics').innerHTML=[
      metric(release.toUpperCase(),'WhatsApp release','Modo atual',release==='live'?'danger':'success'),
      metric(`${n(cfg.canary_percent)}%`,'Canary WhatsApp','Não aumentar sem autorização'),
      metric(n(im.active_total??((q.human_open||0)+(q.human_claimed||0))),'Inbox humana','Abertos + assumidos',(im.active_total||q.human_open||q.human_claimed)?'warning':''),
      metric(n(im.sla_overdue||0),'SLA vencido','Atendimentos ativos',im.sla_overdue?'danger':''),
      metric(im.first_response_avg_seconds==null?'—':`${n(im.first_response_avg_seconds)}s`,'1ª resposta média','Histórico com resposta humana'),
      metric(n(q.outbound_review||0),'Envios IA em revisão','Nunca recebem retry cego',q.outbound_review?'danger':''),
      metric(costValue,'Custo IA hoje',costHelp,costStatus==='unpriced'?'warning':'')
    ].join('');
    if($('waOpsState'))$('waOpsState').innerHTML=`
      <div class="ops-kv"><span>WhatsApp inbound</span><strong>${cfg.inbound_enabled?'ligado':'desligado'}</strong></div>
      <div class="ops-kv"><span>WhatsApp auto-reply</span><strong>${cfg.auto_reply_enabled?'ligado':'desligado'}</strong></div>
      <div class="ops-kv"><span>IA</span><strong>${cfg.ai_enabled?'ligada':'desligada'}</strong></div>
      <div class="ops-kv"><span>Worker</span><strong>${cfg.worker_enabled?'ligado':'desligado'}</strong></div>
      <div class="ops-kv"><span>Dispatcher event-driven</span><strong>${cfg.dispatch_enabled?'ligado':'desligado'}</strong></div>
      <div class="ops-kv"><span>Novas conversas IA / hora</span><strong>${n(h.new_ai_canary_conversations||0)} / ${n(cfg.max_new_conversations_per_hour||0)}</strong></div>
      <div class="ops-kv"><span>Chamadas IA / hora</span><strong>${n(h.ai_calls||0)} / ${n(cfg.max_ai_jobs_per_hour||0)}</strong></div>
      <div class="ops-kv"><span>Outbound IA / hora</span><strong>${n(h.outbound_sent||0)} / ${n(cfg.max_outbound_per_hour||0)}</strong></div>
      <div class="ops-kv"><span>Emergency stop WhatsApp</span><strong>${esc(cfg.emergency_stop_reason||'sem bloqueio registrado')}</strong></div>`;

    renderInbox(data.inbox||[],im);
    const events=d.recent_ops_events||[];
    if($('waOpsEvents'))$('waOpsEvents').innerHTML=events.length?events.map(x=>`<div class="list-row"><div><strong>${esc(x.event_type)}</strong><small>${fmt(x.created_at)} · ${esc(x.severity)}</small></div>${badge(x.severity)}</div>`).join(''):'<div class="empty">Nenhum evento operacional recente.</div>';
    const canWrite=['owner','operator'].includes(data.user?.role);if($('waEmergencyStop'))$('waEmergencyStop').disabled=!canWrite;
  }

  async function loadOps(){
    if(loading)return;loading=true;ensureUnifiedInboxUi();
    if($('waHandoffRows'))$('waHandoffRows').innerHTML='<div class="empty">Carregando…</div>';
    try{render(await api('dashboard'))}catch(e){toast(e.message,'error');if($('waHandoffRows'))$('waHandoffRows').innerHTML=`<div class="empty">${esc(e.message)}</div>`}
    finally{loading=false}
  }
  async function loadInbox(){
    try{
      const data=await api('inbox',{channel:$('inboxChannel')?.value||'',status:$('inboxStatus')?.value||'',priority:$('inboxPriority')?.value||'',limit:75});
      renderInbox(data.inbox||[],data.metrics||{});
    }catch(e){toast(e.message,'error')}
  }
  async function claim(id){try{await api('claim_handoff',{id});toast('Atendimento assumido.','success');await loadOps()}catch(e){toast(e.message,'error')}}
  async function resolve(id){
    const notes=window.prompt('Observação de resolução (opcional):','')||'';
    try{await api('resolve_handoff',{id,notes});toast('Atendimento marcado como resolvido. IA não foi retomada automaticamente.','success');await loadOps()}
    catch(e){toast(e.message,'error');await loadOps()}
  }
  async function reply(conversationId,channel){
    const message=window.prompt(`Responder por ${channelLabel(channel)}:`, '');if(!message?.trim())return;
    try{
      const data=await api('operator_reply',{conversation_id:conversationId,message});const dispatch=data.result?.dispatch||{};
      if(dispatch.status==='dispatching')toast('Resposta humana enviada para entrega controlada.','success');
      else if(dispatch.skipped)toast(`Resposta registrada, mas não enviada: ${dispatch.skipped}.`,'warning');
      else toast('Resposta humana registrada.','success');
      await loadOps();
    }catch(e){toast(e.message,'error')}
  }
  async function showTimeline(conversationId){
    try{
      const data=await api('timeline',{conversation_id:conversationId});const rows=data.timeline||[];
      openModal('Histórico da conversa',rows.length?`<div class="history">${rows.map(x=>`<div class="history-row"><span><strong>${esc(channelLabel(x.channel))} · ${esc(x.event_kind)}</strong><small>${fmt(x.occurred_at)} · ${esc(x.direction||'system')}</small></span><span>${esc(x.body_text||x.title||'—')}</span></div>`).join('')}</div>`:'<div class="empty">Sem eventos na timeline.</div>');
    }catch(e){toast(e.message,'error')}
  }
  async function showCrm(customerId){
    try{
      const data=await api('customer_identity_summary',{customer_id:customerId});const c=data.customer||{},ids=data.channel_identities||[],emails=data.emails||[],consents=data.consents||[];
      openModal(c.name||'Cliente',`<div class="detail-grid">
        <div class="detail-card"><span>WhatsApp principal</span><strong>${esc(c.primary_whatsapp_e164||'—')}</strong></div>
        <div class="detail-card"><span>Pedidos</span><strong>${n(c.order_count||0)}</strong></div>
        <div class="detail-card"><span>Última compra</span><strong>${fmt(c.last_order_at)}</strong></div>
      </div>
      <div class="panel-head" style="padding-left:0;padding-right:0"><div><div class="eyebrow">Identidades confirmadas</div><h2>Canais</h2></div></div>
      <div class="history">${ids.length?ids.map(i=>`<div class="history-row"><span><strong>${esc(channelLabel(i.channel))}</strong><small>${esc(i.identity_kind)} · ${esc(i.verification_status)}</small></span><span>${esc(i.external_user_id)}</span></div>`).join(''):'<div class="empty">Nenhuma identidade de canal vinculada.</div>'}</div>
      <div class="panel-head" style="padding-left:0;padding-right:0"><div><div class="eyebrow">Contato</div><h2>E-mails</h2></div></div>
      <div class="history">${emails.length?emails.map(i=>`<div class="history-row"><span><strong>${esc(i.email_normalized)}</strong><small>${esc(i.verification_status)}${i.is_primary?' · principal':''}</small></span></div>`).join(''):'<div class="empty">Nenhum e-mail confirmado.</div>'}</div>
      <div class="panel-head" style="padding-left:0;padding-right:0"><div><div class="eyebrow">Consentimentos</div><h2>Por canal</h2></div></div>
      <div class="history">${consents.length?consents.map(i=>`<div class="history-row"><span><strong>${esc(channelLabel(i.channel))} · ${esc(i.purpose)}</strong><small>${fmt(i.occurred_at)}</small></span>${badge(i.status)}</div>`).join(''):'<div class="empty">Nenhum consentimento registrado nesta estrutura.</div>'}</div>`);
    }catch(e){toast(e.message,'error')}
  }
  async function emergencyStop(){
    if(!window.confirm('Confirmar PARADA DE EMERGÊNCIA do atendimento automático do WhatsApp?'))return;
    const reason=window.prompt('Motivo da parada:','parada manual pelo Admin')||'parada manual pelo Admin';
    try{await api('emergency_stop',{reason});toast('Atendimento automático do WhatsApp interrompido.','success');await loadOps()}catch(e){toast(e.message,'error')}
  }
  function isOpsVisible(){return document.querySelector('.view[data-view="whatsapp"]')?.classList.contains('active')}
  function bind(){
    ensureUnifiedInboxUi();
    const nav=document.querySelector('.nav[data-route="whatsapp"]');
    nav?.addEventListener('click',()=>setTimeout(()=>{ensureUnifiedInboxUi();if($('pageTitle'))$('pageTitle').textContent='Inbox omnichannel';if($('pageSubtitle'))$('pageSubtitle').textContent='CRM, timeline, SLA e atendimento humano centralizado. Canais automáticos respeitam gates independentes.';loadOps()},0));
    $('refreshButton')?.addEventListener('click',()=>{if(isOpsVisible())setTimeout(loadOps,0)});
    $('waEmergencyStop')?.addEventListener('click',emergencyStop);
    document.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.id==='reloadUnifiedInbox')loadInbox();
      if(b.dataset.waClaim)claim(b.dataset.waClaim);
      if(b.dataset.waResolve)resolve(b.dataset.waResolve);
      if(b.dataset.inboxReply)reply(b.dataset.inboxReply,b.dataset.channel);
      if(b.dataset.inboxTimeline)showTimeline(b.dataset.inboxTimeline);
      if(b.dataset.inboxCrm)showCrm(b.dataset.inboxCrm);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
