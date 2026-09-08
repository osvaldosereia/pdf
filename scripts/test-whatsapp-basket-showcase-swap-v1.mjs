import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(p,'utf8');
const migration=read('supabase/migrations/20260908223500_whatsapp_basket_showcase_swap_admin_v1.sql');
const priceMigration=read('supabase/migrations/20260908231500_whatsapp_basket_dynamic_price_v1.sql');
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
assert.match(migration,/trg_00_route_whatsapp_basket_swap_v1/,'Pedido falado de troca deve ser interceptado antes do worker livre');
assert.doesNotMatch(migration,/whatsapp_live_canary_percent\s*=\s*(?:[2-9]|[1-9][0-9])/i,'Migration não pode aumentar o canary');
assert.doesNotMatch(migration,/whatsapp_sales_bling_submit_enabled\s*=\s*true/i,'Migration não pode ligar Bling');

assert.match(priceMigration,/basket_total/,'Edição da composição precisa retornar novo total da cesta');
assert.match(priceMigration,/base_commercial_price=adjusted_basket_price/,'Preço ajustado precisa alimentar o carrinho');
assert.match(priceMigration,/pricing_complete/,'Preço faltante precisa ser fail-safe, sem inventar valor');
assert.match(priceMigration,/p\.price is not null then -p\.price/,'Retirada usa preço cadastrado apenas nos bastidores');
assert.match(priceMigration,/coalesce\(bi2\.add_unit_delta,p\.price\)/,'Aumento usa delta configurado ou preço cadastrado');

assert.match(api,/"basket_replace_v1"/,'API precisa aceitar vitrine de substituição criada pela IA');
assert.match(api,/action==="set_replacement_categories"/,'API precisa montar candidatos por categorias escolhidas');
assert.match(api,/action==="choose_replacement"/,'API precisa registrar escolha do substituto');
assert.match(api,/replacement_price_hidden:true/,'API deve declarar preço individual oculto na substituição');
assert.match(api,/product:products\(id,name,image_url\)/,'Lista inicial da cesta precisa carregar foto sem buscar preço individual');
assert.match(api,/whatsapp_deep_link/,'Retorno precisa oferecer deep link do WhatsApp');
assert.match(api,/whatsapp_web_fallback/,'Retorno precisa oferecer fallback web');

assert.doesNotMatch(app,/data-swap=/,'Lista inicial não deve exibir botão Trocar');
assert.match(app,/data-remove=/,'Lista inicial deve oferecer botão Retirar');
assert.match(app,/basket-row-image/,'Lista inicial deve mostrar foto de cada produto');
assert.match(app,/basketTotal/,'Barra fixa precisa mostrar total da cesta');
assert.match(app,/whatsapp_deep_link/,'Frontend precisa tentar abrir o app diretamente');
assert.match(app,/set_replacement_categories/,'Vitrine específica de troca precisa filtrar por categorias reais');
assert.match(app,/choose_replacement/,'Substituição continua sendo registrada somente na vitrine específica');
assert.match(app,/replacement-note/,'Vitrine de troca não deve mostrar valor individual');
assert.match(html,/Aumente, diminua ou retire produtos/,'Página deve orientar edição simples da composição');
assert.match(html,/logoantonia5\.png/,'Topo precisa usar a logo oficial Dona Antônia');
assert.match(html,/id="basketTotal"/,'Página precisa reservar total fixo da cesta');

assert.match(adminApi,/action==="showcase_update"/,'Admin API precisa salvar configuração da vitrine');
assert.match(admin,/data-showcase-enabled/,'Admin precisa permitir ativar/desativar categoria na vitrine');
assert.match(admin,/data-showcase-label/,'Admin precisa editar nome mostrado ao cliente');
assert.match(admin,/data-showcase-order/,'Admin precisa editar ordem das categorias');

console.log('PASS: cesta inicial editável com fotos/retirada/total, troca externa por IA e retorno robusto ao WhatsApp validados.');
