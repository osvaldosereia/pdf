import { readPreparedProductAiRequests } from '../services/product-ai-request.js';
import {
  parseProductAiResponse,
  buildProductDraftFromAi,
  storeProductAiResult
} from '../services/product-ai-response.js';
import { createNewProductSeed } from '../services/ean-service.js';

const content = document.getElementById('admin-content');
const status = document.getElementById('admin-status');
const title = document.getElementById('module-title');
const subtitle = document.getElementById('module-subtitle');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const state = { requests: [], selected: null, result: null };

function decisionLabel(decision) {
  if (decision === 'suggested') return 'Alta confiança';
  if (decision === 'review') return 'Revisar';
  if (decision === 'blocked') return 'Bloqueado';
  return 'Baixa confiança';
}

function decisionClass(decision) {
  if (decision === 'suggested') return 'ok';
  if (decision === 'review') return 'warn';
  return 'error';
}

function requestCard(request) {
  const photos = Array.isArray(request.photoSlots) ? request.photoSlots.length : 0;
  const createdAt = request.createdAt ? new Date(request.createdAt).toLocaleString('pt-BR') : 'Data indisponível';
  return `<button class="ai-request-card" type="button" data-ai-request-open="${escapeHtml(request.id)}"><span><strong>EAN ${escapeHtml(request.ean)}</strong><small>${escapeHtml(createdAt)}</small></span><span><b>${photos}</b><small>fotos</small></span></button>`;
}

function renderList() {
  state.requests = [...readPreparedProductAiRequests()];
  state.selected = null;
  state.result = null;
  title.textContent = 'Revisão da IA';
  subtitle.textContent = 'Valide manualmente as informações extraídas antes de abrir um rascunho.';
  content.innerHTML = `<section class="module-hero"><div><span class="eyebrow">IA · REVISÃO HUMANA OBRIGATÓRIA</span><h2>Cadastros preparados para análise</h2><p>Nenhuma sugestão da IA é aplicada diretamente. Escolha uma captura e cole a resposta do cenário do Make para revisar campo por campo.</p></div></section><section class="panel"><div class="panel-head"><h3>Pacotes locais</h3><span class="pill">${state.requests.length} pendentes</span></div>${state.requests.length ? `<div class="ai-request-list">${state.requests.map(requestCard).join('')}</div>` : '<div class="empty">Ainda não existem pacotes preparados. Leia um EAN não cadastrado e tire as fotos do produto.</div>'}<div class="notice">Esta área não chama o Make e não grava no Firebase. Ela apenas valida respostas copiadas manualmente durante a homologação.</div></section>`;
}

function responseExample(request) {
  return JSON.stringify({
    requestId: request.id,
    ean: request.ean,
    fields: {
      nome: { value: 'Nome identificado', confidence: 0.96, source: 'foto_frente' },
      descricao: { value: 'Descrição objetiva do produto', confidence: 0.88, source: 'pesquisa' },
      validade: { value: '31/12/2026', confidence: 0.91, source: 'foto_validade' },
      ncm: { value: '00000000', confidence: 0.62, source: 'pesquisa', note: 'Confirmar com o fiscal' },
      categoria: { value: request.category || 'Mercearia', confidence: 0.8, source: 'classificacao' }
    }
  }, null, 2);
}

function renderImporter(request) {
  state.selected = request;
  state.result = null;
  title.textContent = 'Revisão da IA';
  subtitle.textContent = `EAN ${request.ean} · pacote preparado localmente`;
  content.innerHTML = `<section class="panel"><button class="back-button" type="button" data-ai-review-back>← Voltar aos pacotes</button><div class="panel-head"><div><span class="eyebrow">IMPORTAR RESPOSTA DO MAKE</span><h2>EAN ${escapeHtml(request.ean)}</h2></div><span class="score warn">Homologação manual</span></div><form id="ai-response-form"><label class="editor-field editor-field-wide"><span>JSON retornado pelo cenário</span><textarea id="ai-response-json" name="response" rows="18" spellcheck="false" placeholder="Cole aqui o JSON completo"></textarea></label><div class="editor-actions"><button class="primary-action" type="submit">Validar resposta</button><button class="secondary-action" type="button" data-ai-load-example>Carregar exemplo</button></div></form><details class="ai-schema-help"><summary>Formato esperado</summary><pre>${escapeHtml(responseExample(request))}</pre></details><div class="notice">O identificador da solicitação e o EAN precisam corresponder ao pacote selecionado.</div></section>`;
}

