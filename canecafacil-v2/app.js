import { contrastInk, getConfig, getProducts, money, norm, productArray } from './shared/api.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const viewer = $('#viewer');
const toastEl = $('#toast');
const STORAGE_FAVORITES = 'canecafacil_v2_favoritos';
const STORAGE_CART = 'canecafacil_v2_carrinho';
const PERSONALIZER_BASE = 'https://donaantonia.com.br/loja-integrada/personalizar/';

const state = {
  config: { marca: 'CanecaFácil', preco_padrao: 24.9 },
  products: [],
  mode: 'home',
  favoriteIds: new Set(loadFavorites()),
  cart: loadCart(),
  activeId: '',
};

const demoProducts = [
  { id: 'demo-cafe', nome: 'Café, boas ideias', slug: 'cafe-boas-ideias', categoria: 'Café', subcategoria: 'Humor', fundo: '#FF6B1A', preco: 24.9, ativo: true, personalizavel: true, mockup_png: './assets/mockup-demo.svg', descricao_curta: 'Uma caneca para ideias grandes e cafés maiores ainda.', ordem: 1 },
  { id: 'demo-treino', nome: 'Descanso entre séries', slug: 'descanso-entre-series', categoria: 'Academia', subcategoria: 'Humor', fundo: '#95DDD0', preco: 24.9, ativo: true, personalizavel: true, mockup_png: './assets/mockup-demo.svg', descricao_curta: 'Para quem leva o treino a sério e o descanso mais ainda.', ordem: 2 },
  { id: 'demo-prof', nome: 'Profissional do improviso', slug: 'profissional-do-improviso', categoria: 'Profissões', subcategoria: 'Humor', fundo: '#F5C54D', preco: 24.9, ativo: true, personalizavel: false, mockup_png: './assets/mockup-demo.svg', descricao_curta: 'Humor cotidiano em forma de caneca.', ordem: 3 },
  { id: 'demo-beach', nome: 'Só mais uma partida', slug: 'so-mais-uma-partida', categoria: 'Beach Tennis', subcategoria: 'Esportes', fundo: '#C9B9F2', preco: 24.9, ativo: true, personalizavel: true, mockup_png: './assets/mockup-demo.svg', descricao_curta: 'Para quem nunca sabe quando é realmente a última.', ordem: 4 },
];

function loadFavorites() {
  try { return JSON.parse(localStorage.getItem(STORAGE_FAVORITES) || '[]'); } catch { return []; }
}
function saveFavorites() { localStorage.setItem(STORAGE_FAVORITES, JSON.stringify([...state.favoriteIds])); }
function loadCart() {
  try {
    const cart = JSON.parse(localStorage.getItem(STORAGE_CART) || '[]');
    return Array.isArray(cart) ? cart : [];
  } catch { return []; }
}
function saveCart() {
  localStorage.setItem(STORAGE_CART, JSON.stringify(state.cart));
  updateCartBadge();
}
function cartCount() { return state.cart.reduce((sum, item) => sum + Math.max(1, Number(item.qtd || 1)), 0); }
function updateCartBadge() {
  const badge = $('#cartBadge');
  if (!badge) return;
  const count = cartCount();
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
}
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}
function activeProducts() { return state.products.filter(p => p.ativo !== false); }
function visibleProducts() {
  if (state.mode === 'favorites') return activeProducts().filter(p => state.favoriteIds.has(p.id));
  return activeProducts();
}
function setTheme(product) {
  if (!product) return;
  const bg = product.fundo || '#FF6B1A';
  const ink = contrastInk(bg);
  document.documentElement.style.setProperty('--bg', bg);
  document.documentElement.style.setProperty('--ink', ink);
  document.body.style.backgroundColor = bg;
  document.body.style.color = ink;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  $('#personalizerOverlay')?.style.setProperty('--bg', bg);
  $('#descriptionOverlay')?.style.setProperty('--product-bg', bg);
  state.activeId = product.id;
}

