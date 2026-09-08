import { chromium } from 'playwright';

const BASE = process.env.TEST_URL || 'http://127.0.0.1:4173/index-pagespeed-test.html';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error && error.stack || error)));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitCatalog(selector = '.da-home-offer-card,.da-home-offer-feature,.product-card,.basket-card') {
  await page.waitForFunction(sel => document.querySelectorAll(sel).length > 0, selector, { timeout: 35000 });
}

async function assertFirstImages(selector, amount = 4) {
  await page.waitForFunction(({ selector, amount }) => {
    const images = Array.from(document.querySelectorAll(selector)).slice(0, amount);
    return images.length >= Math.min(2, amount) && images.every(img => img.complete && img.naturalWidth > 0);
  }, { selector, amount }, { timeout: 25000 });
}

async function assertStaticBannerPlacement() {
  const result = await page.evaluate(() => {
    const banner = document.querySelector('.da-inline-banner-zone');
    if (!banner) return { found: false };
    let before = banner.previousElementSibling;
    while (before && !before.matches('[data-da-products-before-banner],[data-da-items-before-banner]')) {
      before = before.previousElementSibling;
    }
    const cards = banner.querySelectorAll('.banner-card,.da-banner-card');
    return {
      found: true,
      beforeCount: before ? before.querySelectorAll('.product-card,.basket-card,.kit-card,.category-button').length : 0,
      total: cards.length,
      controls: banner.querySelectorAll('.da-banner-controls,.banner-dots,.banner-arrow,[data-autoplay]').length,
      staticFlag: banner.getAttribute('data-da-static-banner')
    };
  });
  if (!result.found) return false;
  assert(result.beforeCount === 4, `Banner não está após quatro itens. Encontrado antes: ${result.beforeCount}`);
  assert(result.total > 0 && result.total <= 4, `Quantidade desktop de banners inválida: ${result.total}`);
  assert(result.controls === 0, 'Banner estático ainda possui controles ou autoplay.');
  assert(result.staticFlag === 'true', 'Banner não usa a implementação estática v12.');
  return true;
}

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await waitCatalog();
  const homeOffers = await page.locator('.da-home-offer-card,.da-home-offer-feature').count();
  assert(homeOffers >= 20, `A home exibiu apenas ${homeOffers} ofertas; esperado: 20.`);
  assert(await page.locator('[data-banner-position="home.hero"],.da-home-profit .da-inline-banner-zone').count() === 0, 'A home ainda possui banner.');
  await assertFirstImages('.da-home-offer-card img,.da-home-offer-feature img', 4);

  await page.goto(`${BASE}#/categorias`, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForSelector('a[href^="#/categoria/"]', { timeout: 35000 });
  const categoryHrefs = await page.locator('a[href^="#/categoria/"]').evaluateAll(nodes => Array.from(new Set(nodes.map(node => node.getAttribute('href')).filter(Boolean))).slice(0, 20));
  assert(categoryHrefs.length > 0, 'Nenhuma categoria foi encontrada para o teste.');

  let chosenHref = '';
  let bannerFound = false;
  for (const href of categoryHrefs) {
    await page.goto(BASE + href, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForFunction(() => document.querySelectorAll('.product-card').length > 0 || document.querySelector('.empty'), null, { timeout: 35000 });
    const productCount = await page.locator('.product-card').count();
    if (productCount < 4) continue;
    chosenHref = href;
    if (await assertStaticBannerPlacement()) {
      bannerFound = true;
      break;
    }
  }

  assert(chosenHref, 'Nenhuma categoria com quatro produtos foi encontrada.');
  assert(bannerFound, 'Nenhuma categoria com banner relacionado foi encontrada entre as categorias testadas.');
  await assertFirstImages('.product-card img', 4);

  const bannerSourcesBefore = await page.locator('.da-inline-banner-zone img').evaluateAll(images => images.map(img => img.currentSrc || img.src));
  await page.waitForTimeout(5500);
  const bannerSourcesAfter = await page.locator('.da-inline-banner-zone img').evaluateAll(images => images.map(img => img.currentSrc || img.src));
  assert(JSON.stringify(bannerSourcesBefore) === JSON.stringify(bannerSourcesAfter), 'Os banners ainda estão trocando automaticamente.');

  // Atualização direta da categoria: deve continuar carregando catálogo e fotos na primeira tentativa.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForFunction(() => document.querySelectorAll('.product-card').length >= 4, null, { timeout: 35000 });
  await assertFirstImages('.product-card img', 4);
  await assertStaticBannerPlacement();

  // Busca usando o primeiro produto da categoria.
  const productName = (await page.locator('.product-name').first().textContent() || '').trim();
  assert(productName, 'Não foi possível obter um produto para testar a busca.');
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForSelector('.search-input', { timeout: 35000 });
  await page.locator('.search-input').fill(productName);
  await page.locator('.search-input').press('Enter');
  await page.waitForFunction(() => location.hash.includes('/busca/') && (document.querySelectorAll('.product-card').length > 0 || document.querySelector('.empty')), null, { timeout: 35000 });
  const searchCount = await page.locator('.product-card').count();
  assert(searchCount > 0, 'A busca não retornou o produto usado no teste.');
  await assertFirstImages('.product-card img', Math.min(4, searchCount));
  if (searchCount >= 4 && await page.locator('.da-inline-banner-zone').count()) await assertStaticBannerPlacement();

  // Mobile: no máximo dois banners visíveis e catálogo carregado após atualização direta.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + chosenHref, { waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForFunction(() => document.querySelectorAll('.product-card').length >= 4, null, { timeout: 35000 });
  await assertFirstImages('.product-card img', 4);
  const visibleMobileBanners = await page.locator('.da-inline-banner-zone .banner-card:visible,.da-inline-banner-zone .da-banner-card:visible').count();
  assert(visibleMobileBanners > 0 && visibleMobileBanners <= 2, `Quantidade mobile de banners inválida: ${visibleMobileBanners}`);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 35000 });
  await page.waitForFunction(() => document.querySelectorAll('.product-card').length >= 4, null, { timeout: 35000 });
  await assertFirstImages('.product-card img', 4);

  assert(pageErrors.length === 0, `Erros JavaScript detectados:\n${pageErrors.join('\n')}`);
  console.log('Teste de navegador concluído: home, categoria direta, busca, imagens e banners aprovados.');
} finally {
  await browser.close();
}
