(()=>{
  'use strict';
  const C=window.DA_ADMIN_V3_CONFIG||{},AUTH_KEY='da_admin_v3_auth';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const clean=v=>String(v??'').replace(/\r/g,'').trim();
  const slug=v=>clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60)||'item';
  const toast=(m,k='')=>{const h=$('toastRegion');if(!h)return;const n=document.createElement('div');n.className=`toast ${k}`.trim();n.textContent=m;h.appendChild(n);setTimeout(()=>n.remove(),k==='error'?6000:3000)};
  const loadAuth=()=>{try{return JSON.parse(localStorage.getItem(AUTH_KEY)||'null')}catch{return null}};
  const saveAuth=a=>localStorage.setItem(AUTH_KEY,JSON.stringify(a));
  async function refreshAuth(auth){const r=await fetch(`${C.supabaseUrl}/auth/v1/token?grant_type=refresh_token`,{method:'POST',headers:{apikey:C.supabasePublishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:auth?.refresh_token})});const d=await r.json().catch(()=>({}));if(!r.ok||!d.access_token)throw new Error('Sessão expirada.');saveAuth(d);return d}
  async function api(action,payload={},retry=true){let auth=loadAuth();if(!auth?.access_token)throw new Error('Faça login no Admin principal.');const r=await fetch(`${C.supabaseUrl}/functions/v1/admin-service-intelligence-v1`,{method:'POST',headers:{apikey:C.supabasePublishableKey,Authorization:`Bearer ${auth.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...payload})});const d=await r.json().catch(()=>({}));if(r.status===401&&retry){auth=await refreshAuth(auth);return api(action,payload,false)}if(!r.ok||d.ok===false)throw new Error(d.detail||d.error||`Erro ${r.status}`);return d}

  let type='knowledge',items=[],selected=null,dashboard=null;
  const names={knowledge:'O que a IA deve saber',guidance:'Como a IA deve atender',procedure:'Regras importantes'};
  const singular={knowledge:'informação',guidance:'orientação',procedure:'regra'};
  const statusLabel=s=>s==='published'?'Publicado':s==='archived'?'Arquivado':'Rascunho';
  const keyOf=x=>x?.knowledge_key||x?.rule_key||x?.procedure_key||'';
  const field=(label,name,value='',kind='input',help='')=>`<label>${esc(label)}${kind==='textarea'?`<textarea name="${name}">${esc(value)}</textarea>`:`<input name="${name}" value="${esc(value)}">`}${help?`<small class="si-help">${esc(help)}</small>`:''}</label>`;

  function formHtml(t,x={}){
    if(t==='knowledge'){
      const cat=x.category||'geral';
      return `<label>Assunto<select name="category"><option value="geral" ${cat==='geral'?'selected':''}>Geral</option><option value="empresa" ${cat==='empresa'?'selected':''}>Empresa</option><option value="cestas" ${cat==='cestas'?'selected':''}>Cestas</option><option value="entrega" ${cat==='entrega'?'selected':''}>Entrega</option><option value="pagamento" ${cat==='pagamento'?'selected':''}>Pagamento</option><option value="trocas" ${cat==='trocas'?'selected':''}>Trocas e substituições</option><option value="atendimento" ${cat==='atendimento'?'selected':''}>Atendimento</option></select></label>`+
        field('Título','title',x.title||'')+
        field('O que a IA precisa saber','content',x.content||'','textarea','Escreva como você explicaria isso para um funcionário novo.');
    }
    if(t==='guidance')return field('Título','title',x.title||'')+field('Como a IA deve agir','instruction',x.instruction||'','textarea','Exemplo: quando o cliente perguntar preço de cesta, mostrar as opções direto, sem perguntar se ele quer ver.');
    return field('Título','title',x.title||'')+
      field('Quando essa regra se aplica','trigger_description',x.trigger_description||'','textarea','Exemplo: quando o cliente pedir para trocar um produto da cesta.')+
      field('O que a IA deve fazer','steps',(x.steps||[]).join('\n'),'textarea','Escreva uma orientação por linha, em ordem.');
  }

  function renderEditor(){const x=selected||{};$('siEditorTitle').textContent=`${selected?'Editar':'Nova'} ${singular[type]}`;$('siStatus').textContent=statusLabel(x.status||'draft');$('siForm').innerHTML=formHtml(type,x);$('siPublish').disabled=!selected?.id||selected?.status==='published';$('siArchive').disabled=!selected?.id||selected?.status==='archived'}
  function renderList(){const host=$('siList');host.innerHTML=items.length?items.map(x=>`<div class="si-item ${selected?.id===x.id?'active':''}" data-id="${esc(x.id)}"><div class="si-item-row"><strong>${esc(x.title||'Sem título')}</strong><span class="badge">${esc(statusLabel(x.status))}</span></div><small>${type==='knowledge'?esc(x.category||'geral'):type==='procedure'?esc(x.trigger_description||'Regra de atendimento'):'Orientação de atendimento'}</small></div>`).join(''):'<div class="empty">Nada cadastrado aqui ainda.</div>'}
  function renderMetrics(){const c=dashboard?.counts||{};$('siMetrics').innerHTML=[['Produtos disponíveis',c.sellable_products||0],['Informações',c.knowledge||0],['Orientações',c.guidance||0],['Regras',c.procedures||0]].map(([a,b])=>`<div class="metric"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('')}

  async function loadDashboard(){dashboard=await api('dashboard');renderMetrics()}
  async function loadList(){const d=await api('list',{type,q:$('siSearch')?.value||''});items=d.items||[];if(selected)selected=items.find(x=>x.id===selected.id)||selected;renderList();renderEditor()}

  function makeKey(prefix,title,current){return current||`${prefix}_${slug(title)}_${Date.now().toString(36)}`}
  function payload(){const f=new FormData($('siForm')),o=Object.fromEntries(f.entries());o.type=type;if(selected?.id)o.id=selected.id;o.priority=90;
    if(type==='knowledge')Object.assign(o,{knowledge_key:makeKey('info',o.title,selected?.knowledge_key),keywords:[],channel_scope:['whatsapp'],source_note:'Admin simples do atendimento'});
    if(type==='guidance')Object.assign(o,{rule_key:makeKey('orientacao',o.title,selected?.rule_key),intent_scope:[],stage_scope:[],behavior_tags:['mvp_whatsapp'],channel_scope:['whatsapp']});
    if(type==='procedure')Object.assign(o,{procedure_key:makeKey('regra',o.title,selected?.procedure_key),trigger_description:clean(o.trigger_description)||clean(o.title),steps:clean(o.steps).split('\n').map(x=>x.trim()).filter(Boolean),allowed_actions:[],confirmation_actions:[],fallback:null});
    return o;
  }

  async function save(){try{const p=payload();if(!clean(p.title))throw new Error('Informe um título.');if(type==='knowledge'&&!clean(p.content))throw new Error('Escreva o que a IA precisa saber.');if(type==='guidance'&&!clean(p.instruction))throw new Error('Escreva como a IA deve atender.');if(type==='procedure'&&!p.steps.length)throw new Error('Escreva o que a IA deve fazer.');const d=await api('save',p);selected=d.item;toast('Salvo.','success');await loadList();await loadDashboard()}catch(e){toast(e.message,'error')}}
  async function setStatus(status){if(!selected?.id)return toast('Salve primeiro.','error');try{const d=await api('set_status',{type,id:selected.id,status});selected=d.item;toast(status==='published'?'Publicado para a IA.':'Arquivado.','success');await loadList();await loadDashboard()}catch(e){toast(e.message,'error')}}

  async function init(){if(!loadAuth()?.access_token){$('siAuthWarning').classList.remove('hidden');return}try{await loadDashboard();await loadList()}catch(e){$('siAuthWarning').classList.remove('hidden');$('siAuthWarning').textContent=e.message}}
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',async()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.remove('active'));b.classList.add('active');type=b.dataset.tab;selected=null;$('siListTitle').textContent=names[type];await loadList()}));
  $('siList').addEventListener('click',e=>{const n=e.target.closest('[data-id]');if(!n)return;selected=items.find(x=>x.id===n.dataset.id)||null;renderList();renderEditor()});
  $('siNew').addEventListener('click',()=>{selected=null;renderList();renderEditor()});
  $('siSave').addEventListener('click',save);
  $('siPublish').addEventListener('click',()=>setStatus('published'));
  $('siArchive').addEventListener('click',()=>setStatus('archived'));
  $('siRefresh').addEventListener('click',async()=>{await loadDashboard();await loadList()});
  let timer;$('siSearch').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(loadList,220)});
  init();
})();