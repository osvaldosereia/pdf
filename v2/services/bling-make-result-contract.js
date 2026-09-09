const text = value => String(value ?? '').trim();
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clone = value => JSON.parse(JSON.stringify(value ?? null));

export const BLING_STATUS = Object.freeze({
  NOT_PROCESSED: 'not_processed',
  CREATED: 'created',
  DUPLICATE_CONFIRMED: 'duplicate_confirmed',
  RATE_LIMITED: 'rate_limited',
  ERROR: 'error',
  UNKNOWN: 'unknown'
});

const CONTACT_SUCCESS = new Set(['found', 'created', 'updated', 'existing', 'reused']);
const SALE_SUCCESS = new Set(['created', 'confirmed', 'existing', 'duplicate_confirmed', 'reused']);

function normalizeStatus(value) {
  return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s-]+/g, '_');
}

function findBlingPayload(body) {
  if (!body || typeof body !== 'object') return null;
  return body.integrations?.bling || body.integration?.bling || body.data?.bling || body.bling || null;
}

function findHttpStatus(raw = {}) {
  return number(raw.httpStatus || raw.statusCode || raw.code || raw.error?.status || raw.error?.code);
}

function duplicateMessage(value) {
  const normalized = normalizeStatus(value);
  return normalized.includes('informacoes_identicas_a_ultima_venda') ||
    normalized.includes('venda_identica') ||
    normalized.includes('duplicate_sale');
}

function rateLimitInfo(raw = {}) {
  const status = findHttpStatus(raw);
  const type = normalizeStatus(raw.error?.type || raw.type);
  const message = text(raw.error?.message || raw.error?.description || raw.message || raw.detail);
  const limited = status === 429 || type === 'too_many_requests' || /limite de requisi|too many requests/i.test(message);
  const period = normalizeStatus(raw.rateLimit?.period || raw.error?.period || raw.period);
  const limit = number(raw.rateLimit?.limit || raw.error?.limit || raw.limit);
  const explicitRetry = number(raw.rateLimit?.retryAfterMs || raw.retryAfterMs);
  const retryAfterMs = explicitRetry > 0 ? explicitRetry : period === 'second' ? 500 : 0;
  return Object.freeze({
    limited,
    period,
    limit,
    retryAfterMs,
    retryable: limited && period !== 'day'
  });
}

function normalizeContact(raw = {}) {
  const status = normalizeStatus(raw.status || raw.situation || raw.action);
  const id = text(raw.id || raw.contactId || raw.contatoId);
  return Object.freeze({
    status: status || 'unknown',
    id,
    success: CONTACT_SUCCESS.has(status) && Boolean(id)
  });
}

function normalizeSale(raw = {}, parent = {}) {
  const status = normalizeStatus(raw.status || raw.situation || raw.action);
  const id = text(raw.id || raw.saleId || raw.vendaId || parent.saleId || parent.vendaId);
  const numberValue = text(raw.number || raw.numero || raw.saleNumber || parent.saleNumber || parent.numeroVenda);
  const duplicate = raw.duplicate === true || parent.duplicate === true || status === 'duplicate_confirmed' || duplicateMessage(raw.message || parent.message || parent.detail || parent.error?.message);
  const referenceConfirmed = Boolean(id || numberValue);
  const effectiveStatus = duplicate && referenceConfirmed ? BLING_STATUS.DUPLICATE_CONFIRMED : SALE_SUCCESS.has(status) ? BLING_STATUS.CREATED : status || BLING_STATUS.UNKNOWN;
  const success = (SALE_SUCCESS.has(status) || duplicate) && referenceConfirmed;
  return Object.freeze({
    status: effectiveStatus,
    id,
    number: numberValue,
    duplicate,
    referenceConfirmed,
    success
  });
}

function normalizeError(raw = {}, fallback = '') {
  const source = raw.error && typeof raw.error === 'object' ? raw.error : raw;
  return Object.freeze({
    type: normalizeStatus(source.type || source.code || 'integration_error'),
    message: text(source.message || source.description || source.detail || fallback),
    httpStatus: findHttpStatus(raw)
  });
}

export function buildExpectedBlingResponseContract(envelope = {}) {
  return Object.freeze({
    version: 1,
    transport: 'make',
    directBrowserAccessAllowed: false,
    envelopeId: text(envelope.id),
    idempotencyKey: text(envelope.fingerprint),
    required: Object.freeze({
      success: 'boolean',
      envelopeId: 'string',
      idempotencyKey: 'string',
      integrations: Object.freeze({
        bling: Object.freeze({
          status: 'created|duplicate_confirmed|rate_limited|error',
          contact: Object.freeze({ status:'found|created|updated|existing', id:'string' }),
          sale: Object.freeze({ status:'created|existing|duplicate_confirmed', id:'string', number:'string' }),
          error: 'object|null'
        })
      })
    })
  });
}

