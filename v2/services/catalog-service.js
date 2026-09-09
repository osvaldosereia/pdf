import { APP_CONFIG } from '../shared/config.js';
import { logger } from '../shared/logger.js';
import { normalizeCatalog, createProductIndex, validateCatalog } from '../shared/catalog.js';
import { readNode } from './firebase-service.js';

function isBlank(value) {
  return String(value ?? '').trim() === '';
}

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function percentage(part, total) {
  return total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0;
}

export function analyzeCatalogQuality(products = []) {
  const list = Array.isArray(products) ? products : [];
  const duplicateIds = new Set();
  const duplicateGtins = new Set();
  const seenIds = new Set();
  const seenGtins = new Set();

  const counters = {
    total: list.length,
    active: 0,
    inactive: 0,
    withStock: 0,
    withoutStock: 0,
    withoutImage: 0,
    withoutPrice: 0,
    withoutCategory: 0,
    withoutBrand: 0,
    withoutDescription: 0,
    withoutPackaging: 0,
    withoutGtin: 0
  };

  for (const product of list) {
    const active = String(product?.situacao || 'A').toUpperCase() !== 'I';
    counters[active ? 'active' : 'inactive'] += 1;
    counters[Number(product?.estoque || 0) > 0 ? 'withStock' : 'withoutStock'] += 1;

    if (isBlank(product?.imagem)) counters.withoutImage += 1;
    if (!(Number(product?.preco) > 0)) counters.withoutPrice += 1;
    if (isBlank(product?.categoria)) counters.withoutCategory += 1;
    if (isBlank(product?.marca)) counters.withoutBrand += 1;
    if (isBlank(product?.descricao)) counters.withoutDescription += 1;
    if (isBlank(product?.embalagem)) counters.withoutPackaging += 1;
    if (isBlank(product?.gtin)) counters.withoutGtin += 1;

    const id = normalizeKey(product?.id);
    if (id) {
      if (seenIds.has(id)) duplicateIds.add(id);
      seenIds.add(id);
    }

    const gtin = normalizeKey(product?.gtin);
    if (gtin) {
      if (seenGtins.has(gtin)) duplicateGtins.add(gtin);
      seenGtins.add(gtin);
    }
  }

  const completeness = {
    image: 100 - percentage(counters.withoutImage, counters.total),
    price: 100 - percentage(counters.withoutPrice, counters.total),
    category: 100 - percentage(counters.withoutCategory, counters.total),
    brand: 100 - percentage(counters.withoutBrand, counters.total),
    description: 100 - percentage(counters.withoutDescription, counters.total),
    packaging: 100 - percentage(counters.withoutPackaging, counters.total),
    gtin: 100 - percentage(counters.withoutGtin, counters.total)
  };

  return Object.freeze({
    ...counters,
    duplicateIds: Object.freeze(Array.from(duplicateIds)),
    duplicateGtins: Object.freeze(Array.from(duplicateGtins)),
    completeness: Object.freeze(completeness)
  });
}

export async function loadCatalogFromFirebase(options = {}) {
  const startedAt = performance.now();
  const node = options.node || APP_CONFIG.firebase.nodes.products;
  const response = await readNode(node, {
    timeoutMs: options.timeoutMs,
    cache: 'no-store'
  });

  const normalizationStartedAt = performance.now();
  const products = normalizeCatalog(response.data);
  const normalizationMs = Math.round(performance.now() - normalizationStartedAt);
  const audit = validateCatalog(products, Number(options.previousCount || 0));

  if (!audit.valid) {
    const error = new Error(`Catálogo rejeitado: ${audit.errors.join(' ')}`);
    logger.error('catalog-validation-failed', {
      module: 'catalog-service',
      error,
      data: { node, audit }
    });
    throw error;
  }

  const quality = analyzeCatalogQuality(products);
  const totalMs = Math.round(performance.now() - startedAt);
  const metrics = Object.freeze({
    firebaseMs: response.elapsedMs,
    normalizationMs,
    totalMs,
    productCount: products.length
  });

  logger.info('catalog-loaded', {
    module: 'catalog-service',
    data: { node, metrics, quality }
  });

  return Object.freeze({
    products,
    index: createProductIndex(products),
    audit,
    quality,
    metrics,
    source: 'firebase',
    stale: false
  });
}

export function findProduct(catalogResult, identifier) {
  const key = normalizeKey(identifier);
  if (!key) return null;

  if (catalogResult?.index instanceof Map) {
    return catalogResult.index.get(key) || null;
  }

  const products = Array.isArray(catalogResult?.products)
    ? catalogResult.products
    : Array.isArray(catalogResult)
      ? catalogResult
      : [];

  return createProductIndex(products).get(key) || null;
}

export const catalogService = Object.freeze({
  loadCatalogFromFirebase,
  analyzeCatalogQuality,
  findProduct
});
