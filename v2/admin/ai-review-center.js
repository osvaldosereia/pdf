// Admin V2 - Central de revisão de sugestões IA
// Somente homologação. Não aplica alterações externas.

export const AI_REVIEW_STATUS = {
  PENDING: 'pending_review',
  APPROVED: 'approved_local',
  REJECTED: 'rejected'
};

export function filterSuggestions(items = [], filters = {}) {
  return items.filter(item => {
    if (filters.status && item.status !== filters.status) return false;
    if (filters.type && item.type !== filters.type) return false;
    if (filters.productId && item.productId !== filters.productId) return false;
    return true;
  });
}

export function reviewSuggestion(item, action) {
  return {
    ...item,
    status: action === 'approve' ? AI_REVIEW_STATUS.APPROVED : AI_REVIEW_STATUS.REJECTED,
    reviewedAt: new Date().toISOString()
  };
}
