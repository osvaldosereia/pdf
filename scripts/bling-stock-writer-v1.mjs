import { writeFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const LIMIT = Math.min(100, Math.max(1, Number.parseInt(process.env.COMMAND_LIMIT || '30', 10) || 30));
const API_BASE = 'https://api.bling.com.br/Api/v3';
const SUPABASE_URL = required('SUPABASE_URL').replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const WORKER_ID = text(process.env.WORKER_ID) || `github-${process.env.GITHUB_RUN_ID || Date.now()}`;
const EXPLICIT_DEPOSIT_ID = Number.parseInt(process.env.BLING_DEPOSIT_ID || '', 10) || null;
const MIN_INTERVAL_MS = Math.max(420, Number(process.env.BLING_REQUEST_INTERVAL_MS || 460));
const RETRY_SECONDS = Math.max(30, Math.min(3600, Number(process.env.BLING_RETRY_SECONDS || 120)));

let accessToken = '';
let lastBlingRequestAt = 0;
let defaultDepositId = null;
const summary = { mode: APPLY ? 'apply' : 'dry-run', found: 0, processed: 0, done: 0, errors: 0, skipped: 0, matched: 0 };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = value => String(value ?? '').trim();
const digits = value => String(value ?? '').replace(/\D/g, '');
const number = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = text(value).replace(/[^0-9,.-]/g, '');
  if (!raw) return 0;
  const comma = raw.lastIndexOf(','), dot = raw.lastIndexOf('.');
  const parsed = Number(comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

function required(name) {
  const value = text(process.env[name]);
  if (!value) throw new Error(`A secret ${name} não foi configurada.`);
  return value;
}

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 1600);
    throw new Error(`Supabase ${response.status}: ${body}`);
  }
  if (response.status === 204) return null;
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

async function pace() {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastBlingRequestAt));
  if (wait) await sleep(wait);
  lastBlingRequestAt = Date.now();
}

async function bling(path, options = {}, { attempts = 5, label = path } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await pace();
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'enable-jwt': '1',
          ...(options.headers || {})
        }
      });
    } catch (error) {
      if (attempt === attempts) throw new Error(`${label}: falha de rede (${error.message})`);
      await sleep(attempt * 1000);
      continue;
    }
    if (response.ok) return response;
    const body = (await response.text()).slice(0, 1600);
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === attempts) throw new Error(`${label}: HTTP ${response.status} ${body}`);
    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * attempt * 1000);
  }
  throw new Error(`${label}: falha inesperada.`);
}

async function oauth() {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: required('BLING_REFRESH_TOKEN') });
  const basic = Buffer.from(`${required('BLING_CLIENT_ID')}:${required('BLING_CLIENT_SECRET')}`).toString('base64');
  const response = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'enable-jwt': '1'
    },
    body
  });
  if (!response.ok) throw new Error(`OAuth do Bling: HTTP ${response.status} ${(await response.text()).slice(0, 1000)}`);
  const data = await response.json();
  if (!text(data.access_token)) throw new Error('OAuth do Bling não retornou access_token.');
  const refreshFile = text(process.env.BLING_REFRESH_TOKEN_FILE);
  if (refreshFile && text(data.refresh_token)) writeFileSync(refreshFile, text(data.refresh_token), { encoding: 'utf8', mode: 0o600 });
  accessToken = text(data.access_token);
}

async function pendingCommands() {
  if (APPLY) {
    return await supabase('/rest/v1/rpc/claim_bling_commands', {
      method: 'POST',
      body: JSON.stringify({ p_worker: WORKER_ID, p_limit: LIMIT })
    }) || [];
  }
  const query = new URLSearchParams({
    status: 'eq.pending',
    select: 'id,command_type,product_id,payload,attempts',
    order: 'created_at.asc',
    limit: String(LIMIT)
  });
  return await supabase(`/rest/v1/bling_commands?${query}`, { method: 'GET' }) || [];
}

async function productById(id) {
  const query = new URLSearchParams({
    id: `eq.${id}`,
    select: 'id,bling_product_id,sku,name,gtin,price,cost,stock,sync_status'
  });
  const rows = await supabase(`/rest/v1/products?${query}`, { method: 'GET' }) || [];
  if (!rows.length) throw new Error('Produto operacional não encontrado no Supabase.');
  return rows[0];
}

async function bindBlingProduct(productId, blingProductId) {
  if (!APPLY) return;
  await supabase('/rest/v1/rpc/bind_bling_product_id', {
    method: 'POST',
    body: JSON.stringify({ p_product_id: productId, p_bling_product_id: blingProductId })
  });
}

