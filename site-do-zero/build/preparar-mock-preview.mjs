import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Monta arquivos locais que imitam os endpoints REST do futuro /site_novo.
 * Não grava no Firebase. Produtos são obtidos somente por GET.
 */

const ROOT = process.cwd();
const FIREBASE_URL = String(
  process.env.FIREBASE_URL || 'https://cedar-chemist-310801-default-rtdb.firebaseio.com'
).replace(/\/$/, '');
const NAMESPACE_FILE = path.resolve(
  ROOT,
  process.env.NAMESPACE_FILE || 'site-do-zero/importacao/site-novo-publico.json'
);
const MOCK_DIR = path.resolve(
  ROOT,
  process.env.MOCK_DIR || 'site-do-zero/importacao/mock'
);

async function getProducts() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(`${FIREBASE_URL}/produtos.json`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Firebase respondeu HTTP ${response.status} em /produtos.`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const [namespaceRaw, products] = await Promise.all([
  readFile(NAMESPACE_FILE, 'utf8').then(JSON.parse),
  getProducts()
]);

const baskets = namespaceRaw?.publico?.cestas || {};
const kits = namespaceRaw?.publico?.kits || {};
const categories = namespaceRaw?.publico?.categorias || {};
const config = namespaceRaw?.publico?.config || {};
const version = namespaceRaw?.publico?.versao || {};

await mkdir(path.join(MOCK_DIR, 'site_novo/publico'), { recursive: true });
await writeFile(path.join(MOCK_DIR, 'produtos.json'), JSON.stringify(products), 'utf8');
await writeFile(path.join(MOCK_DIR, 'site_novo/publico/cestas.json'), JSON.stringify(baskets), 'utf8');
await writeFile(path.join(MOCK_DIR, 'site_novo/publico/kits.json'), JSON.stringify(kits), 'utf8');
await writeFile(path.join(MOCK_DIR, 'site_novo/publico/categorias.json'), JSON.stringify(categories), 'utf8');
await writeFile(path.join(MOCK_DIR, 'site_novo/publico/config.json'), JSON.stringify(config), 'utf8');
await writeFile(path.join(MOCK_DIR, 'site_novo/publico/versao.json'), JSON.stringify(version), 'utf8');

console.log(`Mock local criado em ${MOCK_DIR}`);
console.log(`Produtos: ${Object.keys(products || {}).length}`);
console.log(`Cestas: ${Object.keys(baskets).length}`);
console.log(`Kits: ${Object.keys(kits).length}`);
console.log(`Categorias: ${Object.keys(categories).length}`);
console.log('Nenhuma gravação foi executada no Firebase.');
