import { APP_CONFIG } from '../shared/config.js';
import { validateProductDraft, productIdentity, readProductDrafts } from '../admin/product-editor.js';

const STORAGE_KEY = `${APP_CONFIG.cache.namespace}:product-homologations`;

export const HOMOLOGATION_STATUS = Object.freeze({
  PENDING: 'pending_review',
  READY: 'ready_for_approval',
  APPROVED: 'approved_for_homologation',
  REJECTED: 'rejected'
});

export const HUMAN_CONFIRMATIONS = Object.freeze([
  Object.freeze({ id: 'physical_data', label: 'Conferi nome, marca, embalagem e descrição diretamente no produto.' }),
  Object.freeze({ id: 'ean_and_expiry', label: 'Conferi o EAN e a validade nas fotos ou na embalagem física.' }),
  Object.freeze({ id: 'classification', label: 'Revisei categoria, subcategoria e NCM.' }),
  Object.freeze({ id: 'commercial', label: 'Revisei fornecedor, custo e preço de venda.' }),
  Object.freeze({ id: 'stock', label: 'Revisei estoque inicial, gôndola e prateleira.' }),
  Object.freeze({ id: 'image_rights', label: 'Confirmei que a imagem poderá ser tratada e publicada após aprovação.' })
]);

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function readRecords() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeRecords(records) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 100)));
}

function validDate(value) {
  const raw = text(value);
  let year;
  let month;
  let day;
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) [, year, month, day] = match;
  else {
    match = raw.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})$/);
    if (!match) return false;
    [, day, month, year] = match;
  }
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day);
}

export function resolveSavedDraftProduct(savedDraft = {}) {
  if (!savedDraft?.draft || !savedDraft?.original) throw new Error('Rascunho local inválido para homologação.');
  return Object.freeze({ ...clone(savedDraft.original), ...clone(savedDraft.draft) });
}

function automaticChecks(product = {}) {
  const baseValidation = validateProductDraft(product);
  const hasImageSource = Boolean(text(product.imagem) || text(product.captureSessionId));
  const checks = [
    {
      id: 'base_validation',
      label: 'Validação básica do editor',
      ok: baseValidation.valid,
      detail: baseValidation.valid ? 'Nome, identificação e valores básicos válidos.' : baseValidation.errors.join(' ')
    },
    {
      id: 'identity',
      label: 'Identificação comercial',
      ok: Boolean(text(product.nome) && (text(product.codigo) || text(product.gtin))),
      detail: 'Nome e código interno ou EAN são obrigatórios.'
    },
    {
      id: 'classification',
      label: 'Classificação fiscal e comercial',
      ok: /^\d{8}$/.test(text(product.ncm).replace(/\D/g, '')) && Boolean(text(product.categoria) && text(product.subcategoria)),
      detail: 'NCM com 8 dígitos, categoria e subcategoria são obrigatórios.'
    },
    {
      id: 'commercial',
      label: 'Dados comerciais',
      ok: number(product.preco) > 0 && number(product.preco_custo) > 0 && Boolean(text(product.fornecedor)),
      detail: 'Fornecedor, custo e preço de venda devem estar preenchidos com valores maiores que zero.'
    },
    {
      id: 'inventory',
      label: 'Estoque, validade e localização',
      ok: number(product.estoque) >= 0 && validDate(product.validade) && Boolean(text(product.gondola) && text(product.prateleira)),
      detail: 'Validade válida, gôndola e prateleira devem estar preenchidas.'
    },
    {
      id: 'presentation',
      label: 'Apresentação do produto',
      ok: Boolean(text(product.descricao) && text(product.embalagem) && text(product.tags)),
      detail: 'Descrição, embalagem e tags são obrigatórias.'
    },
    {
      id: 'image_source',
      label: 'Fonte de imagem',
      ok: hasImageSource,
      detail: 'Informe uma imagem ou mantenha a sessão de fotos vinculada.'
    }
  ];
  return checks.map(check => Object.freeze(check));
}

function normalizedConfirmations(confirmations = {}) {
  return Object.freeze(Object.fromEntries(HUMAN_CONFIRMATIONS.map(item => [item.id, confirmations[item.id] === true])));
}

export function evaluateProductHomologation(product = {}, confirmations = {}) {
  const automatic = automaticChecks(product);
  const human = normalizedConfirmations(confirmations);
  const automaticPassed = automatic.filter(check => check.ok).length;
  const humanPassed = HUMAN_CONFIRMATIONS.filter(item => human[item.id]).length;
  const blockingIssues = automatic.filter(check => !check.ok);
  const ready = blockingIssues.length === 0 && humanPassed === HUMAN_CONFIRMATIONS.length;
  return Object.freeze({
    status: ready ? HOMOLOGATION_STATUS.READY : HOMOLOGATION_STATUS.PENDING,
    ready,
    automatic: Object.freeze(automatic),
    confirmations: human,
    automaticPassed,
    automaticTotal: automatic.length,
    humanPassed,
    humanTotal: HUMAN_CONFIRMATIONS.length,
    blockingIssues: Object.freeze(blockingIssues)
  });
}

