import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(process.cwd(), 'site-do-zero');
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

async function read(relativePath) {
  return readFile(path.join(ROOT, relativePath), 'utf8');
}

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

async function validateHome() {
  const html = await read('index.html');

  assert(/<meta\s+name="robots"\s+content="noindex,nofollow"/i.test(html), 'A versão de desenvolvimento deve permanecer noindex.');
  assert(html.includes("DB:'https://cedar-chemist-310801-default-rtdb.firebaseio.com'"), 'Firebase oficial não encontrado no CONFIG.');
  assert(html.includes('TEST:true'), 'Modo de teste precisa permanecer ativo.');
  assert(html.includes('SAVE:false'), 'Gravação de pedidos precisa permanecer desativada.');
  assert(html.includes('SEND:false'), 'Webhook do Make precisa permanecer desativado.');
  assert(html.includes("if(!C.TEST)"), 'Qualquer integração futura deve permanecer protegida pelo modo de teste.');
  assert(html.includes('if(C.SAVE)'), 'Gravação futura precisa depender da chave SAVE.');
  assert(html.includes('if(C.SEND)'), 'Envio futuro ao Make precisa depender da chave SEND.');

  assert(html.includes("S.baskets.slice(0,4)"), 'A home deve mostrar exatamente até 4 cestas.');
  assert(html.includes("S.kits.slice(0,4)"), 'A home deve mostrar exatamente até 4 kits.');
  assert(html.includes('VER TODAS AS CESTAS'), 'Botão largo de todas as cestas ausente.');
  assert(html.includes('VER TODOS OS KITS'), 'Botão largo de todos os kits ausente.');
  assert(html.includes('Descontos de até 50%'), 'Banner principal de ofertas ausente.');
  assert(html.includes("section('Categorias'"), 'Categorias não estão no final da home.');

  assert(/\.grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(html), 'Grid mobile precisa ter 2 colunas.');
  assert(/@media\(min-width:900px\)[\s\S]*?\.grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/.test(html), 'Grid desktop precisa ter até 4 colunas.');
  assert(/\.media\{[^}]*aspect-ratio:4\/5/.test(html), 'Cards precisam permanecer verticais.');

  const firstLoad = html.match(/Promise\.all\(\[([^\]]+)\]\)/)?.[1] || '';
  assert(firstLoad.includes('C.P.baskets'), 'A home precisa carregar cestas na abertura.');
  assert(firstLoad.includes('C.P.kits'), 'A home precisa carregar kits na abertura.');
  assert(firstLoad.includes('C.P.categories'), 'A home precisa carregar categorias na abertura.');
  assert(!firstLoad.includes('C.P.products'), 'A home não pode baixar todos os produtos na abertura.');
}

async function validateInstitutionalPages() {
  const pages = [
    ['sobre-nos.html', 'https://donaantonia.com.br/sobre-nos.html'],
    ['contato.html', 'https://donaantonia.com.br/contato.html'],
    ['politica-de-entrega.html', 'https://donaantonia.com.br/politica-de-entrega.html'],
    ['politica-de-troca.html', 'https://donaantonia.com.br/politica-de-troca.html'],
    ['politica-de-privacidade.html', 'https://donaantonia.com.br/politica-de-privacidade.html'],
    ['termos-de-uso.html', 'https://donaantonia.com.br/termos-de-uso.html'],
    ['perguntas-frequentes.html', 'https://donaantonia.com.br/perguntas-frequentes.html']
  ];

  await access(path.join(ROOT, 'assets/institucional.css'));

  for (const [file, canonical] of pages) {
    const html = await read(file);
    assert(/<!doctype html>/i.test(html), `${file}: doctype ausente.`);
    assert(/<html\s+lang="pt-BR"/i.test(html), `${file}: idioma pt-BR ausente.`);
    assert(count(html, /<h1\b/gi) === 1, `${file}: deve possuir exatamente um H1.`);
    assert(/<meta\s+name="description"\s+content="[^"]+"/i.test(html), `${file}: descrição ausente.`);
    assert(html.includes(`<link rel="canonical" href="${canonical}">`), `${file}: canonical incorreta.`);
    assert(/<meta\s+name="robots"\s+content="index,follow/i.test(html), `${file}: indexação institucional não configurada.`);
    assert(html.includes('assets/institucional.css'), `${file}: CSS institucional não ligado.`);
    assert(html.includes('CNPJ 51.385.335/0001-06'), `${file}: identificação da empresa ausente.`);
    assert(!/kits promocionais|produtos avulsos/i.test(html), `${file}: conteúdo deve manter foco institucional e em cestas.`);
  }
}

async function validateGenerator() {
  const generator = await read('build/gerar-seo-cestas.mjs');
  const documentation = await read('FIREBASE-SOMENTE-LEITURA.md');

  assert(generator.includes("method: 'GET'"), 'Gerador deve usar GET explícito.');
  assert(!/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(generator), 'Gerador contém método de escrita.');
  assert(generator.includes('product_type>Cestas básicas'), 'Feed deve declarar somente cestas básicas.');
  assert(generator.includes("'/cestas/'"), 'Sitemap deve conter a página de cestas.');
  assert(!generator.includes("'/kits/'"), 'Sitemap não pode incluir kits.');
  assert(!generator.includes("'/produtos/'"), 'Sitemap não pode incluir produtos avulsos.');
  assert(documentation.includes('Somente requisições HTTP `GET`'), 'Proteção somente leitura não está documentada.');
}

await validateHome();
await validateInstitutionalPages();
await validateGenerator();

if (failures.length) {
  console.error('\nFalhas encontradas:');
  failures.forEach((failure, index) => console.error(`${index + 1}. ${failure}`));
  process.exitCode = 1;
} else {
  console.log('Projeto validado: layout, SEO de cestas e proteção do Firebase preservados.');
}
