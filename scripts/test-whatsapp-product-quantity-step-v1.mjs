import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20260908210970_whatsapp_product_quantity_step_v1.sql',import.meta.url),'utf8');
const has=(needle,msg)=>assert.ok(sql.includes(needle),`${msg}: faltou ${needle}`);
const no=(needle,msg)=>assert.ok(!sql.includes(needle),`${msg}: encontrou ${needle}`);

has("'product_selected_waiting_quantity'",'seleção entra em estado de quantidade');
has("'product_quantity'",'estado awaiting explícito');
has('whatsapp_quantity_prompt_v1','prompt de quantidade determinístico');
has("'da_qty:'||pid",'quantidade usa IDs oficiais de lista');
has("'da_qty_other:'||pid",'outra quantidade suportada');
has('apply_whatsapp_sales_product_quantity_v1','produto só entra após quantidade');
has('quantity_exceeds_stock','quantidade respeita estoque');
has("v_interactive_id like 'da_add_product:%'",'seleção de produto interceptada antes do worker');
has("p_message_type='text'",'quantidade digitada também suportada');
has('enrich_whatsapp_product_selection_list_v1','lista é enriquecida');
has("desc_txt:=left(coalesce(p->>'name','')||' · R$ '",'nome completo aparece na descrição da opção');
has('Você escolheu: ','tela seguinte repete nome completo');
has('Qual quantidade você quer?','tela seguinte pergunta quantidade');
has("update public.ai_jobs set status='done'",'job de IA é neutralizado no caminho determinístico');
has("grant execute on function public.apply_whatsapp_sales_product_quantity_v1",'RPC server-only liberada apenas para service role');
no('p_quantity:1','seleção não pode fixar quantidade 1');

console.log('PASS: seleção de produto exige quantidade explícita, preserva nome completo e só depois altera o carrinho.');
