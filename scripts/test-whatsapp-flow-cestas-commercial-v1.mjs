import fs from 'node:fs';
import assert from 'node:assert/strict';

const migration=fs.readFileSync(new URL('../supabase/migrations/20260909062000_whatsapp_flow_cestas_commercial_v1.sql',import.meta.url),'utf8');
const flow=JSON.parse(fs.readFileSync(new URL('../whatsapp/flows/flow-cestas-comercial-v1.json',import.meta.url),'utf8'));

assert.equal(flow.version,'7.1');
assert.equal(flow.data_api_version,'3.0');
assert.ok(Array.isArray(flow.screens));
assert.ok(flow.screens.length<=10,'WhatsApp Flow must stay within 10 screens');

const ids=new Set(flow.screens.map(s=>s.id));
for(const required of ['CESTAS','PERSONALIZAR','SECOES','TERMOS','PRODUTOS','PRODUTO','UPSELL','REVISAO','CLIENTE','FINALIZAR']) assert.ok(ids.has(required),`missing ${required}`);
assert.equal(flow.screens.find(s=>s.id==='FINALIZAR')?.terminal,true);

const serialized=JSON.stringify(flow);
assert.match(serialized,/data_exchange/);
assert.match(serialized,/product_image_base64/);
assert.match(serialized,/request_location/);
assert.doesNotMatch(serialized,/unit_price.*basket/i,'basket components must not expose individual prices');

assert.match(migration,/never_load_full_catalog',true/);
assert.match(migration,/max_products_per_query',20/);
assert.match(migration,/default_products_per_query',12/);
assert.match(migration,/component_prices_visible',false/);
assert.match(migration,/upsell_optional',true/);
assert.match(migration,/flow_basket_commercial','whatsapp_flow',false,0/);
assert.match(migration,/experience_orchestrator_enabled=false/);
assert.match(migration,/whatsapp_flow_data_exchange_enabled=false/);
assert.match(migration,/whatsapp_flow_send_enabled=false/);
assert.match(migration,/bling_order_sync_enabled=false/);

const searchRows=[...migration.matchAll(/\('(?:mercearia|limpeza|higiene|bebidas|utilidades_pet|ofertas)'/g)];
assert.ok(searchRows.length>=30,'expected a useful segmented search vocabulary');

console.log('whatsapp-flow-cestas-commercial-v1: ok');
