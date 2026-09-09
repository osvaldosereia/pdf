import { contrastInk, deleteProduct, getConfig, getProducts, money, nowIso, number, productArray, saveConfig, saveProduct, slugify } from '../shared/api.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const productForm = $('#productForm');
const settingsForm = $('#settingsForm');
const editor = $('#editor');
const toastEl = $('#toast');

const state = { config: { marca: 'CanecaFácil', preco_padrao: 24.9 }, products: [] };

function toast(message, error = false) {
  toastEl.textContent = message;
  toastEl.style.background = error ? '#8d1515' : '#111';
  toastEl.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastEl.classList.remove('show'), 1900);
}
function setStatus(message) { $('#statusText').textContent = message; }
function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
function productById(id) { return state.products.find(p => p.id === id); }
function effectivePrice(product) { return number(product.preco) || number(state.config.preco_padrao); }

async function load() {
  setStatus('Carregando…');
  try {
    const [config, map] = await Promise.all([getConfig(), getProducts()]);
    state.config = config;
    state.products = productArray(map, config);
    fillSettings();
    renderProducts();
    updateDatalists();
    setStatus(`${state.products.length} caneca${state.products.length === 1 ? '' : 's'}`);
  } catch (error) {
    setStatus('Erro de conexão');
    toast(error.message || 'Falha ao carregar', true);
  }
}

function renderProducts() {
  const query = ($('#searchProducts').value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const filter = $('#statusFilter').value;
  const list = state.products
    .filter(p => filter === 'all' || (filter === 'active' ? p.ativo !== false : p.ativo === false))
    .filter(p => !query || [p.nome, p.categoria, p.subcategoria].join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(query))
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.nome.localeCompare(b.nome, 'pt-BR'));

  $('#productList').innerHTML = list.length ? list.map(p => `
    <article class="product-row" data-edit-id="${escapeAttr(p.id)}">
      <div class="product-thumb" style="background:${escapeAttr(p.fundo)}"><img src="${escapeAttr(p.mockup_png || '../assets/mockup-demo.svg')}" alt=""></div>
      <div class="product-meta"><strong>${escapeHtml(p.nome)}</strong><small>${escapeHtml([p.categoria,p.subcategoria].filter(Boolean).join(' · ') || 'Sem categoria')}</small></div>
      <span class="badge ${p.ativo === false ? 'off' : ''}">${p.ativo === false ? 'inativa' : p.personalizavel ? 'personalizável' : 'ativa'}</span>
      <span class="row-price">${money(effectivePrice(p))}</span>
    </article>`).join('') : '<div class="panel"><strong>Nenhuma caneca encontrada.</strong><p class="hint">Use “Nova caneca” para começar o catálogo V2.</p></div>';

  $$('[data-edit-id]').forEach(row => row.addEventListener('click', () => openEditor(row.dataset.editId)));
}

function openEditor(id = '') {
  const p = id ? productById(id) : null;
  productForm.reset();
  productForm.elements.id.value = p?.id || '';
  productForm.elements.nome.value = p?.nome || '';
  productForm.elements.slug.value = p?.slug || '';
  productForm.elements.ordem.value = p?.ordem ?? 0;
  productForm.elements.categoria.value = p?.categoria || '';
  productForm.elements.subcategoria.value = p?.subcategoria || '';
  productForm.elements.preco.value = number(p?.preco) || 0;
  productForm.elements.fundo.value = p?.fundo || '#FF6B1A';
  productForm.elements.fundo_text.value = p?.fundo || '#FF6B1A';
  productForm.elements.mockup_png.value = p?.mockup_png || '';
  productForm.elements.arte_horizontal.value = p?.arte_horizontal || '';
  productForm.elements.descricao_curta.value = p?.descricao_curta || '';
  productForm.elements.ativo.checked = p ? p.ativo !== false : true;
  productForm.elements.personalizavel.checked = p?.personalizavel === true;
  productForm.elements.personalizador_modelo_key.value = p?.personalizador_modelo_key || '';
  $('#editorTitle').textContent = p ? 'Editar caneca' : 'Nova caneca';
  $('#deleteProductBtn').hidden = !p;
  $('#personalizerFields').hidden = !productForm.elements.personalizavel.checked;
  editor.hidden = false;
  updatePreview();
}
function closeEditor() { editor.hidden = true; }

function updatePreview() {
  const color = normalizeHex(productForm.elements.fundo_text.value || productForm.elements.fundo.value);
  if (productForm.elements.fundo.value !== color) productForm.elements.fundo.value = color;
  if (productForm.elements.fundo_text.value !== color) productForm.elements.fundo_text.value = color;
  const ink = contrastInk(color);
  $('#visualPreview').style.background = color;
  $('#visualPreview').style.color = ink;
  $('#previewName').textContent = productForm.elements.nome.value || 'Nova caneca';
  $('#mockupPreview').src = productForm.elements.mockup_png.value || '../assets/mockup-demo.svg';
  $('#contrastBadge').textContent = ink === '#FFFFFF' ? 'texto branco automático' : 'texto preto automático';
}