function productScene(product, index, total) {
  const ink = contrastInk(product.fundo);
  const mockup = product.mockup_png || './assets/mockup-demo.svg';
  const favorite = state.favoriteIds.has(product.id);
  return `
    <article class="scene" id="produto-${escapeAttr(product.slug)}" data-product-id="${escapeAttr(product.id)}" style="--scene-bg:${escapeAttr(product.fundo)};--scene-ink:${ink}">
      <section class="scene-copy">
        <p class="eyebrow">${escapeHtml([product.categoria, product.subcategoria].filter(Boolean).join(' · '))}</p>
        <h1>${escapeHtml(product.nome)}</h1>
        <div class="scene-price-row">
          <p class="price">${money(product.preco)}</p>
          <button class="info-link" data-description="${escapeAttr(product.id)}" aria-label="Ver detalhes desta caneca">Detalhes</button>
        </div>
        <div class="cta-row">
          <button class="cta primary buy-cta" data-buy="${escapeAttr(product.id)}">Comprar</button>
          ${product.personalizavel ? `<button class="cta secondary personalize-cta" data-personalize="${escapeAttr(product.id)}">Personalizar</button>` : ''}
        </div>
      </section>
      <div class="mockup-wrap">
        <img class="mockup" src="${escapeAttr(mockup)}" alt="${escapeAttr(`Mockup da ${product.nome}`)}" loading="${index < 2 ? 'eager' : 'lazy'}" decoding="async">
      </div>
      <aside class="scene-side" aria-label="Ações desta caneca">
        <div class="scene-actions">
          <button class="scene-action ${favorite ? 'favorited' : ''}" data-favorite="${escapeAttr(product.id)}" aria-label="${favorite ? 'Remover dos favoritos' : 'Favoritar'}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 1 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/></svg>
          </button>
          <button class="scene-action" data-share="${escapeAttr(product.id)}" aria-label="Compartilhar esta caneca">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.3 10.9 7.4-4.5M8.3 13.1l7.4 4.5"/></svg>
          </button>
          <button class="scene-action" data-description="${escapeAttr(product.id)}" aria-label="Descrição e detalhes">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/></svg>
          </button>
        </div>
        <span class="scene-index">${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}</span>
      </aside>
    </article>`;
}

function renderViewer({ preserveProduct = '' } = {}) {
  const list = visibleProducts().sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.nome.localeCompare(b.nome, 'pt-BR'));
  if (!list.length) {
    viewer.innerHTML = `<section class="empty-state"><div><h1>Nenhuma caneca aqui ainda.</h1><p>${state.mode === 'favorites' ? 'Favorite uma caneca tocando no coração e ela aparecerá aqui.' : 'Cadastre a primeira caneca no novo Admin CanecaFácil.'}</p></div></section>`;
    return;
  }
  viewer.innerHTML = list.map((product, index) => productScene(product, index, list.length)).join('');
  bindSceneActions();
  observeScenes();
  const targetId = preserveProduct || productFromUrl();
  const target = list.find(p => p.id === targetId || p.slug === targetId) || list[0];
  setTheme(target);
  requestAnimationFrame(() => document.getElementById(`produto-${target.slug}`)?.scrollIntoView({ block: 'start' }));
}

function bindSceneActions() {
  $$('[data-favorite]', viewer).forEach(btn => btn.addEventListener('click', () => toggleFavorite(btn.dataset.favorite)));
  $$('[data-share]', viewer).forEach(btn => btn.addEventListener('click', () => shareProduct(btn.dataset.share)));
  $$('[data-personalize]', viewer).forEach(btn => btn.addEventListener('click', () => openPersonalizer(btn.dataset.personalize)));
  $$('[data-buy]', viewer).forEach(btn => btn.addEventListener('click', () => addToCart(btn.dataset.buy)));
  $$('[data-description]', viewer).forEach(btn => btn.addEventListener('click', () => openDescription(btn.dataset.description)));
}
function observeScenes() {
  window._cfObserver?.disconnect();
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(e => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible || visible.intersectionRatio < .45) return;
    const product = state.products.find(p => p.id === visible.target.dataset.productId);
    if (product) setTheme(product);
  }, { root: viewer, threshold: [.45, .6, .8] });
  $$('.scene', viewer).forEach(scene => observer.observe(scene));
  window._cfObserver = observer;
}

