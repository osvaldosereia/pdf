import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Prepara um pacote para futura importação em /site_novo.
 *
 * Este script NÃO grava no Firebase.
 * Ele usa:
 * - GET em /produtos para montar categorias leves;
 * - arquivos atuais apenas como origem de migração inicial de cestas e kits;
 * - saída local em site-do-zero/importacao/.
 */

const ROOT = process.cwd();
const FIREBASE_URL = String(
  process.env.FIREBASE_URL || 'https://cedar-chemist-310801-default-rtdb.firebaseio.com'
).replace(/\/$/, '');
const OUTPUT = path.resolve(
  ROOT,
  process.env.IMPORT_OUTPUT || 'site-do-zero/importacao/site-novo-publico.json'
);

const BASKETS_FILE = path.resolve(ROOT, 'site/produtos-cesta-basica.json');
const KITS_FILE = path.resolve(ROOT, 'site/kits.json');

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

function cleanObject(value) {
  if (Array.isArray(value)) return value.map(cleanObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, cleanObject(item)])
  );
}

async function readJson(file) {
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function readProducts() {
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
    const data = await response.json();
    return Object.entries(data || {}).map(([key, raw]) => ({ key, ...(raw || {}) }));
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBasket(raw = {}, index = 0) {
  const id = text(raw.id || raw.codigo || `cesta-${index + 1}`);
  return cleanObject({
    id,
    slug: slug(`${raw.nome || 'cesta-basica'}-${raw.codigo || id}`),
    nome: text(raw.nome || 'Cesta básica'),
    codigo: text(raw.codigo || id),
    preco: number(raw.preco || raw.price),
    preco_original: number(raw.preco_original || raw.precoOriginal || raw.preco_anterior) || undefined,
    imagem: text(raw.imagem || raw.img || raw.url_imagem),
    descricao: text(raw.descricao || raw.description) || undefined,
    produtos: Array.isArray(raw.produtos) ? raw.produtos.map(item => ({
      qtd: Math.max(1, integer(item?.qtd || item?.qty || item?.quantidade || 1, 1)),
      codigo: text(item?.codigo || item?.sku || item?.id),
      substitutos: Array.isArray(item?.substitutos)
        ? item.substitutos.map(substitute => text(substitute?.codigo || substitute?.sku || substitute)).filter(Boolean)
        : []
    })).filter(item => item.codigo) : [],
    ativo: raw.ativo !== false,
    ordem: integer(raw.ordem, index + 1),
    atualizado_em: text(raw.atualizado_em) || new Date().toISOString()
  });
}

function normalizeKit(raw = {}, index = 0) {
  const id = text(raw.id || raw.codigo || `kit-${index + 1}`);
  return cleanObject({
    id,
    slug: slug(`${raw.nome || 'kit-promocional'}-${raw.codigo || id}`),
    nome: text(raw.nome || 'Kit promocional'),
    codigo: text(raw.codigo || id),
    preco: number(raw.preco || raw.preco_novo || raw.price),
    preco_anterior: number(raw.preco_anterior || raw.preco_original || raw.precoOriginal) || undefined,
    imagem: text(raw.imagem || raw.img || raw.url_imagem),
    descricao: text(raw.descricao || raw.description) || undefined,
    produtos: Array.isArray(raw.produtos) ? raw.produtos.map(item => ({
      qtd: Math.max(1, integer(item?.qtd || item?.qty || item?.quantidade || 1, 1)),
      codigo: text(item?.codigo || item?.sku || item?.id),
      substitutos: Array.isArray(item?.substitutos)
        ? item.substitutos.map(substitute => text(substitute?.codigo || substitute?.sku || substitute)).filter(Boolean)
        : []
    })).filter(item => item.codigo) : [],
    limite_kits: Math.max(0, integer(raw.limite_kits || raw.limiteKits)),
    estoque_disponivel: Math.max(0, integer(raw.estoque_disponivel || raw.estoqueDisponivel)),
    desconto_percentual: number(raw.desconto_percentual || raw.descontoPercentual),
    data_inicio: text(raw.data_inicio || raw.dataInicio) || undefined,
    data_fim: text(raw.data_fim || raw.dataFim) || undefined,
    ativo: raw.ativo !== false,
    ativo_ate_estoque_zero: raw.ativo_ate_estoque_zero !== false,
    ordem: integer(raw.ordem, index + 1),
    atualizado_em: text(raw.atualizado_em) || new Date().toISOString()
  });
}

function imageOf(raw = {}) {
  return text(raw.url_imagem || raw.imagem_url || raw.imagem || raw.image || raw.foto);
}

function buildCategories(products) {
  const map = new Map();

  for (const raw of products) {
    const status = text(raw.situacao || raw.status).toUpperCase();
    if (status === 'I') continue;

    const category = text(raw.categoria || raw.category);
    if (!category) continue;

    const key = slug(category);
    const current = map.get(key) || {
      id: key,
      slug: key,
      nome: category,
      quantidade_produtos: 0,
      quantidade_disponivel: 0,
      imagem: '',
      ativo: true
    };

    current.quantidade_produtos += 1;
    const stock = Math.max(0, integer(raw.estoque || raw.stock));
    const price = Math.max(0, number(raw.preco || raw.price || raw.valor));
    if (stock > 0 && price > 0) {
      current.quantidade_disponivel += 1;
      if (!current.imagem) current.imagem = imageOf(raw);
    }

    map.set(key, current);
  }

  return [...map.values()]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .reduce((result, category, index) => {
      result[category.id] = { ...category, ordem: index + 1 };
      return result;
    }, {});
}

function keyed(items) {
  return items.reduce((result, item) => {
    result[item.id] = item;
    return result;
  }, {});
}

const [basketSource, kitSource, products] = await Promise.all([
  readJson(BASKETS_FILE),
  readJson(KITS_FILE),
  readProducts()
]);

const baskets = (Array.isArray(basketSource) ? basketSource : Object.values(basketSource || {}))
  .map(normalizeBasket)
  .filter(item => item.id && item.nome && item.preco > 0 && item.produtos.length);

const kits = (Array.isArray(kitSource) ? kitSource : Object.values(kitSource || {}))
  .map(normalizeKit)
  .filter(item => item.id && item.nome && item.preco > 0 && item.produtos.length);

const categories = buildCategories(products);
const now = new Date().toISOString();

const output = {
  publico: {
    cestas: keyed(baskets),
    kits: keyed(kits),
    categorias: categories,
    config: {
      nome_loja: 'Super Cestas Básicas Dona Antônia',
      whatsapp: '5565998150975',
      pedido_minimo: 75,
      cidades: ['Cuiabá', 'Várzea Grande'],
      somente_delivery: true,
      seo_exclusivo_cestas: true,
      merchant_exclusivo_cestas: true
    },
    versao: {
      gerado_em: now,
      origem: 'migracao_inicial_controlada',
      produtos_origem: '/produtos',
      total_produtos_lidos: products.length,
      total_cestas: baskets.length,
      total_kits: kits.length,
      total_categorias: Object.keys(categories).length
    }
  }
};

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, JSON.stringify(output, null, 2), 'utf8');

console.log(`Pacote criado: ${OUTPUT}`);
console.log(`Produtos lidos por GET: ${products.length}`);
console.log(`Cestas preparadas: ${baskets.length}`);
console.log(`Kits preparados: ${kits.length}`);
console.log(`Categorias preparadas: ${Object.keys(categories).length}`);
console.log('Nenhuma gravação foi executada no Firebase.');
