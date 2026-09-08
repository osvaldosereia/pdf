(function(){
  'use strict';

  const C=window.DA_ADMIN_V3_CONFIG||{};
  const AUTH_KEY='da_admin_v3_auth';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=v=>{if(!v)return '—';const d=new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleString('pt-BR')};
  const channelLabel=v=>({whatsapp:'WhatsApp',web:'Sala',hybrid:'Híbrido',instagram:'Instagram',messenger:'Messenger'}[String(v||'').toLowerCase()]||String(v||'—'));
  const roleLabel=v=>({inbound:'Cliente',outbound:'Equipe',system:'Sistema'}[String(v||'').toLowerCase()]||String(v||'Sistema'));

  const state={
    mounted:false,
    loading:false,
    inbox:[],
    metrics:{},
    user:null,
    selected:null,
    timeline:[],
    customer:null,
    identities:[],
    consents:[],
    query:'',
    filter:'all',
  };

  function auth(){try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch{return null}}
  async function refreshToken(a){
    if(!a?.refresh_token)throw new Error('Sessão expirada.');
    const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{
      method:'POST',
      headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},
      body:JSON.stringify({refresh_token:a.refresh_token}),
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok||!data.access_token)throw new Error('Sessão expirada.');
    localStorage.setItem(AUTH_KEY,JSON.stringify(data));
    return data;
  }
  async function api(action,payload={},retry=true){
    let a=auth();
    if(!a?.access_token)throw new Error('Faça login.');
    const fn=C.whatsappOpsEdgeFunction||'admin-whatsapp-ops-v1';
    const r=await fetch(`${C.supabaseUrl}/functions/v1/${fn}`,{
      method:'POST',
      headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${a.access_token}`,'Content-Type':'application/json'},
      body:JSON.stringify({action,...payload}),
    });
    const data=await r.json().catch(()=>({}));
    if(r.status===401&&retry){a=await refreshToken(a);return api(action,payload,false)}
    if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||`Erro ${r.status}`);
    return data;
  }

  function toast(message,kind=''){
    const region=$('toastRegion');
    if(!region)return;
    const x=document.createElement('div');
    x.className=`toast ${kind}`.trim();
    x.textContent=message;
    region.appendChild(x);
    setTimeout(()=>x.remove(),kind==='error'?6500:3500);
  }

  function overdue(row){
    if(!row?.sla_due_at)return false;
    return new Date(row.sla_due_at).getTime()<Date.now();
  }

  function filteredInbox(){
    const q=state.query.trim().toLowerCase();
    return state.inbox.filter(row=>{
      if(state.filter==='mine'&&row.claimed_by!==state.user?.id)return false;
      if(state.filter==='waiting'&&row.handoff_status!=='open')return false;
      if(state.filter==='claimed'&&row.handoff_status!=='claimed')return false;
      if(state.filter==='sla'&&!overdue(row))return false;
      if(!q)return true;
      return [
        row.customer_name,row.last_preview,row.handoff_reason,row.channel,row.stage
      ].some(v=>String(v||'').toLowerCase().includes(q));
    });
  }

  function conversationMode(row){
    if(!row)return '—';
    if(row.mode==='human')return C.humanCopilotEnabled?'HUMAN_COPILOT':'HUMAN';
    return 'AI';
  }

  function renderShell(){
    const root=$('humanServiceCenterMount');
    if(!root)return;
    root.innerHTML=`
      <div class="hsc-toolbar">
        <div>
          <div class="eyebrow">Central de atendimento</div>
          <h2>Conversas, contexto e resposta humana</h2>
          <p>Mesmo thread do cliente. Handoff humano prevalece; copiloto nunca envia sozinho.</p>
        </div>
        <button id="hscRefresh" class="button secondary small" type="button">Atualizar</button>
      </div>
      <div class="hsc-layout">
        <aside class="hsc-list-pane">
          <div class="hsc-search">
            <input id="hscSearch" type="search" placeholder="Buscar cliente ou mensagem" aria-label="Buscar conversas">
            <select id="hscFilter" aria-label="Filtrar conversas">
              <option value="all">Todas</option>
              <option value="mine">Minhas</option>
              <option value="waiting">Aguardando</option>
              <option value="claimed">Assumidas</option>
              <option value="sla">SLA vencido</option>
            </select>
          </div>
          <div id="hscInbox" class="hsc-inbox"><div class="empty">Carregando conversas…</div></div>
        </aside>
        <section class="hsc-chat-pane">
          <div id="hscChatHeader" class="hsc-chat-header"><div><strong>Selecione uma conversa</strong><small>A timeline aparecerá aqui.</small></div></div>
          <div id="hscTimeline" class="hsc-timeline"><div class="empty">Nenhuma conversa selecionada.</div></div>
          <form id="hscComposer" class="hsc-composer">
            <textarea id="hscMessage" maxlength="4096" rows="3" placeholder="Escreva a resposta ao cliente…" disabled></textarea>
            <div class="hsc-composer-actions">
              <span id="hscComposerHint">Assuma uma conversa para responder.</span>
              <button id="hscSend" class="button primary" type="submit" disabled>Enviar resposta</button>
            </div>
          </form>
        </section>
        <aside class="hsc-context-pane">
          <section class="hsc-context-card">
            <div class="eyebrow">Cliente</div>
            <div id="hscCustomer"><div class="empty">Selecione uma conversa.</div></div>
          </section>
          <section class="hsc-context-card">
            <div class="eyebrow">Copiloto IA</div>
            <div id="hscCopilot"></div>
          </section>
          <section class="hsc-context-card">
            <div class="eyebrow">Segurança</div>
            <div id="hscRisks"></div>
          </section>
        </aside>
      </div>`;
    root.classList.remove('hidden');

    $('hscRefresh').onclick=()=>loadInbox(true);
    $('hscSearch').oninput=e=>{state.query=e.target.value||'';renderInbox()};
    $('hscFilter').onchange=e=>{state.filter=e.target.value||'all';renderInbox()};
    $('hscComposer').onsubmit=sendReply;
  }

  function renderInbox(){
    const root=$('hscInbox');
    if(!root)return;
    const rows=filteredInbox();
    root.innerHTML=rows.length?rows.map(row=>{
      const selected=state.selected?.conversation_id===row.conversation_id;
      const mine=row.claimed_by===state.user?.id;
      const sla=overdue(row);
      return `<button class="hsc-conversation ${selected?'selected':''}" type="button" data-hsc-conversation="${esc(row.conversation_id)}">
        <div class="hsc-conversation-top">
          <strong>${esc(row.customer_name||'Cliente')}</strong>
          <span>${esc(channelLabel(row.channel))}</span>
        </div>
        <p>${esc(row.last_preview||row.handoff_reason||'Sem prévia')}</p>
        <div class="hsc-conversation-meta">
          <span>${esc(row.handoff_status==='claimed'?(mine?'Assumida por você':'Assumida'):'Aguardando')}</span>
          <span class="${sla?'danger-text':''}">${row.sla_due_at?(sla?'SLA vencido':`SLA ${fmt(row.sla_due_at)}`):'SLA —'}</span>
        </div>
      </button>`;
    }).join(''):'<div class="empty">Nenhuma conversa para estes filtros.</div>';

    root.querySelectorAll('[data-hsc-conversation]').forEach(btn=>{
      btn.onclick=()=>selectConversation(btn.dataset.hscConversation);
    });
  }

  function timelineKind(item){
    const direction=String(item.direction||'').toLowerCase();
    if(direction==='inbound')return 'customer';
    const meta=item.metadata||{};
    const title=String(item.title||'').toLowerCase();
    if(meta.admin_user_id||title.includes('operador')||String(item.event_kind||'').includes('operator'))return 'human';
    if(direction==='outbound')return 'assistant';
    return 'system';
  }

  function renderTimeline(){
    const root=$('hscTimeline');
    if(!root)return;
    const rows=[...state.timeline].sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));
    root.innerHTML=rows.length?rows.map(item=>{
      const kind=timelineKind(item);
      const who=kind==='customer'?'Cliente':kind==='human'?'Operador':kind==='assistant'?'IA':roleLabel(item.direction);
      return `<article class="hsc-message ${kind}">
        <div class="hsc-message-meta"><strong>${esc(who)}</strong><span>${esc(channelLabel(item.channel))} · ${esc(fmt(item.occurred_at))}</span></div>
        <div class="hsc-message-body">${esc(item.body_text||item.title||'—')}</div>
      </article>`;
    }).join(''):'<div class="empty">Sem eventos na timeline.</div>';
    requestAnimationFrame(()=>{root.scrollTop=root.scrollHeight});
  }

  function renderHeader(){
    const root=$('hscChatHeader'),row=state.selected;
    if(!root)return;
    if(!row){root.innerHTML='<div><strong>Selecione uma conversa</strong><small>A timeline aparecerá aqui.</small></div>';return}
    const mine=row.claimed_by===state.user?.id;
    root.innerHTML=`
      <div>
        <strong>${esc(row.customer_name||'Cliente')}</strong>
        <small>${esc(channelLabel(row.channel))} · modo ${esc(conversationMode(row))} · prioridade ${esc(row.priority||0)}</small>
      </div>
      <div class="hsc-header-actions">
        ${row.handoff_status==='open'?'<button id="hscClaim" class="button primary small" type="button">Assumir</button>':''}
        ${row.handoff_status==='claimed'&&mine?'<button id="hscResolve" class="button secondary small" type="button">Resolver</button>':''}
      </div>`;
    if($('hscClaim'))$('hscClaim').onclick=claimSelected;
    if($('hscResolve'))$('hscResolve').onclick=resolveSelected;
  }

  function renderComposer(){
    const row=state.selected;
    const mine=row?.handoff_status==='claimed'&&row.claimed_by===state.user?.id&&row.mode==='human';
    const textarea=$('hscMessage'),send=$('hscSend'),hint=$('hscComposerHint');
    if(!textarea||!send||!hint)return;
    textarea.disabled=!mine;
    send.disabled=!mine;
    hint.textContent=!row?'Selecione uma conversa.':
      row.handoff_status==='open'?'Assuma o atendimento antes de responder.':
      row.claimed_by!==state.user?.id?'Atendimento assumido por outro operador.':
      row.mode!=='human'?'O backend não está em modo humano; envio bloqueado.':
      'Resposta humana explícita. Nenhum envio automático do copiloto.';
  }

  function renderCustomer(){
    const root=$('hscCustomer');
    if(!root)return;
    const c=state.customer;
    if(!c){root.innerHTML='<div class="empty">Cliente não vinculado ou CRM indisponível.</div>';return}
    root.innerHTML=`
      <dl class="hsc-kv">
        <div><dt>Nome</dt><dd>${esc(c.name||'—')}</dd></div>
        <div><dt>WhatsApp</dt><dd>${esc(c.primary_whatsapp_e164||'—')}</dd></div>
        <div><dt>Pedidos</dt><dd>${esc(c.order_count||0)}</dd></div>
        <div><dt>Última compra</dt><dd>${esc(fmt(c.last_order_at))}</dd></div>
        <div><dt>Aniversário</dt><dd>${c.birthday_day&&c.birthday_month?`${esc(c.birthday_day)}/${esc(c.birthday_month)}`:'—'}</dd></div>
      </dl>
      <small>${state.identities.length} identidade(s) de canal · ${state.consents.length} consentimento(s) registrado(s)</small>`;
  }

  function renderCopilot(){
    const root=$('hscCopilot');
    if(!root)return;
    if(!C.humanCopilotEnabled){
      root.innerHTML=`
        <div class="hsc-copilot-state safe">
          <strong>Copiloto dormente</strong>
          <p>A interface está preparada, mas nenhuma chamada de IA é feita e nenhuma sugestão é enviada ao cliente.</p>
          <ul>
            <li>Resumo curto da conversa</li>
            <li>Next Best Action</li>
            <li>Resposta editável</li>
          </ul>
        </div>`;
      return;
    }
    root.innerHTML=`
      <div class="hsc-copilot-state warning">
        <strong>Backend do copiloto ainda não liberado</strong>
        <p>O gate visual não é autorização de execução. A camada server-side precisa validar política, custo, contexto e handoff antes de qualquer chamada.</p>
      </div>`;
  }

  function renderRisks(){
    const root=$('hscRisks'),row=state.selected;
    if(!root)return;
    if(!row){root.innerHTML='<div class="empty">Selecione uma conversa.</div>';return}
    const risks=[];
    if(row.handoff_status==='open')risks.push('Atendimento ainda não foi assumido.');
    if(row.handoff_status==='claimed'&&row.claimed_by!==state.user?.id)risks.push('Ownership pertence a outro operador.');
    if(row.mode!=='human'&&row.handoff_status==='claimed')risks.push('Conversa assumida sem mode=human; backend deve bloquear resposta.');
    if(overdue(row))risks.push('SLA do handoff está vencido.');
    if(['instagram','messenger'].includes(row.channel))risks.push(`${channelLabel(row.channel)} permanece sem transporte humano real autorizado.`);
    root.innerHTML=risks.length?`<ul class="hsc-risk-list">${risks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<div class="hsc-ok">Sem alerta operacional adicional nesta conversa.</div>';
  }

  async function selectConversation(conversationId){
    const row=state.inbox.find(x=>x.conversation_id===conversationId);
    if(!row)return;
    state.selected=row;
    state.timeline=[];
    state.customer=null;
    state.identities=[];
    state.consents=[];
    renderInbox();renderHeader();renderComposer();renderCustomer();renderRisks();renderTimeline();
    $('hscTimeline').innerHTML='<div class="empty">Carregando histórico…</div>';

    try{
      const jobs=[api('timeline',{conversation_id:conversationId})];
      if(row.customer_id)jobs.push(api('customer_identity_summary',{customer_id:row.customer_id}));
      const data=await Promise.all(jobs);
      state.timeline=data[0]?.timeline||[];
      if(row.customer_id){
        state.customer=data[1]?.customer||null;
        state.identities=data[1]?.channel_identities||[];
        state.consents=data[1]?.consents||[];
      }
      renderTimeline();renderCustomer();renderRisks();
    }catch(e){
      $('hscTimeline').innerHTML=`<div class="empty">${esc(e.message)}</div>`;
      toast(e.message,'error');
    }
  }

  async function claimSelected(){
    const row=state.selected;
    if(!row?.handoff_id)return;
    try{
      await api('claim_handoff',{id:row.handoff_id});
      toast('Atendimento assumido. A IA não volta a responder automaticamente.','success');
      await loadInbox(true,row.conversation_id);
    }catch(e){toast(e.message,'error')}
  }

  async function resolveSelected(){
    const row=state.selected;
    if(!row?.handoff_id)return;
    const notes=window.prompt('Observação de resolução (opcional):','')||'';
    try{
      await api('resolve_handoff',{id:row.handoff_id,notes});
      toast('Handoff resolvido. A retomada da IA continua sendo ação separada e explícita.','success');
      state.selected=null;state.timeline=[];state.customer=null;
      await loadInbox(true);
    }catch(e){toast(e.message,'error')}
  }

  async function sendReply(event){
    event.preventDefault();
    const row=state.selected,message=$('hscMessage')?.value?.trim();
    if(!row||!message)return;
    const button=$('hscSend');
    button.disabled=true;
    try{
      const data=await api('operator_reply',{conversation_id:row.conversation_id,message});
      const dispatch=data.result?.dispatch||{};
      $('hscMessage').value='';
      if(dispatch.status==='dispatching')toast('Resposta humana enviada para entrega controlada.','success');
      else if(dispatch.skipped)toast(`Resposta registrada, mas não enviada: ${dispatch.skipped}.`,'warning');
      else toast('Resposta humana registrada.','success');
      await selectConversation(row.conversation_id);
      await loadInbox(false,row.conversation_id);
    }catch(e){toast(e.message,'error')}
    finally{renderComposer()}
  }

  async function loadInbox(selectFirst=false,preferredConversationId=null){
    if(state.loading)return;
    state.loading=true;
    try{
      const data=await api('dashboard');
      state.user=data.user||null;
      state.inbox=data.inbox||[];
      state.metrics=data.inbox_metrics||{};
      renderInbox();
      const preferred=preferredConversationId&&state.inbox.find(x=>x.conversation_id===preferredConversationId);
      const current=state.selected&&state.inbox.find(x=>x.conversation_id===state.selected.conversation_id);
      if(preferred)await selectConversation(preferred.conversation_id);
      else if(current){state.selected=current;renderHeader();renderComposer();renderRisks()}
      else if(selectFirst&&state.inbox[0])await selectConversation(state.inbox[0].conversation_id);
      else if(!state.inbox.length){
        state.selected=null;renderHeader();renderComposer();renderCustomer();renderRisks();renderTimeline();
      }
    }catch(e){toast(e.message,'error');if($('hscInbox'))$('hscInbox').innerHTML=`<div class="empty">${esc(e.message)}</div>`}
    finally{state.loading=false}
  }

  async function mount(root){
    if(state.mounted||!root)return;
    state.mounted=true;
    renderShell();
    renderCopilot();
    const legacy=$('waLegacyOpsGrid');
    if(legacy)legacy.classList.add('hidden');
    await loadInbox(true);
  }

  window.DAHumanServiceCenter=Object.freeze({mount});
})();
