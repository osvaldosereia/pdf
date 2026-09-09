import { APP_CONFIG } from '../shared/config.js';
import { normalizeEan } from './ean-service.js';

const STORAGE_KEY = `${APP_CONFIG.cache.namespace}:product-ai-results`;
const HIGH_CONFIDENCE = 0.85;
const MINIMUM_CONFIDENCE = 0.6;

const FIELD_DEFINITIONS = Object.freeze([
  { field: 'nome', label: 'Nome', aliases: ['nome', 'name', 'nome_comercial', 'nome_comercial_confirmado'] },
  { field: 'descricao', label: 'Descrição', aliases: ['descricao', 'description', 'descricao_objetiva'] },
  { field: 'gtin', label: 'EAN / GTIN', aliases: ['gtin', 'ean', 'codigo_ean'] },
  { field: 'validade', label: 'Validade', aliases: ['validade', 'data_validade', 'expiry', 'expiry_date'] },
  { field: 'ncm', label: 'NCM', aliases: ['ncm', 'ncm_provavel'] },
  { field: 'categoria', label: 'Categoria', aliases: ['categoria', 'category'] },
  { field: 'subcategoria', label: 'Subcategoria', aliases: ['subcategoria', 'subcategory'] },
  { field: 'marca', label: 'Marca', aliases: ['marca', 'brand'] },
  { field: 'embalagem', label: 'Embalagem', aliases: ['embalagem', 'package', 'peso_ou_volume'] },
  { field: 'fornecedor', label: 'Fornecedor', aliases: ['fornecedor', 'supplier', 'fabricante'] },
  { field: 'tags', label: 'Tags', aliases: ['tags', 'keywords', 'palavras_chave'] }
]);

const FORBIDDEN_ALIASES = Object.freeze([
  'preco', 'price', 'preco_venda', 'preco_custo', 'cost', 'estoque', 'stock',
  'gondola', 'prateleira', 'situacao', 'url_imagem', 'imagem'
]);

function text(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sourceObject(raw = {}) {
  if (raw?.fields && typeof raw.fields === 'object') return raw.fields;
  if (raw?.product && typeof raw.product === 'object') return raw.product;
  if (raw?.data?.fields && typeof raw.data.fields === 'object') return raw.data.fields;
  if (raw?.data?.product && typeof raw.data.product === 'object') return raw.data.product;
  return raw && typeof raw === 'object' ? raw : {};
}

function firstValue(object, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(object, alias)) return object[alias];
  }
  return undefined;
}

function normalizeConfidence(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const normalized = number > 1 ? number / 100 : number;
  return Math.max(0, Math.min(1, normalized));
}

function unwrapField(rawValue) {
  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    return {
      value: rawValue.value ?? rawValue.valor ?? rawValue.text ?? rawValue.result ?? '',
      confidence: normalizeConfidence(rawValue.confidence ?? rawValue.confianca ?? rawValue.score, 0.5),
      source: text(rawValue.source ?? rawValue.fonte ?? rawValue.origin ?? 'ai'),
      note: text(rawValue.note ?? rawValue.notes ?? rawValue.observacao ?? rawValue.reason)
    };
  }
  return { value: rawValue, confidence: 0.5, source: 'ai', note: '' };
}

