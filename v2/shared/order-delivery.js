import { APP_CONFIG } from './config.js';

const OUTBOX_KEY = `${APP_CONFIG.cache.namespace}:order-outbox`;

function safeParse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function text(value) { return String(value ?? '').trim(); }
function money(value) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
function hash(input) { let h = 2166136261; for (const char of String(input)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export function orderFingerprint(order) {
  const basis = {
    cliente: order?.cliente?.telefone || '',
    itens: (order?.itens || []).map(item => [item.firebaseKey || item.id, item.quantidade, item.precoUnitario]),
    total: Number(order?.total || 0)
  };
  return hash(JSON.stringify(basis));
}

export function prepareOrderEnvelope(order) {
  if (!order || order.ambiente !== 'homologation') throw new Error('Somente pedidos de homologação podem entrar nesta fila.');
  const fingerprint = orderFingerprint(order);
  return Object.freeze({
    id: `HML-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${fingerprint.toUpperCase()}`,
    fingerprint,
    ambiente: 'homologation',
    criadoEm: new Date().toISOString(),
    tentativas: 0,
    status: 'aguardando_teste_manual',
    canais: Object.freeze({ whatsapp: 'bloqueado_homologacao', firebase: 'bloqueado_homologacao', make: 'bloqueado_homologacao' }),
    order
  });
}

export function readOutbox() {
  const value = safeParse(localStorage.getItem(OUTBOX_KEY), '');
  return Array.isArray(value) ? value : [];
}

export function saveToOutbox(envelope) {
  const list = readOutbox();
  if (list.some(item => item.fingerprint === envelope.fingerprint)) return Object.freeze({ saved: false, duplicate: true, list });
  const next = [envelope, ...list].slice(0, 30);
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(next));
  return Object.freeze({ saved: true, duplicate: false, list: next });
}

export function clearOutbox() {
  localStorage.removeItem(OUTBOX_KEY);
  return [];
}

export function formatWhatsAppMessage(order) {
  const lines = ['*NOVO PEDIDO - DONA ANTÔNIA*', '', `Cliente: ${text(order?.cliente?.nome)}`, `Telefone: ${text(order?.cliente?.telefone)}`];
  if (order?.cliente?.cpf) lines.push(`CPF: ${text(order.cliente.cpf)}`);
  lines.push('', `Entrega: ${text(order?.entrega?.logradouro)}, ${text(order?.entrega?.numero)} - ${text(order?.entrega?.bairro)} - ${text(order?.entrega?.cidade)}`);
  if (order?.entrega?.complemento) lines.push(`Complemento: ${text(order.entrega.complemento)}`);
  if (order?.entrega?.referencia) lines.push(`Referência: ${text(order.entrega.referencia)}`);
  if (order?.entrega?.agendamento) lines.push(`Agendamento: ${text(order.entrega.agendamento)}`);
  lines.push('', '*Itens:*');
  for (const item of order?.itens || []) lines.push(`${item.quantidade}x ${text(item.nome)} - ${money(item.subtotal)}`);
  lines.push('', `*Total: ${money(order?.total)}*`, `Pagamento: ${text(order?.pagamento?.tipo)}`);
  if (order?.pagamento?.tipo === 'dinheiro' && Number(order?.pagamento?.trocoPara) > 0) lines.push(`Troco para: ${money(order.pagamento.trocoPara)}`);
  if (order?.observacoes) lines.push(`Observações: ${text(order.observacoes)}`);
  lines.push('', '[HOMOLOGAÇÃO - NÃO ENVIAR]');
  return lines.join('\n');
}

export function buildDeliveryPreview(envelope) {
  const firebasePath = `${APP_CONFIG.firebase.nodes.homologationOrders}/${envelope.id}`;
  return Object.freeze({
    envelope,
    whatsapp: Object.freeze({ number: APP_CONFIG.commerce.whatsappNumber, message: formatWhatsAppMessage(envelope.order), enabled: false }),
    firebase: Object.freeze({ path: firebasePath, payload: envelope.order, enabled: false, productionPathBlocked: true }),
    make: Object.freeze({ payload: envelope.order, enabled: false })
  });
}
