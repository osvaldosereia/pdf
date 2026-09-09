import { contrastInk, getConfig, getProducts, money, norm, productArray } from './shared/api.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const overlay = $('#exploreOverlay');

const state = {
  products: [],
  filtered: [],
  index: 0,
  category: '',
  subcategory: '',
  query: '',
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}

function categories() {
  return [...new Set(state.products.map(p => p.categoria).filter(Boolean))].sort((a,b) => a.localeCompare(b,'pt-BR'));
}

function subcategories() {
  return [...new Set(
    state.products
      .filter(p => !state.category || p.categoria === state.category)
      .map(p => p.subcategoria)
      .filter(Boolean)
  )].sort((a,b) => a.localeCompare(b,'pt-BR'));
}

function current() {
  return state.filtered[state.index] || null;
}

function filterProducts() {
  const q = norm(state.query);
  return state.products.filter(p => {
    if (state.category && p.categoria !== state.category) return false;
    if (state.subcategory && p.subcategoria !== state.subcategory) return false;
    if (q && !norm([p.nome,p.categoria,p.subcategoria,p.descricao_curta].join(' ')).includes(q)) return false;
    return true;
  });
}

function install() {
  if (!overlay) return;
  overlay.classList.add('visual-browser-overlay');
  overlay.innerHTML = `
    <section class="visual-browser" role="dialog" aria-modal="true" aria-label="Explorar CanecaFácil">
      <div class="browser-mockup"><img id="browserImage" src="./assets/mockup-demo.svg" alt=""></div>

      <div class="browser-copy">
        <small id="browserEyebrow"></small>
        <h2 id="browserName">CanecaFácil</h2>
        <strong id="browserPrice"></strong>
      </div>

      <aside class="browser-panel floating-pill" aria-label="Categorias e busca">
        <div class="browser-panel-head">
          <strong>Explorar</strong>
          <button class="browser-close" data-browser-close aria-label="Fechar explorar">×</button>
        </div>

        <label class="browser-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
          <input id="browserQuery" type="search" placeholder="Buscar caneca" autocomplete="off">
        </label>

        <div class="browser-filter-block">
          <small>Categorias</small>
          <div id="browserCategories" class="browser-chips"></div>
        </div>

        <div id="browserSubBlock" class="browser-filter-block" hidden>
          <small>Subcategorias</small>
          <div id="browserSubcategories" class="browser-chips"></div>
        </div>

        <div class="browser-nav-row">
          <button data-browser-prev aria-label="Caneca anterior">←</button>
          <span id="browserCounter">01 / 01</span>
          <button data-browser-next aria-label="Próxima caneca">→</button>
        </div>

        <button class="browser-open" data-browser-open>Ver esta caneca</button>
      </aside>
    </section>`;

  $('[data-browser-close]', overlay).addEventListener('click', close);
  $('[data-browser-prev]', overlay).addEventListener('click', () => move(-1));
  $('[data-browser-next]', overlay).addEventListener('click', () => move(1));
  $('[data-browser-open]', overlay).addEventListener('click', openCurrent);
  $('#browserQuery', overlay).addEventListener('input', event => {
    state.query = event.target.value;
    apply();
  });
}

function renderFilters() {
  const categoryValues = ['', ...categories()];
  $('#browserCategories', overlay).innerHTML = categoryValues.map(value => `
    <button class="browser-chip ${state.category === value ? 'active' : ''}" data-cat="${escapeHtml(value)}">
      ${escapeHtml(value || 'Todas')}
    </button>`).join('');

  $$('[data-cat]', overlay).forEach(btn => btn.addEventListener('click', () => {
    state.category = btn.dataset.cat || '';
    state.subcategory = '';
    apply();
  }));

  const subs = subcategories();
  $('#browserSubBlock', overlay).hidden = !state.category || !subs.length;
  $('#browserSubcategories', overlay).innerHTML = ['', ...subs].map(value => `
    <button class="browser-chip ${state.subcategory === value ? 'active' : ''}" data-sub="${escapeHtml(value)}">
      ${escapeHtml(value || 'Todas')}
    </button>`).join('');

  $$('[data-sub]', overlay).forEach(btn => btn.addEventListener('click', () => {
    state.subcategory = btn.dataset.sub || '';
    apply();
  }));
}

