import { loadCatalog } from '../shared/catalog.js';
import {
  EDITABLE_FIELDS,
  normalizeDraft,
  validateProductDraft,
  diffProduct,
  saveProductDraft,
  readProductDrafts,
  discardProductDraft,
  productIdentity
} from './product-editor.js';

const content = document.getElementById('admin-content');
const status = document.getElementById('admin-status');
const title = document.getElementById('module-title');
const subtitle = document.getElementById('module-subtitle');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const state = { loaded: false, products: [], selected: null, mode: 'view', draft: null, changes: [], errors: [], isNew: false };
const keyOf = product => String(product.firebaseKey || product.id || product.codigo || product.gtin || '');
const imageOf = product => product.imagem || '../../img/logoantonia5.png';

async function ensureCatalog() {
  if (state.loaded) return;
  const result = await loadCatalog();
  state.products = result.products;
  state.loaded = true;
}

function fieldValue(product, field) {
  const value = product?.[field];
  return Array.isArray(value) ? value.join(', ') : value ?? '';
}

function inputFor(product, [field, label, type]) {
  const value = fieldValue(product, field);
  if (type === 'textarea') return `<label class="editor-field editor-field-wide"><span>${escapeHtml(label)}</span><textarea name="${field}" rows="4">${escapeHtml(value)}</textarea></label>`;
  return `<label class="editor-field"><span>${escapeHtml(label)}</span><input name="${field}" type="${type}" value="${escapeHtml(value)}"${type === 'number' ? ' step="0.01" min="0"' : ''}></label>`;
}

function aiOriginNotice(product) {
  if (product?.source !== 'ai-reviewed-draft') return '';
  return `<div class="ai-origin-notice"><strong>Rascunho iniciado com sugestões revisadas da IA</strong><span>Confirme principalmente validade, NCM, categoria, embalagem e nome comercial antes de salvar o rascunho local.</span></div>`;
}

function renderView(product) {
  const id = productIdentity(product);
  const saved = readProductDrafts()[id];
  title.textContent = 'Produto individual';
  subtitle.textContent = 'Consulta e edição segura em homologação local.';
  content.innerHTML = `<section class="product-detail-panel"><button class="back-button" type="button" data-editor-back>← Voltar aos produtos</button>${aiOriginNotice(product)}<div class="product-editor-view"><div class="product-detail-image"><img src="${escapeHtml(imageOf(product))}" alt="${escapeHtml(product.nome)}"></div><div><span class="eyebrow">PRODUTO INDIVIDUAL</span><h2>${escapeHtml(product.nome || 'Produto sem nome')}</h2><div class="detail-badges"><span class="pill">${escapeHtml(product.codigo || 'Sem código')}</span><span class="pill">Estoque ${Number(product.estoque) || 0}</span><span class="pill">${money(product.preco)}</span>${product.source === 'ai-reviewed-draft' ? '<span class="score warn">Origem IA revisada</span>' : ''}${saved ? '<span class="score warn">Rascunho local</span>' : ''}</div><div class="editor-summary-grid">${[['EAN',product.gtin],['NCM',product.ncm],['Categoria',product.categoria],['Subcategoria',product.subcategoria],['Marca',product.marca],['Embalagem',product.embalagem],['Validade',product.validade],['Local',`${product.gondola || '—'} / ${product.prateleira || '—'}`]].map(([label,value]) => `<article><span>${label}</span><strong>${escapeHtml(value || '—')}</strong></article>`).join('')}</div><div class="editor-actions"><button class="primary-action" type="button" data-editor-edit>Editar produto</button>${saved ? `<button class="secondary-action" type="button" data-editor-load-draft>Carregar rascunho</button><button class="secondary-action" type="button" data-editor-homologation="${escapeHtml(id)}">Abrir homologação</button><button class="danger-action" type="button" data-editor-discard>Descartar rascunho</button>` : ''}</div><div class="notice">Esta edição não grava no Firebase, GitHub, Make ou Bling. O resultado fica somente neste navegador até existir uma etapa de publicação aprovada.</div></div></div></section>`;
}

function renderForm(product, draft = product) {
  state.mode = 'edit';
  content.innerHTML = `<section class="product-detail-panel"><button class="back-button" type="button" data-editor-cancel>← Cancelar edição</button><div class="panel-head"><div><span class="eyebrow">${state.isNew ? 'NOVO PRODUTO · RASCUNHO LOCAL' : 'EDIÇÃO SEGURA · HOMOLOGAÇÃO LOCAL'}</span><h2>${escapeHtml(product.nome || product.gtin || 'Novo produto')}</h2></div><span class="score warn">Sem gravação externa</span></div>${aiOriginNotice(product)}<form id="product-edit-form"><div class="product-editor-form">${EDITABLE_FIELDS.map(field => inputFor(draft, field)).join('')}</div><div id="product-editor-errors"></div><div class="editor-actions"><button class="primary-action" type="submit">Revisar alterações</button><button class="secondary-action" type="button" data-editor-cancel>Cancelar</button></div></form></section>`;
}

