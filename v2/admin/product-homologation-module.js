import { readProductDrafts } from './product-editor.js';
import {
  HUMAN_CONFIRMATIONS,
  HOMOLOGATION_STATUS,
  resolveSavedDraftProduct,
  evaluateProductHomologation,
  saveProductHomologation,
  approveProductHomologation,
  rejectProductHomologation,
  buildHomologationEnvelope,
  readProductHomologations,
  findSavedDraft
} from '../services/product-homologation-service.js';

const content = document.getElementById('admin-content');
const status = document.getElementById('admin-status');
const title = document.getElementById('module-title');
const subtitle = document.getElementById('module-subtitle');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));
const state = { records: [], selectedDraft: null, selectedRecord: null };

function statusLabel(value) {
  if (value === HOMOLOGATION_STATUS.APPROVED) return 'Aprovado para homologação';
  if (value === HOMOLOGATION_STATUS.READY) return 'Pronto para aprovação';
  if (value === HOMOLOGATION_STATUS.REJECTED) return 'Reprovado';
  return 'Revisão pendente';
}

function statusClass(value) {
  if (value === HOMOLOGATION_STATUS.APPROVED || value === HOMOLOGATION_STATUS.READY) return 'ok';
  if (value === HOMOLOGATION_STATUS.REJECTED) return 'error';
  return 'warn';
}

function draftEntries() {
  return Object.values(readProductDrafts()).sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
}

function renderList() {
  const drafts = draftEntries();
  state.records = [...readProductHomologations()];
  state.selectedDraft = null;
  state.selectedRecord = null;
  title.textContent = 'Homologação de produtos';
  subtitle.textContent = 'Checklist final antes de qualquer futura publicação.';
  const cards = drafts.map(saved => {
    const product = resolveSavedDraftProduct(saved);
    const record = state.records.find(item => item.productId === saved.id);
    const evaluation = record?.evaluation || evaluateProductHomologation(product, record?.confirmations || {});
    const displayStatus = record?.status || evaluation.status;
    return `<button class="homologation-card" type="button" data-homologation-open="${escapeHtml(saved.id)}"><span><strong>${escapeHtml(product.nome || product.gtin || 'Produto sem nome')}</strong><small>EAN ${escapeHtml(product.gtin || '—')} · salvo ${escapeHtml(saved.savedAt ? new Date(saved.savedAt).toLocaleString('pt-BR') : 'sem data')}</small></span><span class="homologation-card-status"><b class="score ${statusClass(displayStatus)}">${escapeHtml(statusLabel(displayStatus))}</b><small>${evaluation.automaticPassed}/${evaluation.automaticTotal} automáticos · ${evaluation.humanPassed}/${evaluation.humanTotal} humanos</small></span></button>`;
  }).join('');
  content.innerHTML = `<section class="module-hero"><div><span class="eyebrow">HOMOLOGAÇÃO · SEM PUBLICAÇÃO</span><h2>Rascunhos aguardando revisão final</h2><p>Esta etapa consolida os dados, registra confirmações humanas e impede publicação enquanto existir qualquer pendência.</p></div></section><section class="panel"><div class="panel-head"><h3>Rascunhos locais</h3><span class="pill">${drafts.length} encontrados</span></div><div class="homologation-list">${cards || '<div class="empty">Nenhum rascunho local disponível para homologação.</div>'}</div><div class="notice">Aprovar nesta tela não grava no Firebase e não publica imagens. Apenas muda o estado local para “aprovado para homologação”.</div></section>`;
  status.textContent = `${drafts.length} rascunhos locais`;
  status.dataset.type = drafts.length ? 'success' : '';
}

