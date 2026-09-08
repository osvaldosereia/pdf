import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = p => readFileSync(p, 'utf8');
const html = read('cesta/index.html');
const app = read('cesta/app.js');
const edge = read('supabase/functions/basket-shop-v1/index.ts');
const migration = read('supabase/migrations/20260908230950_whatsapp_basket_final_pricing_v1.sql');

assert.match(html, /\/img\/logoantonia5\.png/, 'logo Dona Antônia deve aparecer no topo');
assert.match(html, /id="basketTotal"/, 'barra fixa deve exibir total da cesta');
assert.match(html, /Aumente, diminua ou retire produtos/, 'primeira etapa deve ser edição da cesta');
assert.match(app, /class="basket-row-image"/, 'cada item da cesta deve renderizar imagem');
assert.match(app, /data-remove=/, 'primeira lista deve oferecer Retirar');
assert.match(app, />Retirar<\/button>/, 'rótulo Retirar deve existir');
assert.match(app, /updateBasketPricing\(res\.result\|\|\{\}\)/, 'alteração de quantidade deve atualizar total');
assert.match(app, /whatsapp_deep_link/, 'retorno deve tentar deep link do WhatsApp');
assert.match(app, /whatsapp_web_fallback/, 'retorno deve ter fallback web');
assert.match(edge, /whatsapp_accounts\(phone_e164\)/, 'link deve usar número real da conta WhatsApp');
assert.doesNotMatch(edge, /phone_number_id/, 'não pode usar Meta phone_number_id como telefone de destino');
assert.match(edge, /base_commercial_price/, 'vitrine deve carregar preço comercial recalculado');
assert.match(edge, /product:products\(id,name,image_url\)/, 'itens da cesta devem receber imagem do produto');
assert.match(migration, /basket_adjusted_price:=coalesce\(cart_row\.base_commercial_price,b\.base_price,0\)/, 'finalização deve usar preço ajustado');
assert.match(migration, /total_value:=basket_adjusted_price\+coalesce\(extras_total,0\)/, 'total final deve somar cesta ajustada e adicionais');

console.log('OK: fase 1 da vitrine de cestas protegida por contrato estático.');
