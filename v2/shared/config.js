export const APP_CONFIG = Object.freeze({
  appName: 'Dona Antônia V2',
  environment: 'homologation',
  version: '2026.07.18-order-reprocess.1',
  firebase: Object.freeze({
    baseUrl: 'https://cedar-chemist-310801-default-rtdb.firebaseio.com',
    nodes: Object.freeze({
      products: 'produtos',
      orders: 'pedidos',
      homologationOrders: 'homologacao_v2/pedidos',
      baskets: 'cestas',
      kits: 'kits',
      quickPurchase: 'config_compra_rapida'
    })
  }),
  snapshots: Object.freeze({
    productsHome: '../../site/produtos-home.json',
    baskets: '../../site/produtos-cesta-basica.json',
    kits: '../../site/kits.json',
    coupons: '../../site/cuponsativos.json'
  }),
  cache: Object.freeze({
    namespace: 'da_v2',
    catalogTtlMs: 15 * 60 * 1000,
    staleCatalogMaxAgeMs: 24 * 60 * 60 * 1000
  }),
  catalogSafety: Object.freeze({
    minimumProducts: 1,
    maximumDropRatio: 0.25,
    requestTimeoutMs: 8000
  }),
  commerce: Object.freeze({
    minimumOrder: 75,
    whatsappNumber: '5565998150975'
  }),
  integrations: Object.freeze({
    orderDispatch: Object.freeze({
      whatsappPreviewEnabled: true,
      firebaseWriteEnabled: false,
      makeWriteEnabled: false,
      makeWebhookUrl: '',
      makeContractVersion: 2,
      makeRequireBlingConfirmation: true,
      makeAllowedHostSuffixes: Object.freeze(['.make.com']),
      requestTimeoutMs: 12000,
      maximumAttempts: 3,
      retryBaseDelayMs: 500,
      reprocessReasonMinimumLength: 8,
      reprocessConfirmationTtlMs: 10 * 60 * 1000
    }),
    bling: Object.freeze({
      mode: 'via_make_only',
      directBrowserAccessAllowed: false,
      maximumRequestsPerSecond: 3,
      maximumRequestsPerDay: 120000,
      duplicateRequiresSaleReference: true
    })
  })
});

export function firebaseNodeUrl(node) {
  const clean = String(node || '').replace(/^\/+|\/+$/g, '');
  return `${APP_CONFIG.firebase.baseUrl}/${clean}.json`;
}