function normalizeDate(value) {
  const raw = text(value);
  if (!raw) return '';
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = raw.match(/^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return raw;
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  return text(value).split(/[,;|]/).map(text).filter(Boolean).join(', ');
}

function normalizeFieldValue(field, value) {
  if (field === 'gtin') return normalizeEan(value);
  if (field === 'ncm') return text(value).replace(/\D/g, '');
  if (field === 'validade') return normalizeDate(value);
  if (field === 'tags') return normalizeTags(value);
  return text(value);
}

function fieldWarnings(field, value, expectedEan) {
  const warnings = [];
  if (!value) warnings.push('Campo vazio ou não identificado.');
  if (field === 'gtin' && value && value !== expectedEan) warnings.push(`EAN divergente: esperado ${expectedEan}.`);
  if (field === 'ncm' && value && !/^\d{8}$/.test(value)) warnings.push('NCM deve conter exatamente 8 dígitos.');
  if (field === 'validade' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) warnings.push('Validade não está em uma data reconhecida.');
  return warnings;
}

function decisionFor(confidence, warnings) {
  if (warnings.length) return 'blocked';
  if (confidence >= HIGH_CONFIDENCE) return 'suggested';
  if (confidence >= MINIMUM_CONFIDENCE) return 'review';
  return 'ignored';
}

function readStoredResults() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function parseProductAiResponse(rawResponse, request) {
  if (!request?.id || !request?.ean) throw new Error('Solicitação preparada não informada.');
  const raw = typeof rawResponse === 'string' ? JSON.parse(rawResponse) : rawResponse;
  if (!raw || typeof raw !== 'object') throw new Error('Resposta da IA inválida.');

  const expectedEan = normalizeEan(request.ean);
  const responseRequestId = text(raw.requestId ?? raw.request_id ?? raw.id_solicitacao ?? raw.data?.requestId);
  const responseEan = normalizeEan(raw.ean ?? raw.gtin ?? raw.data?.ean ?? expectedEan);
  const globalErrors = [];
  const globalWarnings = [];

  if (responseRequestId && responseRequestId !== request.id) globalErrors.push('A resposta pertence a outra solicitação.');
  if (responseEan && responseEan !== expectedEan) globalErrors.push(`EAN da resposta (${responseEan}) diferente do EAN consultado (${expectedEan}).`);

  const source = sourceObject(raw);
  const fields = FIELD_DEFINITIONS.map(definition => {
    const wrapped = unwrapField(firstValue(source, definition.aliases));
    const value = normalizeFieldValue(definition.field, wrapped.value);
    const warnings = fieldWarnings(definition.field, value, expectedEan);
    return Object.freeze({
      field: definition.field,
      label: definition.label,
      value,
      confidence: wrapped.confidence,
      confidencePercent: Math.round(wrapped.confidence * 100),
      source: wrapped.source,
      note: wrapped.note,
      warnings: Object.freeze(warnings),
      decision: decisionFor(wrapped.confidence, warnings)
    });
  }).filter(item => item.value || item.warnings.length);

  const forbiddenFound = FORBIDDEN_ALIASES.filter(alias => Object.prototype.hasOwnProperty.call(source, alias));
  if (forbiddenFound.length) globalWarnings.push(`Campos operacionais ignorados: ${forbiddenFound.join(', ')}.`);
  if (!fields.some(item => item.value)) globalErrors.push('A resposta não contém nenhum campo de produto utilizável.');

  const blockedFields = fields.filter(item => item.decision === 'blocked').length;
  const reviewFields = fields.filter(item => item.decision === 'review').length;
  const uncertainFields = fields.filter(item => item.decision === 'ignored').length;
  const status = globalErrors.length ? 'blocked' : blockedFields || reviewFields || uncertainFields ? 'attention' : 'ready';

  return Object.freeze({
    id: `ai_result_${expectedEan}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    requestId: request.id,
    ean: expectedEan,
    status,
    receivedAt: new Date().toISOString(),
    fields: Object.freeze(fields),
    errors: Object.freeze(globalErrors),
    warnings: Object.freeze(globalWarnings),
    raw: clone(raw)
  });
}

export function buildProductDraftFromAi({ seed = {}, result, acceptedFields } = {}) {
  if (!result?.requestId || result.status === 'blocked') throw new Error('Resultado da IA bloqueado para uso.');
  const accepted = new Set(Array.isArray(acceptedFields) ? acceptedFields : []);
  const draft = { ...seed };
  const applied = [];
  const skipped = [];

  for (const item of result.fields || []) {
    const canApply = item.decision !== 'blocked' && item.decision !== 'ignored' && accepted.has(item.field);
    if (canApply) {
      draft[item.field] = item.value;
      applied.push(item.field);
    } else {
      skipped.push(item.field);
    }
  }

  draft.gtin = normalizeEan(draft.gtin || result.ean);
  draft.aiResultId = result.id;
  draft.aiRequestId = result.requestId;
  draft.aiAppliedFields = [...applied];
  draft.aiReviewRequired = true;
  draft.source = 'ai-reviewed-draft';
  draft.draftOnly = true;

  return Object.freeze({ draft: Object.freeze(draft), applied: Object.freeze(applied), skipped: Object.freeze(skipped) });
}

export function storeProductAiResult(result) {
  if (!result?.id || !result?.requestId) throw new Error('Resultado da IA inválido para armazenamento.');
  const safe = clone(result);
  const list = [safe, ...readStoredResults().filter(item => item?.id !== safe.id)].slice(0, 30);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  return safe;
}

export function readProductAiResults() {
  return Object.freeze(readStoredResults());
}

export const productAiResponseService = Object.freeze({
  parseProductAiResponse,
  buildProductDraftFromAi,
  storeProductAiResult,
  readProductAiResults
});
