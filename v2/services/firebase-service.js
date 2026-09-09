import { APP_CONFIG, firebaseNodeUrl } from '../shared/config.js';
import { assertExternalWriteAllowed } from '../shared/environment.js';
import { logger } from '../shared/logger.js';

export class FirebaseServiceError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'FirebaseServiceError';
    this.context = context;
  }
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || APP_CONFIG.catalogSafety.requestTimeoutMs);
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: options.cache || 'no-store'
    });

    const elapsedMs = Math.round(performance.now() - startedAt);
    if (!response.ok) {
      throw new FirebaseServiceError(`Firebase respondeu HTTP ${response.status}.`, {
        url,
        status: response.status,
        elapsedMs
      });
    }

    const data = await response.json();
    logger.info('firebase-request-ok', {
      module: 'firebase-service',
      data: { method: options.method || 'GET', url, elapsedMs }
    });
    return { data, status: response.status, elapsedMs };
  } catch (error) {
    const normalized = error?.name === 'AbortError'
      ? new FirebaseServiceError(`Tempo limite de ${timeoutMs} ms ao acessar o Firebase.`, { url, timeoutMs })
      : error;
    logger.error('firebase-request-failed', {
      module: 'firebase-service',
      error: normalized,
      data: { method: options.method || 'GET', url }
    });
    throw normalized;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function readNode(node, options = {}) {
  const result = await request(firebaseNodeUrl(node), { ...options, method: 'GET' });
  return result;
}

export async function readRecord(node, recordId, options = {}) {
  const cleanId = encodeURIComponent(String(recordId || '').trim());
  if (!cleanId) throw new FirebaseServiceError('Identificador do registro não informado.');
  return request(firebaseNodeUrl(`${node}/${cleanId}`), { ...options, method: 'GET' });
}

export async function writeRecord(node, recordId, value, options = {}) {
  assertExternalWriteAllowed(`PUT ${node}/${recordId}`);
  const cleanId = encodeURIComponent(String(recordId || '').trim());
  if (!cleanId) throw new FirebaseServiceError('Identificador do registro não informado.');
  return request(firebaseNodeUrl(`${node}/${cleanId}`), {
    ...options,
    method: 'PUT',
    body: value
  });
}

export const firebaseService = Object.freeze({ readNode, readRecord, writeRecord });
