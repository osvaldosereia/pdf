import { lookupProductByEan, createNewProductSeed, normalizeEan } from '../services/ean-service.js';
import {
  PRODUCT_PHOTO_SLOTS,
  createCaptureSession,
  setCapturePhoto,
  validateCaptureSession,
  saveCaptureSession,
  createPhotoPreviewUrl
} from '../services/product-photo-service.js';
import { buildProductAiDraftRequest, storePreparedProductAiRequest } from '../services/product-ai-request.js';

const content = document.getElementById('admin-content');
const status = document.getElementById('admin-status');
const title = document.getElementById('module-title');
const subtitle = document.getElementById('module-subtitle');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));
const state = {
  loading: false,
  lastEan: '',
  lastResult: null,
  captureSession: null,
  capturePreviews: {},
  captureContext: { category: '', subcategory: '', supplier: '' }
};

function releasePreviews() {
  Object.values(state.capturePreviews).forEach(url => { if (url) URL.revokeObjectURL(url); });
  state.capturePreviews = {};
}

function resetCaptureState() {
  releasePreviews();
  state.captureSession = null;
  state.captureContext = { category: '', subcategory: '', supplier: '' };
}

function renderStart() {
  resetCaptureState();
  title.textContent = 'Consulta por EAN';
  subtitle.textContent = 'Use câmera, leitor USB ou digitação manual para localizar um produto.';
  content.innerHTML = `<section class="module-hero"><div><span class="eyebrow">EAN · SOMENTE LEITURA</span><h2>Localizar produto rapidamente</h2><p>Leitores USB funcionam como teclado: clique no campo, leia o código e pressione Enter.</p></div></section><section class="panel"><form id="ean-search-form"><label class="editor-field editor-field-wide"><span>EAN / código de barras</span><input id="ean-search-input" name="ean" inputmode="numeric" autocomplete="off" autofocus placeholder="Leia ou digite entre 8 e 14 números"></label><div class="editor-actions"><button class="primary-action" type="submit">Buscar produto</button></div></form><div class="notice">A consulta não altera Firebase, estoque, produtos ou pedidos.</div></section>`;
  queueMicrotask(() => document.getElementById('ean-search-input')?.focus());
}

function renderFound(result) {
  resetCaptureState();
  const product = result.product;
  content.innerHTML = `<section class="panel"><button class="back-button" type="button" data-ean-back>← Nova leitura</button><div class="panel-head"><div><span class="eyebrow">PRODUTO ENCONTRADO</span><h2>${escapeHtml(product.nome || 'Produto')}</h2></div><span class="score ok">EAN ${escapeHtml(result.ean)}</span></div><div class="editor-summary-grid"><article><span>Código</span><strong>${escapeHtml(product.codigo || '—')}</strong></article><article><span>Categoria</span><strong>${escapeHtml(product.categoria || '—')}</strong></article><article><span>Estoque</span><strong>${Number(product.estoque || 0)}</strong></article><article><span>Preço</span><strong>${Number(product.preco || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}</strong></article></div><div class="editor-actions"><button class="primary-action" type="button" data-ean-open-editor="${escapeHtml(product.firebaseKey || product.id || product.codigo || product.gtin)}">Abrir editor</button><button class="secondary-action" type="button" data-ean-back>Realizar outra leitura</button></div></section>`;
}

function ensureCaptureSession(ean) {
  if (!state.captureSession || state.captureSession.ean !== ean) {
    resetCaptureState();
    state.captureSession = createCaptureSession(ean);
  }
  return state.captureSession;
}

function photoCard(slot) {
  const photo = state.captureSession?.photos?.[slot.id];
  const preview = state.capturePreviews[slot.id];
  return `<article class="ean-photo-card ${photo ? 'has-photo' : ''}"><input class="ean-photo-input" id="ean-photo-${slot.id}" type="file" accept="image/*" capture="environment" data-ean-photo-input="${slot.id}"><label class="ean-photo-label" for="ean-photo-${slot.id}"><div class="ean-photo-preview">${preview ? `<img src="${escapeHtml(preview)}" alt="Foto ${escapeHtml(slot.label)}">` : `<div class="ean-photo-placeholder"><strong>＋</strong><span>Abrir câmera</span></div>`}</div><div class="ean-photo-copy"><strong>${escapeHtml(slot.label)}</strong><small>${escapeHtml(slot.description)}</small><em>${photo ? 'Foto pronta · toque para trocar' : slot.required ? 'Obrigatória' : 'Opcional'}</em></div></label></article>`;
}

