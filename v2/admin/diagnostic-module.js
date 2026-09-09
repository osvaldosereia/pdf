import { loadCatalogFromFirebase } from '../services/catalog-service.js';
import { loadHomeCollections } from '../shared/collections.js';
import { loadOrders } from '../shared/orders.js';
import { buildDiagnosticSummary, diagnosticRecommendations } from './diagnostic-audit.js';

const content=document.getElementById('admin-content');
const status=document.getElementById('admin-status');
const title=document.getElementById('module-title');
const subtitle=document.getElementById('module-subtitle');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const metric=(value,label)=>`<article class="metric"><strong>${value}</strong><span>${label}</span></article>`;
const state={loading:false,loaded:false,summary:null,generatedAt:''};

function localIntegrationResults(){try{return JSON.parse(localStorage.getItem('da_v2:integration-results')||'[]');}catch{return [];}}
function localPublicationPlan(){try{const rows=JSON.parse(localStorage.getItem('da_v2:publication-plans')||'[]');return rows[0]||null;}catch{return null;}}
function statusLabel(value){return value==='ready'?'Pronto para revisão':value==='attention'?'Exige atenção':'Bloqueado';}
function percentage(value){return `${Number(value||0).toFixed(1)}%`;}

function render(){
  const summary=state.summary;
  const quality=summary.catalogQuality||{};
  const metrics=summary.catalogMetrics||{};
  const recommendations=diagnosticRecommendations(summary);
  title.textContent='Diagnóstico geral';
  subtitle.textContent='Dados reais do Firebase, catálogo, coleções e pedidos em modo somente leitura.';
  content.innerHTML=`
    <section class="module-hero diagnostic-hero">
      <div><span class="eyebrow">CONSOLIDAÇÃO · SOMENTE LEITURA</span><h2>Saúde geral da V2</h2><p>O painel lê os dados reais, mede desempenho e aponta falhas cadastrais. Nenhuma correção é executada automaticamente.</p></div>
      <div class="diagnostic-score ${summary.status}"><strong>${summary.score}%</strong><span>${statusLabel(summary.status)}</span></div>
    </section>
    <section class="metrics">
      ${metric(quality.total??0,'PRODUTOS ANALISADOS')}
      ${metric(quality.withStock??0,'COM ESTOQUE')}
      ${metric(quality.withoutImage??0,'SEM IMAGEM')}
      ${metric(quality.withoutPrice??0,'SEM PREÇO')}
      ${metric(quality.withoutCategory??0,'SEM CATEGORIA')}
      ${metric(`${metrics.totalMs??0} ms`,'TEMPO TOTAL')}
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Completude cadastral</h3><span class="pill">Firebase ${metrics.firebaseMs??0} ms</span></div>
      <div class="diagnostic-checks">
        <article class="diagnostic-check ${(quality.completeness?.image??0)>=95?'ok':'error'}"><span>${(quality.completeness?.image??0)>=95?'✓':'!'}</span><div><strong>Imagens</strong><small>${percentage(quality.completeness?.image)} completos</small></div></article>
        <article class="diagnostic-check ${(quality.completeness?.price??0)>=99?'ok':'error'}"><span>${(quality.completeness?.price??0)>=99?'✓':'!'}</span><div><strong>Preços</strong><small>${percentage(quality.completeness?.price)} completos</small></div></article>
        <article class="diagnostic-check ${(quality.completeness?.category??0)>=95?'ok':'error'}"><span>${(quality.completeness?.category??0)>=95?'✓':'!'}</span><div><strong>Categorias</strong><small>${percentage(quality.completeness?.category)} completos</small></div></article>
        <article class="diagnostic-check ${(quality.completeness?.gtin??0)>=95?'ok':'error'}"><span>${(quality.completeness?.gtin??0)>=95?'✓':'!'}</span><div><strong>EAN/GTIN</strong><small>${percentage(quality.completeness?.gtin)} completos</small></div></article>
        <article class="diagnostic-check ${(quality.completeness?.brand??0)>=80?'ok':'error'}"><span>${(quality.completeness?.brand??0)>=80?'✓':'!'}</span><div><strong>Marcas</strong><small>${percentage(quality.completeness?.brand)} completos</small></div></article>
        <article class="diagnostic-check ${(quality.completeness?.packaging??0)>=80?'ok':'error'}"><span>${(quality.completeness?.packaging??0)>=80?'✓':'!'}</span><div><strong>Embalagens</strong><small>${percentage(quality.completeness?.packaging)} completos</small></div></article>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Verificações consolidadas</h3><span class="pill">Atualizado ${escapeHtml(state.generatedAt)}</span></div>
      <div class="diagnostic-checks">${summary.checks.map(check=>`<article class="diagnostic-check ${check.ok?'ok':'error'}"><span>${check.ok?'✓':'!'}</span><div><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></div></article>`).join('')}</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Duplicidades encontradas</h3><span class="pill">Somente auditoria</span></div>
      <div class="notice ${quality.duplicateIds?.length||quality.duplicateGtins?.length?'error':'success'}">IDs duplicados: ${quality.duplicateIds?.length||0} · EANs duplicados: ${quality.duplicateGtins?.length||0}</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h3>Próximas correções recomendadas</h3><span class="pill">Sem automação</span></div>
      ${recommendations.length?`<div class="recommendation-list">${recommendations.map(item=>`<article><strong>${escapeHtml(item.text)}</strong><span>Abra o módulo correspondente para analisar os registros.</span></article>`).join('')}</div>`:'<div class="notice success">Todas as verificações consolidadas foram aprovadas. Ainda é necessária revisão humana antes de qualquer escrita ou publicação.</div>'}
      <div class="notice">Este diagnóstico não salva produtos, não altera pedidos, não chama Make/Bling e não publica arquivos.</div>
    </section>`;
}

async function openModule(){
  document.querySelectorAll('[data-module]').forEach(button=>button.classList.toggle('active',button.dataset.module==='diagnostics'));
  if(state.loading)return;
  state.loading=true;
  title.textContent='Diagnóstico geral';
  subtitle.textContent='Lendo o catálogo real e reunindo auditorias seguras…';
  content.innerHTML='<div class="panel"><div class="empty">Carregando diagnóstico consolidado…</div></div>';
  try{
    const [catalog,collections,orders]=await Promise.all([
      loadCatalogFromFirebase(),
      loadHomeCollections(),
      loadOrders().catch(()=>[])
    ]);
    state.summary=buildDiagnosticSummary({products:catalog.products,catalogQuality:catalog.quality,catalogMetrics:catalog.metrics,baskets:collections.baskets,kits:collections.kits,orders,integrationResults:localIntegrationResults(),publicationPlan:localPublicationPlan()});
    state.generatedAt=new Date().toLocaleString('pt-BR');
    state.loaded=true;
    status.textContent=`Diagnóstico ${state.summary.score}% · ${catalog.metrics.totalMs} ms`;
    status.dataset.type=state.summary.status==='ready'?'success':'error';
    render();
  }catch(error){
    status.textContent='Falha no diagnóstico';
    status.dataset.type='error';
    content.innerHTML=`<div class="panel"><div class="notice error">${escapeHtml(error.message||error)}</div></div>`;
  }finally{state.loading=false;}
}

document.addEventListener('click',event=>{const button=event.target.closest('[data-module="diagnostics"]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();openModule();},true);
