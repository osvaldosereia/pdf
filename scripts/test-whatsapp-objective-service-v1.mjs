import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20260908210960_whatsapp_sales_objective_service_v1.sql',import.meta.url),'utf8');
for(const needle of [
  "execution_mode='homologation'",
  'media_enabled=true',
  'fast_objective_service',
  'ask_only_missing_information',
  'no_unnecessary_confirmation',
  'current_message_precedence',
  'must_not_ask_to_search',
  'must_not_ask_to_add',
  'ask_only_missing_fields'
]) assert.ok(sql.includes(needle),`faltou ${needle}`);
assert.match(sql,/Não faça perguntas de cortesia, confirmação intermediária/);
assert.match(sql,/Confirmação explícita continua obrigatória somente para finalizar o pedido/);
console.log('PASS: atendimento rápido, objetivo e sem perguntas desnecessárias está formalizado e testável.');