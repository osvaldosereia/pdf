import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20260908210980_whatsapp_checkout_address_first_v1.sql',import.meta.url),'utf8');
const has=(n,m)=>assert.ok(sql.includes(n),`${m}: faltou ${n}`);

has("coalesce(v_action,'')<>'checkout_preview'",'guard deve atuar somente no preview de checkout');
has("'delivery_address'",'estado passa a aguardar endereço');
has("'request_address'",'ação vira pedido de endereço');
has("checkout_address_first",'mensagem fica auditável como fluxo address-first');
has("new.payload:=jsonb_set(new.payload,'{delivery_mode}',to_jsonb('text'::text),true)",'preview vira texto quando falta endereço');
has("new.payload:=jsonb_set(new.payload,'{interactive}','null'::jsonb,true)",'botão de confirmação não sai antes do endereço');
has('customer_addresses','endereço já conhecido evita pergunta desnecessária');
has("'checkout_address_before_confirmation'",'orientação fica persistida na inteligência');
has('uma única confirmação explícita','regra de UX está documentada');

console.log('PASS: checkout pede endereço antes e preserva uma única confirmação final.');
