const text = value => String(value ?? '').trim();
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const array = value => Array.isArray(value) ? value : text(value) ? text(value).split(',').map(item => item.trim()).filter(Boolean) : [];

export function createProduct(raw = {}, fallbackId = '') {
  const id = text(raw.id || raw.firebaseKey || raw.codigo || fallbackId);
  const status = text(raw.situacao || raw.status || 'A').toUpperCase();

  return Object.freeze({
    id,
    firebaseKey: text(raw.firebaseKey || fallbackId || id),
    codigo: text(raw.codigo || raw.sku || id),
    gtin: text(raw.gtin || raw.ean || raw.codigo_barras),
    nome: text(raw.nome || raw.produto_nome || raw.descricaoProduto || 'Produto sem nome'),
    descricao: text(raw.descricao || raw.descricao_produto),
    categoria: text(raw.categoria),
    subcategoria: text(raw.subcategoria),
    subsubcategoria: text(raw.subsubcategoria),
    marca: text(raw.marca),
    fornecedor: text(raw.fornecedor),
    embalagem: text(raw.embalagem),
    tags: array(raw.tags),
    imagem: text(raw.imagem || raw.url_imagem || raw.imagem_url || raw.foto),
    preco: number(raw.preco ?? raw.preco_venda),
    precoCusto: number(raw.preco_custo ?? raw.custo),
    precoOferta: number(raw.preco_oferta),
    estoque: number(raw.estoque),
    validade: text(raw.validade),
    ncm: text(raw.ncm),
    gondola: text(raw.gondola),
    prateleira: text(raw.prateleira),
    situacao: status,
    ativo: !['I', 'INATIVO', '0', 'FALSE'].includes(status)
  });
}

export function validateProduct(product = {}) {
  const errors = [];
  const warnings = [];

  if (!text(product.id)) errors.push('Produto sem identificador.');
  if (!text(product.nome) || product.nome === 'Produto sem nome') errors.push('Produto sem nome.');
  if (number(product.preco) < 0) errors.push('Preço não pode ser negativo.');
  if (number(product.estoque) < 0) warnings.push('Estoque negativo identificado.');
  if (!text(product.imagem)) warnings.push('Produto sem imagem.');
  if (!text(product.categoria)) warnings.push('Produto sem categoria.');

  return Object.freeze({ valid: errors.length === 0, errors, warnings });
}
