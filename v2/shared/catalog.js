import { APP_CONFIG, firebaseNodeUrl } from './config.js';

const CACHE_KEY = `${APP_CONFIG.cache.namespace}:catalog`;

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text) || 0;
  return Number(text.replace(/[^0-9,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}

function text(value) {
  return String(value ?? '').trim();
}

export function normalizeProduct(raw = {}, key = '') {
  const firebaseKey = text(raw.firebaseKey || key || raw.id || raw.codigo);
  const codigo = text(raw.codigo || raw.sku || raw.id || firebaseKey);
  const id = text(raw.id || codigo || firebaseKey);
  const image = text(raw.url_imagem || raw.imagem_url || raw.imagem || raw.img || raw.foto || '');

  return Object.freeze({
    id,
    firebaseKey,
    codigo,
    gtin: text(raw.gtin || raw.ean),
    nome: text(raw.nome || raw.name || raw.descricao || 'Produto'),
    descricao: text(raw.descricao),
    categoria: text(raw.categoria || raw.category),
    subcategoria: text(raw.subcategoria),
    subsubcategoria: text(raw.subsubcategoria),
    marca: text(raw.marca),
    embalagem: text(raw.embalagem),
    preco: toNumber(raw.preco ?? raw.price ?? raw.valor),
    precoOferta: toNumber(raw.preco_oferta ?? raw.precoOferta),
    estoque: Math.max(0, Math.floor(toNumber(raw.estoque ?? raw.stock))),
    situacao: text(raw.situacao || 'A').toUpperCase(),
    validade: text(raw.validade),
    validadeOferta: text(raw.validade_oferta || raw.validadeOferta),
    imagem: image
  });
}

function entries(raw) {
  if (Array.isArray(raw)) return raw.map((value, index) => [String(index), value]);
  if (raw && typeof raw === 'object') return Object.entries(raw);
  return [];
}

export function normalizeCatalog(raw) {
  return entries(raw)
    .filter(([, value]) => value && typeof value === 'object')
    .map(([key, value]) => normalizeProduct(value, key))
    .filter(product => product.id && product.nome && product.situacao !== 'I')
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

export function validateCatalog(products, previousCount = 0) {
  const list = Array.isArray(products) ? products : [];
  const errors = [];

  if (list.length < APP_CONFIG.catalogSafety.minimumProducts) {
    errors.push('Catálogo vazio ou abaixo da quantidade mínima permitida.');
  }

  const duplicatedIds = new Set();
  const seenIds = new Set();
  for (const product of list) {
    if (!product.id || !product.nome) errors.push('Existe produto sem identificador ou nome.');
    if (seenIds.has(product.id)) duplicatedIds.add(product.id);
    seenIds.add(product.id);
  }
  if (duplicatedIds.size) errors.push(`Identificadores duplicados: ${Array.from(duplicatedIds).slice(0, 10).join(', ')}`);

  if (previousCount > 0) {
    const dropRatio = (previousCount - list.length) / previousCount;
    if (dropRatio > APP_CONFIG.catalogSafety.maximumDropRatio) {
      errors.push(`Queda anormal de catálogo: ${previousCount} para ${list.length} produtos.`);
    }
  }

  return Object.freeze({ valid: errors.length === 0, errors, count: list.length });
}

async function fetchJson(url, { timeoutMs = APP_CONFIG.catalogSafety.requestTimeoutMs, cache = 'no-cache' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache, headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function readCache() {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!value || !Array.isArray(value.products)) return null;
    return value;
  } catch {
    return null;
  }
}

function writeCache(products, source) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), source, products }));
  } catch {
    // O catálogo continua funcional mesmo sem armazenamento local.
  }
}

export async function loadCatalog({ onStatus } = {}) {
  const cache = readCache();
  const cachedCount = cache?.products?.length || 0;

  if (cache?.products?.length) onStatus?.({ phase: 'cache', products: cache.products, source: cache.source, stale: true });

  const sources = [
    { name: 'snapshot', url: APP_CONFIG.snapshots.productsHome, cache: 'no-cache' },
    { name: 'firebase', url: firebaseNodeUrl(APP_CONFIG.firebase.nodes.products), cache: 'no-store' }
  ];

  const errors = [];
  for (const source of sources) {
    try {
      const raw = await fetchJson(source.url, { cache: source.cache });
      const products = normalizeCatalog(raw);
      const audit = validateCatalog(products, cachedCount);
      if (!audit.valid) throw new Error(audit.errors.join(' '));
      writeCache(products, source.name);
      const result = Object.freeze({ products, source: source.name, stale: false, audit });
      onStatus?.({ phase: 'ready', ...result });
      return result;
    } catch (error) {
      errors.push(`${source.name}: ${error.message || error}`);
    }
  }

  if (cache?.products?.length) {
    const age = Date.now() - Number(cache.savedAt || 0);
    if (age <= APP_CONFIG.cache.staleCatalogMaxAgeMs) {
      const result = Object.freeze({ products: cache.products, source: 'cache', stale: true, audit: validateCatalog(cache.products) });
      onStatus?.({ phase: 'ready', ...result, warning: errors.join(' | ') });
      return result;
    }
  }

  throw new Error(`Nenhuma fonte segura de catálogo disponível. ${errors.join(' | ')}`);
}

export function createProductIndex(products) {
  const map = new Map();
  for (const product of products || []) {
    [product.id, product.firebaseKey, product.codigo, product.gtin]
      .map(value => text(value).toLowerCase())
      .filter(Boolean)
      .forEach(key => { if (!map.has(key)) map.set(key, product); });
  }
  return map;
}