function renderNotFound(result) {
  ensureCaptureSession(result.ean);
  const validation = validateCaptureSession(state.captureSession);
  const captured = PRODUCT_PHOTO_SLOTS.filter(slot => state.captureSession?.photos?.[slot.id]?.blob instanceof Blob).length;
  state.lastResult = { ...result, seed: createNewProductSeed(result.ean) };
  content.innerHTML = `<section class="panel"><button class="back-button" type="button" data-ean-back>← Nova leitura</button><div class="panel-head"><div><span class="eyebrow">EAN NÃO CADASTRADO</span><h2>${escapeHtml(result.ean)}</h2></div><span class="score warn">Novo cadastro</span></div><div class="notice">Tire as fotos separadamente. Elas serão comprimidas e mantidas apenas neste navegador até a homologação do envio ao Make.</div><div class="ean-capture-context"><label class="editor-field"><span>Categoria conhecida</span><input data-ean-context="category" value="${escapeHtml(state.captureContext.category)}" placeholder="Ex.: Mercearia"></label><label class="editor-field"><span>Subcategoria conhecida</span><input data-ean-context="subcategory" value="${escapeHtml(state.captureContext.subcategory)}" placeholder="Ex.: Arroz"></label><label class="editor-field"><span>Fornecedor</span><input data-ean-context="supplier" value="${escapeHtml(state.captureContext.supplier)}" placeholder="Opcional"></label></div><div class="ean-photo-grid">${PRODUCT_PHOTO_SLOTS.map(photoCard).join('')}</div><div class="ean-capture-progress"><strong>${captured} de ${PRODUCT_PHOTO_SLOTS.length} fotos adicionadas</strong><span>${validation.valid ? 'Pacote mínimo completo para análise.' : 'Frente, EAN e validade são obrigatórias.'}</span></div>${validation.errors.length && captured ? `<div class="notice error">${validation.errors.map(escapeHtml).join('<br>')}</div>` : ''}<div class="editor-actions"><button class="primary-action" type="button" data-ean-prepare-capture ${validation.valid ? '' : 'disabled'}>Preparar cadastro com fotos</button><button class="secondary-action" type="button" data-ean-new-draft>Criar rascunho sem fotos</button><button class="secondary-action" type="button" data-ean-back>Cancelar</button></div><div class="notice">O botão apenas prepara o pacote local. Nenhuma foto será enviada ao Make ou GitHub nesta fase.</div></section>`;
}

function syncCaptureContext() {
  document.querySelectorAll('[data-ean-context]').forEach(input => {
    state.captureContext[input.dataset.eanContext] = String(input.value || '').trim();
  });
}

async function addPhoto(slotId, file) {
  if (!file || !state.captureSession) return;
  syncCaptureContext();
  status.textContent = `Processando foto ${PRODUCT_PHOTO_SLOTS.find(slot => slot.id === slotId)?.label || ''}…`;
  status.dataset.type = '';
  try {
    state.captureSession = await setCapturePhoto(state.captureSession, slotId, file);
    await saveCaptureSession(state.captureSession);
    if (state.capturePreviews[slotId]) URL.revokeObjectURL(state.capturePreviews[slotId]);
    state.capturePreviews[slotId] = createPhotoPreviewUrl(state.captureSession.photos[slotId]);
    renderNotFound(state.lastResult);
    status.textContent = 'Foto salva localmente';
    status.dataset.type = 'success';
  } catch (error) {
    status.textContent = 'Falha ao processar foto';
    status.dataset.type = 'error';
    content.insertAdjacentHTML('afterbegin', `<div class="notice error">${escapeHtml(error.message || error)}</div>`);
  }
}