function toggleFavorite(id) {
  const wasFavorite = state.favoriteIds.has(id);
  if (wasFavorite) state.favoriteIds.delete(id); else state.favoriteIds.add(id);
  saveFavorites();
  const current = state.activeId;
  if (state.mode === 'favorites') renderViewer({ preserveProduct: current });
  else $$(`[data-favorite="${cssEscape(id)}"]`).forEach(btn => {
    btn.classList.toggle('favorited', !wasFavorite);
    btn.setAttribute('aria-label', !wasFavorite ? 'Remover dos favoritos' : 'Favoritar');
  });
  toast(wasFavorite ? 'Removida dos favoritos' : 'Salva nos favoritos');
}

async function shareProduct(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  const url = new URL(location.href);
  url.searchParams.set('produto', product.slug);
  const shareData = { title: `${product.nome} · CanecaFácil`, text: `Olha esta caneca: ${product.nome}`, url: url.toString() };
  try {
    if (navigator.share) await navigator.share(shareData);
    else { await navigator.clipboard.writeText(url.toString()); toast('Link copiado'); }
  } catch (error) {
    if (error?.name !== 'AbortError') toast('Não foi possível compartilhar agora');
  }
}

function addToCart(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  const existing = state.cart.find(item => item.id === id && !item.creationCode);
  if (existing) existing.qtd = Math.min(20, Number(existing.qtd || 1) + 1);
  else state.cart.push({ id: product.id, slug: product.slug, nome: product.nome, preco: product.preco, mockup_png: product.mockup_png, fundo: product.fundo, qtd: 1 });
  saveCart();
  toast('Caneca adicionada à sacola');
}

function openDescription(id) {
  const product = state.products.find(p => p.id === id);
  const overlay = $('#descriptionOverlay');
  if (!product || !overlay) return;
  overlay.style.setProperty('--product-bg', product.fundo || '#FF6B1A');
  $('#descriptionCategory').textContent = [product.categoria, product.subcategoria].filter(Boolean).join(' · ');
  $('#descriptionName').textContent = product.nome;
  $('#descriptionPrice').textContent = money(product.preco);
  $('#descriptionText').textContent = product.descricao_curta || 'Caneca de porcelana com arte CanecaFácil.';
  $('#descriptionMockup').src = product.mockup_png || './assets/mockup-demo.svg';
  $('#descriptionMockup').alt = `Mockup da ${product.nome}`;
  $('#descriptionBuy').dataset.buySheet = product.id;
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
}

function openPersonalizer(id) {
  const product = state.products.find(p => p.id === id);
  if (!product) return;
  if (!product.personalizavel) return toast('Esta caneca não está marcada como personalizável');
  const key = product.personalizador_modelo_key || product.id;
  const url = new URL(PERSONALIZER_BASE);
  url.searchParams.set('model', key);
  url.searchParams.set('embed', '1');
  url.searchParams.set('store_v2', '1');
  url.searchParams.set('return', location.href);
  $('#personalizerFrame').src = url.toString();
  $('#personalizerOverlay').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.hidden = true;
  if (id === 'personalizerOverlay') $('#personalizerFrame').src = 'about:blank';
  document.body.style.overflow = '';
}

