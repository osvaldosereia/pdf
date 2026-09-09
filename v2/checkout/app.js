import { APP_CONFIG } from '../shared/config.js';
import { loadCatalog, createProductIndex } from '../shared/catalog.js';
import { cartSummary } from '../shared/cart.js';
import { buildOrderDraft, readCheckoutDraft, saveCheckoutDraft } from '../shared/checkout.js';
import { prepareOrderEnvelope, saveToOutbox } from '../shared/order-delivery.js';
import {
  simulateDispatch,
  markWhatsAppOpened,
  findDispatchSession,
  DISPATCH_STATUS
} from '../services/order-dispatch-service.js';

const form = document.getElementById('checkout-form');
const summaryEl = document.getElementById('summary');
const totalEl = document.getElementById('total');
const minimumEl = document.getElementById('minimum');
const errorsEl = document.getElementById('errors');
const resultEl = document.getElementById('result');
const trocoField = document.getElementById('troco-field');
const submitButton = form.querySelector('button[type="submit"]');
const state = { summary: null, envelope: null, dispatch: null };

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]));

function fillForm(draft) {
  for (const [key, value] of Object.entries({ ...draft.cliente, ...draft.entrega, observacoes: draft.observacoes, trocoPara: draft.pagamento.trocoPara })) {
    const field = form.elements.namedItem(key);
    if (field) field.value = value || '';
  }
  const payment = form.querySelector(`[name="pagamento"][value="${draft.pagamento.tipo}"]`);
  if (payment) payment.checked = true;
  updateTroco();
}

function readForm() {
  const data = new FormData(form);
  return {
    cliente: {
      nome: data.get('nome'),
      telefone: data.get('telefone'),
      cpf: data.get('cpf'),
      email: data.get('email')
    },
    entrega: {
      cidade: data.get('cidade'),
      bairro: data.get('bairro'),
      logradouro: data.get('logradouro'),
      numero: data.get('numero'),
      complemento: data.get('complemento'),
      referencia: data.get('referencia'),
      agendamento: data.get('agendamento')
    },
    pagamento: {
      tipo: data.get('pagamento'),
      trocoPara: data.get('trocoPara')
    },
    observacoes: data.get('observacoes')
  };
}

function updateTroco() {
  trocoField.hidden = form.querySelector('[name="pagamento"]:checked')?.value !== 'dinheiro';
}

function renderSummary(summary) {
  summaryEl.innerHTML = summary.rows.length
    ? summary.rows.map(({ product, quantity, subtotal }) => `<article><img src="${escapeHtml(product.imagem || '../../img/logoantonia5.png')}" alt=""><div><strong>${escapeHtml(product.nome)}</strong><span>${quantity} × ${money(subtotal / quantity)}</span></div><b>${money(subtotal)}</b></article>`).join('')
    : '<div class="empty">Sua compra está vazia.</div>';
  totalEl.textContent = money(summary.total);
  const missing = Math.max(0, APP_CONFIG.commerce.minimumOrder - summary.total);
  minimumEl.textContent = missing > 0 ? `Faltam ${money(missing)} para o pedido mínimo.` : 'Pedido mínimo atingido.';
  minimumEl.dataset.ok = missing <= 0 ? 'true' : 'false';
}

function channelLabel(channel) {
  if (channel === 'whatsapp') return 'WhatsApp';
  if (channel === 'firebase') return 'Firebase';
  return 'Make';
}

function channelStatusLabel(channel) {
  const status = channel?.status;
  if (status === DISPATCH_STATUS.WHATSAPP_OPENED) return 'Abertura registrada';
  if (status === DISPATCH_STATUS.SUCCESS) return 'Concluído';
  if (status === DISPATCH_STATUS.ERROR) return 'Falhou';
  if (status === DISPATCH_STATUS.BLOCKED) return 'Bloqueado na homologação';
  if (status === DISPATCH_STATUS.PENDING) return 'Pendente';
  return 'Preparado';
}

function channelStatusClass(channel) {
  if ([DISPATCH_STATUS.SUCCESS, DISPATCH_STATUS.WHATSAPP_OPENED].includes(channel?.status)) return 'ok';
  if (channel?.status === DISPATCH_STATUS.ERROR) return 'error';
  return 'warn';
}

