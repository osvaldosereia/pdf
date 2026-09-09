const STORAGE = 'canecafacil_v2_criacoes';
const PERSONALIZER_BASE = 'https://donaantonia.com.br/loja-integrada/personalizar/';
const PERSONALIZER_ORIGIN = 'https://donaantonia.com.br';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const text = value => String(value ?? '').trim();

function notify(message) {
  const node = $('#toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => node.classList.remove('show'), 1900);
}
function loadCreations() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveCreations(list) {
  localStorage.setItem(STORAGE, JSON.stringify(list.slice(0, 50)));
}
function upsertCreation(data = {}) {
  const code = text(data.code).toUpperCase();
  if (!/^CF-/i.test(code)) return;
  const list = loadCreations();
  const existing = list.find(item => item.code === code) || {};
  const merged = {
    ...existing,
    code,
    status: text(data.status || existing.status || 'salva'),
    modelId: text(data.modelId || data.modelKey || existing.modelId),
    productId: text(data.productId || existing.productId),
    productName: text(data.productName || existing.productName),
    productCategory: text(data.productCategory || existing.productCategory),
    mockup: text(data.mockup || existing.mockup),
    artUrl: text(data.artUrl || existing.artUrl),
    quantity: Number(data.quantity || existing.quantity || 1) || 1,
    updatedAt: new Date().toISOString(),
  };
  const next = [merged, ...list.filter(item => item.code !== code)].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  saveCreations(next);
}
function removeCreation(code) {
  saveCreations(loadCreations().filter(item => item.code !== code));
  renderCreations();
}
function currentProductContext() {
  const scenes = $$('.scene');
  let best = null;
  for (const scene of scenes) {
    const r = scene.getBoundingClientRect();
    const visible = Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
    if (!best || visible > best.visible) best = { scene, visible };
  }
  const scene = best?.scene;
  return {
    productId: text(scene?.dataset.productId),
    productName: text(scene?.querySelector('h1')?.textContent),
    productCategory: text(scene?.querySelector('.eyebrow')?.textContent),
    mockup: text(scene?.querySelector('.mockup')?.src),
  };
}
function ensureV2ModeInFrame() {
  const frame = $('#personalizerFrame');
  if (!frame?.src || frame.src === 'about:blank') return;
  try {
    const url = new URL(frame.src);
    if (url.origin !== PERSONALIZER_ORIGIN) return;
    if (url.searchParams.get('store_v2') === '1') return;
    url.searchParams.set('store_v2', '1');
    frame.src = url.toString();
  } catch {}
}
function applyContextFromButton(button) {
  const scene = button?.closest('.scene');
  const image = scene?.querySelector('.mockup');
  const title = scene?.querySelector('h1');
  const category = scene?.querySelector('.eyebrow');
  if ($('#personalizerContextImage') && image?.src) $('#personalizerContextImage').src = image.src;
  if ($('#personalizerContextName')) $('#personalizerContextName').textContent = text(title?.textContent) || 'Sua caneca';
  if ($('#personalizerContextCategory')) $('#personalizerContextCategory').textContent = text(category?.textContent) || 'CanecaFácil';
  ensureV2ModeInFrame();
}
function closePersonalizer() {
  const overlay = $('#personalizerOverlay');
  if (!overlay) return;
  overlay.hidden = true;
  const frame = $('#personalizerFrame');
  if (frame) frame.src = 'about:blank';
  document.body.style.overflow = '';
}
function openCreation(item) {
  const overlay = $('#personalizerOverlay');
  const frame = $('#personalizerFrame');
  if (!overlay || !frame) return;
  const url = new URL(PERSONALIZER_BASE);
  if (item.modelId) url.searchParams.set('model', item.modelId);
  url.searchParams.set('creation', item.code);
  url.searchParams.set('embed', '1');
  url.searchParams.set('store_v2', '1');
  url.searchParams.set('return', location.href);
  frame.src = url.toString();
  if ($('#personalizerContextImage') && item.mockup) $('#personalizerContextImage').src = item.mockup;
  if ($('#personalizerContextName')) $('#personalizerContextName').textContent = item.productName || item.code;
  if ($('#personalizerContextCategory')) $('#personalizerContextCategory').textContent = item.productCategory || 'Minha caneca';
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  $('#creationsOverlay').hidden = true;
}
function statusLabel(status) {
  const key = text(status).toLowerCase();
  if (key === 'gerando') return 'Gerando';
  if (key === 'arte_pronta') return 'Arte pronta';
  if (key === 'aprovada' || key === 'salva_loja_v2' || key === 'carrinho') return 'Salva';
  return 'Salva';
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}
function renderCreations() {
  const root = $('#creationsGrid');
  if (!root) return;
  const list = loadCreations();
  root.innerHTML = list.length ? list.map(item => `
    <article class="creation-card">
      <span class="creation-status">${escapeHtml(statusLabel(item.status))}</span>
      <div>
        <div class="creation-code">${escapeHtml(item.productName || item.code)}</div>
        <div class="creation-meta">${escapeHtml(item.code)}${item.productCategory ? ` · ${escapeHtml(item.productCategory)}` : ''}${item.quantity > 1 ? ` · ${item.quantity} un.` : ''}</div>
      </div>
      <div class="creation-actions">
        <button class="creation-button" data-open-creation="${escapeHtml(item.code)}">Abrir</button>
        <button class="creation-button secondary" data-remove-creation="${escapeHtml(item.code)}">Remover</button>
      </div>
    </article>`).join('') : '<div class="creation-empty"><strong>Você ainda não criou uma caneca neste dispositivo.</strong><br>Escolha um modelo e toque em “Personalizar”.</div>';
  $$('[data-open-creation]', root).forEach(btn => btn.addEventListener('click', () => {
    const item = loadCreations().find(c => c.code === btn.dataset.openCreation);
    if (item) openCreation(item);
  }));
  $$('[data-remove-creation]', root).forEach(btn => btn.addEventListener('click', () => removeCreation(btn.dataset.removeCreation)));
}
function openCreations() {
  renderCreations();
  $('#creationsOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.hidden = true;
  document.body.style.overflow = '';
}

document.addEventListener('click', event => {
  const personalize = event.target.closest('[data-personalize]');
  if (personalize) setTimeout(() => applyContextFromButton(personalize), 0);

  const creations = event.target.closest('[data-action="creations"]');
  if (creations) {
    event.preventDefault();
    event.stopImmediatePropagation();
    $$('.nav-button').forEach(btn => btn.classList.toggle('active', btn.dataset.action === 'creations'));
    openCreations();
  }

  const closer = event.target.closest('[data-close-v2]');
  if (closer) closeOverlay(closer.dataset.closeV2);
}, true);

window.addEventListener('message', event => {
  if (event.origin !== PERSONALIZER_ORIGIN) return;
  const data = event.data || {};
  if (!data || typeof data !== 'object') return;
  if (data.type === 'canecafacil:minha-arte') {
    const context = currentProductContext();
    upsertCreation({ ...data, ...context });
    if (!$('#creationsOverlay').hidden) renderCreations();
  }
  if (data.type === 'canecafacil:return-to-store') closePersonalizer();
  if (data.type === 'canecafacil:v2-personalization-approved') {
    const context = currentProductContext();
    upsertCreation({ ...data, status:'aprovada', ...context });
    closePersonalizer();
    notify('Sua caneca foi salva em Minhas canecas');
  }
});

window.addEventListener('storage', event => {
  if (event.key === STORAGE && !$('#creationsOverlay')?.hidden) renderCreations();
});