export function normalizeMakeBlingResult(body, envelope = {}, options = {}) {
  const requireConfirmation = options.requireConfirmation !== false;
  const errors = [];
  const objectBody = body && typeof body === 'object' ? body : null;
  const expectedEnvelopeId = text(envelope.id);
  const expectedIdempotency = text(envelope.fingerprint);
  const returnedEnvelopeId = text(objectBody?.envelopeId || objectBody?.data?.envelopeId);
  const returnedIdempotency = text(objectBody?.idempotencyKey || objectBody?.data?.idempotencyKey);

  if (!objectBody) errors.push('Resposta do Make precisa ser um objeto JSON.');
  if (requireConfirmation && expectedEnvelopeId && !returnedEnvelopeId) errors.push('Resposta do Make não devolveu o envelopeId.');
  if (requireConfirmation && expectedIdempotency && !returnedIdempotency) errors.push('Resposta do Make não devolveu a chave de idempotência.');
  if (returnedEnvelopeId && expectedEnvelopeId && returnedEnvelopeId !== expectedEnvelopeId) errors.push('Resposta do Make pertence a outro envelope.');
  if (returnedIdempotency && expectedIdempotency && returnedIdempotency !== expectedIdempotency) errors.push('Resposta do Make possui chave de idempotência divergente.');

  const rawBling = findBlingPayload(objectBody);
  if (requireConfirmation && !rawBling) errors.push('Resposta do Make não confirmou a integração com o Bling.');

  const rateLimit = rateLimitInfo(rawBling || objectBody || {});
  const contact = normalizeContact(rawBling?.contact || rawBling?.contato || {});
  const sale = normalizeSale(rawBling?.sale || rawBling?.venda || {}, rawBling || {});
  const rawSuccess = rawBling?.success === true || objectBody?.success === true || objectBody?.accepted === true;
  const rawFailure = rawBling?.success === false || objectBody?.success === false || objectBody?.accepted === false;
  const error = normalizeError(rawBling || objectBody || {}, text(objectBody?.detail || objectBody?.message));

  let status = BLING_STATUS.UNKNOWN;
  if (rateLimit.limited) status = BLING_STATUS.RATE_LIMITED;
  else if (sale.status === BLING_STATUS.DUPLICATE_CONFIRMED) status = BLING_STATUS.DUPLICATE_CONFIRMED;
  else if (sale.success) status = BLING_STATUS.CREATED;
  else if (rawFailure || error.message) status = BLING_STATUS.ERROR;
  else if (!rawBling) status = BLING_STATUS.NOT_PROCESSED;

  if (sale.duplicate && !sale.referenceConfirmed) errors.push('O Bling indicou venda duplicada, mas não retornou ID nem número da venda existente.');
  if (rawSuccess && requireConfirmation && !contact.success) errors.push('O Make marcou sucesso sem confirmar o contato no Bling.');
  if (rawSuccess && requireConfirmation && !sale.success) errors.push('O Make marcou sucesso sem confirmar a venda no Bling.');

  const completed = errors.length === 0 && contact.success && sale.success && !rateLimit.limited && !rawFailure;
  const retryable = !completed && (rateLimit.retryable || error.httpStatus >= 500);
  const detail = completed
    ? sale.duplicate ? `Venda já existente confirmada no Bling${sale.number ? ` (${sale.number})` : ''}.` : `Venda criada no Bling${sale.number ? ` (${sale.number})` : ''}.`
    : rateLimit.limited
      ? `Bling limitou as requisições${rateLimit.period ? ` no período ${rateLimit.period}` : ''}.`
      : errors[0] || error.message || 'Integração com o Bling não confirmada.';

  return Object.freeze({
    valid: errors.length === 0,
    completed,
    success: completed,
    retryable,
    retryAfterMs: rateLimit.retryAfterMs,
    detail,
    errors: Object.freeze(errors),
    contract: Object.freeze({
      returnedEnvelopeId,
      returnedIdempotency,
      envelopeMatches: Boolean(returnedEnvelopeId) && returnedEnvelopeId === expectedEnvelopeId,
      idempotencyMatches: Boolean(returnedIdempotency) && returnedIdempotency === expectedIdempotency
    }),
    bling: Object.freeze({
      status,
      contact,
      sale,
      rateLimit,
      error,
      rawSuccess,
      rawFailure
    }),
    raw: clone(rawBling)
  });
}

export function blingResultSummary(result = {}) {
  const bling = result.bling || {};
  return Object.freeze({
    status: bling.status || BLING_STATUS.UNKNOWN,
    completed: result.completed === true,
    retryable: result.retryable === true,
    detail: text(result.detail),
    contactId: text(bling.contact?.id),
    contactStatus: text(bling.contact?.status),
    saleId: text(bling.sale?.id),
    saleNumber: text(bling.sale?.number),
    duplicate: bling.sale?.duplicate === true,
    rateLimited: bling.rateLimit?.limited === true,
    rateLimitPeriod: text(bling.rateLimit?.period),
    rateLimitValue: number(bling.rateLimit?.limit)
  });
}

export const blingMakeResultContract = Object.freeze({
  BLING_STATUS,
  buildExpectedBlingResponseContract,
  normalizeMakeBlingResult,
  blingResultSummary
});