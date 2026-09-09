import { APP_CONFIG } from '../shared/config.js';
import { environmentSnapshot, assertExternalWriteAllowed } from '../shared/environment.js';
import { normalizeEan } from './ean-service.js';
import { PRODUCT_PHOTO_SLOTS, validateCaptureSession } from './product-photo-service.js';

const STORAGE_KEY = `${APP_CONFIG.cache.namespace}:product-ai-requests`;

function text(value) {
  return String(value ?? '').trim();
}

function readRequests() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeRequests(requests) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(requests.slice(0, 30)));
}

export function buildProductAiDraftRequest({ ean, session, category = '', subcategory = '', supplier = '' } = {}) {
  const normalizedEan = normalizeEan(ean || session?.ean);
  if (!/^\d{8,14}$/.test(normalizedEan)) throw new Error('EAN inválido para preparar a análise por IA.');

  const captureValidation = validateCaptureSession(session);
  if (!captureValidation.valid) throw new Error(captureValidation.errors.join(' '));

  const request = {
    id: `ai_product_${normalizedEan}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'product_registration_analysis',
    version: 1,
    mode: 'prepared_only',
    environment: environmentSnapshot(),
    createdAt: new Date().toISOString(),
    ean: normalizedEan,
    category: text(category),
    subcategory: text(subcategory),
    supplier: text(supplier),
    captureSessionId: session.id,
    photoSlots: PRODUCT_PHOTO_SLOTS
      .filter(slot => session.photos?.[slot.id]?.blob instanceof Blob)
      .map(slot => ({
        id: slot.id,
        label: slot.label,
        required: slot.required,
        filename: `${slot.id}.jpg`,
        contentType: session.photos[slot.id].type || 'image/jpeg',
        size: session.photos[slot.id].size || 0
      })),
    instructions: {
      extract: ['nome', 'descricao', 'ean', 'validade', 'marca', 'embalagem', 'peso_ou_volume', 'fabricante'],
      research: ['nome_comercial_confirmado', 'ncm_provavel', 'categoria', 'subcategoria'],
      generate: ['descricao_objetiva', 'tags'],
      restrictions: [
        'Não inventar dados ilegíveis.',
        'Marcar campos incertos para revisão humana.',
        'Não gravar no Firebase.',
        'Não publicar imagem no GitHub.',
        'Não alterar estoque ou preço automaticamente.'
      ]
    }
  };

  return Object.freeze(request);
}

export function buildProductAiFormData(request, session) {
  if (!request?.id || !session?.id || request.captureSessionId !== session.id) throw new Error('Pacote de análise incompatível com a sessão de fotos.');
  const form = new FormData();
  form.append('request', JSON.stringify(request));
  for (const slot of PRODUCT_PHOTO_SLOTS) {
    const photo = session.photos?.[slot.id];
    if (photo?.blob instanceof Blob) form.append(`photo_${slot.id}`, photo.blob, `${slot.id}.jpg`);
  }
  return form;
}

export function storePreparedProductAiRequest(request) {
  if (!request?.id || request.mode !== 'prepared_only') throw new Error('Solicitação de IA inválida.');
  const safeCopy = JSON.parse(JSON.stringify(request));
  const requests = [safeCopy, ...readRequests().filter(item => item?.id !== request.id)];
  writeRequests(requests);
  return safeCopy;
}

export function readPreparedProductAiRequests() {
  return Object.freeze(readRequests());
}

export function canDispatchProductAiRequest() {
  return false;
}

export async function dispatchProductAiRequest({ endpoint, request, session } = {}) {
  assertExternalWriteAllowed('POST product registration images to Make');
  if (!text(endpoint)) throw new Error('Webhook do Make não configurado.');
  const response = await fetch(endpoint, { method: 'POST', body: buildProductAiFormData(request, session) });
  if (!response.ok) throw new Error(`Make respondeu HTTP ${response.status}.`);
  return response.json();
}