function renderDispatchResult(outboxResult, dispatchResult) {
  state.dispatch = dispatchResult.session;
  const session = state.dispatch;
  const whatsapp = session.plan.channels.whatsapp;
  const duplicateMessage = outboxResult.duplicate || dispatchResult.duplicate
    ? '<div class="dispatch-notice warn"><strong>Pedido já preparado.</strong><span>A sessão existente foi reutilizada para impedir duplicidade.</span></div>'
    : '<div class="dispatch-notice ok"><strong>Pedido salvo na fila local.</strong><span>Nenhum canal externo foi acionado automaticamente.</span></div>';

  const channelCards = ['whatsapp', 'firebase', 'make'].map((channelName, index) => {
    const channel = session.channels[channelName];
    return `<article class="dispatch-channel ${channelStatusClass(channel)}"><span class="dispatch-order">${index + 1}</span><div><strong>${channelLabel(channelName)}</strong><small>${escapeHtml(channel.detail || channelStatusLabel(channel))}</small></div><b>${escapeHtml(channelStatusLabel(channel))}</b></article>`;
  }).join('');

  resultEl.hidden = false;
  resultEl.innerHTML = `<div class="result-head"><div><span>ORDEM DE DESPACHO</span><h2>Pedido ${escapeHtml(session.envelopeId)}</h2></div><b class="result-badge">Homologação</b></div>${duplicateMessage}<div class="dispatch-channels">${channelCards}</div><section class="whatsapp-preview"><div><span>ETAPA 1 · MANUAL</span><h3>Revise a mensagem do WhatsApp</h3><p>O botão apenas abre a conversa com a mensagem preenchida. O envio continua dependendo de confirmação manual.</p></div><div class="dispatch-actions"><a class="whatsapp-button" data-whatsapp-open href="${escapeHtml(whatsapp.url)}" target="_blank" rel="noopener">Abrir prévia no WhatsApp</a><button type="button" data-copy-message>Copiar mensagem</button></div><textarea id="whatsapp-message-preview" readonly>${escapeHtml(whatsapp.message)}</textarea></section><div class="dispatch-notice"><strong>Firebase e Make continuam bloqueados.</strong><span>O serviço já possui sequência, idempotência e histórico; a escrita externa só será liberada depois dos testes de homologação.</span></div>`;
  resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function copyWhatsAppMessage() {
  const textarea = document.getElementById('whatsapp-message-preview');
  if (!textarea) return;
  try {
    await navigator.clipboard.writeText(textarea.value);
  } catch {
    textarea.select();
    document.execCommand('copy');
  }
  const button = resultEl.querySelector('[data-copy-message]');
  if (button) {
    button.textContent = 'Mensagem copiada';
    setTimeout(() => { button.textContent = 'Copiar mensagem'; }, 1800);
  }
}

function registerWhatsAppOpening() {
  if (!state.envelope) return;
  state.dispatch = markWhatsAppOpened(state.envelope.id);
  renderDispatchResult({ duplicate: true }, { session: state.dispatch, duplicate: true });
}

const draft = readCheckoutDraft();
fillForm(draft);
form.addEventListener('input', () => saveCheckoutDraft(readForm()));
form.addEventListener('change', () => { updateTroco(); saveCheckoutDraft(readForm()); });

resultEl.addEventListener('click', event => {
  if (event.target.closest('[data-copy-message]')) copyWhatsAppMessage();
  if (event.target.closest('[data-whatsapp-open]')) registerWhatsAppOpening();
});

try {
  const catalog = await loadCatalog();
  const productMap = createProductIndex(catalog.products);
  state.summary = cartSummary(productMap);
  renderSummary(state.summary);

  form.addEventListener('submit', event => {
    event.preventDefault();
    errorsEl.hidden = true;
    submitButton.disabled = true;
    const current = readForm();
    saveCheckoutDraft(current);
    const result = buildOrderDraft(current, state.summary);
    if (!result.valid) {
      errorsEl.hidden = false;
      errorsEl.innerHTML = result.errors.map(error => `<div>${escapeHtml(error)}</div>`).join('');
      resultEl.hidden = true;
      submitButton.disabled = false;
      return;
    }

    try {
      state.envelope = prepareOrderEnvelope(result.order);
      const outboxResult = saveToOutbox(state.envelope);
      const dispatchResult = simulateDispatch(state.envelope);
      state.dispatch = findDispatchSession(state.envelope.id) || dispatchResult.session;
      renderDispatchResult(outboxResult, { ...dispatchResult, session: state.dispatch });
    } catch (error) {
      errorsEl.hidden = false;
      errorsEl.innerHTML = `<div>${escapeHtml(error.message || error)}</div>`;
    } finally {
      submitButton.disabled = false;
    }
  });
} catch (error) {
  summaryEl.innerHTML = `<div class="errors">Não foi possível carregar o catálogo seguro: ${escapeHtml(error.message || error)}</div>`;
  submitButton.disabled = true;
}