function openSearch() {
  $('#searchOverlay').hidden = false;
  setTimeout(() => $('#searchInput').focus(), 30);
  renderSearch('');
}
function renderSearch(query) {
  const q = norm(query);
  const list = activeProducts().filter(p => !q || norm([p.nome, p.categoria, p.subcategoria, p.descricao_curta].join(' ')).includes(q)).slice(0, 16);
  $('#searchResults').innerHTML = list.map(miniCard).join('') || '<p>Nenhuma caneca encontrada.</p>';
  bindMiniCards($('#searchResults'));
}
function openExplore() {
  $('#exploreOverlay').hidden = false;
  renderExplore();
}
function renderExplore(category = '') {
  const categories = [...new Set(activeProducts().map(p => p.categoria).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('#categoryFilters').innerHTML = ['Todas', ...categories].map(c => `<button class="chip ${(!category && c === 'Todas') || category === c ? 'active' : ''}" data-category="${escapeAttr(c === 'Todas' ? '' : c)}">${escapeHtml(c)}</button>`).join('');
  const list = activeProducts().filter(p => !category || p.categoria === category);
  $('#exploreGrid').innerHTML = list.map(miniCard).join('');
  $$('.chip', $('#categoryFilters')).forEach(btn => btn.addEventListener('click', () => renderExplore(btn.dataset.category)));
  bindMiniCards($('#exploreGrid'));
}
function miniCard(product) {
  return `<button class="mini-card" data-open-product="${escapeAttr(product.id)}"><img src="${escapeAttr(product.mockup_png || './assets/mockup-demo.svg')}" alt="" loading="lazy"><span class="mini-card-copy"><strong>${escapeHtml(product.nome)}</strong><small>${money(product.preco)}</small></span></button>`;
}
function bindMiniCards(root) {
  $$('[data-open-product]', root).forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.openProduct;
    $$('.overlay').forEach(overlay => overlay.hidden = true);
    state.mode = 'home';
    setNav('home');
    renderViewer({ preserveProduct: id });
  }));
}
function setNav(action) {
  $$('.nav-button').forEach(btn => btn.classList.toggle('active', btn.dataset.action === action || (action === 'home' && btn.dataset.action === 'home')));
}
function productFromUrl() { return new URLSearchParams(location.search).get('produto') || ''; }

function handleAction(action) {
  if (action === 'home') {
    state.mode = 'home'; setNav('home'); renderViewer({ preserveProduct: state.activeId });
  } else if (action === 'favorites') {
    state.mode = 'favorites'; setNav('favorites'); renderViewer();
  } else if (action === 'search') openSearch();
  else if (action === 'explore') { setNav('explore'); openExplore(); }
  else if (action === 'cart') openCartSummary();
}

function openCartSummary() {
  const overlay = $('#cartOverlay');
  if (!overlay) return;
  const root = $('#cartItems');
  const total = state.cart.reduce((sum, item) => sum + Number(item.preco || 0) * Math.max(1, Number(item.qtd || 1)), 0);
  root.innerHTML = state.cart.length ? state.cart.map(item => `<article class="cart-row"><img src="${escapeAttr(item.mockup_png || './assets/mockup-demo.svg')}" alt=""><div><strong>${escapeHtml(item.nome)}</strong><small>${Math.max(1, Number(item.qtd || 1))} × ${money(item.preco)}</small></div><button data-cart-remove="${escapeAttr(item.id)}" aria-label="Remover">×</button></article>`).join('') : '<p class="cart-empty">Sua sacola está vazia.</p>';
  $('#cartTotal').textContent = money(total);
  $$('[data-cart-remove]', root).forEach(btn => btn.addEventListener('click', () => {
    state.cart = state.cart.filter(item => item.id !== btn.dataset.cartRemove);
    saveCart();
    openCartSummary();
  }));
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
function escapeAttr(value) { return escapeHtml(value); }
function cssEscape(value) { return String(value).replace(/(["\\])/g, '\\$1'); }

async function boot() {
  try {
    const [config, map] = await Promise.all([getConfig().catch(() => state.config), getProducts().catch(() => ({}))]);
    state.config = config;
    const loaded = productArray(map, config).filter(p => p.ativo !== false);
    state.products = loaded.length ? loaded : demoProducts;
  } catch {
    state.products = demoProducts;
  }
  updateCartBadge();
  renderViewer();
}

$$('[data-action]').forEach(btn => btn.addEventListener('click', () => handleAction(btn.dataset.action)));
$$('[data-close]').forEach(btn => btn.addEventListener('click', () => closeOverlay(btn.dataset.close)));
$$('.overlay').forEach(overlay => overlay.addEventListener('click', event => { if (event.target === overlay && overlay.id !== 'personalizerOverlay') closeOverlay(overlay.id); }));
$('#searchInput').addEventListener('input', event => renderSearch(event.target.value));
$('#descriptionBuy')?.addEventListener('click', event => { const id = event.currentTarget.dataset.buySheet; if (id) { addToCart(id); closeOverlay('descriptionOverlay'); } });
window.addEventListener('keydown', event => { if (event.key === 'Escape') $$('.overlay:not([hidden])').forEach(overlay => closeOverlay(overlay.id)); });

boot();
