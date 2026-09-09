export const PRODUCT_AI_ACTIONS = {
  nome: { label: 'Melhorar nome', critical: false },
  descricao: { label: 'Gerar descrição', critical: false },
  categoria: { label: 'Sugerir categoria', critical: true },
  ncm: { label: 'Sugerir NCM', critical: true },
  tags: { label: 'Gerar tags', critical: false },
  embalagem: { label: 'Sugerir embalagem', critical: false },
  imagem: { label: 'Gerar imagem', critical: false }
};

export function canApplyAiSuggestion(action) {
  return Boolean(PRODUCT_AI_ACTIONS[action]);
}

export function createAiSuggestion(productId, action, value) {
  return {
    environment: 'homologation-local',
    productId,
    action,
    value,
    status: 'pending-review',
    createdAt: new Date().toISOString()
  };
}
