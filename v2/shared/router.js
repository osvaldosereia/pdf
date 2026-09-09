function cleanHash(value) {
  return String(value || '#/')
    .replace(/^#/, '')
    .replace(/^\/+|\/+$/g, '');
}

export function currentRoute() {
  const raw = cleanHash(location.hash || '#/');
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = pathPart ? pathPart.split('/').map(decodeURIComponent) : [];
  const name = segments[0] || 'home';
  return Object.freeze({
    name,
    segments,
    params: new URLSearchParams(queryPart),
    raw
  });
}

export function productRoute(productId) {
  return `#/produto/${encodeURIComponent(String(productId || ''))}`;
}

export function navigate(hash) {
  const target = String(hash || '#/');
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = target;
}

export function subscribeRoute(listener) {
  if (typeof listener !== 'function') return () => {};
  const handler = () => listener(currentRoute());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
