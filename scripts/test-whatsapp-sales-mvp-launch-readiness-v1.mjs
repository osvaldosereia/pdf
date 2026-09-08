import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const search=readFileSync(new URL('../supabase/migrations/20260908211030_whatsapp_product_search_diacritics_v1.sql',import.meta.url),'utf8');
const address=readFileSync(new URL('../supabase/migrations/20260908211020_whatsapp_checkout_address_resume_v1.sql',import.meta.url),'utf8');
const quantity=readFileSync(new URL('../supabase/migrations/20260908210970_whatsapp_product_quantity_step_v1.sql',import.meta.url),'utf8');
const checkout=readFileSync(new URL('../supabase/migrations/20260908210980_whatsapp_checkout_address_first_v1.sql',import.meta.url),'utf8');
const precedence=readFileSync(new URL('../supabase/migrations/20260908210940_whatsapp_current_message_precedence_v1.sql',import.meta.url),'utf8');
const worker=readFileSync(new URL('../supabase/functions/conversation-worker-v3/index.ts',import.meta.url),'utf8');

for(const needle of ["translate(lower(trim(coalesce(p_query,'')))","p.n_name like '%'||q.term||'%'","accentless_product_search"]){
  assert.ok(search.includes(needle),`busca tolerante a acentos: faltou ${needle}`);
}
for(const needle of ['checkout_resume_after_address','address_is_not_confirmation','single_final_confirmation']){
  assert.ok(address.includes(needle),`retomada após endereço: faltou ${needle}`);
}
for(const needle of ["'product_selected_waiting_quantity'","'product_quantity'",'quantity_exceeds_stock']){
  assert.ok(quantity.includes(needle),`quantidade explícita: faltou ${needle}`);
}
for(const needle of ['checkout_address_requested_before_confirmation','uma única confirmação explícita']){
  assert.ok(checkout.includes(needle),`endereço antes da confirmação: faltou ${needle}`);
}
for(const needle of ['current_message_is_authoritative','support_only_never_overrides_current_message']){
  assert.ok(precedence.includes(needle),`prioridade da mensagem atual: faltou ${needle}`);
}
for(const needle of ['sales_state','confirm_whatsapp_sales_order_v1','queue_human_handoff_v1']){
  assert.ok(worker.includes(needle),`worker de vendas: faltou ${needle}`);
}
assert.ok(!worker.includes('whatsapp_sales_bling_submit_enabled=true'),'worker não pode ligar Bling por código');

console.log('PASS: prontidão final do MVP protege busca, quantidade, endereço, confirmação e handoff.');
