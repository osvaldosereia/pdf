export const FIREBASE_BASE = 'https://cedar-chemist-310801-default-rtdb.firebaseio.com';
export const ROOT = 'canecafacil_v2';

export const DEFAULT_CONFIG = Object.freeze({
  marca: 'CanecaFácil',
  preco_padrao: 24.9,
});

export const text = value => String(value ?? '').trim();
export const number = value => {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
export const nowIso = () => new Date().toISOString();
export const money = value => number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const norm = value => text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const slugify = value => norm(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
export const safeKey = value => text(value).replace(/[.#$\[\]/]/g, '_');

async function request(path, options = {}) {
  const response = await fetch(`${FIREBASE_BASE}/${path}.json${options.cacheBust ? `?_=${Date.now()}` : ''}`, {
    cache: options.cacheBust ? 'no-store' : 'default',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    method: options.method || 'GET',
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) throw new Error(`Firebase ${response.status}`);
  return response.json().catch(() => null);
}

export const getConfig = async () => ({ ...DEFAULT_CONFIG, ...((await request(`${ROOT}/config`, { cacheBust: true })) || {}) });
export const saveConfig = config => request(`${ROOT}/config`, { method: 'PATCH', body: config });
export const getProducts = async () => (await request(`${ROOT}/produtos`, { cacheBust: true })) || {};
export const getProduct = id => request(`${ROOT}/produtos/${safeKey(id)}`, { cacheBust: true });
export const saveProduct = (id, product) => request(`${ROOT}/produtos/${safeKey(id)}`, { method: 'PUT', body: product });
export const patchProduct = (id, patch) => request(`${ROOT}/produtos/${safeKey(id)}`, { method: 'PATCH', body: patch });
export const deleteProduct = id => request(`${ROOT}/produtos/${safeKey(id)}`, { method: 'DELETE' });

export function productArray(map = {}, config = DEFAULT_CONFIG) {
  return Object.entries(map).map(([id, p]) => normalizeProduct(id, p, config));
}

export function normalizeProduct(id, p = {}, config = DEFAULT_CONFIG) {
  const preco = number(p.preco) || number(config.preco_padrao);
  return {
    ...p,
    id,
    nome: text(p.nome || 'Caneca sem nome'),
    slug: text(p.slug) || slugify(p.nome || id),
    ativo: p.ativo !== false,
    categoria: text(p.categoria || 'Canecas'),
    subcategoria: text(p.subcategoria),
    descricao_curta: text(p.descricao_curta || p.descricao),
    mockup_png: text(p.mockup_png || p.mockup_transparente || p.mockup_1),
    arte_horizontal: text(p.arte_horizontal || p.arte_impressao),
    fundo: normalizeHex(p.fundo || '#FF6B1A'),
    preco,
    personalizavel: p.personalizavel === true,
    personalizador_modelo_key: text(p.personalizador_modelo_key || p.modelo_origem_key || id),
    ordem: number(p.ordem),
  };
}

export function normalizeHex(value) {
  const raw = text(value).replace('#', '').trim();
  if (/^[0-9a-f]{3}$/i.test(raw)) return `#${raw.split('').map(c => c + c).join('').toUpperCase()}`;
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toUpperCase()}`;
  return '#FF6B1A';
}

export function contrastInk(background) {
  const hex = normalizeHex(background).slice(1);
  const channels = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;
  return whiteContrast >= blackContrast ? '#FFFFFF' : '#111111';
}
