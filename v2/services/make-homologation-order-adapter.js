import { APP_CONFIG } from '../shared/config.js';
import { assertExternalWriteAllowed, environmentSnapshot } from '../shared/environment.js';
import {
  buildExpectedBlingResponseContract,
  normalizeMakeBlingResult,
  blingResultSummary
} from './bling-make-result-contract.js';

const DEFAULT_CONFIG = APP_CONFIG.integrations.orderDispatch;

function text(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseBody(value) {
  const raw = text(value);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

function detailFromBody(body, fallback) {
  if (body && typeof body === 'object') {
    return text(body.detail || body.message || body.error || body.status) || fallback;
  }
  return text(body) || fallback;
}

export function validateMakeWebhookUrl(value, allowedSuffixes = DEFAULT_CONFIG.makeAllowedHostSuffixes) {
  const errors = [];
  const raw = text(value);
  let parsed = null;

  if (!raw) errors.push('Webhook do Make não configurado.');
  if (raw) {
    try { parsed = new URL(raw); }
    catch { errors.push('Webhook do Make possui URL inválida.'); }
  }

  if (parsed) {
    if (parsed.protocol !== 'https:') errors.push('Webhook do Make precisa usar HTTPS.');
    if (parsed.username || parsed.password) errors.push('Webhook do Make não pode conter credenciais na URL.');
    if (!parsed.pathname || parsed.pathname === '/') errors.push('Webhook do Make precisa conter o identificador do cenário.');
    const suffixes = Array.isArray(allowedSuffixes) ? allowedSuffixes.map(text).filter(Boolean) : [];
    if (!suffixes.some(suffix => parsed.hostname.endsWith(suffix))) {
      errors.push('Host do webhook não pertence à lista permitida do Make.');
    }
  }

  return Object.freeze({
    valid: errors.length === 0,
    configured: Boolean(raw),
    host: parsed?.hostname || '',
    errors: Object.freeze(errors)
  });
}

export function validateMakeOrderEnvelope(envelope = {}) {
  const errors = [];
  if (!text(envelope.id)) errors.push('Envelope sem identificador.');
  if (!text(envelope.fingerprint)) errors.push('Envelope sem chave de idempotência.');
  if (envelope.ambiente !== 'homologation') errors.push('Somente envelopes de homologação podem ser enviados ao Make.');
  if (!envelope.order || typeof envelope.order !== 'object') errors.push('Pedido ausente no envelope.');
  if (envelope.order?.ambiente !== 'homologation') errors.push('O pedido interno precisa estar em homologação.');
  if (!Array.isArray(envelope.order?.itens) || envelope.order.itens.length === 0) errors.push('Pedido sem itens.');
  if (!text(envelope.order?.cliente?.telefone)) errors.push('Telefone do cliente ausente.');
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function buildMakeOrderPayload(envelope) {
  const validation = validateMakeOrderEnvelope(envelope);
  if (!validation.valid) throw new Error(validation.errors.join(' '));

  return Object.freeze({
    contractVersion: Number(DEFAULT_CONFIG.makeContractVersion || 1),
    eventType: 'order.homologation.created',
    environment: 'homologation',
    source: 'checkout-v2',
    envelopeId: envelope.id,
    idempotencyKey: envelope.fingerprint,
    occurredAt: envelope.criadoEm || new Date().toISOString(),
    sentAt: new Date().toISOString(),
    order: clone(envelope.order),
    expectedResponse: buildExpectedBlingResponseContract(envelope),
    safeguards: Object.freeze({
      productionOrderWriteAllowed: false,
      firebaseTarget: APP_CONFIG.firebase.nodes.homologationOrders,
      requiresHumanValidation: true,
      blingAccessMode: APP_CONFIG.integrations.bling.mode,
      directBlingBrowserAccessAllowed: false
    })
  });
}

export function shouldRetryMakeRequest({
  status = 0,
  error = null,
  retryable = false,
  attempt = 1,
  maximumAttempts = DEFAULT_CONFIG.maximumAttempts
} = {}) {
  if (attempt >= Number(maximumAttempts || 1)) return false;
  if (retryable) return true;
  if (error) return true;
  return [408, 425, 429].includes(Number(status)) || Number(status) >= 500;
}

export function createMakeHomologationOrderAdapter(options = {}) {
  const enabled = options.enabled ?? (DEFAULT_CONFIG.makeWriteEnabled === true);
  const webhookUrl = text(options.webhookUrl ?? DEFAULT_CONFIG.makeWebhookUrl);
  const fetchFn = options.fetchFn || globalThis.fetch;
  const assertWrite = options.assertWriteFn || assertExternalWriteAllowed;
  const sleepFn = options.sleepFn || wait;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || DEFAULT_CONFIG.requestTimeoutMs || 12000));
  const maximumAttempts = Math.max(1, Number(options.maximumAttempts || DEFAULT_CONFIG.maximumAttempts || 1));
  const retryBaseDelayMs = Math.max(0, Number(options.retryBaseDelayMs ?? DEFAULT_CONFIG.retryBaseDelayMs ?? 500));
  const allowedSuffixes = options.allowedHostSuffixes || DEFAULT_CONFIG.makeAllowedHostSuffixes;
  const requireBlingConfirmation = options.requireBlingConfirmation ?? (DEFAULT_CONFIG.makeRequireBlingConfirmation !== false);

  return async function sendHomologationOrderToMake(envelope) {
    const envelopeValidation = validateMakeOrderEnvelope(envelope);
    if (!envelopeValidation.valid) throw new Error(envelopeValidation.errors.join(' '));

    const webhookValidation = validateMakeWebhookUrl(webhookUrl, allowedSuffixes);
    if (!enabled) {
      return Object.freeze({
        success: false,
        blocked: true,
        retryable: false,
        attempts: 0,
        detail: 'Envio ao Make continua desabilitado na configuração.',
        endpointConfigured: webhookValidation.configured,
        endpointValid: webhookValidation.valid,
        bling: Object.freeze({ status: 'not_processed', completed: false })
      });
    }
    if (!webhookValidation.valid) throw new Error(webhookValidation.errors.join(' '));
    if (typeof fetchFn !== 'function') throw new Error('Cliente HTTP indisponível para chamar o Make.');

    assertWrite(`POST Make homologation webhook for ${envelope.id}`);
    const payload = buildMakeOrderPayload(envelope);
    const attemptHistory = [];

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = Date.now();
      let nextDelayMs = retryBaseDelayMs * Math.pow(2, attempt - 1);

      try {
        const response = await fetchFn(webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-DA-Environment': 'homologation',
            'X-DA-Envelope-Id': envelope.id,
            'X-Idempotency-Key': envelope.fingerprint,
            'X-DA-Contract-Version': String(payload.contractVersion)
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
          cache: 'no-store'
        });
        const elapsedMs = Date.now() - startedAt;
        const responseText = await response.text().catch(() => '');
        const body = parseBody(responseText);
        const normalized = normalizeMakeBlingResult(body, envelope, { requireConfirmation: requireBlingConfirmation });
        const success = response.ok && normalized.success;
        const fallback = response.ok ? 'O Make respondeu sem confirmar a venda no Bling.' : `Make respondeu HTTP ${response.status}.`;
        const detail = normalized.detail || detailFromBody(body, fallback);
        const bling = blingResultSummary(normalized);

        attemptHistory.push({
          attempt,
          status: response.status,
          elapsedMs,
          success,
          retryable: normalized.retryable,
          detail,
          bling: clone(bling)
        });

        if (success) {
          return Object.freeze({
            success: true,
            blocked: false,
            retryable: false,
            duplicate: bling.duplicate === true,
            attempts: attempt,
            status: response.status,
            detail,
            response: clone(body),
            bling,
            contract: normalized.contract,
            history: Object.freeze(attemptHistory)
          });
        }

        const retry = shouldRetryMakeRequest({
          status: response.status,
          retryable: normalized.retryable,
          attempt,
          maximumAttempts
        });
        if (!retry) {
          return Object.freeze({
            success: false,
            blocked: false,
            retryable: false,
            attempts: attempt,
            status: response.status,
            detail,
            response: clone(body),
            bling,
            contract: normalized.contract,
            validationErrors: normalized.errors,
            history: Object.freeze(attemptHistory)
          });
        }
        nextDelayMs = Math.max(nextDelayMs, Number(normalized.retryAfterMs || 0));
      } catch (error) {
        const elapsedMs = Date.now() - startedAt;
        const normalizedDetail = error?.name === 'AbortError'
          ? `Tempo limite de ${timeoutMs} ms ao chamar o Make.`
          : text(error?.message || error) || 'Falha de rede ao chamar o Make.';
        attemptHistory.push({ attempt, status: 0, elapsedMs, success: false, retryable: true, detail: normalizedDetail });
        const retry = shouldRetryMakeRequest({ error, attempt, maximumAttempts });
        if (!retry) {
          return Object.freeze({
            success: false,
            blocked: false,
            retryable: false,
            attempts: attempt,
            status: 0,
            detail: normalizedDetail,
            bling: Object.freeze({ status: 'unknown', completed: false }),
            history: Object.freeze(attemptHistory)
          });
        }
      } finally {
        clearTimeout(timeoutId);
      }

      if (nextDelayMs > 0) await sleepFn(nextDelayMs);
    }

    return Object.freeze({
      success: false,
      blocked: false,
      retryable: false,
      attempts: maximumAttempts,
      status: 0,
      detail: 'O limite de tentativas do Make foi atingido.',
      bling: Object.freeze({ status: 'unknown', completed: false }),
      history: Object.freeze(attemptHistory)
    });
  };
}

