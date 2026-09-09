import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'canecafacil-v2');
const FIREBASE = (process.env.FIREBASE_BASE_URL || 'https://cedar-chemist-310801-default-rtdb.firebaseio.com').replace(/\/$/, '');
const BASE = (process.env.CANECAFACIL_V2_BASE_URL || 'https://www.canecafacil.com.br/').replace(/\/?$/, '/');
const DATA_ROOT = 'canecafacil_v2';

const text = value => String(value ?? '').trim();
const number = value => { const n = Number(String(value ?? '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const norm = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const slugify = value => norm(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'caneca';
const esc = value => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const jsonScript = value => JSON.stringify(value).replace(/<\/script/gi, '<\\/script');
const money = value => number(value).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const absolute = value => { try { return new URL(value, BASE).href; } catch { return ''; } };

function normalizeHex(value) {
  const raw = text(value).replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map(c => c + c).join('').toUpperCase()}`;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toUpperCase()}`;
  return '#FF6B1A';
}
function contrastInk(background) {
  const hex = normalizeHex(background).slice(1);
  const c = [0,2,4].map(i => parseInt(hex.slice(i,i+2),16)/255).map(v => v <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4);
  const l = .2126*c[0] + .7152*c[1] + .0722*c[2];
  return (1.05/(l+.05)) >= ((l+.05)/.05) ? '#FFFFFF' : '#111111';
}
async function getJson(pathname) {
  const response = await fetch(`${FIREBASE}/${pathname}.json`, { headers:{ Accept:'application/json' } });
  if (!response.ok) throw new Error(`Firebase ${response.status} em ${pathname}`);
  return response.json();
}
async function write(relative, content) {
  const file = path.join(OUT, relative);
  await fs.mkdir(path.dirname(file), { recursive:true });
  await fs.writeFile(file, content);
}
function productUrl(product) { return new URL(`p/${encodeURIComponent(product.slug)}/`, BASE).href; }
function categoryUrl(category, subcategory = '') {
  const suffix = subcategory ? `${slugify(category)}/${slugify(subcategory)}/` : `${slugify(category)}/`;
  return new URL(`categoria/${suffix}`, BASE).href;
}
function baseHead({ title, description, canonical, bg='#FFFFFF', image='' }) {
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="index,follow,max-image-preview:large"><meta name="theme-color" content="${esc(bg)}"><title>${esc(title)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${esc(canonical)}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}">${image ? `<meta property="og:image" content="${esc(absolute(image))}">` : ''}<meta name="twitter:card" content="summary_large_image">`;
}
const css = `*{box-sizing:border-box}html,body{margin:0;min-height:100%;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{background:var(--bg);color:var(--ink)}.pill{position:fixed;z-index:5;left:50%;transform:translateX(-50%);background:#fff;color:#111;border-radius:999px;box-shadow:0 12px 28px rgba(0,0,0,.14);text-decoration:none}.top{top:22px;padding:15px 24px;font-weight:850;letter-spacing:-.04em}.product{min-height:100dvh;display:grid;grid-template-columns:minmax(260px,.8fr) minmax(420px,1.2fr);align-items:center;gap:4vw;padding:105px 8vw 95px}.copy small{text-transform:uppercase;letter-spacing:.14em;font-weight:850;opacity:.65}.copy h1{font-size:clamp(42px,5vw,80px);line-height:.92;letter-spacing:-.065em;max-width:9ch;margin:14px 0}.copy p{font-size:clamp(15px,1.2vw,20px);line-height:1.5;max-width:34ch;opacity:.78}.price{font-size:clamp(26px,2.8vw,42px);font-weight:900;margin:22px 0}.cta{display:inline-flex;border:1.5px solid currentColor;color:inherit;text-decoration:none;border-radius:999px;padding:13px 18px;font-weight:850}.mock{display:grid;place-items:center;height:74dvh}.mock img{max-width:100%;max-height:100%;object-fit:contain;filter:drop-shadow(0 26px 26px rgba(0,0,0,.16))}.category-page{background:#f6f6f4;color:#111;min-height:100vh;padding:100px 5vw 70px}.category-head{max-width:1100px;margin:0 auto 24px}.category-head h1{font-size:clamp(40px,6vw,76px);letter-spacing:-.06em;margin:0}.grid{max-width:1280px;margin:auto;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.card{border-radius:18px;overflow:hidden;text-decoration:none;color:#111;min-height:340px;display:flex;flex-direction:column}.card-img{flex:1;display:grid;place-items:center;min-height:260px}.card-img img{width:92%;height:250px;object-fit:contain}.card-copy{background:#fff;padding:12px 14px}.card-copy strong{display:block}.card-copy small{display:block;margin-top:4px;opacity:.55}@media(max-width:900px){.product{grid-template-columns:1fr;grid-template-rows:auto 1fr;padding:92px 20px 90px}.copy{position:absolute;z-index:2;left:22px;bottom:100px}.copy h1{font-size:38px}.copy p{display:none}.mock{height:70dvh;margin-top:4dvh}.grid{grid-template-columns:1fr}.category-page{padding:90px 16px 50px}.card{min-height:420px}.card-img img{height:340px}}`;

const [configRaw, productsRaw] = await Promise.all([
  getJson(`${DATA_ROOT}/config`).catch(() => ({})),
  getJson(`${DATA_ROOT}/produtos`).catch(() => ({})),
]);
const config = { marca:'CanecaFácil', preco_padrao:24.9, ...(configRaw || {}) };
const products = Object.entries(productsRaw || {}).map(([id,p]) => {
  p ||= {};
  return {
    ...p,
    id,
    nome:text(p.nome || 'Caneca'),
    slug:text(p.slug) || slugify(p.nome || id),
    categoria:text(p.categoria || 'Canecas'),
    subcategoria:text(p.subcategoria),
    fundo:normalizeHex(p.fundo || '#FF6B1A'),
    preco:number(p.preco) || number(config.preco_padrao),
    mockup:text(p.mockup_web || p.mockup_png || p.mockup_transparente),
    descricao:text(p.seo_description || p.descricao_curta || p.descricao || `Caneca ${p.nome || ''} com arte exclusiva CanecaFácil.`),
    ativo:p.ativo !== false,
  };
}).filter(p => p.ativo && p.nome && p.mockup);

const urls = new Set([BASE]);
for (const product of products) {
  const canonical = productUrl(product);
  const title = text(product.seo_title) || `${product.nome} | ${config.marca || 'CanecaFácil'}`;
  const ink = contrastInk(product.fundo);
  const schema = {
    '@context':'https://schema.org', '@type':'Product', name:product.nome, description:product.descricao,
    image:[absolute(product.mockup)].filter(Boolean), sku:product.id,
    brand:{ '@type':'Brand', name:config.marca || 'CanecaFácil' },
    category:[product.categoria, product.subcategoria].filter(Boolean).join(' > '),
    offers:{ '@type':'Offer', priceCurrency:'BRL', price:product.preco.toFixed(2), availability:'https://schema.org/InStock', url:canonical }
  };
  const breadcrumbs = {
    '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[
      { '@type':'ListItem', position:1, name:'CanecaFácil', item:BASE },
      { '@type':'ListItem', position:2, name:product.categoria, item:categoryUrl(product.categoria) },
      ...(product.subcategoria ? [{ '@type':'ListItem', position:3, name:product.subcategoria, item:categoryUrl(product.categoria, product.subcategoria) }] : []),
      { '@type':'ListItem', position:product.subcategoria ? 4 : 3, name:product.nome, item:canonical },
    ]
  };
  const deepLink = new URL(BASE); deepLink.searchParams.set('produto', product.slug);
  const html = `<!doctype html><html lang="pt-BR" style="--bg:${product.fundo};--ink:${ink}"><head>${baseHead({ title, description:product.descricao, canonical, bg:product.fundo, image:product.mockup })}<script type="application/ld+json">${jsonScript(schema)}</script><script type="application/ld+json">${jsonScript(breadcrumbs)}</script><style>${css}</style></head><body><a class="pill top" href="${esc(BASE)}">CanecaFácil</a><main class="product"><section class="copy"><small>${esc([product.categoria,product.subcategoria].filter(Boolean).join(' · '))}</small><h1>${esc(product.nome)}</h1><p>${esc(product.descricao)}</p><div class="price">${esc(money(product.preco))}</div><a class="cta" href="${esc(deepLink.href)}">Ver na loja</a></section><div class="mock"><img src="${esc(product.mockup)}" alt="${esc(`Caneca ${product.nome}`)}" width="1600" height="1800"></div></main></body></html>`;
  await write(path.join('p', product.slug, 'index.html'), html);
  urls.add(canonical);
}

const groups = new Map();
for (const product of products) {
  const catKey = product.categoria;
  if (!groups.has(catKey)) groups.set(catKey, new Map());
  const subKey = product.subcategoria || '';
  if (!groups.get(catKey).has(subKey)) groups.get(catKey).set(subKey, []);
  groups.get(catKey).get(subKey).push(product);
}
function cards(list) {
  return list.map(p => `<a class="card" href="${esc(productUrl(p))}"><div class="card-img" style="background:${esc(p.fundo)}"><img src="${esc(p.mockup)}" alt="${esc(p.nome)}" loading="lazy"></div><div class="card-copy"><strong>${esc(p.nome)}</strong><small>${esc(money(p.preco))}</small></div></a>`).join('');
}
for (const [category, subs] of groups) {
  const all = [...subs.values()].flat();
  const canonical = categoryUrl(category);
  const title = `Canecas de ${category} | ${config.marca || 'CanecaFácil'}`;
  const desc = `Veja canecas de ${category} com artes exclusivas, presentes e modelos personalizáveis.`;
  await write(path.join('categoria', slugify(category), 'index.html'), `<!doctype html><html lang="pt-BR"><head>${baseHead({ title, description:desc, canonical })}<style>${css}</style></head><body class="category-page"><a class="pill top" href="${esc(BASE)}">CanecaFácil</a><header class="category-head"><h1>${esc(category)}</h1><p>${esc(desc)}</p></header><main class="grid">${cards(all)}</main></body></html>`);
  urls.add(canonical);
  for (const [subcategory, list] of subs) {
    if (!subcategory) continue;
    const subCanonical = categoryUrl(category, subcategory);
    const subTitle = `${subcategory} · ${category} | ${config.marca || 'CanecaFácil'}`;
    const subDesc = `Canecas de ${category} em ${subcategory}. Explore as artes da CanecaFácil.`;
    await write(path.join('categoria', slugify(category), slugify(subcategory), 'index.html'), `<!doctype html><html lang="pt-BR"><head>${baseHead({ title:subTitle, description:subDesc, canonical:subCanonical })}<style>${css}</style></head><body class="category-page"><a class="pill top" href="${esc(BASE)}">CanecaFácil</a><header class="category-head"><h1>${esc(subcategory)}</h1><p>${esc(category)}</p></header><main class="grid">${cards(list)}</main></body></html>`);
    urls.add(subCanonical);
  }
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...urls].sort().map(url => `  <url><loc>${esc(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
await write('sitemap.xml', sitemap);
await write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${new URL('sitemap.xml', BASE).href}\n`);
await write('seo-manifest.json', JSON.stringify({ generated_at:new Date().toISOString(), products:products.length, urls:[...urls].sort() }, null, 2));
console.log(`CanecaFácil V2 SEO: ${products.length} produtos, ${urls.size} URLs.`);
