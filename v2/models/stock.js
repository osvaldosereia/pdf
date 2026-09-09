const text = value => String(value ?? '').trim();
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export const STOCK_MOVEMENT_TYPES = Object.freeze({
  ENTRY: 'entry',
  SALE: 'sale',
  LOSS: 'loss',
  ADJUSTMENT: 'adjustment',
  INVENTORY: 'inventory'
});

export function createStockMovement(raw = {}) {
  const previousBalance = number(raw.saldoAnterior ?? raw.saldo_anterior);
  const quantity = number(raw.quantidade);
  const nextBalance = raw.saldoNovo !== undefined || raw.saldo_novo !== undefined
    ? number(raw.saldoNovo ?? raw.saldo_novo)
    : previousBalance + quantity;

  return Object.freeze({
    id: text(raw.id),
    produtoId: text(raw.produtoId || raw.produto_id),
    tipo: text(raw.tipo || STOCK_MOVEMENT_TYPES.ADJUSTMENT),
    quantidade: quantity,
    saldoAnterior: previousBalance,
    saldoNovo: nextBalance,
    motivo: text(raw.motivo),
    origem: text(raw.origem || 'admin-v2'),
    referencia: text(raw.referencia),
    usuario: text(raw.usuario || 'homologacao'),
    criadoEm: text(raw.criadoEm || raw.criado_em || new Date().toISOString())
  });
}

export function validateStockMovement(movement = {}) {
  const errors = [];
  if (!text(movement.produtoId)) errors.push('Movimentação sem produto.');
  if (!text(movement.tipo)) errors.push('Movimentação sem tipo.');
  if (!Number.isFinite(Number(movement.quantidade)) || Number(movement.quantidade) === 0) {
    errors.push('Quantidade da movimentação deve ser diferente de zero.');
  }
  if (Number(movement.saldoNovo) < 0 && !text(movement.motivo)) {
    errors.push('Saldo negativo exige motivo explícito.');
  }
  return Object.freeze({ valid: errors.length === 0, errors });
}
