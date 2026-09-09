const criticalFields = [
  'preco',
  'preco_custo',
  'estoque',
  'ncm',
  'categoria',
  'gtin'
];

export function getCriticalChanges(changes = []) {
  return changes.filter((change) => criticalFields.includes(change.field));
}

export function requiresReview(changes = []) {
  return getCriticalChanges(changes).length > 0;
}
