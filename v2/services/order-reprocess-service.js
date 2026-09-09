import { APP_CONFIG } from '../shared/config.js';
import { assertExternalWriteAllowed, environmentSnapshot } from '../shared/environment.js';
import {
  DISPATCH_STATUS,
  findDispatchSession,
  registerChannelResult,
  appendDispatchHistory
} from './order-dispatch-service.js';
import { saveHomologationOrder } from './firebase-homologation-order-adapter.js';
import { createMakeHomologationOrderAdapter } from './make-homologation-order-adapter.js';

const STORAGE_KEY = `${APP_CONFIG.cache.namespace}:order-reprocess-requests`;
const REPROCESSABLE_CHANNELS = Object.freeze(['firebase', 'make']);

export const REPROCESS_STATUS = Object.freeze({
  AWAITING_CONFIRMATION: 'awaiting_confirmation',
  EXECUTING: 'executing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired'
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

function readMutable(storage = localStorage) {
  const parsed = safeParse(storage.getItem(STORAGE_KEY) || '[]', []);
  return Array.isArray(parsed) ? parsed : [];
}

function writeMutable(requests, storage = localStorage) {
  storage.setItem(STORAGE_KEY, JSON.stringify(requests.slice(0, 100)));
}

function channelLabel(channel) {
  return channel === 'firebase' ? 'Firebase' : channel === 'make' ? 'Make/Bling' : channel;
}

function confirmationPhrase(channel, envelopeId) {
  return `REPROCESSAR ${channel.toUpperCase()} ${text(envelopeId)}`;
}

export function createOrderReprocessService(options = {}) {
  const config = options.config || APP_CONFIG.integrations.orderDispatch;
  const storage = options.storage || localStorage;
  const nowFn = options.nowFn || (() => Date.now());
  const environmentFn = options.environmentSnapshotFn || environmentSnapshot;
  const assertWrite = options.assertWriteFn || assertExternalWriteAllowed;
  const findSession = options.findSessionFn || findDispatchSession;
  const registerResult = options.registerChannelResultFn || registerChannelResult;
  const appendHistory = options.appendDispatchHistoryFn || appendDispatchHistory;
  const firebaseAdapter = options.firebaseAdapter || saveHomologationOrder;
  const makeAdapterFactory = options.makeAdapterFactory || (adapterOptions => createMakeHomologationOrderAdapter(adapterOptions));
  const maximumAttempts = Math.max(1, Number(config.maximumAttempts || 1));
  const reasonMinimumLength = Math.max(5, Number(config.reprocessReasonMinimumLength || 8));
  const confirmationTtlMs = Math.max(60_000, Number(config.reprocessConfirmationTtlMs || 10 * 60_000));

  function readRequests() {
    const currentTime = nowFn();
    const requests = readMutable(storage).map(request => {
      if (
        request.status === REPROCESS_STATUS.AWAITING_CONFIRMATION &&
        Number(request.expiresAt || 0) <= currentTime
      ) {
        return { ...request, status: REPROCESS_STATUS.EXPIRED, updatedAt: new Date(currentTime).toISOString() };
      }
      return request;
    });
    writeMutable(requests, storage);
    return Object.freeze(requests.map(request => Object.freeze(request)));
  }

  function findRequest(requestId) {
    return readRequests().find(request => request.id === text(requestId)) || null;
  }

  function findPending(envelopeId, channel = '') {
    return readRequests().find(request =>
      request.envelopeId === text(envelopeId) &&
      (!channel || request.channel === channel) &&
      request.status === REPROCESS_STATUS.AWAITING_CONFIRMATION
    ) || null;
  }

  function assess(envelopeId, channel) {
    const normalizedChannel = text(channel).toLowerCase();
    const reasons = [];
    const session = findSession(envelopeId);
    const environment = environmentFn();
    const activeRequest = readRequests().find(request =>
      request.envelopeId === text(envelopeId) &&
      request.channel === normalizedChannel &&
      request.status === REPROCESS_STATUS.EXECUTING
    );

    if (!REPROCESSABLE_CHANNELS.includes(normalizedChannel)) reasons.push('Somente Firebase ou Make podem ser reprocessados.');
    if (!session) reasons.push('Sessão de despacho não encontrada.');
    if (activeRequest) reasons.push('Já existe um reprocessamento em execução para este canal.');

    const channelState = session?.channels?.[normalizedChannel] || {};
    const attempts = Number(channelState.attempts || 0);
    const remainingAttempts = Math.max(0, maximumAttempts - attempts);

    if (session && session.channels?.whatsapp?.status !== DISPATCH_STATUS.WHATSAPP_OPENED) {
      reasons.push('A abertura do WhatsApp precisa estar registrada primeiro.');
    }
    if (channelState.status === DISPATCH_STATUS.SUCCESS) reasons.push(`${channelLabel(normalizedChannel)} já foi concluído.`);
    if (remainingAttempts <= 0) reasons.push(`Limite de ${maximumAttempts} tentativas atingido.`);
    if (normalizedChannel === 'make' && session?.channels?.firebase?.status !== DISPATCH_STATUS.SUCCESS) {
      reasons.push('O Firebase precisa estar concluído antes de repetir o Make.');
    }
    if (normalizedChannel === 'make' && channelState.bling?.completed === true) {
      reasons.push('A venda no Bling já está confirmada.');
    }
    if (
      normalizedChannel === 'make' &&
      channelState.bling?.rateLimited === true &&
      text(channelState.bling?.rateLimitPeriod).toLowerCase() === 'day'
    ) {
      reasons.push('O limite diário do Bling foi atingido; aguarde o próximo período antes de repetir.');
    }

    const enabledByConfig = normalizedChannel === 'firebase'
      ? config.firebaseWriteEnabled === true
      : config.makeWriteEnabled === true && Boolean(text(config.makeWebhookUrl));
    const externalWriteEnabled = environment.externalWriteEnabled === true;
    const eligible = reasons.length === 0;

    return Object.freeze({
      envelopeId: text(envelopeId),
      channel: normalizedChannel,
      channelLabel: channelLabel(normalizedChannel),
      eligible,
      configurationReady: enabledByConfig && externalWriteEnabled,
      canExecute: eligible && enabledByConfig && externalWriteEnabled,
      enabledByConfig,
      externalWriteEnabled,
      attempts,
      maximumAttempts,
      remainingAttempts,
      reasons: Object.freeze(reasons),
      session: session ? Object.freeze(clone(session)) : null
    });
  }

  function prepare(envelopeId, channel, reason) {
    const assessment = assess(envelopeId, channel);
    if (!assessment.eligible) throw new Error(assessment.reasons.join(' '));

    const cleanReason = text(reason);
    if (cleanReason.length < reasonMinimumLength) {
      throw new Error(`Informe um motivo com pelo menos ${reasonMinimumLength} caracteres.`);
    }

    const existing = findPending(envelopeId, assessment.channel);
    if (existing) return Object.freeze({ request: existing, duplicate: true, created: false, assessment });

    const currentTime = nowFn();
    const request = {
      id: `reprocess_${assessment.channel}_${currentTime}_${assessment.session.fingerprint}`,
      envelopeId: assessment.envelopeId,
      fingerprint: assessment.session.fingerprint,
      channel: assessment.channel,
      reason: cleanReason,
      confirmationPhrase: confirmationPhrase(assessment.channel, assessment.envelopeId),
      status: REPROCESS_STATUS.AWAITING_CONFIRMATION,
      createdAt: new Date(currentTime).toISOString(),
      updatedAt: new Date(currentTime).toISOString(),
      expiresAt: currentTime + confirmationTtlMs,
      remainingAttemptsAtCreation: assessment.remainingAttempts,
      configurationReadyAtCreation: assessment.configurationReady
    };

    writeMutable([request, ...readMutable(storage)], storage);
    appendHistory(assessment.envelopeId, {
      action: 'reprocess_prepared',
      status: REPROCESS_STATUS.AWAITING_CONFIRMATION,
      channel: assessment.channel,
      detail: cleanReason,
      requestId: request.id
    });

    return Object.freeze({ request: Object.freeze(request), duplicate: false, created: true, assessment });
  }

  function updateRequest(requestId, patch = {}) {
    const requests = readMutable(storage);
    const index = requests.findIndex(request => request.id === text(requestId));
    if (index < 0) throw new Error('Solicitação de reprocessamento não encontrada.');
    const next = { ...requests[index], ...clone(patch), updatedAt: new Date(nowFn()).toISOString() };
    requests[index] = next;
    writeMutable(requests, storage);
    return Object.freeze(next);
  }

  function cancel(requestId) {
    const request = findRequest(requestId);
    if (!request) throw new Error('Solicitação de reprocessamento não encontrada.');
    if (request.status !== REPROCESS_STATUS.AWAITING_CONFIRMATION) throw new Error('Esta solicitação não pode mais ser cancelada.');
    const cancelled = updateRequest(request.id, { status: REPROCESS_STATUS.CANCELLED });
    appendHistory(request.envelopeId, {
      action: 'reprocess_cancelled',
      status: REPROCESS_STATUS.CANCELLED,
      channel: request.channel,
      requestId: request.id
    });
    return cancelled;
  }

  async function execute(requestId, confirmation) {
    const request = findRequest(requestId);
    if (!request) throw new Error('Solicitação de reprocessamento não encontrada.');
    if (request.status === REPROCESS_STATUS.EXPIRED || Number(request.expiresAt || 0) <= nowFn()) {
      updateRequest(request.id, { status: REPROCESS_STATUS.EXPIRED });
      throw new Error('A confirmação expirou. Prepare uma nova tentativa.');
    }
    if (request.status !== REPROCESS_STATUS.AWAITING_CONFIRMATION) throw new Error('Esta solicitação não está aguardando confirmação.');
    if (text(confirmation) !== request.confirmationPhrase) throw new Error('Frase de confirmação incorreta.');

    const assessment = assess(request.envelopeId, request.channel);
    if (!assessment.eligible) {
      updateRequest(request.id, { status: REPROCESS_STATUS.FAILED, detail: assessment.reasons.join(' ') });
      throw new Error(assessment.reasons.join(' '));
    }
    if (assessment.session.fingerprint !== request.fingerprint) {
      updateRequest(request.id, { status: REPROCESS_STATUS.FAILED, detail: 'Fingerprint do pedido foi alterado.' });
      throw new Error('O pedido mudou desde a preparação. Prepare uma nova tentativa.');
    }
    if (!assessment.configurationReady) {
      appendHistory(request.envelopeId, {
        action: 'reprocess_blocked',
        status: DISPATCH_STATUS.BLOCKED,
        channel: request.channel,
        requestId: request.id,
        detail: 'A política de escrita ou a configuração do canal continua desabilitada.'
      });
      return Object.freeze({
        executed: false,
        blocked: true,
        request,
        assessment,
        detail: 'Reprocessamento preparado, mas a escrita externa continua desabilitada.'
      });
    }

    assertWrite(`reprocess ${request.channel} for ${request.envelopeId}`);
    updateRequest(request.id, { status: REPROCESS_STATUS.EXECUTING });
    appendHistory(request.envelopeId, {
      action: 'reprocess_started',
      status: REPROCESS_STATUS.EXECUTING,
      channel: request.channel,
      requestId: request.id,
      detail: request.reason
    });

    let result;
    try {
      if (request.channel === 'firebase') {
        result = await firebaseAdapter(assessment.session.envelope);
      } else {
        const makeAdapter = makeAdapterFactory({ maximumAttempts: assessment.remainingAttempts });
        result = await makeAdapter(assessment.session.envelope);
      }
    } catch (error) {
      const detail = text(error?.message || error) || 'Falha inesperada durante o reprocessamento.';
      registerResult(request.envelopeId, request.channel, {
        success: false,
        attempts: 1,
        retryable: true,
        detail
      });
      updateRequest(request.id, { status: REPROCESS_STATUS.FAILED, detail });
      appendHistory(request.envelopeId, {
        action: 'reprocess_failed',
        status: REPROCESS_STATUS.FAILED,
        channel: request.channel,
        requestId: request.id,
        detail
      });
      throw error;
    }

    const updatedSession = registerResult(request.envelopeId, request.channel, result);
    const finalStatus = result?.success === true ? REPROCESS_STATUS.COMPLETED : REPROCESS_STATUS.FAILED;
    const updatedRequest = updateRequest(request.id, {
      status: finalStatus,
      detail: text(result?.detail || result?.error),
      result: clone(result)
    });
    appendHistory(request.envelopeId, {
      action: `reprocess_${result?.success === true ? 'completed' : 'failed'}`,
      status: finalStatus,
      channel: request.channel,
      requestId: request.id,
      detail: text(result?.detail || result?.error)
    });

    return Object.freeze({
      executed: true,
      blocked: false,
      success: result?.success === true,
      request: updatedRequest,
      result: Object.freeze(clone(result)),
      session: updatedSession
    });
  }

  function clearRequests() {
    storage.removeItem(STORAGE_KEY);
    return [];
  }

  return Object.freeze({ assess, prepare, execute, cancel, readRequests, findRequest, findPending, clearRequests });
}

const defaultService = createOrderReprocessService();

export const assessChannelReprocess = defaultService.assess;
export const prepareChannelReprocess = defaultService.prepare;
export const executePreparedReprocess = defaultService.execute;
export const cancelPreparedReprocess = defaultService.cancel;
export const readChannelReprocessRequests = defaultService.readRequests;
export const findPendingChannelReprocess = defaultService.findPending;
export const clearChannelReprocessRequests = defaultService.clearRequests;

export const orderReprocessService = defaultService;
