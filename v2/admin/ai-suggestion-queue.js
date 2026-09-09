// Product AI Suggestion Queue - V2
// Ambiente de homologacao: nenhuma sugestao grava dados externos.

export function createSuggestion({productId, field, oldValue, newValue, source='ai'}) {
  return {
    id: `suggestion_${Date.now()}`,
    productId,
    field,
    oldValue,
    newValue,
    source,
    status: 'pending_review',
    createdAt: new Date().toISOString()
  };
}

export function approveSuggestion(item) {
  return { ...item, status: 'approved_local' };
}

export function rejectSuggestion(item, reason='') {
  return { ...item, status: 'rejected', reason };
}
