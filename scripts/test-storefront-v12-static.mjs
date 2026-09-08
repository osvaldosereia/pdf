import fs from 'node:fs/promises';

const html = await fs.readFile('index-pagespeed-test.html', 'utf8');
const fail = message => { throw new Error(message); };
const must = (condition, message) => { if (!condition) fail(message); };

must(html.includes('DA_STOREFRONT_TEST_V12'), 'Runtime v12 não encontrado.');
must(html.includes('DA_STOREFRONT_TEST_PAGE_V12'), 'Marcador da página de teste não encontrado.');
must(html.includes('data-da-products-before-banner="true"'), 'Estrutura anterior ao banner não encontrada.');
must(html.includes('slice(0, 4)'), 'Limite de quatro itens antes do banner não encontrado.');
must(html.includes("state.bannerConfig.autoplay = false"), 'Autoplay não foi desativado.');
must(html.includes("state.bannerConfig.loop = false"), 'Loop não foi desativado.');
must(html.includes('daHomeDiversifyByCategory(ranked.slice(1),19)'), 'A home não está configurada para vinte ofertas.');
must(html.includes('da-home-here-item:nth-child(n+7)'), 'Limite mobile do Aqui Tem não encontrado.');
must(html.includes('grid-template-columns:repeat(6'), 'Grade desktop do Aqui Tem não encontrada.');
must(!html.includes('id="da-storefront-banners-cache-v10"'), 'Runtime tardio v10 ainda presente.');
must(!html.includes('id="da-fast-home-runtime"'), 'Runtime tardio da home ainda presente.');
must(!html.includes('cdn.jsdelivr.net/gh/osvaldosereia/SUCEDOAN12@main/'), 'Reescrita instável para jsDelivr ainda presente.');
must(!html.includes("bannerSlotHtml('home.hero'"), 'Banner da página inicial ainda presente.');
must(html.includes('<meta name="robots" content="noindex, nofollow">'), 'Página de teste não está protegida com noindex.');

const runtimeIndex = html.indexOf('DA_STOREFRONT_TEST_V12');
const initIndex = html.indexOf('    init();', runtimeIndex);
must(runtimeIndex > 0 && initIndex > runtimeIndex, 'Runtime v12 não está antes da inicialização principal.');

const bytes = Buffer.byteLength(html);
must(bytes < 760000, `HTML de teste excedeu o limite: ${bytes} bytes.`);
console.log(`Validação estática concluída: ${bytes} bytes.`);
