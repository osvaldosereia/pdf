import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Gerador estático de SEO e Merchant exclusivo para cestas básicas.
 *
 * SEGURANÇA:
 * - somente requisições GET;
 * - nenhuma função de escrita no Firebase;
 * - nenhum token ou credencial de escrita;
 * - resultados gravados apenas no diretório local de saída.
 */

const CONFIG = Object.freeze({
  firebaseUrl: String(process.env.FIREBASE_URL || 'https://cedar-chemist-310801-default-rtdb.firebaseio.com').replace(/\/$/, ''),
  productsPath: String(process.env.FIREBASE_PRODUCTS_PATH || 'produtos').replace(/^\/+|\/+$/g, ''),
  basketsPath: String(process.env.FIREBASE_BASKETS_PATH || 'cestas').replace(/^\/+|\/+$/g, ''),
  publicBaseUrl: String(process.env.PUBLIC_BASE_URL || 'https://donaantonia.com.br').replace(/\/$/, ''),
  outputDir: path.resolve(process.cwd(), process.env.OUTPUT_DIR || 'site-do-zero/generated'),
  storeName: 'Super Cestas Básicas Dona Antônia',
  shortName: 'Dona Antônia',
  whatsapp: '5565998150975',
  email: 'atendimento@donaantonia.com.br',
  cnpj: '51.385.335/0001-06',
  minimumOrder: 75,
  cities: ['Cuiabá', 'Várzea Grande'],
  state: 'Mato Grosso',
  stateCode: 'MT'
});

