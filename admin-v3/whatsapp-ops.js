(function(){
  'use strict';
  const C=window.DA_ADMIN_V3_CONFIG||{};
  const AUTH_KEY='da_admin_v3_auth';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR')};
  const n=v=>new Intl.NumberFormat('pt-BR').format(Number(v||0));
  const usd=v=>`US$ ${new Intl.NumberFormat('pt-BR',{minimumFractionDigits:4,maximumFractionDigits:6}).format(Number(v||0))}`;
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
  function badge(v){const s=String(v||'').toLowerCase();const kind=s==='open'?'warning':s==='claimed'?'info':s==='live'?'danger':s==='off'?'success':'info';return `<span class="badge ${kind}">${esc(v||'—')}</span>`}

  function render(data){
    lastData=data;
    const d=data.dashboard||{},cfg=d.config||{},q=d.queues||{},h=d.last_hour||{},u=d.today_usage||{};
    const release=String(cfg.release_mode||'off');
    const costStatus=String(u.cost_status||'unpriced');
    const costValue=costStatus==='priced'?usd(u.estimated_cost_usd):costStatus==='no_usage'?'—':'não precificado';
    const costHelp=costStatus==='unpriced'
      ? `${n(u.unpriced_events||0)} chamada(s) com tokens, mas sem tabela de preço registrada`
      : costStatus==='priced'
        ? `${n(u.priced_events||0)} chamada(s) com estimativa registrada`
        : 'Nenhuma chamada concluída hoje';
    const banner=$('waReleaseBanner');
    if(banner){
      banner.className=`ops-alert ${release==='live'?'live':release==='observe'?'observe':'safe'}`;
      banner.textContent=release==='live'
        ? `ATENÇÃO: atendimento live em ${n(cfg.canary_percent)}% do cohort. Monitore filas, limites e fallback humano.`
        : release==='observe'
          ? 'Modo observação: mensagens entram, mas a IA não responde automaticamente. Casos são direcionados para humano.'
          : release==='homologation'
            ? 'Homologação restrita: somente allowlist temporária pode receber automação.'
            : 'Atendimento automático geral fechado. Infraestrutura operacional está em modo seguro.';
    }
    $('waOpsMetrics').innerHTML=[
      metric(release.toUpperCase(),'Release','Modo atual',release==='live'?'danger':'success'),
      metric(`${n(cfg.canary_percent)}%`,'Canary IA','Percentual elegível no live'),
      metric(n((q.human_open||0)+(q.human_claimed||0)),'Fallback humano','Abertos + assumidos',(q.human_open||q.human_claimed)?'warning':''),
      metric(n(q.ai_pending||0),'Jobs IA pendentes','Fila event-driven',q.ai_pending?'warning':''),
      metric(n(q.outbound_review||0),'Envios em revisão','Nunca recebem retry cego',q.outbound_review?'danger':''),
      metric(n(u.input_tokens||0),'Tokens hoje','Entrada OpenAI'),
      metric(costValue,'Custo IA hoje',costHelp,costStatus==='unpriced'?'warning':'')
    ].join('');
    $('waOpsState').innerHTML=`
      <div class="ops-kv"><span>Inbound</span><strong>${cfg.inbound_enabled?'ligado':'desligado'}</strong></div>
      <div class="ops-kv"><span>Auto-reply</span><strong>${cfg.auto_reply_enabled?'ligado':'desligado'}</strong></div>
      <div class="ops-kv"><span>IA</span><strong>${cfg.ai_enabled?'ligada':'desligada'}</strong></div>
      <div class="ops-kv"><span>Worker</span><strong>${cfg.worker_enabled?'ligado':'desligado'}</strong></div>
      <div class="ops-kv"><span>Dispatcher event-driven</span><strong>${cfg.dispatch_enabled?'ligado':'desligado'}</strong></div>
      <div class="ops-kv"><span>Novas conversas IA / hora</span><strong>${n(h.new_ai_canary_conversations||0)} / ${n(cfg.max_new_conversations_per_hour||0)}</strong></div>
      <div class="ops-kv"><span>Chamadas IA / hora</span><strong>${n(h.ai_calls||0)} / ${n(cfg.max_ai_jobs_per_hour||0)}</strong></div>
      <div class="ops-kv"><span>Outbound / hora</span><strong>${n(h.outbound_sent||0)} / ${n(cfg.max_outbound_per_hour||0)}</strong></div>
      <div class="ops-kv"><span>Tokens saída hoje</span><strong>${n(u.output_tokens||0)}</strong></div>
      <div class="ops-kv"><span>Chamadas sem preço hoje</span><strong>${n(u.unpriced_events||0)}</strong></div>
      <div class="ops-kv"><span>Emergency stop</span><strong>${esc(cfg.emergency_stop_reason||'sem bloqueio registrado')}</strong></div>`;

    const handoffs=data.handoffs||[];
    $('waHandoffCount').textContent=`${handoffs.length} visível(is)`;
    $('waHandoffRows').innerHTML=handoffs.length?handoffs.map(x=>{
      const name=x.customer?.name||'Cliente WhatsApp';
      const claimed=x.status==='claimed';
      return `<div class="list-row ops-handoff"><div><strong>${esc(name)}</strong><small>${esc(x.reason)} · prioridade ${n(x.priority)} · ${fmt(x.created_at)}</small><small>${esc(x.summary||'')}</small></div><div class="list-actions">${badge(x.status)}${claimed?`<button class="row-button" data-wa-resolve="${esc(x.id)}" data-conversation="${esc(x.conversation_id)}" type="button">Resolver</button><button class="row-button" data-wa-resume="${esc(x.id)}" data-conversation="${esc(x.conversation_id)}" type="button">Resolver + IA</button>`:`<button class="row-button" data-wa-claim="${esc(x.id)}" type="button">Assumir</button>`}</div></div>`;
    }).join(''):'<div class="empty">Nenhum atendimento aguardando equipe.</div>';

    const events=d.recent_ops_events||[];
    $('waOpsEvents').innerHTML=events.length?events.map(x=>`<div class="list-row"><div><strong>${esc(x.event_type)}</strong><small>${fmt(x.created_at)} · ${esc(x.severity)}</small></div>${badge(x.severity)}</div>`).join(''):'<div class="empty">Nenhum evento operacional recente.</div>';
    const canWrite=['owner','operator'].includes(data.user?.role);
    $('waEmergencyStop').disabled=!canWrite;
  }

  async function loadOps(){
    if(loading)return;loading=true;
    if($('waHandoffRows'))$('waHandoffRows').innerHTML='<div class="empty">Carregando…</div>';
    try{render(await api('dashboard'))}catch(e){toast(e.message,'error');if($('waHandoffRows'))$('waHandoffRows').innerHTML=`<div class="empty">${esc(e.message)}</div>`}
    finally{loading=false}
  }
  async function claim(id){try{await api('claim_handoff',{id});toast('Atendimento assumido.','success');await loadOps()}catch(e){toast(e.message,'error')}}
  async function resolve(id,conversationId,resume){
    const notes=window.prompt('Observação de resolução (opcional):','')||'';
    try{
      await api('resolve_handoff',{id,notes});
      if(resume)await api('resume_ai',{conversation_id:conversationId});
      toast(resume?'Atendimento resolvido e devolvido à IA.':'Atendimento marcado como resolvido.','success');await loadOps();
    }catch(e){toast(e.message,'error');await loadOps()}
  }
  async function emergencyStop(){
    if(!window.confirm('Confirmar PARADA DE EMERGÊNCIA do atendimento automático do WhatsApp?'))return;
    const reason=window.prompt('Motivo da parada:','parada manual pelo Admin')||'parada manual pelo Admin';
    try{await api('emergency_stop',{reason});toast('Atendimento automático interrompido.','success');await loadOps()}catch(e){toast(e.message,'error')}
  }
  function isOpsVisible(){return document.querySelector('.view[data-view="whatsapp"]')?.classList.contains('active')}
  function bind(){
    const nav=document.querySelector('.nav[data-route="whatsapp"]');
    nav?.addEventListener('click',()=>setTimeout(()=>{if($('pageTitle'))$('pageTitle').textContent='Atendimento IA';if($('pageSubtitle'))$('pageSubtitle').textContent='Release, filas, custos e fallback humano do WhatsApp.';loadOps()},0));
    $('refreshButton')?.addEventListener('click',()=>{if(isOpsVisible())setTimeout(loadOps,0)});
    $('waEmergencyStop')?.addEventListener('click',emergencyStop);
    $('waHandoffRows')?.addEventListener('click',e=>{
      const b=e.target.closest('button');if(!b)return;
      if(b.dataset.waClaim)claim(b.dataset.waClaim);
      if(b.dataset.waResolve)resolve(b.dataset.waResolve,b.dataset.conversation,false);
      if(b.dataset.waResume)resolve(b.dataset.waResume,b.dataset.conversation,true);
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
