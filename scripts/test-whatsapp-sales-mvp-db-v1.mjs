import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async q=>((await db.query(q)).rows?.[0]??null);
const jsonVal=async q=>{const r=await one(q);const v=Object.values(r||{})[0];return typeof v==='string'?JSON.parse(v):v};
const n=v=>Number(v??0);
try{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.customers(id uuid primary key default gen_random_uuid(),name text,primary_whatsapp_e164 text,preferred_reply text default 'auto',order_count integer default 0,last_order_at timestamptz);
    create table public.conversations(id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),status text default 'open',stage text default 'new',mode text default 'ai',service_window_expires_at timestamptz default now()+interval '24 hours',fast_checkout boolean default false,upsell_declined boolean default false,updated_at timestamptz default now());
    create table public.products(id uuid primary key default gen_random_uuid(),sku text,gtin text,name text not null,brand text,category text,packaging text,price numeric,stock numeric,image_url text,gondola text,shelf text,sort_order integer,physically_verified boolean default false,is_active boolean default true,description_short text,metadata jsonb default '{}'::jsonb,updated_at timestamptz default now());
    create table public.basket_templates(id uuid primary key default gen_random_uuid(),name text,base_price numeric,is_active boolean default true);
    create table public.carts(id uuid primary key default gen_random_uuid(),conversation_id uuid references public.conversations(id),customer_id uuid,basket_id uuid references public.basket_templates(id),status text default 'draft',base_commercial_price numeric default 0,total numeric default 0,expires_at timestamptz,version integer default 1,fiscal_subtotal numeric default 0,other_expenses numeric default 0,discount numeric default 0,pricing_status text default 'ready',updated_at timestamptz default now());
    create table public.cart_items(id uuid primary key default gen_random_uuid(),cart_id uuid references public.carts(id),product_id uuid references public.products(id),source text,quantity numeric,unit_price numeric,line_total numeric,commercial_unit_price numeric,metadata jsonb default '{}'::jsonb,created_at timestamptz default now(),updated_at timestamptz default now());
    create table public.messages(id uuid primary key default gen_random_uuid(),conversation_id uuid references public.conversations(id),direction text,message_type text,body_text text,transcript text,raw_event jsonb default '{}'::jsonb,ai_interpretation jsonb default '{}'::jsonb,created_at timestamptz default now());
    create table public.substitution_groups(id uuid primary key default gen_random_uuid(),code text,status text,version_no integer default 1);
    create table public.substitution_group_items(id uuid primary key default gen_random_uuid(),group_id uuid references public.substitution_groups(id),product_id uuid references public.products(id),status text);
    create or replace function public.recalculate_cart(p_cart_id uuid) returns jsonb language plpgsql as $$
    declare t numeric; begin
      select coalesce(sum(quantity*unit_price),0) into t from public.cart_items where cart_id=p_cart_id and quantity>0;
      update public.carts set total=t,fiscal_subtotal=t,other_expenses=0,discount=0,version=version+1,updated_at=now() where id=p_cart_id;
      return jsonb_build_object('cart_id',p_cart_id,'commercial_total',t,'fiscal_subtotal',t,'pricing_status','ready');
    end $$;
  `);
  await db.exec(readFileSync('supabase/migrations/20260908210000_whatsapp_sales_intelligence_mvp_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908210200_whatsapp_sales_worker_support_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908210300_whatsapp_sales_state_v1.sql','utf8'));

  const ids=await one(`with c as (insert into public.customers(name,primary_whatsapp_e164) values('Cliente','+556500000000') returning id), v as (insert into public.conversations(customer_id) select id from c returning id), good as (insert into public.products(name,sku,price,stock,physically_verified,is_active,image_url) values('Arroz Bom 5kg','ARROZ-5',29.90,10,true,true,'https://example.invalid/arroz.jpg') returning id), hidden as (insert into public.products(name,sku,price,stock,physically_verified,is_active) values('Arroz Não Conferido','BAD',1,100,false,true) returning id), zero as (insert into public.products(name,sku,price,stock,physically_verified,is_active) values('Arroz Sem Estoque','ZERO',10,0,true,true) returning id) select (select id from v) conversation_id,(select id from good) product_id,(select id from hidden) hidden_id;`);

  let rows=(await db.query(`select * from public.search_whatsapp_sellable_products_v1('arroz',20)`)).rows;
  assert.equal(rows.length,1,'somente produto fisicamente conferido/ativo/com estoque pode aparecer');
  assert.equal(rows[0].name,'Arroz Bom 5kg');
  assert.equal(n(rows[0].price),29.90);

  let add=await jsonVal(`select public.add_whatsapp_sales_product_v1('${ids.conversation_id}','${ids.product_id}',2) x`);
  assert.equal(n(add.commercial_total),59.8);
  let cart=await jsonVal(`select public.get_whatsapp_sales_cart_v1('${ids.conversation_id}') x`);
  assert.equal(cart.exists,true);assert.equal(cart.items.length,1);assert.equal(n(cart.items[0].quantity),2);assert.equal(n(cart.total),59.8);

  let blocked=false;try{await db.exec(`select public.set_whatsapp_sales_product_quantity_v1('${ids.conversation_id}','${ids.product_id}',11)`)}catch{blocked=true}assert.equal(blocked,true,'não pode vender acima do estoque conferido');
  blocked=false;try{await db.exec(`select public.add_whatsapp_sales_product_v1('${ids.conversation_id}','${ids.hidden_id}',1)`)}catch{blocked=true}assert.equal(blocked,true,'produto não conferido nunca entra no carrinho');

  let bundle=await jsonVal(`select public.get_service_intelligence_bundle_v1('whatsapp',null,'customizing') x`);
  assert.equal(bundle.enabled,false,'inteligência nasce fail-closed');
  await db.exec(`update public.service_intelligence_runtime_config set enabled=true,execution_mode='homologation',knowledge_enabled=true,guidance_enabled=true,procedures_enabled=true where id=1`);
  bundle=await jsonVal(`select public.get_service_intelligence_bundle_v1('whatsapp','search','customizing') x`);
  assert.equal(bundle.enabled,true);assert.ok(bundle.guidance.length>=6);assert.ok(bundle.procedures.length>=3);
  assert.ok(bundle.guidance.some(x=>String(x.instruction).includes('contador')),'bundle publicado contém regra do catálogo próprio');

  await db.exec(`insert into public.messages(conversation_id,direction,message_type,body_text,ai_interpretation,raw_event) values('${ids.conversation_id}','inbound','text','quero arroz','{}','{"source":"whatsapp"}')`);
  const mid=(await one(`select id from public.messages where conversation_id='${ids.conversation_id}' order by created_at desc limit 1`)).id;
  const ctx=await jsonVal(`select public.build_whatsapp_sales_context_v1('${ids.conversation_id}','${mid}') x`);
  assert.equal(ctx.catalog_source,'counter_verified');assert.equal(ctx.cart.items.length,1);assert.equal(ctx.product_candidates.length,1);assert.equal(ctx.intelligence.enabled,true);

  const priv=await one(`select has_function_privilege('anon','public.search_whatsapp_sellable_products_v1(text,integer)','EXECUTE') anon_exec,has_function_privilege('authenticated','public.add_whatsapp_sales_product_v1(uuid,uuid,numeric)','EXECUTE') auth_exec,has_function_privilege('service_role','public.add_whatsapp_sales_product_v1(uuid,uuid,numeric)','EXECUTE') srv_exec`);
  assert.equal(priv.anon_exec,false);assert.equal(priv.auth_exec,false);assert.equal(priv.srv_exec,true);
  console.log('PASS: catálogo counter_verified, carrinho, estoque, inteligência fail-closed/publicada e privilégios server-only validados.');
} finally {await db.close()}