export function createProductHomologation(savedDraft, confirmations = {}) {
  const product = resolveSavedDraftProduct(savedDraft);
  const productId = productIdentity(product) || text(savedDraft.id);
  if (!productId) throw new Error('Produto sem identificação segura para homologação.');
  const evaluation = evaluateProductHomologation(product, confirmations);
  const now = new Date().toISOString();
  return Object.freeze({
    id: `homologation_${productId}`,
    productId,
    draftSavedAt: savedDraft.savedAt || now,
    createdAt: now,
    updatedAt: now,
    status: evaluation.status,
    confirmations: evaluation.confirmations,
    evaluation,
    original: clone(savedDraft.original),
    draft: clone(product),
    changes: clone(savedDraft.changes || []),
    rejectionReason: '',
    approvedAt: '',
    rejectedAt: '',
    environment: 'homologation-local',
    externalWriteAllowed: false,
    history: Object.freeze([{ at: now, action: 'created', status: evaluation.status }])
  });
}

export function saveProductHomologation(savedDraft, confirmations = {}) {
  const candidate = createProductHomologation(savedDraft, confirmations);
  const records = readRecords();
  const previous = records.find(item => item?.id === candidate.id);
  const now = new Date().toISOString();
  const record = previous
    ? {
        ...candidate,
        createdAt: previous.createdAt || candidate.createdAt,
        updatedAt: now,
        history: [{ at: now, action: 'review_saved', status: candidate.status }, ...(Array.isArray(previous.history) ? previous.history : [])].slice(0, 50)
      }
    : candidate;
  writeRecords([record, ...records.filter(item => item?.id !== record.id)]);
  return Object.freeze(record);
}

export function approveProductHomologation(recordId) {
  const records = readRecords();
  const record = records.find(item => item?.id === recordId);
  if (!record) throw new Error('Ficha de homologação não encontrada.');
  const evaluation = evaluateProductHomologation(record.draft, record.confirmations);
  if (!evaluation.ready) throw new Error('A homologação ainda possui pendências obrigatórias.');
  const now = new Date().toISOString();
  const approved = {
    ...record,
    status: HOMOLOGATION_STATUS.APPROVED,
    evaluation,
    approvedAt: now,
    rejectedAt: '',
    rejectionReason: '',
    updatedAt: now,
    history: [{ at: now, action: 'approved_for_homologation', status: HOMOLOGATION_STATUS.APPROVED }, ...(record.history || [])].slice(0, 50)
  };
  writeRecords([approved, ...records.filter(item => item?.id !== recordId)]);
  return Object.freeze(approved);
}

export function rejectProductHomologation(recordId, reason) {
  const message = text(reason);
  if (!message) throw new Error('Informe o motivo da reprovação.');
  const records = readRecords();
  const record = records.find(item => item?.id === recordId);
  if (!record) throw new Error('Ficha de homologação não encontrada.');
  const now = new Date().toISOString();
  const rejected = {
    ...record,
    status: HOMOLOGATION_STATUS.REJECTED,
    rejectionReason: message,
    rejectedAt: now,
    approvedAt: '',
    updatedAt: now,
    history: [{ at: now, action: 'rejected', status: HOMOLOGATION_STATUS.REJECTED, reason: message }, ...(record.history || [])].slice(0, 50)
  };
  writeRecords([rejected, ...records.filter(item => item?.id !== recordId)]);
  return Object.freeze(rejected);
}

export function buildHomologationEnvelope(record) {
  if (!record?.id || record.status !== HOMOLOGATION_STATUS.APPROVED) throw new Error('Produto ainda não aprovado para homologação.');
  return Object.freeze({
    version: 1,
    mode: 'homologation_only',
    recordId: record.id,
    productId: record.productId,
    product: clone(record.draft),
    changes: clone(record.changes || []),
    approvedAt: record.approvedAt,
    generatedAt: new Date().toISOString(),
    externalWriteAllowed: false,
    canPublish: false
  });
}

export function readProductHomologations() {
  return Object.freeze(readRecords());
}

export function findSavedDraft(productId) {
  const drafts = readProductDrafts();
  return drafts[text(productId)] || Object.values(drafts).find(item => text(item?.id) === text(productId)) || null;
}

export const productHomologationService = Object.freeze({
  resolveSavedDraftProduct,
  evaluateProductHomologation,
  createProductHomologation,
  saveProductHomologation,
  approveProductHomologation,
  rejectProductHomologation,
  buildHomologationEnvelope,
  readProductHomologations,
  findSavedDraft
});
