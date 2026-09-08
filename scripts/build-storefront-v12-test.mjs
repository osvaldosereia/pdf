import fs from 'node:fs/promises';

const SOURCE = 'index.html';
const OUTPUT = 'index-pagespeed-test.html';
const VERSION = '2026-07-17-storefront-runtime-test-v12';
let html = await fs.readFile(SOURCE, 'utf8');

function replaceRequired(pattern, replacement, label, minimum = 1) {
  const matches = html.match(pattern) || [];
  if (matches.length < minimum) throw new Error(`Não foi possível aplicar ${label}. Encontrado: ${matches.length}`);
  html = html.replace(pattern, replacement);
}

function removeScriptById(id, label) {
  const pattern = new RegExp(`<script id=["']${id}["']>[\\s\\S]*?<\\/script>\\s*(?:<!--[^>]*-->)?`, 'g');
  replaceRequired(pattern, '', label);
}

function removeStyleById(id, label) {
  const pattern = new RegExp(`<style id=["']${id}["']>[\\s\\S]*?<\\/style>`, 'g');
  replaceRequired(pattern, '', label);
}

html = html.replace(/<meta name="da-build-version" content="[^"]+">/, `<meta name="da-build-version" content="${VERSION}">`);
html = html.replace(/<meta name="robots" content="[^"]+">/, '<meta name="robots" content="noindex, nofollow">');
html = html.replace(/<title>(.*?)<\/title>/, '<title>$1 · Teste Catálogo V12</title>');
html = html.replace(/window\.__DA_PAGESPEED_TEST__\s*=\s*false;/g, 'window.__DA_PAGESPEED_TEST__ = true;');

// Retira os patches tardios que competiam com as funções internas do catálogo.
removeScriptById('da-storefront-banners-cache-v10', 'runtime tardio de banners v10');
removeScriptById('da-fast-home-runtime', 'runtime tardio da home');
removeStyleById('da-banners-after-four-v10', 'CSS antigo dos banners v10');

// A página inicial permanece sem banner, mas mantém a função original e todo o carregamento do catálogo.
replaceRequired(
  /\s*\$\{bannerSlotHtml\(\s*'home\.hero'\s*,\s*\{[^}]*\}\s*\)\}/g,
  '',
  'remoção do banner da home'
);

// A home deve realmente renderizar vinte ofertas: uma principal e até dezenove adicionais.
replaceRequired(
  /const remaining\s*=\s*daHomeDiversifyByCategory\(ranked\.slice\(1\),\s*7\);/g,
  'const remaining = daHomeDiversifyByCategory(ranked.slice(1),19);',
  'vinte ofertas na home'
);

const css = `
<style id="da-storefront-test-v12-css">
.da-inline-banner-zone{grid-column:1/-1;margin:18px 0 22px;content-visibility:auto;contain-intrinsic-size:260px}
.da-inline-banner-zone .da-banner-zone-head{margin-bottom:10px}
.da-inline-banner-zone .da-banner-zone-head span,.da-inline-banner-zone .da-banner-page-counter,.da-inline-banner-zone .da-banner-controls{display:none!important}
.da-inline-banner-zone .da-banner-track{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:12px!important;overflow:visible!important;transform:none!important;scroll-behavior:auto!important}
.da-inline-banner-zone .banner-card,.da-inline-banner-zone .da-banner-card{width:auto!important;min-width:0!important;aspect-ratio:4/5!important;animation:none!important;transition:none!important;transform:none!important}
.da-inline-banner-zone img{width:100%!important;height:100%!important;object-fit:cover!important;display:block!important}
.da-home-here-grid{display:grid!important;grid-template-columns:repeat(6,minmax(0,1fr))!important;gap:14px!important}
.da-home-here-item{display:block!important;aspect-ratio:1/1!important;border-radius:18px!important;overflow:hidden!important;background:#fff!important}
.da-home-here-item img{width:100%!important;height:100%!important;object-fit:contain!important;padding:6px!important;box-sizing:border-box!important}
.da-home-here-item:nth-child(n+13){display:none!important}
@media(max-width:767px){
  .da-inline-banner-zone .da-banner-track{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
  .da-inline-banner-zone .banner-card:nth-child(n+3),.da-inline-banner-zone .da-banner-card:nth-child(n+3){display:none!important}
  .da-home-here-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:10px!important}
  .da-home-here-item{border-radius:16px!important}
  .da-home-here-item img{padding:4px!important}
  .da-home-here-item:nth-child(n+7){display:none!important}
}
</style>`;
html = html.replace('</head>', `${css}\n</head>`);

