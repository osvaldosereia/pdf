import { APP_CONFIG } from './config.js';
import { getEnvironment } from './environment.js';

const MAX_LOCAL_ENTRIES = 250;
const STORAGE_KEY = `${APP_CONFIG.cache.namespace}:logs`;

function normalizeError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack || '' };
  }
  return { name: 'Error', message: String(error), stack: '' };
}

function readStoredLogs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(entry) {
  if (typeof localStorage === 'undefined') return;
  try {
    const logs = readStoredLogs();
    logs.unshift(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, MAX_LOCAL_ENTRIES)));
  } catch {
    // O logger nunca deve interromper a operação principal.
  }
}

export function log(level, event, details = {}) {
  const entry = Object.freeze({
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level: String(level || 'info').toLowerCase(),
    event: String(event || 'unknown-event'),
    module: String(details.module || 'core'),
    environment: getEnvironment(),
    version: APP_CONFIG.version,
    createdAt: new Date().toISOString(),
    data: details.data ?? null,
    error: normalizeError(details.error)
  });

  persist(entry);

  const method = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'info';
  console[method](`[${entry.module}] ${entry.event}`, entry);
  return entry;
}

export const logger = Object.freeze({
  info: (event, details) => log('info', event, details),
  warn: (event, details) => log('warn', event, details),
  error: (event, details) => log('error', event, details),
  list: () => readStoredLogs(),
  clear: () => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  }
});