function renderProduct() {
  const p = current();
  const browser = $('.visual-browser', overlay);
  if (!browser) return;

  if (!p) {
    browser.style.setProperty('--browser-bg','#F2F2F0');
    browser.style.setProperty('--browser-ink','#111111');
    $('#browserName', overlay).textContent = 'Nenhuma caneca encontrada';
    $('#browserEyebrow', overlay).textContent = '';
    $('#browserPrice', overlay).textContent = '';
    $('#browserImage', overlay).removeAttribute('src');
    $('#browserCounter', overlay).textContent = '00 / 00';
    $('[data-browser-open]', overlay).disabled = true;
    return;
  }

  const bg = p.fundo || '#FF6B1A';
  browser.style.setProperty('--browser-bg', bg);
  browser.style.setProperty('--browser-ink', contrastInk(bg));
  $('#browserEyebrow', overlay).textContent = [p.categoria,p.subcategoria].filter(Boolean).join(' · ');
  $('#browserName', overlay).textContent = p.nome;
  $('#browserPrice', overlay).textContent = money(p.preco);

  const image = $('#browserImage', overlay);
  image.src = p.mockup_png || './assets/mockup-demo.svg';
  image.alt = `Mockup da ${p.nome}`;

  $('#browserCounter', overlay).textContent = `${String(state.index + 1).padStart(2,'0')} / ${String(state.filtered.length).padStart(2,'0')}`;
  $('[data-browser-open]', overlay).disabled = false;
}

function apply() {
  state.filtered = filterProducts();
  state.index = 0;
  renderFilters();
  renderProduct();
}

function move(delta) {
  if (!state.filtered.length) return;
  state.index = (state.index + delta + state.filtered.length) % state.filtered.length;
  renderProduct();
}

function open({ focusSearch = false } = {}) {
  state.filtered = filterProducts();
  state.index = Math.min(state.index, Math.max(0, state.filtered.length - 1));
  renderFilters();
  renderProduct();
  overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  if (focusSearch) setTimeout(() => $('#browserQuery', overlay)?.focus(), 40);
}

function close() {
  if (!overlay) return;
  overlay.hidden = true;
  document.body.style.overflow = '';
}

function openCurrent() {
  const p = current();
  if (!p) return;
  close();
  document.querySelector('.nav-button[data-action="home"]')?.click();
  const url = new URL(location.href);
  url.searchParams.set('produto', p.slug);
  history.replaceState({}, '', url);
  setTimeout(() => document.getElementById(`produto-${p.slug}`)?.scrollIntoView({ block:'start', behavior:'smooth' }), 80);
}

async function load() {
  try {
    const [config,map] = await Promise.all([getConfig(), getProducts()]);
    state.products = productArray(map,config).filter(p => p.ativo !== false);
    state.filtered = [...state.products];
  } catch {
    state.products = [];
    state.filtered = [];
  }
}

document.addEventListener('click', event => {
  const trigger = event.target.closest('[data-action="explore"],[data-action="search"]');
  if (trigger) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    open({ focusSearch: trigger.dataset.action === 'search' });
    return;
  }

  const navAway = event.target.closest('[data-action="home"],[data-action="favorites"],[data-action="creations"],[data-action="cart"]');
  if (navAway && overlay && !overlay.hidden) close();
}, true);

document.addEventListener('keydown', event => {
  if (!overlay || overlay.hidden) return;
  if (event.key === 'Escape') close();
  if (event.key === 'ArrowLeft') move(-1);
  if (event.key === 'ArrowRight') move(1);
});

install();
load();
