import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20260908211010_whatsapp_sales_knowledge_baseline_v1.sql',import.meta.url),'utf8');
for(const key of ['how_to_buy','delivery_area','payment_baseline','basket_commercial_price','basket_customization','catalog_truth','substitution_behavior','order_confirmation_customer_view']) assert.ok(sql.includes(`'${key}'`),`faltou ${key}`);
for(const phrase of ['Cuiabá e Várzea Grande','normalmente realizado na entrega','preço comercial próprio','produtos fisicamente conferidos pelo contador','não deve atrasar a confirmação ao cliente']) assert.ok(sql.includes(phrase),`faltou regra: ${phrase}`);
assert.ok(sql.includes("status='published'"),'baseline precisa nascer publicado');
console.log('PASS: baseline de conhecimento comercial do WhatsApp está completo e versionado.');