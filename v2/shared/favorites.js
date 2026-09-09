import { APP_CONFIG } from './config.js';

const STORAGE_KEY = `${APP_CONFIG.cache.namespace}:favorites`;
let favorites = read();
const listeners = new Set();

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(String).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(favorites)));
  const snapshot = getFavorites();
  listeners.forEach(listener => listener(snapshot));
}

export function getFavorites() {
  return Array.from(favorites);
}

export function isFavorite(productId) {
  return favorites.has(String(productId || ''));
}

export function toggleFavorite(productId) {
  const id = String(productId || '').trim();
  if (!id) return getFavorites();
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  persist();
  return getFavorites();
}

export function clearFavorites() {
  favorites = new Set();
  persist();
}

export function subscribeFavorites(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}