async function prepareCaptureDraft() {
  syncCaptureContext();
  const validation = validateCaptureSession(state.captureSession);
  if (!validation.valid) {
    status.textContent = 'Fotos obrigatórias ausentes';
    status.dataset.type = 'error';
    renderNotFound(state.lastResult);
    return;
  }

  try {
    await saveCaptureSession(state.captureSession);
    const request = buildProductAiDraftRequest({
      ean: state.lastResult.ean,
      session: state.captureSession,
      category: state.captureContext.category,
      subcategory: state.captureContext.subcategory,
      supplier: state.captureContext.supplier
    });
    storePreparedProductAiRequest(request);
    const seed = {
      ...createNewProductSeed(state.lastResult.ean, {
        categoria: state.captureContext.category,
        subcategoria: state.captureContext.subcategory
      }),
      fornecedor: state.captureContext.supplier,
      captureSessionId: state.captureSession.id,
      aiRequestId: request.id,
      source: 'ean-photo-capture',
      draftOnly: true
    };
    status.textContent = 'Pacote local preparado';
    status.dataset.type = 'success';
    document.dispatchEvent(new CustomEvent('v2:open-new-product-draft', { detail: { product: seed } }));
  } catch (error) {
    status.textContent = 'Falha ao preparar cadastro';
    status.dataset.type = 'error';
    content.insertAdjacentHTML('afterbegin', `<div class="notice error">${escapeHtml(error.message || error)}</div>`);
  }
}

async function searchEan(value) {
  if (state.loading) return;
  state.loading = true;
  state.lastEan = normalizeEan(value);
  status.textContent = 'Consultando EAN…';
  status.dataset.type = '';
  try {
    const result = await lookupProductByEan(state.lastEan);
    state.lastResult = result;
    status.textContent = result.found ? 'Produto encontrado' : 'EAN não cadastrado';
    status.dataset.type = result.found ? 'success' : 'error';
    result.found ? renderFound(result) : renderNotFound(result);
  } catch (error) {
    status.textContent = 'Falha na consulta';
    status.dataset.type = 'error';
    content.innerHTML = `<section class="panel"><div class="notice error">${escapeHtml(error.message || error)}</div><div class="editor-actions"><button class="secondary-action" type="button" data-ean-back>Tentar novamente</button></div></section>`;
  } finally {
    state.loading = false;
  }
}

document.addEventListener('submit', event => {
  if (event.target.id !== 'ean-search-form') return;
  event.preventDefault();
  searchEan(new FormData(event.target).get('ean'));
});

document.addEventListener('change', event => {
  const photoInput = event.target.closest('[data-ean-photo-input]');
  if (!photoInput) return;
  addPhoto(photoInput.dataset.eanPhotoInput, photoInput.files?.[0]);
});

document.addEventListener('input', event => {
  const contextInput = event.target.closest('[data-ean-context]');
  if (contextInput) state.captureContext[contextInput.dataset.eanContext] = contextInput.value;
});

document.addEventListener('click', event => {
  const moduleButton = event.target.closest('[data-module="ean"]');
  if (moduleButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    document.querySelectorAll('[data-module]').forEach(button => button.classList.toggle('active', button === moduleButton));
    renderStart();
    return;
  }
  if (event.target.closest('[data-ean-back]')) { renderStart(); return; }
  const editorButton = event.target.closest('[data-ean-open-editor]');
  if (editorButton) {
    document.dispatchEvent(new CustomEvent('v2:open-product-editor', { detail: { productKey: editorButton.dataset.eanOpenEditor } }));
    return;
  }
  if (event.target.closest('[data-ean-prepare-capture]')) { prepareCaptureDraft(); return; }
  if (event.target.closest('[data-ean-new-draft]') && state.lastResult?.seed) {
    syncCaptureContext();
    const product = {
      ...state.lastResult.seed,
      categoria: state.captureContext.category,
      subcategoria: state.captureContext.subcategory,
      fornecedor: state.captureContext.supplier
    };
    document.dispatchEvent(new CustomEvent('v2:open-new-product-draft', { detail: { product } }));
  }
}, true);
