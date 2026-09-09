import { APP_CONFIG, firebaseNodeUrl } from '../shared/config.js';
import { assertExternalWriteAllowed, environmentSnapshot } from '../shared/environment.js';
import { readRecord, writeRecord } from './firebase-service.js';

function text(value) {
  return String(value ?? '').trim();
}

function normalizeNode(value) {
  return text(value).replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

export const PRODUCTION_ORDERS_NODE = normalizeNode(APP_CONFIG.firebase.nodes.orders);
export const HOMOLOGATION_ORDERS_NODE = normalizeNode(APP_CONFIG.firebase.nodes.homologationOrders);

export function validateHomologationOrdersNode(node = HOMOLOGATION_ORDERS_NODE) {
  const candidate = normalizeNode(node);
  const errors = [];

  if (!candidate) errors.push('Nó de pedidos de homologação não configurado.');
  if (!candidate.startsWith('homologacao_v2/')) errors.push('O nó precisa permanecer dentro de homologacao_v2/.');
  if (
    candidate === PRODUCTION_ORDERS_NODE ||
    candidate.startsWith(`${PRODUCTION_ORDERS_NODE}/`) ||
    PRODUCTION_ORDERS_NODE.startsWith(`${candidate}/`)
  ) {
    errors.push('O nó de homologação não pode coincidir nem se sobrepor ao nó /pedidos de produção.');
  }

  return Object.freeze({
    valid: errors.length === 0,
    node: candidate,
    errors: Object.freeze(errors)
  });
}

export function validateHomologationEnvelope(envelope = {}) {
  const errors = [];
  if (!text(envelope.id)) errors.push('Envelope sem identificador.');
  if (!text(envelope.fingerprint)) errors.push('Envelope sem fingerprint de idempotência.');
  if (envelope.ambiente !== 'homologation') errors.push('Somente envelopes de homologação podem ser persistidos neste adaptador.');
  if (!envelope.order || typeof envelope.order !== 'object') errors.push('Pedido ausente no envelope.');
  if (envelope.order?.ambiente !== 'homologation') errors.push('O pedido interno também precisa estar em homologação.');
  if (!Array.isArray(envelope.order?.itens) || envelope.order.itens.length === 0) errors.push('Pedido sem itens.');

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function buildHomologationOrderTarget(envelope, node = HOMOLOGATION_ORDERS_NODE) {
  const nodeValidation = validateHomologationOrdersNode(node);
  if (!nodeValidation.valid) throw new Error(nodeValidation.errors.join(' '));

  const envelopeValidation = validateHomologationEnvelope(envelope);
  if (!envelopeValidation.valid) throw new Error(envelopeValidation.errors.join(' '));

  const recordId = text(envelope.id);
  const path = `${nodeValidation.node}/${recordId}`;
  return Object.freeze({
    node: nodeValidation.node,
    recordId,
    path,
    url: firebaseNodeUrl(path)
  });
}

export function buildHomologationOrderRecord(envelope, node = HOMOLOGATION_ORDERS_NODE) {
  const target = buildHomologationOrderTarget(envelope, node);
  const timestamp = new Date().toISOString();

  return Object.freeze({
    schemaVersion: 1,
    environment: 'homologation',
    source: 'checkout-v2',
    envelopeId: envelope.id,
    fingerprint: envelope.fingerprint,
    idempotencyKey: envelope.fingerprint,
    createdAt: envelope.criadoEm || timestamp,
    receivedAt: timestamp,
    updatedAt: timestamp,
    status: 'recebido_homologacao',
    targetPath: target.path,
    productionPathBlocked: true,
    order: clone(envelope.order)
  });
}

export function createHomologationFirebaseOrderAdapter(options = {}) {
  const read = options.readRecordFn || readRecord;
  const write = options.writeRecordFn || writeRecord;
  const assertWrite = options.assertWriteFn || assertExternalWriteAllowed;
  const enabled = options.enabled ?? (APP_CONFIG.integrations.orderDispatch.firebaseWriteEnabled === true);
  const timeoutMs = Number(options.timeoutMs || APP_CONFIG.integrations.orderDispatch.requestTimeoutMs || 12000);
  const node = normalizeNode(options.node || HOMOLOGATION_ORDERS_NODE);

  return async function saveHomologationOrder(envelope) {
    const target = buildHomologationOrderTarget(envelope, node);

    if (!enabled) {
      return Object.freeze({
        success: false,
        blocked: true,
        duplicate: false,
        conflict: false,
        detail: 'Escrita no Firebase de homologação continua desabilitada na configuração.',
        target
      });
    }

    assertWrite(`PUT ${target.path}`);
    const record = buildHomologationOrderRecord(envelope, node);
    const existing = await read(target.node, target.recordId, { timeoutMs });

    if (existing?.data) {
      if (text(existing.data.fingerprint) === text(record.fingerprint)) {
        return Object.freeze({
          success: true,
          blocked: false,
          duplicate: true,
          conflict: false,
          detail: 'Pedido já existia no nó de homologação com o mesmo fingerprint.',
          target,
          existing: clone(existing.data)
        });
      }

      return Object.freeze({
        success: false,
        blocked: false,
        duplicate: false,
        conflict: true,
        detail: 'Já existe outro pedido no mesmo identificador de homologação.',
        target,
        existingFingerprint: text(existing.data.fingerprint)
      });
    }

    const response = await write(target.node, target.recordId, record, { timeoutMs });
    return Object.freeze({
      success: true,
      blocked: false,
      duplicate: false,
      conflict: false,
      detail: 'Pedido gravado no nó isolado de homologação.',
      target,
      record,
      response: Object.freeze({ status: response?.status || 200, elapsedMs: response?.elapsedMs || 0 })
    });
  };
}

export const saveHomologationOrder = createHomologationFirebaseOrderAdapter();

export function homologationFirebaseSnapshot() {
  const validation = validateHomologationOrdersNode();
  return Object.freeze({
    environment: environmentSnapshot(),
    node: HOMOLOGATION_ORDERS_NODE,
    productionNode: PRODUCTION_ORDERS_NODE,
    isolated: validation.valid,
    errors: validation.errors,
    writeEnabled: APP_CONFIG.integrations.orderDispatch.firebaseWriteEnabled === true
  });
}

export const firebaseHomologationOrderAdapter = Object.freeze({
  validateHomologationOrdersNode,
  validateHomologationEnvelope,
  buildHomologationOrderTarget,
  buildHomologationOrderRecord,
  createHomologationFirebaseOrderAdapter,
  saveHomologationOrder,
  homologationFirebaseSnapshot
});