function renderReview(product, draft, changes, errors = []) {
  state.mode = 'review';
  state.draft = draft;
  state.changes = changes;
  state.errors = errors;
  content.innerHTML = `<section class="product-detail-panel"><button class="back-button" type="button" data-editor-edit-again>← Voltar à edição</button><div class="panel-head"><div><span class="eyebrow">PRÉVIA DAS ALTERAÇÕES</span><h2>${escapeHtml(product.nome || product.gtin || 'Novo produto')}</h2></div><span class="score ${errors.length ? 'warn' : 'ok'}">${errors.length ? 'Revisão bloqueada' : changes.length + ' mudanças'}</span></div>${aiOriginNotice(product)}${errors.length ? `<div class="notice error"><strong>Corrija antes de salvar:</strong><br>${errors.map(escapeHtml).join('<br>')}</div>` : ''}<div class="change-list">${changes.map(change => `<article><strong>${escapeHtml(change.label)}</strong><div><span>Antes</span><del>${escapeHtml(change.before === '' ? '—' : change.before)}</del></div><div><span>Depois</span><ins>${escapeHtml(change.after === '' ? '—' : change.after)}</ins></div></article>`).join('') || '<div class="empty">Nenhuma mudança identificada.</div>'}</div><div class="editor-actions"><button class="primary-action" type="button" data-editor-save-local ${errors.length || !changes.length ? 'disabled' : ''}>Salvar rascunho local</button><button class="secondary-action" type="button" data-editor-edit-again>Editar novamente</button></div><div class="notice">Salvar aqui cria apenas um rascunho local com data, valores anteriores e posteriores. Nada será enviado para produção.</div></section>`;
}

function openProduct(product, { isNew = false } = {}) {
  state.selected = product;
  state.isNew = isNew;
  state.mode = isNew ? 'edit' : 'view';
  isNew ? renderForm(product) : renderView(product);
}

function backToProducts() { document.querySelector('[data-module="products"]')?.click(); }
function formDraft(form) { return normalizeDraft(state.selected, Object.fromEntries(new FormData(form).entries())); }

async function openByKey(productKey) {
  await ensureCatalog();
  const product = state.products.find(item => keyOf(item) === String(productKey || ''));
  if (!product) throw new Error('Produto não encontrado no catálogo seguro.');
  openProduct(product);
}

document.addEventListener('v2:open-product-editor', async event => {
  try { await openByKey(event.detail?.productKey); }
  catch (error) {
    status.textContent = 'Falha ao abrir editor';
    status.dataset.type = 'error';
    content.innerHTML = `<div class="notice error">${escapeHtml(error.message || error)}</div>`;
  }
});

document.addEventListener('v2:open-new-product-draft', event => {
  const product = event.detail?.product;
  if (product) openProduct(product, { isNew: true });
});

document.addEventListener('submit', event => {
  if (event.target.id !== 'product-edit-form') return;
  event.preventDefault();
  const draft = formDraft(event.target);
  const validation = validateProductDraft(draft);
  renderReview(state.selected, draft, diffProduct(state.selected, draft), validation.errors);
});

document.addEventListener('click', async event => {
  const productButton = event.target.closest('[data-product-detail]');
  if (productButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    try { await openByKey(productButton.dataset.productDetail); }
    catch (error) {
      status.textContent = 'Falha ao abrir editor';
      status.dataset.type = 'error';
      content.innerHTML = `<div class="notice error">${escapeHtml(error.message || error)}</div>`;
    }
    return;
  }
  if (!state.selected) return;
  if (event.target.closest('[data-editor-back]')) { backToProducts(); return; }
  if (event.target.closest('[data-editor-edit]')) { renderForm(state.selected); return; }
  if (event.target.closest('[data-editor-cancel]')) { state.isNew ? document.querySelector('[data-module="ean"]')?.click() : renderView(state.selected); return; }
  if (event.target.closest('[data-editor-edit-again]')) { renderForm(state.selected, state.draft); return; }
  if (event.target.closest('[data-editor-load-draft]')) {
    const saved = readProductDrafts()[productIdentity(state.selected)];
    if (saved) renderForm(state.selected, saved.draft);
    return;
  }
  const homologationButton = event.target.closest('[data-editor-homologation]');
  if (homologationButton) {
    document.dispatchEvent(new CustomEvent('v2:open-product-homologation', { detail: { productId: homologationButton.dataset.editorHomologation } }));
    return;
  }
  if (event.target.closest('[data-editor-discard]')) { discardProductDraft(state.selected); renderView(state.selected); return; }
  if (event.target.closest('[data-editor-save-local]')) {
    try {
      const saved = saveProductDraft(state.selected, state.draft);
      status.textContent = `Rascunho local salvo · ${saved.changes.length} mudanças`;
      status.dataset.type = 'success';
      state.isNew = false;
      state.selected = {
        ...state.selected,
        ...state.draft,
        id: state.selected.id || state.draft.codigo || state.draft.gtin,
        firebaseKey: state.selected.firebaseKey || state.draft.codigo || state.draft.gtin
      };
      renderView(state.selected);
    } catch (error) {
      renderReview(state.selected, state.draft, state.changes, [error.message || String(error)]);
    }
  }
}, true);
