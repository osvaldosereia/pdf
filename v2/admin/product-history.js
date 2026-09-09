export function createChangeSet(before, after) {
  const fields = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  return [...fields]
    .filter((field) => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]))
    .map((field) => ({
      field,
      oldValue: before?.[field] ?? null,
      newValue: after?.[field] ?? null
    }));
}

export function createHistoryEntry(productId, changes) {
  return {
    productId,
    createdAt: new Date().toISOString(),
    environment: 'homologation-local',
    changes
  };
}

export function saveLocalHistory(entry) {
  const key = 'dona-antonia-v2-product-history';
  const current = JSON.parse(localStorage.getItem(key) || '[]');
  current.unshift(entry);
  localStorage.setItem(key, JSON.stringify(current.slice(0, 100)));
}
