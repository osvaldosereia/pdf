import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(p,'utf8');
const migration=read('supabase/migrations/20260908223500_whatsapp_basket_showcase_swap_admin_v1.sql');
const api=read('supabase/functions/basket-shop-v1/index.ts');
const adminApi=read('supabase/functions/admin-product-categories-v1/index.ts');
const app=read('cesta/app.js');
const html=read('cesta/index.html');
const admin=read('admin-v3/product-categories-inline.js');

assert.match(migration,/basket_showcase_enabled/,'Admin precisa controlar categorias disponíveis na vitrine');
assert.match(migration,/basket_showcase_label/,'Admin precisa controlar nome exibido ao cliente');
assert.match(migration,/basket_showcase_sort_order/,'Admin precisa controlar ordem da vitrine');
assert.match(migration,/returns table\(category text,display_name text,product_count integer\)/,'RPC de categorias deve preservar contrato existente');
assert.match(migration,/basket_replace_v1/,'Faltou sessão externa de substituição');
assert.match(migration,/create_whatsapp_basket_replacement_session_v1/,'Faltou criação da vitrine de troca');
assert.match(migration,/choose_whatsapp_basket_replacement_v1/,'Faltou registrar substituição escolhida');
assert.match(migration,/commercial_price_unchanged',true/,'Troca da cesta não pode recalcular silenciosamente o preço comercial base');
assert.match(migration,/trg_00_route_whatsapp_basket_swap_v1/,'Pedido de troca deve ser interceptado antes do worker livre');
assert.doesNotMatch(migration,/whatsapp_live_canary_percent\s*=\s*(?:[2-9]|[1-9][0-9])/i,'Migration não pode aumentar o canary');
assert.doesNotMatch(migration,/whatsapp_sales_bling_submit_enabled\s*=\s*true/i,'Migration não pode ligar Bling');

assert.match(api,/"basket_replace_v1"/,'API precisa aceitar vitrine de substituição');
assert.match(api,/action==="create_replacement"/,'API precisa iniciar troca a partir da cesta');
assert.match(api,/action==="set_replacement_categories"/,'API precisa montar candidatos por categorias escolhidas');
assert.match(api,/action==="choose_replacement"/,'API precisa registrar escolha do substituto');
assert.match(api,/replacement_price_hidden:true/,'API deve declarar preço individual oculto na substituição');
assert.match(api,/product:products\(id,name,image_url,category,stock\)/,'Consulta da substituição não deve buscar preço individual');

assert.match(app,/data-swap=/,'Cada item da cesta precisa oferecer Trocar na vitrine externa');
assert.match(app,/create_replacement/,'Frontend precisa criar vitrine temporária de troca');
assert.match(app,/set_replacement_categories/,'Frontend precisa filtrar troca por categorias reais');
assert.match(app,/choose_replacement/,'Frontend precisa registrar substituto apenas na vitrine');
assert.match(app,/replacement-note/,'Frontend precisa explicar que valor individual não é exibido na troca');
assert.match(html,/Ajuste quantidades ou toque em Trocar/,'Página deve orientar troca fora do WhatsApp');

assert.match(adminApi,/action==="showcase_update"/,'Admin API precisa salvar configuração da vitrine');
assert.match(admin,/data-showcase-enabled/,'Admin precisa permitir ativar/desativar categoria na vitrine');
assert.match(admin,/data-showcase-label/,'Admin precisa editar nome mostrado ao cliente');
assert.match(admin,/data-showcase-order/,'Admin precisa editar ordem das categorias');

console.log('PASS: vitrine externa dinâmica, troca somente fora do WhatsApp, categorias configuráveis e preço individual oculto validados.');
