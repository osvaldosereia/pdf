import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync('supabase/migrations/20260908232500_whatsapp_basket_final_guards_v1.sql','utf8');

assert.match(sql,/basket_ready_for_human/i,'Resposta final de cesta precisa ser protegida');
assert.match(sql,/pricing_status','ready'\)='needs_review'/i,'Total incerto precisa ser interceptado');
assert.match(sql,/nossa equipe vai confirmar o total final/i,'Resposta deve evitar total numérico incerto');
assert.doesNotMatch(sql,/toque em [“"]Trocar[”"]/i,'Fluxo não pode citar botão Trocar removido');
assert.match(sql,/Qual produto da cesta você quer trocar\?/i,'Origem desconhecida deve pedir somente o item que sai');
assert.match(sql,/basket_swap_source_required/i,'Estado determinístico de origem ausente deve existir');
assert.match(sql,/marque a categoria do produto que quer colocar/i,'Destino incerto deve continuar pela seleção de categorias externa');
assert.doesNotMatch(sql,/whatsapp_live_canary_percent\s*=\s*(?:[2-9]|[1-9][0-9])/i,'Não pode aumentar canary');
assert.doesNotMatch(sql,/whatsapp_sales_bling_submit_enabled\s*=\s*true/i,'Não pode ligar Bling');

console.log('PASS: guardas finais de cesta validados.');