const report = {
  generatedAt: new Date().toISOString(),
  source: {
    firebase: CONFIG.firebaseUrl,
    productsPath: `/${CONFIG.productsPath}`,
    basketsPath: `/${CONFIG.basketsPath}`,
    mode: 'GET_ONLY'
  },
  totals: { products: 0, basketsReceived: 0, basketsGenerated: 0, basketsRejected: 0 },
  warnings: [],
  errors: []
};

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function number(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = text(value);
  if (!raw) return 0;
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value, fallback = 0) {
  const parsed = Math.floor(number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalize(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function slug(value) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeHtml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeXml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function money(value) {
  return number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function merchantPrice(value) {
  return `${number(value).toFixed(2)} BRL`;
}

function absoluteUrl(value) {
  const raw = text(value);
  if (!raw) return `${CONFIG.publicBaseUrl}/img/logoantonia5.png`;
  if (/^https?:\/\//i.test(raw)) return raw;
  const clean = raw.replace(/^(\.\.\/|\.\/)+/g, '').replace(/^\/+/, '');
  if (/^img\/(produtos_3|produtos_2|produtos|kits)\//i.test(clean)) {
    return `${CONFIG.publicBaseUrl}/site/${clean}`;
  }
  return `${CONFIG.publicBaseUrl}/${clean}`;
}

function entries(value) {
  if (Array.isArray(value)) return value.map((item, index) => [String(index), item]);
  return Object.entries(value || {});
}

async function firebaseGet(firebasePath) {
  const cleanPath = String(firebasePath || '').replace(/^\/+|\/+$/g, '');
  if (!cleanPath) throw new Error('Caminho vazio do Firebase.');

  const url = `${CONFIG.firebaseUrl}/${cleanPath}.json`;
  if (!url.startsWith(`${CONFIG.firebaseUrl}/`) || !url.endsWith('.json')) {
    throw new Error(`URL de leitura recusada: ${url}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`Firebase respondeu HTTP ${response.status} em /${cleanPath}.`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProduct(raw = {}, key = '', index = 0) {
  const name = text(raw.nome || raw.name || raw.descricao || '');
  const id = text(raw.firebaseKey || raw.id || key || raw.codigo || index);
  const code = text(raw.codigo || raw.sku || id);
  const status = text(raw.situacao || raw.status).toUpperCase();
  const stock = Math.max(0, integer(raw.estoque || raw.stock));
  const regularPrice = Math.max(0, number(raw.preco || raw.price || raw.valor));
  const offerPrice = Math.max(0, number(raw.preco_oferta || raw.precoOferta));
  const image = absoluteUrl(raw.url_imagem || raw.imagem_url || raw.imagem || raw.image || raw.foto);

  return {
    id,
    code,
    name,
    stock,
    status,
    regularPrice,
    offerPrice,
    image,
    packaging: text(raw.embalagem || 'Unidade'),
    brand: text(raw.marca),
    ean: text(raw.ean || raw.gtin),
    category: text(raw.categoria),
    raw
  };
}

function normalizeProducts(data) {
  return entries(data)
    .map(([key, value], index) => normalizeProduct(value || {}, key, index))
    .filter(product => product.id && product.name && product.status !== 'I');
}

function codeVariants(value) {
  const raw = normalize(value);
  const compact = raw.replace(/[^a-z0-9]/g, '');
  const withoutLeadingZeros = compact.replace(/^0+(\d+)$/, '$1');
  const productCodeNumber = compact.replace(/^[a-z]+0*(\d+)$/, '$1');
  return [...new Set([raw, compact, withoutLeadingZeros, productCodeNumber].filter(Boolean))];
}

function indexProducts(products) {
  const index = new Map();
  for (const product of products) {
    for (const value of [product.id, product.code, product.ean]) {
      for (const variant of codeVariants(value)) {
        if (!index.has(variant)) index.set(variant, product);
      }
    }
  }
  return index;
}

function normalizeBasketItem(raw) {
  if (raw && typeof raw === 'object') {
    const substitutes = Array.isArray(raw.substitutos || raw.substitutes)
      ? (raw.substitutos || raw.substitutes)
      : [];

    return {
      quantity: Math.max(1, integer(raw.qtd || raw.qty || raw.quantidade || 1, 1)),
      references: [
        raw.codigo || raw.sku || raw.id || raw.ean || raw.gtin,
        ...substitutes.map(item => typeof item === 'object' ? item.codigo || item.sku || item.id : item)
      ].map(text).filter(Boolean)
    };
  }

  const rawText = text(raw);
  const match = rawText.match(/^(\d+)\s*x\s*(.+)$/i);
  return {
    quantity: match ? Math.max(1, integer(match[1], 1)) : 1,
    references: [match ? match[2] : rawText].filter(Boolean)
  };
}

function findProduct(productIndex, references) {
  for (const reference of references) {
    for (const variant of codeVariants(reference)) {
      const product = productIndex.get(variant);
      if (product) return product;
    }
  }
  return null;
}

function normalizeBasket(raw = {}, key = '', productIndex) {
  const id = text(raw.id || raw.codigo || key);
  const name = text(raw.nome || raw.name || 'Cesta básica');
  const code = text(raw.codigo || raw.sku || id);
  const basketSlug = slug(`${name}-${code || id}`);
  const price = Math.max(0, number(raw.preco || raw.price || raw.valor));
  const oldPrice = Math.max(0, number(raw.preco_original || raw.precoOriginal || raw.preco_anterior));
  const image = absoluteUrl(raw.imagem || raw.img || raw.url_imagem);
  const active = raw.ativo !== false && text(raw.status).toLowerCase() !== 'inativo';
  const itemInputs = Array.isArray(raw.produtos || raw.items) ? (raw.produtos || raw.items) : [];
  const resolvedItems = [];
  const missingItems = [];

  for (const itemInput of itemInputs) {
    const parsed = normalizeBasketItem(itemInput);
    const product = findProduct(productIndex, parsed.references);
    if (!product) {
      missingItems.push({ quantity: parsed.quantity, references: parsed.references });
      continue;
    }
    resolvedItems.push({ quantity: parsed.quantity, product });
  }

  const unitCount = resolvedItems.reduce((sum, item) => sum + item.quantity, 0);
  const uniqueCount = resolvedItems.length;
  const allProductsAvailable = resolvedItems.length === itemInputs.length
    && resolvedItems.every(item => item.product.stock >= item.quantity && item.product.regularPrice > 0);

  return {
    id,
    code,
    name,
    slug: basketSlug,
    price,
    oldPrice,
    image,
    description: text(raw.descricao || raw.description),
    active,
    itemInputs,
    items: resolvedItems,
    missingItems,
    unitCount,
    uniqueCount,
    available: active && price > 0 && itemInputs.length > 0 && allProductsAvailable,
    raw
  };
}

function basketDescription(basket) {
  const preview = basket.items
    .slice(0, 8)
    .map(item => `${item.quantity}x ${item.product.name}`)
    .join(', ');

  return text(
    basket.description
    || `Cesta básica ${basket.name} com ${basket.uniqueCount} produtos e ${basket.unitCount} unidades. Inclui ${preview}. Entrega em Cuiabá e Várzea Grande pela Dona Antônia.`
  );
}

function basketUrl(basket) {
  return `${CONFIG.publicBaseUrl}/cestas/${basket.slug}/`;
}

function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'OnlineStore',
    '@id': `${CONFIG.publicBaseUrl}/#organization`,
    name: CONFIG.storeName,
    alternateName: CONFIG.shortName,
    url: `${CONFIG.publicBaseUrl}/`,
    logo: `${CONFIG.publicBaseUrl}/img/logoantonia5.png`,
    email: CONFIG.email,
    telephone: `+${CONFIG.whatsapp}`,
    taxID: CONFIG.cnpj,
    areaServed: CONFIG.cities.map(city => ({
      '@type': 'City',
      name: city,
      containedInPlace: { '@type': 'State', name: CONFIG.state }
    }))
  };
}

function basketSchema(basket) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${basketUrl(basket)}#product`,
    name: basket.name,
    description: basketDescription(basket),
    image: [basket.image],
    sku: basket.code || basket.id,
    mpn: basket.code || basket.id,
    brand: { '@type': 'Brand', name: CONFIG.shortName },
    category: 'Cestas básicas',
    isRelatedTo: basket.items.map(item => ({
      '@type': 'Product',
      name: item.product.name,
      sku: item.product.code,
      brand: item.product.brand ? { '@type': 'Brand', name: item.product.brand } : undefined
    })),
    offers: {
      '@type': 'Offer',
      url: basketUrl(basket),
      priceCurrency: 'BRL',
      price: basket.price.toFixed(2),
      availability: basket.available
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition',
      seller: { '@id': `${CONFIG.publicBaseUrl}/#organization` },
      shippingDetails: {
        '@type': 'OfferShippingDetails',
        shippingRate: { '@type': 'MonetaryAmount', currency: 'BRL', value: '0.00' },
        shippingDestination: {
          '@type': 'DefinedRegion',
          addressCountry: 'BR',
          addressRegion: CONFIG.stateCode
        },
        deliveryTime: {
          '@type': 'ShippingDeliveryTime',
          handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
          transitTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 2, unitCode: 'DAY' }
        }
      },
      hasMerchantReturnPolicy: {
        '@type': 'MerchantReturnPolicy',
        applicableCountry: 'BR',
        returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
        merchantReturnDays: 7,
        returnMethod: 'https://schema.org/ReturnByMail',
        returnFees: 'https://schema.org/FreeReturn'
      }
    }
  };
}

function pageShell({ title, description, canonical, body, schema = [] }) {
  const schemas = [organizationSchema(), ...schema]
    .map(item => `<script type="application/ld+json">${JSON.stringify(item)}</script>`)
    .join('\n');

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="icon" href="${CONFIG.publicBaseUrl}/img/logoantonia5.png">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:site_name" content="${escapeHtml(CONFIG.shortName)}">
  ${schemas}
  <style>
    :root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#20241f;background:#f6f7f5}*{box-sizing:border-box}body{margin:0}a{color:inherit;text-decoration:none}img{display:block;max-width:100%}.wrap{width:min(1160px,100%);margin:auto;padding:0 14px}.top{background:#fff;border-bottom:1px solid #e4e8e2}.topin{min-height:68px;display:flex;align-items:center;justify-content:space-between;gap:14px}.brand{display:flex;align-items:center;gap:9px;font-weight:900}.brand img{width:48px;height:48px;object-fit:contain}.wa,.button{min-height:44px;padding:0 16px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-weight:900}.wa,.primary{background:#2b6b3a;color:#fff}.hero{padding:28px 0 18px}.hero h1{font-size:clamp(30px,6vw,54px);line-height:1;margin:0 0 9px}.hero p{color:#687068;line-height:1.55;max-width:760px;margin:0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.card,.panel{background:#fff;border:1px solid #e4e8e2;border-radius:18px}.card{overflow:hidden}.card img{width:100%;aspect-ratio:4/5;object-fit:contain;padding:8px}.copy{padding:11px}.copy small{color:#687068;font-weight:800}.copy h2{font-size:15px;line-height:1.25;margin:5px 0}.price{font-size:20px;color:#1f522b;font-weight:900}.button{margin-top:10px;width:100%}.detail{display:grid;gap:18px}.mainimage{background:#fff;border:1px solid #e4e8e2;border-radius:20px;aspect-ratio:1}.mainimage img{width:100%;height:100%;object-fit:contain;padding:12px}.panel{padding:18px}.panel h1{font-size:clamp(30px,5vw,48px);line-height:1;margin:7px 0}.bigprice{font-size:31px;color:#1f522b;font-weight:900}.items{display:grid;gap:7px;margin-top:18px}.item{display:grid;grid-template-columns:60px 1fr auto;align-items:center;gap:9px;border:1px solid #e4e8e2;border-radius:13px;padding:7px}.item img{width:60px;height:60px;object-fit:contain}.item strong{font-size:12px}.item small{display:block;color:#687068;font-size:10px;margin-top:3px}.footer{margin-top:38px;padding:25px 0;border-top:1px solid #e4e8e2;color:#687068;font-size:12px;line-height:1.6}.links{display:flex;flex-wrap:wrap;gap:12px;margin-top:10px}.links a{text-decoration:underline}@media(min-width:900px){.grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.detail{grid-template-columns:minmax(380px,48%) 1fr}.hero{padding:42px 0 24px}}
  </style>
</head>
<body>
  <header class="top"><div class="wrap topin"><a class="brand" href="${CONFIG.publicBaseUrl}/"><img src="${CONFIG.publicBaseUrl}/img/logoantonia5.png" width="48" height="48" alt="Dona Antônia"><span>Dona Antônia</span></a><a class="wa" href="https://wa.me/${CONFIG.whatsapp}" rel="noopener">WhatsApp</a></div></header>
  <main class="wrap">${body}</main>
  <footer class="footer"><div class="wrap"><strong>${escapeHtml(CONFIG.storeName)}</strong><br>CNPJ ${escapeHtml(CONFIG.cnpj)} · Delivery em Cuiabá e Várzea Grande · ${escapeHtml(CONFIG.email)}<nav class="links"><a href="${CONFIG.publicBaseUrl}/sobre-nos.html">Sobre nós</a><a href="${CONFIG.publicBaseUrl}/contato.html">Contato</a><a href="${CONFIG.publicBaseUrl}/politica-de-entrega.html">Entrega</a><a href="${CONFIG.publicBaseUrl}/politica-de-troca.html">Trocas e devoluções</a><a href="${CONFIG.publicBaseUrl}/politica-de-privacidade.html">Privacidade</a><a href="${CONFIG.publicBaseUrl}/termos-de-uso.html">Termos</a></nav></div></footer>
</body>
</html>`;
}

function basketCard(basket) {
  return `<article class="card">
    <a href="${basketUrl(basket)}"><img src="${escapeHtml(basket.image)}" width="440" height="550" loading="lazy" alt="${escapeHtml(basket.name)}"></a>
    <div class="copy">
      <small>Cesta básica · ${basket.unitCount} unidades</small>
      <h2><a href="${basketUrl(basket)}">${escapeHtml(basket.name)}</a></h2>
      <div class="price">${escapeHtml(money(basket.price))}</div>
      <a class="button primary" href="${basketUrl(basket)}">Ver produtos</a>
    </div>
  </article>`;
}

function basketIndexPage(baskets) {
  const description = 'Compare cestas básicas com composição completa e delivery em Cuiabá e Várzea Grande. Veja os produtos e peça pelo WhatsApp.';
  const body = `<section class="hero"><h1>Cestas básicas em Cuiabá e Várzea Grande</h1><p>${escapeHtml(description)}</p></section><section class="grid">${baskets.map(basketCard).join('\n')}</section>`;

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Cestas básicas Dona Antônia',
    itemListElement: baskets.map((basket, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      url: basketUrl(basket),
      name: basket.name
    }))
  };

  return pageShell({
    title: 'Cestas Básicas em Cuiabá e Várzea Grande | Dona Antônia',
    description,
    canonical: `${CONFIG.publicBaseUrl}/cestas/`,
    schema: [itemList],
    body
  });
}

function basketDetailPage(basket) {
  const description = basketDescription(basket);
  const body = `<section class="hero"><a href="${CONFIG.publicBaseUrl}/cestas/">← Todas as cestas</a></section><article class="detail"><div class="mainimage"><img src="${escapeHtml(basket.image)}" width="650" height="650" fetchpriority="high" alt="${escapeHtml(basket.name)}"></div><div class="panel"><small>Cesta básica · ${basket.uniqueCount} produtos · ${basket.unitCount} unidades</small><h1>${escapeHtml(basket.name)}</h1><div class="bigprice">${escapeHtml(money(basket.price))}</div><p>${escapeHtml(description)}</p><a class="button primary" href="${CONFIG.publicBaseUrl}/#/cesta/${encodeURIComponent(basket.id)}">Ver e pedir esta cesta</a><div class="items">${basket.items.map(item => `<div class="item"><img src="${escapeHtml(item.product.image)}" width="60" height="60" loading="lazy" alt=""><span><strong>${escapeHtml(item.product.name)}</strong><small>${escapeHtml(item.product.packaging)}</small></span><b>${item.quantity} un</b></div>`).join('\n')}</div></div></article>`;

  return pageShell({
    title: `${basket.name} | Cesta Básica em Cuiabá e Várzea Grande`,
    description,
    canonical: basketUrl(basket),
    schema: [basketSchema(basket)],
    body
  });
}

function merchantItem(basket) {
  const description = basketDescription(basket);
  const availability = basket.available ? 'in_stock' : 'out_of_stock';

  return `    <item>
      <g:id>${escapeXml(`cesta-${basket.code || basket.id}`)}</g:id>
      <g:title>${escapeXml(`${basket.name} com ${basket.uniqueCount} produtos`)}</g:title>
      <g:description>${escapeXml(description)}</g:description>
      <g:link>${escapeXml(basketUrl(basket))}</g:link>
      <g:canonical_link>${escapeXml(basketUrl(basket))}</g:canonical_link>
      <g:image_link>${escapeXml(basket.image)}</g:image_link>
      <g:availability>${availability}</g:availability>
      <g:condition>new</g:condition>
      <g:price>${escapeXml(merchantPrice(basket.price))}</g:price>
      <g:brand>${escapeXml(CONFIG.shortName)}</g:brand>
      <g:mpn>${escapeXml(basket.code || basket.id)}</g:mpn>
      <g:identifier_exists>yes</g:identifier_exists>
      <g:product_type>Cestas básicas</g:product_type>
      <g:google_product_category>Food, Beverages &amp; Tobacco &gt; Food Items</g:google_product_category>
      <g:shipping_label>delivery-local-cuiaba-vg</g:shipping_label>
      <g:custom_label_0>Cesta básica</g:custom_label_0>
      <g:custom_label_1>Cuiabá e Várzea Grande</g:custom_label_1>
      <g:custom_label_2>${basket.uniqueCount} produtos</g:custom_label_2>
      <g:custom_label_3>${basket.unitCount} unidades</g:custom_label_3>
      <g:custom_label_4>Somente delivery</g:custom_label_4>
    </item>`;
}

function merchantFeed(baskets) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>${escapeXml(CONFIG.storeName)}</title>
    <link>${escapeXml(CONFIG.publicBaseUrl)}</link>
    <description>Cestas básicas com delivery em Cuiabá e Várzea Grande.</description>
${baskets.map(merchantItem).join('\n')}
  </channel>
</rss>`;
}

function sitemap(baskets) {
  const today = new Date().toISOString().slice(0, 10);
  const staticPages = [
    '/',
    '/cestas/',
    '/sobre-nos.html',
    '/contato.html',
    '/politica-de-entrega.html',
    '/politica-de-troca.html',
    '/politica-de-privacidade.html',
    '/termos-de-uso.html'
  ];

  const staticEntries = staticPages.map(page => `  <url><loc>${escapeXml(`${CONFIG.publicBaseUrl}${page}`)}</loc><lastmod>${today}</lastmod></url>`);
  const basketEntries = baskets.map(basket => `  <url><loc>${escapeXml(basketUrl(basket))}</loc><lastmod>${today}</lastmod><image:image><image:loc>${escapeXml(basket.image)}</image:loc><image:title>${escapeXml(basket.name)}</image:title></image:image></url>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${[...staticEntries, ...basketEntries].join('\n')}
</urlset>`;
}

function robots() {
  return `User-agent: *
Allow: /
Disallow: /producao/
Disallow: /producao-v2/
Disallow: /site-do-zero/
Disallow: /#/produto/
Disallow: /#/kit/
Disallow: /#/categoria/
Disallow: /#/busca/

Sitemap: ${CONFIG.publicBaseUrl}/sitemap.xml
`;
}

async function save(relativePath, content) {
  const destination = path.join(CONFIG.outputDir, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, 'utf8');
}

async function main() {
  console.log('Lendo Firebase em modo GET_ONLY...');
  const [productsRaw, basketsRaw] = await Promise.all([
    firebaseGet(CONFIG.productsPath),
    firebaseGet(CONFIG.basketsPath)
  ]);

  const products = normalizeProducts(productsRaw);
  const productIndex = indexProducts(products);
  const basketInputs = entries(basketsRaw);
  const baskets = basketInputs.map(([key, raw]) => normalizeBasket(raw || {}, key, productIndex));

  report.totals.products = products.length;
  report.totals.basketsReceived = baskets.length;

  const approved = [];
  for (const basket of baskets) {
    const reasons = [];
    if (!basket.id) reasons.push('sem identificador');
    if (!basket.name) reasons.push('sem nome');
    if (!basket.price) reasons.push('sem preço');
    if (!basket.itemInputs.length) reasons.push('sem composição');
    if (basket.missingItems.length) reasons.push(`${basket.missingItems.length} produto(s) da composição não encontrado(s)`);
    if (!basket.active) reasons.push('inativa');
    if (!basket.available) reasons.push('indisponível por produto sem estoque ou sem preço');

    if (reasons.length) {
      report.totals.basketsRejected += 1;
      report.warnings.push({ id: basket.id, name: basket.name, reasons, missingItems: basket.missingItems });
      continue;
    }

    approved.push(basket);
  }

  approved.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, 'pt-BR'));
  report.totals.basketsGenerated = approved.length;

  if (!products.length) throw new Error(`Nenhum produto válido encontrado em /${CONFIG.productsPath}.`);
  if (!basketInputs.length) throw new Error(`Nenhuma cesta encontrada em /${CONFIG.basketsPath}.`);
  if (!approved.length) throw new Error('Nenhuma cesta passou pela validação para SEO e Merchant.');

  await rm(CONFIG.outputDir, { recursive: true, force: true });
  await mkdir(CONFIG.outputDir, { recursive: true });

  await save('cestas/index.html', basketIndexPage(approved));
  for (const basket of approved) {
    await save(`cestas/${basket.slug}/index.html`, basketDetailPage(basket));
  }

  await save('merchant.xml', merchantFeed(approved));
  await save('sitemap.xml', sitemap(approved));
  await save('robots.txt', robots());
  await save('relatorio.json', JSON.stringify(report, null, 2));

  console.log(`Produtos lidos: ${products.length}`);
  console.log(`Cestas recebidas: ${baskets.length}`);
  console.log(`Cestas geradas: ${approved.length}`);
  console.log(`Cestas rejeitadas: ${report.totals.basketsRejected}`);
  console.log(`Saída: ${CONFIG.outputDir}`);
}

main().catch(async error => {
  report.errors.push({ message: error?.message || String(error), stack: error?.stack || '' });
  try {
    await mkdir(CONFIG.outputDir, { recursive: true });
    await writeFile(path.join(CONFIG.outputDir, 'relatorio.json'), JSON.stringify(report, null, 2), 'utf8');
  } catch {}
  console.error(error);
  process.exitCode = 1;
});
