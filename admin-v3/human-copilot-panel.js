(function(){
  'use strict';
  const C=window.DA_ADMIN_V3_CONFIG||{};
  if(!C.humanCopilotEnabled)return;
  const AUTH_KEY='da_admin_v3_auth';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[ch]));
  const state={conversationId:null,loading:false,last:null};
  function auth(){try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch{return null}}
  async function refreshToken(a){
    if(!a?.refresh_token)throw new Error('Sessão expirada.');
    const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:a.refresh_token})});
    const data=await r.json().catch(()=>({}));if(!r.ok||!data.access_token)throw new Error('Sessão expirada.');localStorage.setItem(AUTH_KEY,JSON.stringify(data));return data;
  }
  async function api(action,payload={},retry=true){
    let a=auth();if(!a?.access_token)throw new Error('Faça login.');
    const fn=C.humanCopilotEdgeFunction||'admin-human-copilot-v1';
    const r=await fetch(`${C.supabaseUrl}/functions/v1/${fn}`,{method:'POST',headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${a.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});
    const data=await r.json().catch(()=>({}));if(r.status===401&&retry){a=await refreshToken(a);return api(action,payload,false)}
    if(!r.ok||data.ok===false)throw new Error(data.detail||data.error||data.reason||`Erro ${r.status}`);return data;
  }
  function selectedConversation(){return document.querySelector('.hsc-conversation.selected')?.dataset?.hscConversation||null}
  function renderLoading(){const root=$('hscCopilot');if(root)root.innerHTML='<div class="hsc-copilot-state"><strong>Copiloto</strong><p>Montando contexto seguro…</p></div>'}
  function renderError(message){const root=$('hscCopilot');if(root)root.innerHTML=`<div class="hsc-copilot-state warning"><strong>Copiloto indisponível</strong><p>${esc(message)}</p><small>O operador continua com o atendimento humano normal.</small></div>`}
  function render(data){
    const root=$('hscCopilot');if(!root)return;
    const nba=data.next_best_action||{},provider=data.provider_generation||{},draft=data.deterministic_draft||'';
    const risks=Array.isArray(data?.context?.risks)?data.context.risks:[];
    root.innerHTML=`
      <div class="hsc-copilot-state ${provider.allowed?'safe':'warning'}">
        <strong>Copiloto em modo assistivo</strong>
        <p>${esc(data.summary||'Sem resumo disponível.')}</p>
        <div class="hsc-copilot-block"><small>Próxima melhor ação</small><b>${esc(nba.code||'—')}</b><span>${esc(nba.reason||'—')}</span></div>
        ${draft?`<div class="hsc-copilot-draft"><small>Sugestão determinística editável</small><p>${esc(draft)}</p><button id="hscUseDraft" class="button secondary small" type="button">Inserir no campo</button></div>`:''}
        <div class="hsc-copilot-block"><small>Geração por IA</small><span>${provider.allowed?'Permitida pela política, mas ainda exige execução server-side explícita.':`Bloqueada: ${esc(provider.reason||provider.decision||'policy')}`}</span></div>
        ${risks.length?`<div class="hsc-copilot-block"><small>Riscos</small><span>${esc(risks.join(', '))}</span></div>`:''}
        <div class="hsc-copilot-actions"><button id="hscCopilotRefresh" class="button secondary small" type="button">Atualizar</button><button id="hscCopilotMode" class="button secondary small" type="button">Ativar modo copiloto</button></div>
        <small>Nenhuma sugestão é enviada automaticamente.</small>
      </div>`;
    if($('hscUseDraft'))$('hscUseDraft').onclick=()=>{
      const input=$('hscMessage');if(!input||input.disabled)return;input.value=draft;input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));
    };
    $('hscCopilotRefresh').onclick=()=>load(true);
    $('hscCopilotMode').onclick=toggleMode;
  }
  async function load(force=false){
    const id=selectedConversation();
    if(!id){state.conversationId=null;const root=$('hscCopilot');if(root)root.innerHTML='<div class="empty">Selecione e assuma uma conversa para usar o copiloto.</div>';return}
    if(state.loading||(!force&&state.conversationId===id))return;
    state.loading=true;state.conversationId=id;renderLoading();
    try{const data=await api('context_plan',{conversation_id:id});state.last=data;render(data)}catch(e){renderError(e.message)}finally{state.loading=false}
  }
  async function toggleMode(){
    if(!state.conversationId)return;
    try{await api('set_mode',{conversation_id:state.conversationId,enabled:true});await load(true)}catch(e){renderError(e.message)}
  }
  function observe(){
    const inbox=$('hscInbox');if(!inbox){setTimeout(observe,300);return}
    new MutationObserver(()=>load(false)).observe(inbox,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});
    load(false);
  }
  observe();
})();