function renderReview(savedDraft, record = null) {
  state.selectedDraft = savedDraft;
  state.selectedRecord = record;
  const product = resolveSavedDraftProduct(savedDraft);
  const confirmations = record?.confirmations || {};
  const evaluation = evaluateProductHomologation(product, confirmations);
  const currentStatus = record?.status || evaluation.status;
  title.textContent = 'Ficha de homologação';
  subtitle.textContent = 'Revise o produto e registre as confirmações obrigatórias.';

  const automaticHtml = evaluation.automatic.map(check => `<article class="homologation-check ${check.ok ? 'ok' : 'error'}"><span>${check.ok ? '✓' : '!'}</span><div><strong>${escapeHtml(check.label)}</strong><small>${escapeHtml(check.detail)}</small></div></article>`).join('');
  const confirmationsHtml = HUMAN_CONFIRMATIONS.map(item => `<label class="homologation-confirmation"><input type="checkbox" name="confirmation" value="${escapeHtml(item.id)}" ${confirmations[item.id] ? 'checked' : ''}><span>${escapeHtml(item.label)}</span></label>`).join('');
  const historyHtml = (record?.history || []).slice(0, 10).map(item => `<article><span>${escapeHtml(item.action || 'alteração')}</span><small>${escapeHtml(item.at ? new Date(item.at).toLocaleString('pt-BR') : '')}${item.reason ? ` · ${escapeHtml(item.reason)}` : ''}</small></article>`).join('');

  let approvedEnvelope = '';
  if (currentStatus === HOMOLOGATION_STATUS.APPROVED && record) {
    try {
      const envelope = buildHomologationEnvelope(record);
      approvedEnvelope = `<div class="notice success"><strong>Ficha aprovada para homologação.</strong><br>Envelope local ${escapeHtml(envelope.recordId)} criado com publicação externa bloqueada.</div>`;
    } catch {
      approvedEnvelope = '';
    }
  }

  content.innerHTML = `<section class="panel"><button class="back-button" type="button" data-homologation-back>← Voltar à fila</button><div class="panel-head"><div><span class="eyebrow">FICHA DE HOMOLOGAÇÃO</span><h2>${escapeHtml(product.nome || product.gtin || 'Produto')}</h2></div><span class="score ${statusClass(currentStatus)}">${escapeHtml(statusLabel(currentStatus))}</span></div><div class="editor-summary-grid"><article><span>EAN</span><strong>${escapeHtml(product.gtin || '—')}</strong></article><article><span>NCM</span><strong>${escapeHtml(product.ncm || '—')}</strong></article><article><span>Categoria</span><strong>${escapeHtml(product.categoria || '—')}</strong></article><article><span>Preço</span><strong>${Number(product.preco || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong></article></div><div class="homologation-progress"><article><strong>${evaluation.automaticPassed}/${evaluation.automaticTotal}</strong><span>verificações automáticas aprovadas</span></article><article><strong>${evaluation.humanPassed}/${evaluation.humanTotal}</strong><span>confirmações humanas registradas</span></article></div>${approvedEnvelope}<form id="homologation-review-form"><section class="panel"><div class="panel-head"><h3>Verificações automáticas</h3><span class="pill">${evaluation.blockingIssues.length} bloqueios</span></div><div class="homologation-checks">${automaticHtml}</div></section><section class="panel"><div class="panel-head"><h3>Confirmações humanas</h3><span class="pill">Obrigatórias</span></div><div class="homologation-confirmations">${confirmationsHtml}</div></section><div class="editor-actions"><button class="primary-action" type="submit">Salvar revisão</button>${record && evaluation.ready && currentStatus !== HOMOLOGATION_STATUS.APPROVED ? `<button class="secondary-action" type="button" data-homologation-approve="${escapeHtml(record.id)}">Aprovar para homologação</button>` : ''}</div></form>${record ? `<div class="homologation-rejection"><textarea id="homologation-rejection-reason" placeholder="Motivo da reprovação ou devolução para correção"></textarea><button class="danger-action" type="button" data-homologation-reject="${escapeHtml(record.id)}">Reprovar ficha</button></div>` : ''}${historyHtml ? `<section class="panel"><div class="panel-head"><h3>Histórico local</h3></div><div class="homologation-history">${historyHtml}</div></section>` : ''}<div class="notice">Nenhuma ação desta tela grava no Firebase, GitHub, Make ou Bling.</div></section>`;
  status.textContent = statusLabel(currentStatus);
  status.dataset.type = currentStatus === HOMOLOGATION_STATUS.APPROVED ? 'success' : currentStatus === HOMOLOGATION_STATUS.REJECTED ? 'error' : '';
}

function openReview(productId) {
  const saved = findSavedDraft(productId);
  if (!saved) throw new Error('Rascunho local não encontrado.');
  state.records = [...readProductHomologations()];
  renderReview(saved, state.records.find(item => item.productId === saved.id) || null);
}

function collectConfirmations(form) {
  const selected = new Set(new FormData(form).getAll('confirmation'));
  return Object.fromEntries(HUMAN_CONFIRMATIONS.map(item => [item.id, selected.has(item.id)]));
}

document.addEventListener('v2:open-product-homologation', event => {
  try {
    document.querySelectorAll('[data-module]').forEach(button => button.classList.toggle('active', button.dataset.module === 'product-homologation'));
    openReview(event.detail?.productId);
  } catch (error) {
    status.textContent = 'Falha na homologação';
    status.dataset.type = 'error';
    content.innerHTML = `<div class="notice error">${escapeHtml(error.message || error)}</div>`;
  }
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'homologation-review-form') return;
  event.preventDefault();
  try {
    const record = saveProductHomologation(state.selectedDraft, collectConfirmations(event.target));
    state.selectedRecord = record;
    status.textContent = 'Revisão local salva';
    status.dataset.type = 'success';
    renderReview(state.selectedDraft, record);
  } catch (error) {
    status.textContent = 'Falha ao salvar revisão';
    status.dataset.type = 'error';
    content.insertAdjacentHTML('afterbegin', `<div class="notice error">${escapeHtml(error.message || error)}</div>`);
  }
});

document.addEventListener('click', event => {
  const moduleButton = event.target.closest('[data-module="product-homologation"]');
  if (moduleButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    document.querySelectorAll('[data-module]').forEach(button => button.classList.toggle('active', button === moduleButton));
    renderList();
    return;
  }
  const openButton = event.target.closest('[data-homologation-open]');
  if (openButton) {
    try { openReview(openButton.dataset.homologationOpen); }
    catch (error) { content.innerHTML = `<div class="notice error">${escapeHtml(error.message || error)}</div>`; }
    return;
  }
  if (event.target.closest('[data-homologation-back]')) { renderList(); return; }
  const approveButton = event.target.closest('[data-homologation-approve]');
  if (approveButton) {
    try {
      const approved = approveProductHomologation(approveButton.dataset.homologationApprove);
      state.selectedRecord = approved;
      status.textContent = 'Aprovado para homologação';
      status.dataset.type = 'success';
      renderReview(state.selectedDraft, approved);
    } catch (error) {
      content.insertAdjacentHTML('afterbegin', `<div class="notice error">${escapeHtml(error.message || error)}</div>`);
    }
    return;
  }
  const rejectButton = event.target.closest('[data-homologation-reject]');
  if (rejectButton) {
    try {
      const rejected = rejectProductHomologation(rejectButton.dataset.homologationReject, document.getElementById('homologation-rejection-reason')?.value);
      state.selectedRecord = rejected;
      status.textContent = 'Ficha reprovada';
      status.dataset.type = 'error';
      renderReview(state.selectedDraft, rejected);
    } catch (error) {
      content.insertAdjacentHTML('afterbegin', `<div class="notice error">${escapeHtml(error.message || error)}</div>`);
    }
  }
}, true);
