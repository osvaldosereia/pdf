import { APP_CONFIG, firebaseNodeUrl } from '../shared/config.js';
import { assertExternalWriteAllowed, environmentSnapshot } from '../shared/environment.js';
import { formatWhatsAppMessage } from '../shared/order-delivery.js';
import { saveHomologationOrder } from './firebase-homologation-order-adapter.js';
import { createMakeHomologationOrderAdapter } from './make-homologation-order-adapter.js';

const STORAGE_KEY = `${APP_CONFIG.cache.namespace}:order-dispatch-sessions`;
const CHANNEL_ORDER = Object.freeze(['whatsapp', 'firebase', 'make']);

export const DISPATCH_STATUS = Object.freeze({
  PREPARED: 'prepared',
  WAITING_WHATSAPP: 'waiting_whatsapp',
  WHATSAPP_OPENED: 'whatsapp_opened',
  BLOCKED: 'blocked',
  PENDING: 'pending',
  SUCCESS: 'success',
  ERROR: 'error'
});

function text(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function safeParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function now() {
  return new Date().toISOString();
}

function readSessionsMutable() {
  const parsed = safeParse(localStorage.getItem(STORAGE_KEY) || '[]', []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeSessions(sessions) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 100)));
}

function channelState(status, detail = '', attempts = 0, metadata = {}) {
  return {
    status,
    detail: text(detail),
    attempts,
    updatedAt: now(),
    ...clone(metadata || {})
  };
}

