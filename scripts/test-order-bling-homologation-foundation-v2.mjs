import fs from 'node:fs';
import vm from 'node:vm';

const migration = fs.readFileSync('supabase/migrations/20260908030000_order_bling_homologation_foundation_v2.sql','utf8');
const wrapper = fs.readFileSync('scripts/run-bling-order-homologation-v1.mjs','utf8');
const writer = fs.readFileSync('scripts/bling-order-writer-v1.mjs','utf8');

const must = (source, pattern, label) => {
  if (!pattern.test(source)) throw new Error(`FAIL ${label}`);
};

must(migration, /bling_order_sync_enabled boolean not null default false/i, 'Bling sync nasce desligado');
must(migration, /bling_order_homologation_only boolean not null default true/i, 'homologação nasce allowlist-only');
must(migration, /bling_order_max_per_run smallint not null default 1/i, 'máximo inicial de um pedido');
must(migration, /create unique index if not exists orders_cart_id_uq/i, 'um pedido por carrinho');
must(migration, /create unique index if not exists orders_idempotency_key_uq/i, 'idempotência por chave');
must(migration, /confirm_cart_order_v2/i, 'RPC de confirmação idempotente');
must(migration, /idempotent_replay/i, 'RPC devolve replay explícito');
must(migration, /bling_order_homologation_allowlist/i, 'allowlist de homologação');
must(migration, /if not found or not c\.bling_order_sync_enabled then return;/i, 'claim falha fechado com gate off');
must(migration, /c\.bling_order_homologation_only/i, 'claim revalida allowlist');
must(migration, /returned/i, 'estado devolvido suportado');
must(migration, /order_status_events/i, 'timeline auditável de status');
must(migration, /revoke all on function public\.confirm_cart_order_v2/i, 'RPC checkout não público');
must(migration, /grant execute on function public\.confirm_cart_order_v2\([^;]+service_role/i, 'RPC checkout service-role');

must(wrapper, /PEDIDO_UNICO_CONTROLADO/, 'confirmação literal para apply');
must(wrapper, /process\.env\.ORDER_LIMIT = '1'/, 'wrapper força pedido único');
must(writer, /class AmbiguousError extends Error/, 'worker modela resultado ambíguo');
must(writer, /finish\(job,'review'/, 'resultado ambíguo vai para revisão');
must(writer, /if\(!APPLY\)/, 'writer mantém dry-run');

// Executa somente o preâmbulo do wrapper em sandbox para provar fail-closed sem importar o writer.
const preamble = wrapper.split("await import('./bling-order-writer-v1.mjs');")[0];
let exitCode = null;
const sandbox = {
  process: {
    argv: ['node','runner','--apply'],
    env: {},
    exit(code) { exitCode = code; throw new Error(`EXIT:${code}`); }
  },
  console: { error() {} }
};
try { vm.runInNewContext(preamble, sandbox); } catch (e) { if (!String(e.message).startsWith('EXIT:')) throw e; }
if (exitCode !== 78) throw new Error('FAIL wrapper deveria bloquear apply sem confirmação literal');

console.log('OK: fundação da Etapa 2 mantém Bling desligado, allowlisted, pedido único, idempotente e sem retry cego de resultado ambíguo.');