function fieldCard(field) {
  const selectable = field.decision === 'suggested' || field.decision === 'review';
  const checked = field.decision === 'suggested' ? 'checked' : '';
  const disabled = selectable ? '' : 'disabled';
  const warnings = field.warnings?.length ? `<ul>${field.warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '';
  return `<article class="ai-field-card ${decisionClass(field.decision)}"><label><input type="checkbox" name="acceptedField" value="${escapeHtml(field.field)}" ${checked} ${disabled}><span><strong>${escapeHtml(field.label)}</strong><small>${decisionLabel(field.decision)} · ${field.confidencePercent}%</small></span></label><div class="ai-field-value">${escapeHtml(field.value || '—')}</div><div class="ai-field-meta"><span>Fonte: ${escapeHtml(field.source || 'não informada')}</span>${field.note ? `<span>${escapeHtml(field.note)}</span>` : ''}</div>${warnings}</article>`;
}

function renderReview(result) {
  state.result = result;
  const errorBlock = result.errors.length ? `<div class="notice error"><strong>Resultado bloqueado:</strong><br>${result.errors.map(escapeHtml).join('<br>')}</div>` : '';
  const warningBlock = result.warnings.length ? `<div class="notice">${result.warnings.map(escapeHtml).join('<br>')}</div>` : '';
  const fields = result.fields.length ? result.fields.map(fieldCard).join('') : '<div class="empty">Nenhum campo utilizável foi identificado.</div>';
  content.innerHTML = `<section class="panel"><button class="back-button" type="button" data-ai-review-import>← Voltar ao JSON</button><div class="panel-head"><div><span class="eyebrow">REVISÃO CAMPO A CAMPO</span><h2>EAN ${escapeHtml(result.ean)}</h2></div><span class="score ${result.status === 'ready' ? 'ok' : 'warn'}">${result.status === 'blocked' ? 'Bloqueado' : 'Revisão necessária'}</span></div>${errorBlock}${warningBlock}<form id="ai-field-review-form"><div class="ai-field-grid">${fields}</div><div class="editor-actions"><button class="primary-action" type="submit" ${result.status === 'blocked' ? 'disabled' : ''}>Abrir rascunho com campos selecionados</button><button class="secondary-action" type="button" data-ai-review-import>Revisar JSON novamente</button></div></form><div class="notice">Campos de preço, custo, estoque, localização e imagem são sempre ignorados pela importação da IA.</div></section>`;
}

function parseResponse(form) {
  try {
    const result = parseProductAiResponse(new FormData(form).get('response'), state.selected);
    storeProductAiResult(result);
    status.textContent = result.status === 'blocked' ? 'Resposta bloqueada' : 'Resposta validada';
    status.dataset.type = result.status === 'blocked' ? 'error' : 'success';
    renderReview(result);
  } catch (error) {
    status.textContent = 'Resposta inválida';
    status.dataset.type = 'error';
    const previous = document.querySelector('[data-ai-parse-error]');
    previous?.remove();
    form.insertAdjacentHTML('afterend', `<div class="notice error" data-ai-parse-error>${escapeHtml(error.message || error)}</div>`);
  }
}

function openDraft(form) {
  const acceptedFields = new FormData(form).getAll('acceptedField');
  if (!acceptedFields.length) {
    status.textContent = 'Selecione pelo menos um campo';
    status.dataset.type = 'error';
    return;
  }
  try {
    const seed = createNewProductSeed(state.result.ean, {
      categoria: state.selected?.category || '',
      subcategoria: state.selected?.subcategory || ''
    });
    const { draft, applied } = buildProductDraftFromAi({ seed, result: state.result, acceptedFields });
    status.textContent = `${applied.length} sugestões aplicadas ao rascunho`;
    status.dataset.type = 'success';
    document.dispatchEvent(new CustomEvent('v2:open-new-product-draft', { detail: { product: draft } }));
  } catch (error) {
    status.textContent = 'Não foi possível abrir o rascunho';
    status.dataset.type = 'error';
    content.insertAdjacentHTML('afterbegin', `<div class="notice error">${escapeHtml(error.message || error)}</div>`);
  }
}

document.addEventListener('submit', event => {
  if (event.target.id === 'ai-response-form') {
    event.preventDefault();
    parseResponse(event.target);
    return;
  }
  if (event.target.id === 'ai-field-review-form') {
    event.preventDefault();
    openDraft(event.target);
  }
});

document.addEventListener('click', event => {
  const moduleButton = event.target.closest('[data-module="ai-review"]');
  if (moduleButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    document.querySelectorAll('[data-module]').forEach(button => button.classList.toggle('active', button === moduleButton));
    renderList();
    return;
  }
  const requestButton = event.target.closest('[data-ai-request-open]');
  if (requestButton) {
    const request = state.requests.find(item => item.id === requestButton.dataset.aiRequestOpen);
    if (request) renderImporter(request);
    return;
  }
  if (event.target.closest('[data-ai-review-back]')) { renderList(); return; }
  if (event.target.closest('[data-ai-review-import]') && state.selected) { renderImporter(state.selected); return; }
  if (event.target.closest('[data-ai-load-example]') && state.selected) {
    const textarea = document.getElementById('ai-response-json');
    if (textarea) textarea.value = responseExample(state.selected);
  }
}, true);