export function validateDispatchEnvelope(envelope = {}) {
  const errors = [];
  if (!text(envelope.id)) errors.push('Pedido sem identificador de envelope.');
  if (!text(envelope.fingerprint)) errors.push('Pedido sem impressão de idempotência.');
  if (envelope.ambiente !== 'homologation') errors.push('Somente pedidos de homologação são aceitos nesta etapa.');
  if (!envelope.order || typeof envelope.order !== 'object') errors.push('Payload do pedido ausente.');
  if (!Array.isArray(envelope.order?.itens) || envelope.order.itens.length === 0) errors.push('Pedido sem itens.');
  if (!text(envelope.order?.cliente?.telefone)) errors.push('Telefone do cliente ausente.');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function buildWhatsAppUrl(envelope) {
  const validation = validateDispatchEnvelope(envelope);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const number = text(APP_CONFIG.commerce.whatsappNumber).replace(/\D/g, '');
  if (!number) throw new Error('Número do WhatsApp não configurado.');
  const message = formatWhatsAppMessage(envelope.order);
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function buildDispatchPlan(envelope) {
  const validation = validateDispatchEnvelope(envelope);
  if (!validation.valid) throw new Error(validation.errors.join(' '));
  const config = APP_CONFIG.integrations.orderDispatch;
  const firebasePath = `${APP_CONFIG.firebase.nodes.homologationOrders}/${envelope.id}`;

  return Object.freeze({
    envelopeId: envelope.id,
    fingerprint: envelope.fingerprint,
    environment: environmentSnapshot(),
    sequence: CHANNEL_ORDER,
    channels: Object.freeze({
      whatsapp: Object.freeze({
        order: 1,
        mode: 'manual_preview',
        enabled: config.whatsappPreviewEnabled === true,
        url: config.whatsappPreviewEnabled ? buildWhatsAppUrl(envelope) : '',
        message: formatWhatsAppMessage(envelope.order)
      }),
      firebase: Object.freeze({
        order: 2,
        mode: 'homologation_external_write',
        enabled: config.firebaseWriteEnabled === true,
        path: firebasePath,
        url: firebaseNodeUrl(firebasePath),
        productionPathBlocked: true
      }),
      make: Object.freeze({
        order: 3,
        mode: 'homologation_webhook',
        enabled: config.makeWriteEnabled === true && Boolean(text(config.makeWebhookUrl)),
        endpointConfigured: Boolean(text(config.makeWebhookUrl)),
        contractVersion: Number(config.makeContractVersion || 1),
        requiresBlingConfirmation: config.makeRequireBlingConfirmation !== false,
        blingMode: APP_CONFIG.integrations.bling.mode,
        maximumAttempts: Number(config.maximumAttempts || 1),
        timeoutMs: Number(config.requestTimeoutMs || 12000)
      })
    })
  });
}

export function prepareDispatchSession(envelope) {
  const plan = buildDispatchPlan(envelope);
  const sessions = readSessionsMutable();
  const previous = sessions.find(item => item?.fingerprint === envelope.fingerprint);
  if (previous) return Object.freeze({ session: Object.freeze(previous), duplicate: true, created: false });

  const createdAt = now();
  const session = {
    id: `dispatch_${envelope.id}`,
    envelopeId: envelope.id,
    fingerprint: envelope.fingerprint,
    createdAt,
    updatedAt: createdAt,
    status: DISPATCH_STATUS.WAITING_WHATSAPP,
    plan: clone(plan),
    envelope: clone(envelope),
    channels: {
      whatsapp: channelState(DISPATCH_STATUS.PREPARED, 'Mensagem preparada para abertura manual.'),
      firebase: channelState(DISPATCH_STATUS.BLOCKED, `Escrita bloqueada em ${APP_CONFIG.firebase.nodes.homologationOrders}.`),
      make: channelState(DISPATCH_STATUS.BLOCKED, 'Webhook do Make bloqueado na homologação.', 0, {
        bling: { status: 'not_processed', completed: false, detail: 'Aguardando execução segura pelo Make.' }
      })
    },
    history: [{ at: createdAt, action: 'dispatch_prepared', status: DISPATCH_STATUS.WAITING_WHATSAPP }]
  };
  writeSessions([session, ...sessions]);
  return Object.freeze({ session: Object.freeze(session), duplicate: false, created: true });
}

export function readDispatchSessions() {
  return Object.freeze(readSessionsMutable().map(item => Object.freeze(item)));
}

export function findDispatchSession(envelopeId) {
  return readDispatchSessions().find(item => item.envelopeId === text(envelopeId)) || null;
}

function replaceSession(next) {
  const sessions = readSessionsMutable();
  writeSessions([next, ...sessions.filter(item => item?.id !== next.id)]);
  return Object.freeze(next);
}

export function appendDispatchHistory(envelopeId, event = {}) {
  const session = findDispatchSession(envelopeId);
  if (!session) throw new Error('Sessão de despacho não encontrada.');
  const updatedAt = now();
  const entry = {
    at: updatedAt,
    action: text(event.action || 'dispatch_event'),
    status: text(event.status || session.status),
    channel: text(event.channel),
    detail: text(event.detail),
    requestId: text(event.requestId),
    ...clone(event.metadata || {})
  };
  return replaceSession({
    ...clone(session),
    updatedAt,
    history: [entry, ...(session.history || [])].slice(0, 100)
  });
}

export function markWhatsAppOpened(envelopeId) {
  const session = findDispatchSession(envelopeId);
  if (!session) throw new Error('Sessão de despacho não encontrada.');
  const updatedAt = now();
  return replaceSession({
    ...clone(session),
    updatedAt,
    status: DISPATCH_STATUS.WHATSAPP_OPENED,
    channels: {
      ...clone(session.channels),
      whatsapp: channelState(DISPATCH_STATUS.WHATSAPP_OPENED, 'Abertura manual registrada localmente.', Number(session.channels?.whatsapp?.attempts || 0) + 1)
    },
    history: [{ at: updatedAt, action: 'whatsapp_opened', status: DISPATCH_STATUS.WHATSAPP_OPENED }, ...(session.history || [])].slice(0, 100)
  });
}

export function registerChannelResult(envelopeId, channel, result = {}) {
  if (!CHANNEL_ORDER.includes(channel)) throw new Error('Canal de despacho inválido.');
  const session = findDispatchSession(envelopeId);
  if (!session) throw new Error('Sessão de despacho não encontrada.');
  const updatedAt = now();
  const success = result.success === true;
  const reportedAttempts = Number.isFinite(Number(result.attempts)) ? Math.max(0, Number(result.attempts)) : 1;
  const attemptIncrement = result.blocked === true ? reportedAttempts : Math.max(1, reportedAttempts);
  const metadata = {
    blocked: result.blocked === true,
    duplicate: result.duplicate === true,
    conflict: result.conflict === true,
    retryable: result.retryable === true,
    httpStatus: Number(result.status || 0),
    target: clone(result.target),
    contract: clone(result.contract),
    bling: clone(result.bling)
  };
  const nextChannel = channelState(
    success ? DISPATCH_STATUS.SUCCESS : result.blocked === true ? DISPATCH_STATUS.BLOCKED : DISPATCH_STATUS.ERROR,
    result.detail || result.error || (success ? 'Concluído.' : 'Falha sem detalhe.'),
    Number(session.channels?.[channel]?.attempts || 0) + attemptIncrement,
    metadata
  );
  const channels = { ...clone(session.channels), [channel]: nextChannel };
  const allExternalSuccess = channels.firebase.status === DISPATCH_STATUS.SUCCESS && channels.make.status === DISPATCH_STATUS.SUCCESS;
  return replaceSession({
    ...clone(session),
    updatedAt,
    status: allExternalSuccess ? DISPATCH_STATUS.SUCCESS : success ? DISPATCH_STATUS.PENDING : result.blocked === true ? DISPATCH_STATUS.PENDING : DISPATCH_STATUS.ERROR,
    channels,
    history: [{
      at: updatedAt,
      action: `${channel}_${success ? 'success' : result.blocked === true ? 'blocked' : 'error'}`,
      status: nextChannel.status,
      detail: nextChannel.detail,
      attempts: reportedAttempts,
      duplicate: result.duplicate === true,
      conflict: result.conflict === true,
      blingStatus: text(result.bling?.status),
      blingSaleId: text(result.bling?.saleId),
      blingSaleNumber: text(result.bling?.saleNumber)
    }, ...(session.history || [])].slice(0, 100)
  });
}

export function simulateDispatch(envelope) {
  const prepared = prepareDispatchSession(envelope);
  return Object.freeze({
    ...prepared,
    simulation: true,
    externalWritesExecuted: false,
    nextAction: 'open_whatsapp_manually'
  });
}

export async function dispatchExternalChannels(envelope, adapters = {}) {
  assertExternalWriteAllowed('dispatch order to Firebase homologation and Make');
  const config = APP_CONFIG.integrations.orderDispatch;
  if (config.firebaseWriteEnabled !== true || config.makeWriteEnabled !== true) throw new Error('Canais externos continuam desabilitados na configuração.');
  let session = findDispatchSession(envelope.id);
  if (!session || session.channels?.whatsapp?.status !== DISPATCH_STATUS.WHATSAPP_OPENED) throw new Error('Registre primeiro a abertura do WhatsApp.');

  const maximumAttempts = Math.max(1, Number(config.maximumAttempts || 1));
  const firebaseAdapter = typeof adapters.firebase === 'function' ? adapters.firebase : saveHomologationOrder;

  if (session.channels?.firebase?.status !== DISPATCH_STATUS.SUCCESS) {
    if (Number(session.channels?.firebase?.attempts || 0) >= maximumAttempts) throw new Error('Limite de tentativas do Firebase atingido para este pedido.');
    const firebaseResult = await firebaseAdapter(envelope);
    session = registerChannelResult(envelope.id, 'firebase', firebaseResult);
    if (firebaseResult?.success !== true) return session;
  }

  session = findDispatchSession(envelope.id);
  if (session.channels?.make?.status === DISPATCH_STATUS.SUCCESS) return session;

  const previousMakeAttempts = Number(session.channels?.make?.attempts || 0);
  const remainingMakeAttempts = maximumAttempts - previousMakeAttempts;
  if (remainingMakeAttempts <= 0) throw new Error('Limite de tentativas do Make atingido para este pedido.');

  const makeAdapter = typeof adapters.make === 'function'
    ? adapters.make
    : createMakeHomologationOrderAdapter({ maximumAttempts: remainingMakeAttempts });
  const makeResult = await makeAdapter(envelope);
  return registerChannelResult(envelope.id, 'make', makeResult);
}

export function clearDispatchSessions() {
  localStorage.removeItem(STORAGE_KEY);
  return [];
}

export const orderDispatchService = Object.freeze({
  validateDispatchEnvelope,
  buildWhatsAppUrl,
  buildDispatchPlan,
  prepareDispatchSession,
  readDispatchSessions,
  findDispatchSession,
  appendDispatchHistory,
  markWhatsAppOpened,
  registerChannelResult,
  simulateDispatch,
  dispatchExternalChannels,
  clearDispatchSessions
});
