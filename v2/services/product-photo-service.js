import { APP_CONFIG } from '../shared/config.js';

const DB_NAME = `${APP_CONFIG.cache.namespace}_product_capture`;
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

export const PRODUCT_PHOTO_SLOTS = Object.freeze([
  Object.freeze({ id: 'front', label: 'Frente', required: true, description: 'Foto frontal completa e bem iluminada.' }),
  Object.freeze({ id: 'ean', label: 'EAN', required: true, description: 'Código de barras ocupando a maior parte da imagem.' }),
  Object.freeze({ id: 'expiry', label: 'Validade', required: true, description: 'Data de validade legível e sem reflexo.' }),
  Object.freeze({ id: 'information', label: 'Informações', required: false, description: 'Ingredientes, peso, fabricante ou outras informações.' })
]);

function text(value) {
  return String(value ?? '').trim();
}

function slotDefinition(slotId) {
  return PRODUCT_PHOTO_SLOTS.find(slot => slot.id === slotId) || null;
}

export function validateImageFile(file) {
  const errors = [];
  if (!(file instanceof Blob)) errors.push('Selecione uma imagem válida.');
  if (file instanceof Blob && !String(file.type || '').startsWith('image/')) errors.push('O arquivo selecionado não é uma imagem.');
  if (file instanceof Blob && file.size <= 0) errors.push('A imagem está vazia.');
  if (file instanceof Blob && file.size > MAX_IMAGE_BYTES) errors.push('A imagem deve ter no máximo 12 MB.');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function createCaptureSession(ean) {
  const normalizedEan = text(ean).replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(normalizedEan)) throw new Error('EAN inválido para iniciar a captura.');
  const now = new Date().toISOString();
  return {
    id: `capture_${normalizedEan}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ean: normalizedEan,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    photos: {}
  };
}

async function loadImage(blob) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir a imagem.')); };
    image.src = url;
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível processar a imagem.')), 'image/jpeg', JPEG_QUALITY);
  });
}

export async function optimizeProductPhoto(file) {
  const validation = validateImageFile(file);
  if (!validation.valid) throw new Error(validation.errors.join(' '));

  const image = await loadImage(file);
  const originalWidth = Number(image.width || image.naturalWidth || 0);
  const originalHeight = Number(image.height || image.naturalHeight || 0);
  if (!originalWidth || !originalHeight) throw new Error('A imagem não possui dimensões válidas.');

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(originalWidth, originalHeight));
  const width = Math.max(1, Math.round(originalWidth * scale));
  const height = Math.max(1, Math.round(originalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('O navegador não conseguiu preparar a imagem.');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  if (typeof image.close === 'function') image.close();

  const blob = await canvasToBlob(canvas);
  return Object.freeze({ blob, width, height, originalWidth, originalHeight, originalSize: file.size });
}

export async function setCapturePhoto(session, slotId, file) {
  const slot = slotDefinition(slotId);
  if (!slot) throw new Error('Tipo de foto não reconhecido.');
  if (!session?.id) throw new Error('Sessão de captura inválida.');
  const optimized = await optimizeProductPhoto(file);
  const photo = {
    slot: slot.id,
    label: slot.label,
    required: slot.required,
    type: optimized.blob.type || 'image/jpeg',
    size: optimized.blob.size,
    width: optimized.width,
    height: optimized.height,
    originalName: text(file.name) || `${slot.id}.jpg`,
    capturedAt: new Date().toISOString(),
    blob: optimized.blob
  };
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    photos: { ...(session.photos || {}), [slot.id]: photo }
  };
}

export function validateCaptureSession(session) {
  const errors = [];
  if (!session?.id) errors.push('Sessão de captura inexistente.');
  if (!/^\d{8,14}$/.test(text(session?.ean))) errors.push('EAN da sessão inválido.');
  for (const slot of PRODUCT_PHOTO_SLOTS) {
    if (slot.required && !(session?.photos?.[slot.id]?.blob instanceof Blob)) errors.push(`A foto ${slot.label} é obrigatória.`);
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    captured: PRODUCT_PHOTO_SLOTS.filter(slot => session?.photos?.[slot.id]?.blob instanceof Blob).length,
    required: PRODUCT_PHOTO_SLOTS.filter(slot => slot.required).length
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('Este navegador não oferece armazenamento local de imagens.'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir armazenamento de imagens.'));
  });
}

function databaseAction(mode, operation) {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let request;
    try { request = operation(store); } catch (error) { db.close(); reject(error); return; }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha no armazenamento local de imagens.'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Falha no armazenamento local de imagens.')); };
  }));
}

export async function saveCaptureSession(session) {
  if (!session?.id) throw new Error('Sessão de captura inválida.');
  await databaseAction('readwrite', store => store.put(session));
  return session;
}

export async function loadCaptureSession(sessionId) {
  if (!text(sessionId)) return null;
  return databaseAction('readonly', store => store.get(text(sessionId)));
}

export async function deleteCaptureSession(sessionId) {
  if (!text(sessionId)) return false;
  await databaseAction('readwrite', store => store.delete(text(sessionId)));
  return true;
}

export function createPhotoPreviewUrl(photo) {
  return photo?.blob instanceof Blob ? URL.createObjectURL(photo.blob) : '';
}
