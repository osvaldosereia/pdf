const APPLY = process.argv.includes('--apply');
const CONFIRM = String(process.env.BLING_HOMOLOGATION_CONFIRM || '').trim();

if (APPLY && CONFIRM !== 'PEDIDO_UNICO_CONTROLADO') {
  console.error('Aplicação Bling bloqueada: defina BLING_HOMOLOGATION_CONFIRM=PEDIDO_UNICO_CONTROLADO somente durante homologação explicitamente autorizada.');
  process.exit(78);
}

if (APPLY) {
  process.env.ORDER_LIMIT = '1';
  process.env.WORKER_ID = process.env.WORKER_ID || `github-homologation-${process.env.GITHUB_RUN_ID || Date.now()}`;
}

await import('./bling-order-writer-v1.mjs');