export const sendHomologationOrderToMake = createMakeHomologationOrderAdapter();

export function makeHomologationSnapshot() {
  const webhook = validateMakeWebhookUrl(DEFAULT_CONFIG.makeWebhookUrl, DEFAULT_CONFIG.makeAllowedHostSuffixes);
  return Object.freeze({
    environment: environmentSnapshot(),
    enabled: DEFAULT_CONFIG.makeWriteEnabled === true,
    endpointConfigured: webhook.configured,
    endpointValid: webhook.valid,
    endpointHost: webhook.host,
    contractVersion: Number(DEFAULT_CONFIG.makeContractVersion || 1),
    requireBlingConfirmation: DEFAULT_CONFIG.makeRequireBlingConfirmation !== false,
    blingAccessMode: APP_CONFIG.integrations.bling.mode,
    directBlingBrowserAccessAllowed: APP_CONFIG.integrations.bling.directBrowserAccessAllowed === true,
    maximumAttempts: Number(DEFAULT_CONFIG.maximumAttempts || 1),
    timeoutMs: Number(DEFAULT_CONFIG.requestTimeoutMs || 12000),
    errors: webhook.errors
  });
}

export const makeHomologationOrderAdapter = Object.freeze({
  validateMakeWebhookUrl,
  validateMakeOrderEnvelope,
  buildMakeOrderPayload,
  shouldRetryMakeRequest,
  createMakeHomologationOrderAdapter,
  sendHomologationOrderToMake,
  makeHomologationSnapshot
});