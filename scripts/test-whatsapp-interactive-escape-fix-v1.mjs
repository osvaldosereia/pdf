import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync('supabase/migrations/20260908233500_whatsapp_interactive_escape_fix_v1.sql','utf8');

assert.match(sql,/left\(v_interactive_id,3\)=''da_''/i,'mensagens interativas devem usar prefixo sem ESCAPE inválido');
assert.match(sql,/interactive_escape_line_not_found/i,'migration deve falhar de forma explícita se o padrão antigo não existir');
assert.doesNotMatch(sql,/whatsapp_live_canary_percent\s*=/i,'correção não pode alterar canary');
assert.doesNotMatch(sql,/bling_order_sync_enabled\s*=/i,'correção não pode alterar Bling');
assert.doesNotMatch(sql,/whatsapp_flow_send_enabled\s*=/i,'correção não pode alterar Flow');

console.log('PASS: escape inválido do ingest interativo corrigido sem alterar gates.');
