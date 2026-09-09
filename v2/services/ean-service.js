import { loadCatalogFromFirebase, findProduct } from './catalog-service.js';

export function normalizeEan(value) {
  return String(value ?? '').replace(/\D/g, '').trim();
}

export function validateEan(value) {
  const ean = normalizeEan(value);
  const errors = [];
  if (!ean) errors.push('Informe ou leia um código EAN.');
  if (ean && !/^\d{8,14}$/.test(ean)) errors.push('O EAN deve conter entre 8 e 14 dígitos.');
  return Object.freeze({ valid: errors.length === 0, ean, errors: Object.freeze(errors) });
}

export async function lookupProductByEan(value, options = {}) {
  const validation = validateEan(value);
  if (!validation.valid) {
    const error = new Error(validation.errors.join(' '));
    error.code = 'INVALID_EAN';
    throw error;
  }

  const catalog = options.catalogResult || await loadCatalogFromFirebase({
    timeoutMs: options.timeoutMs,
    previousCount: options.previousCount
  });

  const product = findProduct(catalog, validation.ean);
  return Object.freeze({
    found: Boolean(product),
    ean: validation.ean,
    product: product || null,
    catalog
  });
}

export function createNewProductSeed(ean, defaults = {}) {
  const validation = validateEan(ean);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  return Object.freeze({
    id: '',
    firebaseKey: '',
    codigo: '',
    gtin: validation.ean,
    nome: '',
    descricao: '',
    categoria: String(defaults.categoria || ''),
    subcategoria: String(defaults.subcategoria || ''),
    subsubcategoria: '',
    marca: '',
    fornecedor: '',
    embalagem: '',
    tags: '',
    ncm: '',
    preco_custo: 0,
    preco: 0,
    estoque: 0,
    validade: '',
    gondola: '',
    prateleira: '',
    imagem: '',
    situacao: 'A',
    draftOnly: true,
    source: 'ean-not-found'
  });
}

export const eanService = Object.freeze({
  normalizeEan,
  validateEan,
  lookupProductByEan,
  createNewProductSeed
});