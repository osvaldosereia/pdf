import { buildPublicationPlan, publicationChecklist, rollbackPlan, summarizePublicationHistory } from './publication-audit.js';

const content=document.getElementById('admin-content');
const status=document.getElementById('admin-status');
const title=document.getElementById('module-title');
const subtitle=document.getElementById('module-subtitle');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const metric=(value,label)=>`<article class="metric"><strong>${value}</strong><span>${label}</span></article>`;
const storageKey='da_v2:publication-history';
const files=[
  {path:'v2/site/index.html',type:'add',risk:'medium',reason:'Nova entrada do site V2'},
  {path:'v2/site/app.js',type:'add',risk:'medium',reason:'Aplicação do catálogo V2'},
  {path:'v2/checkout/index.html',type:'add',risk:'high',reason:'Novo checkout em homologação'},
  {path:'v2/admin/index.html',type:'add',risk:'medium',reason:'Novo admin modular'},
  {path:'v2/shared/',type:'add',risk:'high',reason:'Contratos centrais de catálogo, carrinho e pedido'}
];

function readHistory(){try{return JSON.parse(localStorage.getItem(storageKey)||'[]')}catch{return[];}}
function saveHistory(entries){localStorage.setItem(storageKey,JSON.stringify(entries.slice(0,20)));}
function currentChecks(){return publicationChecklist({tests:false,mobile:false,integrations:true,backup:false,review:false,noProductionWrites:true});}
function render(){
  title.textContent='Publicação';subtitle.textContent='Comparação, checklist e rollback planejado sem alterar produção.';
  const plan=buildPublicationPlan({files,checks:currentChecks()});const history=summarizePublicationHistory(readHistory());const rollback=rollbackPlan(plan);
  content.innerHTML=`<section class="module-hero"><span class="eyebrow">PUBLICAÇÃO CONTROLADA · SOMENTE PLANEJAMENTO</span><h2>Plano de publicação da V2</h2><p>Esta tela organiza o que seria publicado, quais validações faltam e como o rollback seria executado. Nenhum commit, merge ou upload é disparado.</p></section><section class="metrics">${metric(plan.files.length,'GRUPOS DE ARQUIVOS')}${metric(plan.blocking.length,'BLOQUEIOS')}${metric(plan.sensitive.length,'ALTO RISCO')}${metric(history.total,'PLANOS LOCAIS')}</section><section class="panel"><div class="panel-head"><h3>Checklist obrigatório</h3><span class="score ${plan.ready?'ok':'warn'}">${plan.ready?'Pronto':'Bloqueado'}</span></div><div class="publication-checks">${plan.checks.map(check=>`<article class="${check.passed?'ok':'blocked'}"><strong>${check.passed?'✓':'!' } ${escapeHtml(check.label)}</strong><span>${check.required?'Obrigatório':'Recomendado'}</span></article>`).join('')}</div></section><section class="panel"><div class="panel-head"><h3>Escopo planejado</h3><span class="pill">${escapeHtml(plan.sourceBranch)} → ${escapeHtml(plan.targetBranch)}</span></div><div class="publication-files">${plan.files.map(file=>`<article><span><strong>${escapeHtml(file.path)}</strong><small>${escapeHtml(file.reason)}</small></span><b class="risk-${escapeHtml(file.risk)}">${escapeHtml(file.risk)}</b></article>`).join('')}</div><div class="notice">O escopo permanece limitado à pasta <strong>v2/</strong>. Arquivos atuais da raiz e de <strong>producao/</strong> não fazem parte deste plano.</div></section><section class="panel"><div class="panel-head"><h3>Rollback planejado</h3><span class="pill">Manual e aprovado</span></div><p class="publication-copy">Referência: <strong>${escapeHtml(rollback.reference)}</strong>. ${rollback.actions.length} grupos seriam restaurados para a versão anterior. O rollback automático permanece desabilitado.</p></section><section class="panel"><div class="panel-head"><h3>Histórico local</h3><button class="publication-button" type="button" data-save-publication-plan>Registrar plano local</button></div><div class="publication-history">${history.rows.map(row=>`<article><strong>${escapeHtml(row.createdAt||row.id)}</strong><span>${row.files} arquivos · ${escapeHtml(row.status)}</span></article>`).join('')||'<div class="empty">Nenhum plano local registrado.</div>'}</div></section>`;
  status.textContent=plan.ready?'Plano aprovado para revisão':'Publicação bloqueada por checklist';status.dataset.type=plan.ready?'success':'error';
}
function openModule(){document.querySelectorAll('[data-module]').forEach(button=>button.classList.toggle('active',button.dataset.module==='publishing'));render();}
document.addEventListener('click',event=>{const moduleButton=event.target.closest('[data-module="publishing"]');if(moduleButton){event.preventDefault();event.stopImmediatePropagation();openModule();return;}if(event.target.closest('[data-save-publication-plan]')){const entries=readHistory();entries.unshift({id:`plan-${Date.now()}`,createdAt:new Date().toISOString(),status:'planned',files:files.length,reference:'rebuild-v2'});saveHistory(entries);render();}},true);
