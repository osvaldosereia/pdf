import { APP_CONFIG } from './config.js';

const STORAGE_KEY = `${APP_CONFIG.cache.namespace}:cart`;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function safeParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function sanitizeItems(items) {
  const output = {};
  Object.entries(items || {}).forEach(([id, quantity]) => {
    const key = String(id || '').trim();
    const qty = Math.max(0, Math.floor(Number(quantity) || 0));
    if (key && qty > 0) output[key] = qty;
  });
  return output;
}

function readEnvelope() {
  const raw = safeParse(localStorage.getItem(STORAGE_KEY), null);
  if (!raw || typeof raw !== 'object') return { savedAt: Date.now(), items: {} };
  if (Date.now() - Number(raw.savedAt || 0) > MAX_AGE_MS) return { savedAt: Date.now(), items: {} };
  return { savedAt: Number(raw.savedAt || Date.now()), items: sanitizeItems(raw.items) };
}

let envelope = readEnvelope();
const listeners = new Set();

function persist() {
  envelope.savedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
  listeners.forEach(listener => listener(getCart()));
}

export function getCart() {
  return { savedAt: envelope.savedAt, items: { ...envelope.items } };
}

export function getQuantity(productId) {
  return Number(envelope.items[String(productId)] || 0);
}

export function setQuantity(productId, quantity, stockLimit = Infinity) {
  const id = String(productId || '').trim();
  if (!id) return getCart();
  const safeLimit = Number.isFinite(Number(stockLimit)) ? Math.max(0, Math.floor(Number(stockLimit))) : Infinity;
  const qty = Math.max(0, Math.min(safeLimit, Math.floor(Number(quantity) || 0)));
  if (qty > 0) envelope.items[id] = qty;
  else delete envelope.items[id];
  persist();
  return getCart();
}

export function increment(productId, stockLimit = Infinity) {
  return setQuantity(productId, getQuantity(productId) + 1, stockLimit);
}

export function decrement(productId) {
  return setQuantity(productId, getQuantity(productId) - 1);
}

export function clearCart() {
  envelope = { savedAt: Date.now(), items: {} };
  persist();
  return getCart();
}

export function cartSummary(productMap) {
  let units = 0;
  let total = 0;
  const rows = [];
  Object.entries(envelope.items).forEach(([id, quantity]) => {
    const product = productMap instanceof Map ? productMap.get(id) : null;
    if (!product) return;
    const price = product.precoOferta > 0 && product.precoOferta < product.preco ? product.precoOferta : product.preco;
    units += quantity;
    total += quantity * Number(price || 0);
    rows.push({ product, quantity, subtotal: quantity * Number(price || 0) });
  });
  return { units, total, rows };
}

export function subscribeCart(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}