async function finish(commandId, success, result = {}, error = null) {
  if (!APPLY) return;
  await supabase('/rest/v1/rpc/finish_bling_command', {
    method: 'POST',
    body: JSON.stringify({
      p_command_id: commandId,
      p_success: success,
      p_result: result,
      p_error: error ? String(error).slice(0, 1800) : null,
      p_retry_seconds: RETRY_SECONDS
    })
  });
}

async function findBlingProductByGtin(gtin) {
  const clean = digits(gtin);
  if (!clean) throw new Error('Produto contado sem GTIN/EAN.');
  const params = new URLSearchParams({ pagina: '1', limite: '20' });
  params.append('gtins[]', clean);
  const response = await bling(`/produtos?${params.toString()}`, {}, { label: 'Buscar produto no Bling por GTIN' });
  const data = await response.json();
  const rows = Array.isArray(data?.data) ? data.data : [];
  const exact = rows.filter(row => {
    const values = [row?.gtin, row?.gtinEmbalagem, row?.codigo].map(digits).filter(Boolean);
    return values.includes(clean);
  });
  if (exact.length === 1) return Number(exact[0].id);
  if (exact.length > 1) throw new Error('Mais de um produto do Bling possui o mesmo GTIN/EAN.');
  if (rows.length === 1) return Number(rows[0].id);
  if (!rows.length) throw new Error('Produto contado não encontrado no Bling pelo GTIN/EAN.');
  throw new Error('Busca por GTIN retornou resultado ambíguo no Bling.');
}

async function depositId() {
  if (EXPLICIT_DEPOSIT_ID) return EXPLICIT_DEPOSIT_ID;
  if (defaultDepositId) return defaultDepositId;
  const response = await bling('/depositos?pagina=1&limite=100&situacao=1', {}, { label: 'Consultar depósitos do Bling' });
  const data = await response.json();
  const rows = Array.isArray(data?.data) ? data.data : [];
  const preferred = rows.find(row => row?.padrao === true || row?.padrao === 1 || row?.padrao === 'true');
  if (preferred?.id) defaultDepositId = Number(preferred.id);
  else if (rows.length === 1 && rows[0]?.id) defaultDepositId = Number(rows[0].id);
  else throw new Error('Não foi possível determinar com segurança o depósito padrão do Bling. Configure BLING_DEPOSIT_ID.');
  return defaultDepositId;
}

async function setStock(command) {
  const product = await productById(command.product_id);
  const payload = command.payload || {};
  const counted = number(payload.counted_stock ?? product.stock);
  if (!Number.isFinite(counted) || counted < 0) throw new Error('Quantidade contada inválida.');
  const gtin = digits(payload.gtin || product.gtin);
  let blingProductId = Number(product.bling_product_id) || null;
  if (!blingProductId) {
    blingProductId = await findBlingProductByGtin(gtin);
    summary.matched++;
    await bindBlingProduct(product.id, blingProductId);
  }
  const deposito = await depositId();

  if (!APPLY) {
    return { dry_run: true, bling_product_id: blingProductId, deposit_id: deposito, counted_stock: counted };
  }

  const body = {
    deposito: { id: deposito },
    operacao: 'B',
    produto: { id: blingProductId },
    quantidade: counted,
    preco: number(product.price),
    custo: number(product.cost),
    observacoes: `Contagem física Dona Antônia · comando ${command.id}`
  };
  const response = await bling('/estoques', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, { label: 'Gravar balanço de estoque no Bling' });
  const data = await response.json().catch(() => ({}));
  return {
    bling_product_id: blingProductId,
    deposit_id: deposito,
    counted_stock: counted,
    stock_record_id: data?.data?.id || null
  };
}

async function processCommand(command) {
  summary.processed++;
  if (command.command_type !== 'set_stock') {
    summary.skipped++;
    const message = `Comando ${command.command_type} ainda não é tratado por este worker de estoque.`;
    if (APPLY) await finish(command.id, false, { skipped: true }, message);
    return;
  }
  try {
    const result = await setStock(command);
    if (APPLY) await finish(command.id, true, result, null);
    summary.done++;
  } catch (error) {
    summary.errors++;
    console.error(`Comando ${String(command.id).slice(0, 8)}: ${error.message}`);
    if (APPLY) {
      try { await finish(command.id, false, {}, error.message); }
      catch (finishError) { console.error(`Falha ao registrar erro no Supabase: ${finishError.message}`); }
    }
  }
}

async function main() {
  const commands = await pendingCommands();
  summary.found = commands.length;
  if (!commands.length) {
    console.log(JSON.stringify(summary));
    return;
  }

  await oauth();
  for (const command of commands) await processCommand(command);
  console.log(JSON.stringify(summary));

  const reportFile = text(process.env.BLING_STOCK_REPORT_FILE);
  if (reportFile) writeFileSync(reportFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  if (summary.errors && APPLY) process.exitCode = 2;
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
