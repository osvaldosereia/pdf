import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async(sql)=>{const r=await db.query(sql);return r.rows?.[0]||null};
const mustFail=async(sql,needle)=>{let error=null;try{await db.exec(sql)}catch(e){error=String(e)}if(!error||!error.includes(needle))throw new Error(`expected_failure:${needle}:${error||'none'}`)};
try{
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create schema extensions;create schema vault;
    create function extensions.digest(value text,algorithm text) returns bytea language sql immutable as $$select decode(md5(value),'hex')$$;
    create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as $$select decode(repeat('ab',greatest(1,n)),'hex')$$;

    create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null,name text not null,description text,created_at timestamptz not null default now());
    create table vault.decrypted_secrets(id uuid primary key,secret text,name text,decrypted_secret text,created_at timestamptz not null default now());
    create function vault.create_secret(secret text,name text,description text) returns uuid language plpgsql as $$declare v_id uuid:=gen_random_uuid();begin insert into vault.secrets(id,secret,name,description) values(v_id,secret,name,description);insert into vault.decrypted_secrets(id,secret,name,decrypted_secret) values(v_id,secret,name,secret);return v_id;end$$;
    create function vault.update_secret(secret_id uuid,new_secret text,new_name text,new_description text) returns void language plpgsql as $$begin update vault.secrets set secret=new_secret,name=new_name,description=new_description where id=secret_id;update vault.decrypted_secrets set secret=new_secret,name=new_name,decrypted_secret=new_secret where id=secret_id;end$$;

    create table public.system_secrets(key_name text primary key,key_hash text,is_active boolean not null default true,rotated_at timestamptz);
    create table public.automation_config(
      id integer primary key,
      whatsapp_release_mode text default 'off',
      whatsapp_live_canary_percent smallint default 0,
      updated_at timestamptz default now()
    );
    insert into public.automation_config(id) values(1);
    create table public.customers(id uuid primary key default gen_random_uuid());
    create table public.messages(id uuid primary key default gen_random_uuid());
    create table public.carts(id uuid primary key default gen_random_uuid());
    create table public.products(
      id uuid primary key default gen_random_uuid(),name text not null,image_url text,
      is_active boolean not null default true,physically_verified boolean not null default true,
      is_whatsapp_active boolean not null default true,stock numeric not null default 10
    );
    create table public.basket_templates(
      id uuid primary key default gen_random_uuid(),name text not null,description text,image_url text,base_price numeric not null default 0,
      is_active boolean not null default true,is_whatsapp_active boolean not null default true,updated_at timestamptz not null default now()
    );
    create table public.basket_template_items(
      id uuid primary key default gen_random_uuid(),basket_id uuid not null references public.basket_templates(id),product_id uuid not null references public.products(id),
      quantity numeric not null,removable boolean not null default true,quantity_editable boolean not null default true,
      min_quantity numeric,max_quantity numeric,sort_order integer not null default 0
    );
    create table public.conversations(
      id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),mode text not null default 'ai',
      human_required boolean not null default false,fast_checkout boolean not null default false,upsell_declined boolean not null default false,
      automation_bucket smallint,automation_cohort text,channel text not null default 'whatsapp'
    );
  `);

  await db.exec(readFileSync('supabase/migrations/20260908001000_experience_orchestrator_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908002000_basket_flow_contract_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908010000_whatsapp_flow_transport_foundation_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908010100_whatsapp_flow_transport_hardening_v1.sql','utf8'));

  let r=await one(`select experience_orchestrator_enabled orchestrator,whatsapp_flow_data_exchange_enabled exchange_enabled,whatsapp_flow_send_enabled send_enabled from public.automation_config where id=1`);
  if(r.orchestrator!==false||r.exchange_enabled!==false||r.send_enabled!==false)throw new Error('flow_runtime_must_default_off');
  r=await one(`select public.get_whatsapp_flow_transport_readiness_v1() x`);
  if(r.x.transport_ready!==false||r.x.send_ready!==false||r.x.private_key_configured!==false)throw new Error('transport_must_not_be_ready_by_default');

  const forbidden=await db.query(`select column_name from information_schema.columns where table_schema='public' and table_name='whatsapp_flow_exchange_events' and column_name in ('payload','data','body','flow_token','decrypted_payload','encrypted_flow_data','encrypted_aes_key')`);
  if(forbidden.rows.length)throw new Error(`exchange_event_must_not_store_payload:${forbidden.rows.map(x=>x.column_name).join(',')}`);

  const conv=(await one(`insert into public.conversations(automation_bucket,automation_cohort) values(0,'fixture_flow') returning id`)).id;
  const basket=(await one(`insert into public.basket_templates(name,description,base_price) values('Cesta Flow','Preço comercial próprio',149.90) returning id`)).id;
  const p1=(await one(`insert into public.products(name) values('Arroz 5 kg') returning id`)).id;
  const p2=(await one(`insert into public.products(name) values('Feijão 1 kg') returning id`)).id;
  await db.exec(`insert into public.basket_template_items(basket_id,product_id,quantity,removable,quantity_editable,min_quantity,max_quantity,sort_order) values
    ('${basket}'::uuid,'${p1}'::uuid,2,true,true,0,5,1),('${basket}'::uuid,'${p2}'::uuid,1,false,false,1,1,2)`);
  await db.exec(`update public.automation_config set experience_orchestrator_enabled=true where id=1;update public.experience_feature_flags set enabled=true,rollout_percent=100 where key='flow_personalize_basket';update public.experience_definitions set status='ready',provider_id='meta-flow-fixture',config=config||'{"flow_action":"data_exchange","flow_cta":"Personalizar"}'::jsonb where slug='flow-personalizar-cesta-v1'`);
  r=await one(`select public.create_experience_session_v1('${conv}'::uuid,'flow-personalizar-cesta-v1','flow-transport-fixture-0001',null,null,jsonb_build_object('basket_id','${basket}')) result`);
  if(!r.result.ok)throw new Error('fixture_flow_session_not_created');
  const sessionId=r.result.session_id;

  await mustFail(`select public.issue_whatsapp_flow_token_v1('${sessionId}'::uuid)`,`whatsapp_flow_data_exchange_disabled`);
  await db.exec(`update public.automation_config set whatsapp_flow_data_exchange_enabled=true,whatsapp_flow_send_enabled=true where id=1`);
  await mustFail(`select public.issue_whatsapp_flow_token_v1('${sessionId}'::uuid)`,`whatsapp_flow_transport_not_ready`);

  const privatePem='-----BEGIN PRIVATE KEY-----'+('A'.repeat(700))+'-----END PRIVATE KEY-----';
  const publicPem='-----BEGIN PUBLIC KEY-----'+('B'.repeat(300))+'-----END PUBLIC KEY-----';
  r=await one(`select public.install_whatsapp_flow_private_key_v1('${privatePem}','${publicPem}') result`);
  if(!r.result.ok||r.result.meta_signature_status!=='pending'||Object.hasOwn(r.result,'private_key'))throw new Error('key_install_result_must_not_leak_private_key');
  r=await one(`select public.get_whatsapp_flow_transport_readiness_v1() x`);
  if(!r.x.private_key_configured||!r.x.public_key_configured||r.x.send_ready!==false||r.x.meta_signature_status!=='pending')throw new Error('pending_meta_signature_must_block_send');
  await db.exec(`select public.set_whatsapp_flow_meta_key_status_v1('valid')`);
  r=await one(`select public.get_whatsapp_flow_transport_readiness_v1() x`);
  if(!r.x.transport_ready||!r.x.send_ready)throw new Error('fully_configured_transport_should_be_ready');

  r=await one(`select public.issue_whatsapp_flow_token_v1('${sessionId}'::uuid) result`);
  const token=r.result.flow_token;
  if(!r.result.ok||typeof token!=='string'||token.length<32||r.result.flow_id!=='meta-flow-fixture'||r.result.flow_message_version!=='3')throw new Error('flow_token_issue_failed');
  const stored=await one(`select flow_token_hash,flow_token_issued_at from public.experience_sessions where id='${sessionId}'::uuid`);
  if(!stored.flow_token_hash||stored.flow_token_hash===token||!stored.flow_token_issued_at)throw new Error('raw_flow_token_must_not_be_stored');
  r=await one(`select public.resolve_whatsapp_flow_token_v1('${token}') result`);
  if(!r.result.ok||r.result.session_id!==sessionId)throw new Error('flow_token_resolution_failed');
  r=await one(`select count(*)::int n from public.experience_events where event_data::text like '%'||'${token}'||'%'`);
  if(r.n!==0)throw new Error('raw_flow_token_must_not_enter_audit_events');

  r=await one(`select public.handle_whatsapp_flow_exchange_v1('${token}','INIT',null,'{}'::jsonb) result`);
  if(!r.result.ok||r.result.response.screen!=='BASKET_EDIT'||r.result.response.data.policy.component_prices_visible!==false)throw new Error('flow_init_contract_wrong');
  for(const item of r.result.response.data.items){for(const field of ['price','unit_price','line_total','cost','stock'])if(Object.hasOwn(item,field))throw new Error(`flow_init_component_leak:${field}`)}

  const selection=JSON.stringify([{product_id:p1,quantity:3},{product_id:p2,quantity:1}]).replaceAll("'","''");
  r=await one(`select public.handle_whatsapp_flow_exchange_v1('${token}','data_exchange','BASKET_EDIT',jsonb_build_object('selection','${selection}'::jsonb)) result`);
  if(!r.result.ok||r.result.response.screen!=='BASKET_REVIEW'||r.result.response.data.write_enabled!==false||!r.result.response.data.validation.valid)throw new Error('valid_selection_must_reach_read_only_review');
  r=await one(`select public.handle_whatsapp_flow_exchange_v1('${token}','data_exchange','BASKET_REVIEW','{}'::jsonb) result`);
  if(r.result.response.data.write_enabled!==false||r.result.response.data.error_code!=='flow_cart_apply_not_enabled')throw new Error('flow_must_not_apply_cart_in_foundation');

  await db.exec(`update public.automation_config set whatsapp_flow_data_exchange_enabled=false where id=1`);
  r=await one(`select public.handle_whatsapp_flow_exchange_v1('${token}','INIT',null,'{}'::jsonb) result`);
  if(r.result.ok!==false||r.result.reason!=='whatsapp_flow_data_exchange_disabled')throw new Error('handler_must_recheck_runtime_gate');

  const migration=readFileSync('supabase/migrations/20260908010000_whatsapp_flow_transport_foundation_v1.sql','utf8');
  if(!/revoke all on function public\.get_whatsapp_flow_private_key_v1\(\) from public,anon,authenticated/i.test(migration))throw new Error('private_key_rpc_must_be_revoked_from_client_roles');
  if(!/grant execute on function public\.get_whatsapp_flow_private_key_v1\(\) to service_role/i.test(migration))throw new Error('private_key_rpc_must_be_service_role_only');
  if(/whatsapp_flow_data_exchange_enabled\s*=\s*true/i.test(migration.split('-- Fail closed:')[1]||''))throw new Error('migration_must_not_enable_transport');

  console.log('PASS: WhatsApp Flow transport defaults off, full readiness gates token issue, raw token/private key are not persisted or exposed, basket Flow remains read-only and component prices stay hidden.');
}finally{await db.close()}
