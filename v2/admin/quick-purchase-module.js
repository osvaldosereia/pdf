import { loadCatalog, createProductIndex } from '../shared/catalog.js';
import { loadQuickPurchase } from '../shared/quick-purchase.js';
import { auditQuickPurchase, filterQuickSections } from './quick-purchase-audit.js';

const content=document.getElementById('admin-content');
const status=document.getElementById('admin-status');
const title=document.getElementById('module-title');
const subtitle=document.getElementById('module-subtitle');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]));
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const metric=(value,label)=>`<article class="metric"><strong>${value}</strong><span>${label}</span></article>`;
const moduleState={loaded:false,loading:false,config:null,productMap:new Map(),query:''};

function render(){
  const audit=auditQuickPurchase(moduleState.config,moduleState.productMap);
  const sections=filterQuickSections(audit.sections,moduleState.query);
  title.textContent='Compra rápida';
  subtitle.textContent='Estrutura, grupos e referências auditados sem edição ou publicação.';
  content.innerHTML=`<section class="module-hero"><span class="eyebrow">CONFIGURAÇÃO · SOMENTE LEITURA</span><h2>${escapeHtml(audit.config?.titulo||'Compra rápida')}</h2><p>${escapeHtml(audit.config?.subtitulo||'Auditoria da configuração atual.')}</p></section><section class="metrics">${metric(audit.sectionCount,'SEÇÕES')}${metric(audit.groups,'GRUPOS')}${metric(audit.references,'REFERÊNCIAS')}${metric(audit.coverage+'%','COBERTURA VÁLIDA')}</section><section class="panel"><div class="registration-toolbar"><input id="quick-admin-query" value="${escapeHtml(moduleState.query)}" placeholder="Buscar seção, grupo ou produto"><span class="score ${audit.valid?'ok':'warn'}">${audit.valid?'Configuração válida':'Requer atenção'}</span></div><div class="quick-admin-sections">${sections.map(section=>`<details ${sections.length===1?'open':''}><summary><strong>${escapeHtml(section.titulo)}</strong><span>${section.items.length} grupos</span></summary><div>${section.items.map(item=>`<article class="quick-admin-item ${item.valid?'':'invalid'}"><div><strong>${escapeHtml(item.titulo)}</strong><small>${escapeHtml(item.descricao||'Sem descrição')}</small></div><span>${item.products.length}/${item.productRefs.length} opções válidas</span><div class="quick-admin-products">${item.products.map(product=>`<span><strong>${escapeHtml(product.nome)}</strong><small>${money(product.preco)} · estoque ${Number(product.estoque)||0}</small></span>`).join('')||'<em>Nenhum produto disponível</em>'}</div>${item.unavailable.length?`<div class="notice error">Referências indisponíveis: ${item.unavailable.map(issue=>escapeHtml(issue.ref)).join(', ')}</div>`:''}</article>`).join('')}</div></details>`).join('')||'<div class="empty">Nenhuma seção encontrada.</div>'}</div></section>${audit.emptyItems.length?`<section class="panel"><div class="panel-head"><h3>Grupos sem opção válida</h3><span class="pill">${audit.emptyItems.length}</span></div><div class="audit-list">${audit.emptyItems.map(item=>`<div class="audit-row error"><strong>${escapeHtml(item.titulo)}</strong><span>${escapeHtml(item.sectionId)} / ${escapeHtml(item.itemId)}</span></div>`).join('')}</div></section>`:''}<div class="notice">Este módulo não permite alterar seções, selecionar produtos, salvar configuração ou publicar alterações.</div>`;
  document.getElementById('quick-admin-query')?.addEventListener('input',event=>{moduleState.query=event.target.value;render();document.getElementById('quick-admin-query')?.focus();});
}

async function openModule(){
  document.querySelectorAll('[data-module]').forEach(button=>button.classList.toggle('active',button.dataset.module==='quick-purchase'));
  if(moduleState.loaded){render();return;}
  if(moduleState.loading)return;
  moduleState.loading=true;
  title.textContent='Compra rápida';subtitle.textContent='Carregando configuração e catálogo seguro…';content.innerHTML='<div class="panel"><div class="empty">Auditando Compra rápida…</div></div>';
  try{
    const [catalog,config]=await Promise.all([loadCatalog(),loadQuickPurchase()]);
    moduleState.productMap=createProductIndex(catalog.products);moduleState.config=config;moduleState.loaded=true;
    status.textContent='Compra rápida auditada';status.dataset.type='success';render();
  }catch(error){status.textContent='Falha ao auditar Compra rápida';status.dataset.type='error';content.innerHTML=`<div class="panel"><div class="notice error">${escapeHtml(error.message||error)}</div></div>`;}
  finally{moduleState.loading=false;}
}

document.addEventListener('click',event=>{const button=event.target.closest('[data-module="quick-purchase"]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();openModule();},true);