const runtime = `
    /* DA_STOREFRONT_TEST_V12: regra única, dentro do mesmo escopo e antes do init(). */
    (() => {
      'use strict';

      const daOriginalApplyBannersDataV12 = applyBannersData;
      applyBannersData = function(data) {
        daOriginalApplyBannersDataV12(data);
        state.bannerConfig.autoplay = false;
        state.bannerConfig.loop = false;
        state.bannerConfig.show_arrows = false;
        state.bannerConfig.show_dots = false;
        state.bannerConfig.visible_limit = 4;
        state.bannerConfig.queue_capacity = 4;
      };

      function daUniqueBannersV12(items) {
        const seen = new Set();
        return (items || []).filter(function(item) {
          if (!item || !item.id || seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      }

      function daStaticBannerV12(position, banners, label) {
        let list = daUniqueBannersV12((banners || []).filter(bannerIsCurrent));
        if (typeof bannersInAccessOrder === 'function') list = bannersInAccessOrder(position, list);
        list = list.slice(0, 4);
        if (!list.length) return '';
        return '<section class="da-banner-zone da-inline-banner-zone" data-da-static-banner="true" data-banner-position="' + escapeHtml(position) + '" aria-label="' + escapeHtml(label || 'Destaques relacionados') + '">' +
          '<div class="da-banner-zone-head"><div><strong>' + escapeHtml(label || 'Destaques relacionados') + '</strong></div></div>' +
          '<div class="da-banner-track">' + list.map(function(banner, index) { return bannerCardHtml(banner, index, index < 2, false); }).join('') + '</div>' +
          '</section>';
      }

      function daBannerForFirstProductV12(products, position, label, direct) {
        const first = (products || [])[0];
        const list = [].concat(direct || []);
        if (first) {
          if (first.categoria) list.push.apply(list, getBanners('categoria', first.categoria));
          if (first.subcategoria) {
            const targets = [first.subcategoria];
            if (first.categoria) targets.push(first.categoria + '::' + first.subcategoria);
            list.push.apply(list, getBanners('subcategoria', targets));
          }
          if (first.marca) list.push.apply(list, getBanners('marca', first.marca));
        }
        return daStaticBannerV12(position, list, label);
      }

      function daProductsAfterFourV12(products, banner, mode) {
        const items = products || [];
        if (!items.length) return '';
        const cls = mode === 'list' ? 'product-list' : 'product-grid';
        const cardMode = mode === 'list' ? 'list' : undefined;
        const first = items.slice(0, 4).map(function(product) { return productCard(product, cardMode); }).join('');
        const rest = items.slice(4).map(function(product) { return productCard(product, cardMode); }).join('');
        return '<div class="' + cls + '" data-da-products-before-banner="true">' + first + '</div>' +
          (banner || '') +
          (rest ? '<div class="' + cls + '" data-da-products-after-banner="true">' + rest + '</div>' : '');
      }

      function daCardsAfterFourV12(items, banner, renderer, cls) {
        const list = items || [];
        const first = list.slice(0, 4).map(renderer).join('');
        const rest = list.slice(4).map(renderer).join('');
        return '<div class="' + cls + '" data-da-items-before-banner="true">' + first + '</div>' +
          (banner || '') +
          (rest ? '<div class="' + cls + '" data-da-items-after-banner="true">' + rest + '</div>' : '');
      }

      let daImageFrameV12 = 0;
      function daPrepareVisibleImagesV12() {
        if (daImageFrameV12) return;
        daImageFrameV12 = requestAnimationFrame(function() {
          daImageFrameV12 = 0;
          const images = Array.from(app.querySelectorAll('img'));
          images.forEach(function(img, index) {
            img.decoding = 'async';
            if (index < 8) {
              img.loading = 'eager';
              img.fetchPriority = index < 4 ? 'high' : 'auto';
            } else if (!img.getAttribute('loading')) {
              img.loading = 'lazy';
            }
            if (img.complete && img.naturalWidth === 0 && !img.dataset.daV12Retried) {
              img.dataset.daV12Retried = '1';
              if (typeof window.__daFallbackImg === 'function') window.__daFallbackImg(img);
            }
          });
        });
      }

      const daCatalogObserverV12 = new MutationObserver(daPrepareVisibleImagesV12);
      daCatalogObserverV12.observe(app, { childList: true, subtree: true });
      window.addEventListener('pageshow', function() { setTimeout(daPrepareVisibleImagesV12, 60); }, { passive: true });
      window.addEventListener('online', function() { setTimeout(daPrepareVisibleImagesV12, 100); }, { passive: true });

      renderCategories = function() {
        const cats = getCategories();
        const banner = daStaticBannerV12('categorias-pos-4', getBanners('categorias.topo'), 'Destaques das categorias');
        app.innerHTML = '<div class="container">' + pageHeader('Categorias', 'Escolha um setor para navegar.', '#/') +
          daCardsAfterFourV12(cats, banner, function(entry) { return categoryCardHtml(entry[0], entry[1]); }, 'category-buttons') + '</div>';
        setActiveNav('categorias');
      };

      renderCategory = function(cat) {
        const decoded = decodeURIComponent(cat || '');
        const products = state.products.filter(function(product) { return isAvailable(product) && norm(product.categoria) === norm(decoded); });
        const canonical = products[0] && products[0].categoria ? products[0].categoria : decoded;
        const subs = Array.from(new Set(products.map(function(product) { return product.subcategoria; }).filter(Boolean))).sort(function(a, b) { return a.localeCompare(b, 'pt-BR'); });
        const currentSub = new URLSearchParams(location.hash.split('?')[1] || '').get('sub') || 'Todos';
        const filtered = currentSub === 'Todos' ? products : products.filter(function(product) { return norm(product.subcategoria) === norm(currentSub); });
        const chips = '<div class="chips"><a class="chip ' + (currentSub === 'Todos' ? 'active' : '') + '" href="#/categoria/' + encodeURIComponent(canonical) + '">Todos</a>' +
          subs.map(function(sub) { return '<a class="chip ' + (currentSub === sub ? 'active' : '') + '" href="#/categoria/' + encodeURIComponent(canonical) + '?sub=' + encodeURIComponent(sub) + '">' + escapeHtml(sub) + '</a>'; }).join('') + '</div>';
        const direct = getBanners('categoria', canonical).slice();
        if (currentSub !== 'Todos') direct.push.apply(direct, getBanners('subcategoria', [currentSub, canonical + '::' + currentSub]));
        const banner = daBannerForFirstProductV12(filtered, 'categoria-pos-4', currentSub === 'Todos' ? 'Destaques de ' + canonical : 'Destaques de ' + currentSub, direct);
        const isBeauty = /(beleza|higiene|perfumaria)/.test(norm(canonical));
        const afterFour = (isBeauty ? beautyBannerHtml(products) : '') + banner;
        app.innerHTML = '<div class="container">' + pageHeader(canonical, filtered.length + ' produtos encontrados', '#/categorias') + chips +
          (filtered.length ? daProductsAfterFourV12(filtered, afterFour, 'grid') : '<div class="empty"><strong>Nenhum produto disponível</strong>Esta seção não possui itens disponíveis agora.</div>') + '</div>';
        setActiveNav('categorias');
        updateMeta(canonical + ' - Dona Antônia', 'Compre ' + canonical.toLowerCase() + ' com entrega em Cuiabá e Várzea Grande.', '/?categoria=' + encodeURIComponent(canonical));
      };

      renderSubcategory = function(subcategory) {
        const decoded = decodeURIComponent(subcategory || '');
        const products = state.products.filter(function(product) { return isAvailable(product) && norm(product.subcategoria) === norm(decoded); });
        const canonical = products[0] && products[0].subcategoria ? products[0].subcategoria : decoded;
        const targets = [canonical].concat(Array.from(new Set(products.map(function(product) { return product.categoria; }).filter(Boolean))).map(function(category) { return category + '::' + canonical; }));
        const banner = daBannerForFirstProductV12(products, 'subcategoria-pos-4', 'Destaques de ' + canonical, getBanners('subcategoria', targets));
        app.innerHTML = '<div class="container">' + pageHeader(canonical, products.length + ' produtos encontrados', '#/categorias') +
          (products.length ? daProductsAfterFourV12(products, banner, 'grid') : '<div class="empty"><strong>Nenhum produto disponível</strong>Esta subcategoria não possui itens disponíveis agora.</div>') + '</div>';
        setActiveNav('categorias');
      };

      renderBrand = function(brand) {
        const decoded = decodeURIComponent(brand || '');
        const products = state.products.filter(function(product) { return isAvailable(product) && norm(product.marca) === norm(decoded); });
        const canonical = products[0] && products[0].marca ? products[0].marca : decoded;
        const banner = daBannerForFirstProductV12(products, 'marca-pos-4', 'Destaques da marca ' + canonical, getBanners('marca', canonical));
        app.innerHTML = '<div class="container">' + pageHeader(canonical, products.length + ' produtos encontrados', '#/') +
          (products.length ? daProductsAfterFourV12(products, banner, 'grid') : '<div class="empty"><strong>Nenhum produto disponível</strong>Esta marca não possui itens disponíveis agora.</div>') + '</div>';
        setActiveNav('home');
      };

      renderOffers = function() {
        const products = getTopOffers(200);
        const banner = daBannerForFirstProductV12(products, 'ofertas-pos-4', 'Destaques relacionados às ofertas', getBanners('ofertas.topo'));
        app.innerHTML = '<div class="container">' + pageHeader('Ofertas', 'Produtos com desconto disponíveis agora.', '#/') +
          (products.length ? daProductsAfterFourV12(products, banner, 'grid') : '<div class="empty"><strong>Sem ofertas no momento</strong>Volte mais tarde ou navegue pelas categorias.</div>') + '</div>';
        setActiveNav('ofertas');
        updateMeta('Ofertas - Dona Antônia', 'Ofertas de supermercado com entrega em Cuiabá e Várzea Grande.', '/?secao=ofertas');
      };

      renderRoutine = function(key) {
        const routine = ROUTINES[key] || ROUTINES['compra-mes'];
        if (key === 'compra-mes') {
          const allProducts = productsByRoutine('compra-mes', 240);
          const groups = productsByCategoryForMonth(8);
          const banner = daBannerForFirstProductV12(allProducts, 'rotina-compra-mes-pos-4', 'Destaques para a compra do mês', getBanners('rotina.compra-mes.topo'));
          let bannerInserted = false;
          const body = groups.map(function(group) {
            let grid;
            if (!bannerInserted && group.products && group.products.length) {
              grid = daProductsAfterFourV12(group.products, banner, 'grid');
              bannerInserted = true;
            } else {
              grid = '<div class="product-grid">' + (group.products || []).map(function(product) { return productCard(product); }).join('') + '</div>';
            }
            return '<section class="month-group"><h2 class="month-group-title">' + escapeHtml(group.category) + '</h2>' + grid + '</section>';
          }).join('');
          app.innerHTML = '<div class="container">' + pageHeader('Compra do mês', '', '#/') + (body || '<div class="empty"><strong>Nenhum produto encontrado</strong>Use a busca para encontrar o que precisa.</div>') + '</div>';
        } else {
          let products = productsByRoutine(key, 200);
          if (key === 'higiene') {
            const coupon = getCouponByCode('BELEZA20');
            products = products.filter(function(product) { return couponMatchesProduct(coupon, product); });
          }
          const banner = daBannerForFirstProductV12(products, 'rotina-' + key + '-pos-4', 'Destaques de ' + routine.title, getBanners('rotina.' + key + '.topo'));
          const afterFour = (key === 'higiene' ? beautyBannerHtml(products) : '') + banner;
          app.innerHTML = '<div class="container">' + pageHeader(routine.title, '', '#/') +
            (products.length ? daProductsAfterFourV12(products, afterFour, 'grid') : '<div class="empty"><strong>Nenhum produto encontrado</strong>Use a busca para encontrar o que precisa.</div>') + '</div>';
        }
        setActiveNav('home');
      };

      renderSearch = function(query) {
        const q = String(query || '').trim();
        state.searchQuery = q;
        const searchInput = $('search-input');
        if (searchInput && document.activeElement !== searchInput && searchInput.value !== q) searchInput.value = q;
        updateSearchButtons();
        const products = searchProducts(q);
        const first = products[0];
        const direct = [];
        if (first) {
          if (first.categoria) direct.push.apply(direct, getBanners('categoria', first.categoria));
          if (first.subcategoria) direct.push.apply(direct, getBanners('subcategoria', [first.subcategoria, first.categoria ? first.categoria + '::' + first.subcategoria : first.subcategoria]));
        }
        const banner = daStaticBannerV12('busca-pos-4', direct, 'Destaques de ' + (first && (first.subcategoria || first.categoria) ? (first.subcategoria || first.categoria) : 'sua busca'));
        const results = q ? (products.length ? daProductsAfterFourV12(products, banner, 'list') : '<div class="empty"><strong>Nenhum produto encontrado</strong>Não achamos nada para "' + escapeHtml(q) + '". Tente buscar pelo nome exato, marca ou embalagem.</div>') : '';
        app.innerHTML = '<div class="container search-results-page">' + pageHeader(q ? 'Busca: ' + q : 'Busca', q ? products.length + ' resultado(s)' : 'Digite o produto na busca acima.', '#/') + results + '</div>';
        setActiveNav('home');
      };

      renderCestas = function() {
        const items = state.cestas || [];
        const banner = daStaticBannerV12('cestas-pos-4', getBanners('cestas.topo'), 'Destaques de cestas básicas');
        app.innerHTML = '<div class="container">' + pageHeader('Cestas básicas', 'Escolha uma cesta pronta e envie pelo WhatsApp.', '#/') +
          (items.length ? daCardsAfterFourV12(items, banner, function(item) { return basketCard(item, 'wide'); }, 'basket-list') : '<div class="empty"><strong>Nenhuma cesta carregada</strong>Confira novamente em instantes.</div>') + '</div>';
        setActiveNav('home');
      };

      renderKits = function() {
        const items = getActiveKits();
        const banner = daStaticBannerV12('kits-pos-4', getBanners('kits.topo'), 'Destaques de kits promocionais');
        app.innerHTML = '<div class="container">' + pageHeader('Kits promocionais', 'Escolha um combo com desconto e envie pelo WhatsApp.', '#/') +
          (items.length ? daCardsAfterFourV12(items, banner, function(item) { return kitCard(item, 'wide'); }, 'basket-list') : '<div class="empty"><strong>Nenhum kit promocional ativo</strong>Volte novamente em breve.</div>') + '</div>';
        setActiveNav('home');
        updateOfferCountdowns();
      };

      daPrepareVisibleImagesV12();
    })();
`;

const initPattern = /(\r?\n\s{4}init\(\);\r?\n\s{2}\}\)\(\);\r?\n<\/script>)/;
replaceRequired(initPattern, `${runtime}$1`, 'runtime v12 antes do init');

html = html.replace('</body>', '\n<!-- DA_STOREFRONT_TEST_PAGE_V12 -->\n</body>');
await fs.writeFile(OUTPUT, html, 'utf8');
console.log(`Gerado ${OUTPUT} (${Buffer.byteLength(html)} bytes)`);
