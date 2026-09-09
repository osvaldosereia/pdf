import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const FIREBASE_URL = String(
  process.env.FIREBASE_URL || 'https://cedar-chemist-310801-default-rtdb.firebaseio.com'
).replace(/\/$/, '');

const OUTPUT = path.resolve(
  process.cwd(),
  process.env.DIAGNOSTIC_OUTPUT || 'site-do-zero/diagnosticos/firebase-leitura.json'
);

const PATHS = [
  'produtos',
  'cestas',
  'cestas_basicas',
  'cestas-basicas',
  'produtos_cesta_basica',
  'produtos-cesta-basica',
  'kits',
  'config_site/categorias'
];

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function getJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}
    return { response, text, data };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(firebasePath) {
  const clean = String(firebasePath).replace(/^\/+|\/+$/g, '');
  const url = `${FIREBASE_URL}/${clean}.json?shallow=true`;

  try {
    const { response, text, data } = await getJson(url, 12000);
    const keys = data && typeof data === 'object' && !Array.isArray(data)
      ? Object.keys(data)
      : [];

    return {
      path: `/${clean}`,
      status: response.status,
      readable: response.ok,
      valueType: data === null ? 'null' : Array.isArray(data) ? 'array' : typeof data,
      keyCount: keys.length,
      sampleKeys: keys.slice(0, 12),
      error: response.ok ? '' : String(data?.error || data?.message || text).slice(0, 160)
    };
  } catch (error) {
    return {
      path: `/${clean}`,
      status: 0,
      readable: false,
      valueType: 'error',
      keyCount: 0,
      sampleKeys: [],
      error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error)
    };
  }
}

function increment(map, value) {
  const key = String(value ?? '').trim() || '(vazio)';
  map[key] = Number(map[key] || 0) + 1;
}

async function inspectProducts() {
  const url = `${FIREBASE_URL}/produtos.json`;
  try {
    const { response, text, data } = await getJson(url, 45000);
    if (!response.ok || !data || typeof data !== 'object') {
      return {
        status: response.status,
        readable: false,
        error: String(data?.error || data?.message || text).slice(0, 160),
        total: 0,
        possibleBaskets: []
      };
    }

    const records = Object.entries(data);
    const typeCounts = {};
    const categoryCounts = {};
    const recordsWithComposition = [];
    const possibleBaskets = [];

    for (const [key, rawValue] of records) {
      const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};
      const name = String(raw.nome || raw.name || raw.descricao || '').trim();
      const category = String(raw.categoria || raw.category || '').trim();
      const type = String(raw.tipo || raw.type || raw.grupo || '').trim();
      const searchable = normalize([name, category, type, raw.subcategoria, raw.subsubcategoria].join(' '));
      const composition = raw.produtos || raw.items || raw.composicao || raw.componentes;
      const hasComposition = Array.isArray(composition)
        ? composition.length > 0
        : Boolean(composition && typeof composition === 'object' && Object.keys(composition).length);

      increment(typeCounts, type);
      increment(categoryCounts, category);

      const summary = {
        key,
        id: String(raw.id || raw.firebaseKey || key),
        codigo: String(raw.codigo || raw.sku || ''),
        nome: name,
        categoria: category,
        tipo: type,
        situacao: String(raw.situacao || raw.status || ''),
        preco: Number(raw.preco || raw.price || 0),
        estoque: Number(raw.estoque || raw.stock || 0),
        hasComposition
      };

      if (hasComposition && recordsWithComposition.length < 80) {
        recordsWithComposition.push(summary);
      }

      if ((searchable.includes('cesta') || hasComposition) && possibleBaskets.length < 120) {
        possibleBaskets.push(summary);
      }
    }

    const sortCounts = source => Object.entries(source)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
      .slice(0, 80)
      .map(([value, count]) => ({ value, count }));

    return {
      status: response.status,
      readable: true,
      total: records.length,
      typeCounts: sortCounts(typeCounts),
      categoryCounts: sortCounts(categoryCounts),
      recordsWithComposition,
      possibleBaskets
    };
  } catch (error) {
    return {
      status: 0,
      readable: false,
      error: error?.name === 'AbortError' ? 'timeout' : String(error?.message || error),
      total: 0,
      possibleBaskets: []
    };
  }
}

const results = [];
for (const firebasePath of PATHS) {
  results.push(await probe(firebasePath));
}

const productInspection = await inspectProducts();

const report = {
  generatedAt: new Date().toISOString(),
  firebase: FIREBASE_URL,
  mode: 'GET_ONLY_DIAGNOSTIC',
  results,
  productInspection
};

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, JSON.stringify(report, null, 2), 'utf8');

for (const item of results) {
  console.log(`${String(item.status).padStart(3, ' ')} ${item.readable ? 'OK ' : 'NO '} ${item.path} (${item.keyCount} chaves)`);
}
console.log(`Produtos analisados: ${productInspection.total || 0}`);
console.log(`Possíveis registros de cesta/composição: ${productInspection.possibleBaskets?.length || 0}`);