async function submitProduct(event) {
  event.preventDefault();
  const raw = formObject(productForm);
  const existing = raw.id ? productById(raw.id) : null;
  const slug = slugify(raw.slug || raw.nome);
  const id = raw.id || `${slug || 'caneca'}-${Date.now().toString(36)}`;
  const timestamp = nowIso();
  const payload = {
    nome: raw.nome.trim(),
    slug,
    ordem: number(raw.ordem),
    categoria: raw.categoria.trim(),
    subcategoria: raw.subcategoria.trim(),
    preco: number(raw.preco),
    fundo: normalizeHex(raw.fundo_text || raw.fundo),
    mockup_png: raw.mockup_png.trim(),
    arte_horizontal: raw.arte_horizontal.trim(),
    descricao_curta: raw.descricao_curta.trim(),
    ativo: productForm.elements.ativo.checked,
    personalizavel: productForm.elements.personalizavel.checked,
    personalizador_modelo_key: productForm.elements.personalizavel.checked ? raw.personalizador_modelo_key.trim() : '',
    criado_em: existing?.criado_em || timestamp,
    atualizado_em: timestamp,
  };
  if (!payload.nome || !payload.categoria) return toast('Nome e categoria são obrigatórios', true);
  try {
    setStatus('Salvando…');
    await saveProduct(id, payload);
    toast('Caneca salva');
    closeEditor();
    await load();
  } catch (error) { setStatus('Erro ao salvar'); toast(error.message || 'Falha ao salvar', true); }
}

async function removeCurrentProduct() {
  const id = productForm.elements.id.value;
  const product = productById(id);
  if (!product) return;
  if (!confirm(`Excluir “${product.nome}” do catálogo V2?`)) return;
  try { await deleteProduct(id); toast('Caneca excluída'); closeEditor(); await load(); }
  catch (error) { toast(error.message || 'Falha ao excluir', true); }
}

function fillSettings() {
  settingsForm.elements.marca.value = state.config.marca || 'CanecaFácil';
  settingsForm.elements.preco_padrao.value = number(state.config.preco_padrao) || 24.9;
}
async function submitSettings(event) {
  event.preventDefault();
  const raw = formObject(settingsForm);
  try {
    await saveConfig({ marca: raw.marca.trim() || 'CanecaFácil', preco_padrao: number(raw.preco_padrao), atualizado_em: nowIso() });
    toast('Configurações salvas');
    await load();
  } catch (error) { toast(error.message || 'Falha ao salvar', true); }
}
function updateDatalists() {
  const categories = [...new Set(state.products.map(p => p.categoria).filter(Boolean))].sort();
  const subs = [...new Set(state.products.map(p => p.subcategoria).filter(Boolean))].sort();
  $('#categoryList').innerHTML = categories.map(v => `<option value="${escapeAttr(v)}"></option>`).join('');
  $('#subcategoryList').innerHTML = subs.map(v => `<option value="${escapeAttr(v)}"></option>`).join('');
}
function switchView(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `${view}View`));
  $$('.nav-item[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  $('#pageTitle').textContent = view === 'settings' ? 'Configurações' : 'Canecas';
  $('#newProductBtn').style.display = view === 'products' ? '' : 'none';
}
function normalizeHex(value) {
  const raw = String(value || '').replace('#','').trim();
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map(c => c + c).join('').toUpperCase()}`;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toUpperCase()}`;
  return '#FF6B1A';
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
function escapeAttr(value) { return escapeHtml(value); }

$('#newProductBtn').addEventListener('click', () => openEditor());
$('#closeEditor').addEventListener('click', closeEditor);
$('#cancelEditor').addEventListener('click', closeEditor);
$('#deleteProductBtn').addEventListener('click', removeCurrentProduct);
productForm.addEventListener('submit', submitProduct);
settingsForm.addEventListener('submit', submitSettings);
$('#searchProducts').addEventListener('input', renderProducts);
$('#statusFilter').addEventListener('change', renderProducts);
$$('.nav-item[data-view]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
productForm.elements.personalizavel.addEventListener('change', () => { $('#personalizerFields').hidden = !productForm.elements.personalizavel.checked; });
productForm.elements.nome.addEventListener('input', updatePreview);
productForm.elements.mockup_png.addEventListener('input', updatePreview);
productForm.elements.fundo.addEventListener('input', () => { productForm.elements.fundo_text.value = productForm.elements.fundo.value.toUpperCase(); updatePreview(); });
productForm.elements.fundo_text.addEventListener('input', updatePreview);
editor.addEventListener('click', event => { if (event.target === editor) closeEditor(); });
window.addEventListener('keydown', event => { if (event.key === 'Escape' && !editor.hidden) closeEditor(); });

load();
