import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async(sql)=>{const r=await db.query(sql);return r.rows?.[0]||null};
try{
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
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
      id uuid primary key default gen_random_uuid(),
      customer_id uuid references public.customers(id),
      mode text not null default 'ai',
      human_required boolean not null default false,
      fast_checkout boolean not null default false,
      upsell_declined boolean not null default false,
      automation_bucket smallint,
      automation_cohort text,
      channel text not null default 'whatsapp'
    );
  `);
  await db.exec(readFileSync('supabase/migrations/20260908001000_experience_orchestrator_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908002000_basket_flow_contract_v1.sql','utf8'));

  let r=await one(`select experience_orchestrator_enabled enabled from public.automation_config where id=1`);
  if(r.enabled!==false)throw new Error('orchestrator_must_default_off');
  r=await one(`select count(*)::int n from public.experience_feature_flags where enabled or rollout_percent<>0`);
  if(r.n!==0)throw new Error('features_must_default_off');
  r=await one(`select count(*)::int n from public.experience_definitions where experience_type='whatsapp_flow' and status='draft'`);
  if(r.n<3)throw new Error('flow_drafts_missing');

  const conv=(await one(`insert into public.conversations(automation_bucket) values(0) returning id`)).id;
  r=await one(`select public.plan_next_experience_v1('${conv}'::uuid,'basket_customize',0,8,false,'{}'::jsonb) plan`);
  if(r.plan.action!=='conversation'||r.plan.reason!=='basket_interfaces_disabled')throw new Error('disabled_orchestrator_must_not_open_flow');

  await db.exec(`
    update public.automation_config set experience_orchestrator_enabled=true where id=1;
    update public.experience_feature_flags set enabled=true,rollout_percent=100 where key in ('flow_personalize_basket','flow_build_purchase','flow_upsell','carousel_recommendations','shopping_room_personalized');
    update public.experience_definitions set status='ready' where slug in ('flow-personalizar-cesta-v1','flow-montar-compra-v1','flow-upsell-v1');
  `);
  r=await one(`select public.plan_next_experience_v1('${conv}'::uuid,'basket_customize',0,8,false,'{}'::jsonb) plan`);
  if(r.plan.action!=='whatsapp_flow'||r.plan.definition_slug!=='flow-personalizar-cesta-v1')throw new Error('basket_flow_not_selected');
  r=await one(`select public.plan_next_experience_v1('${conv}'::uuid,'build_purchase',0,6,false,'{}'::jsonb) plan`);
  if(r.plan.action!=='whatsapp_flow')throw new Error('build_purchase_flow_not_selected');
  r=await one(`select public.plan_next_experience_v1('${conv}'::uuid,'recommendations',4,0,false,'{}'::jsonb) plan`);
  if(r.plan.action!=='carousel')throw new Error('small_recommendation_should_use_carousel');
  r=await one(`select public.plan_next_experience_v1('${conv}'::uuid,'recommendations',30,0,true,'{}'::jsonb) plan`);
  if(r.plan.action!=='shopping_room')throw new Error('large_visual_recommendation_should_use_room');

  r=await one(`select public.create_experience_session_v1('${conv}'::uuid,'flow-personalizar-cesta-v1','fixture-session-0001',null,null,'{}'::jsonb) result`);
  if(!r.result.ok||r.result.duplicate)throw new Error('session_not_created');
  const sessionId=r.result.session_id;
  r=await one(`select public.create_experience_session_v1('${conv}'::uuid,'flow-personalizar-cesta-v1','fixture-session-0001',null,null,'{}'::jsonb) result`);
  if(!r.result.duplicate||r.result.session_id!==sessionId)throw new Error('session_idempotency_failed');
  r=await one(`select public.complete_experience_session_v1('${sessionId}'::uuid,'{"basket":"media"}'::jsonb,'provider-fixture') result`);
  if(!r.result.ok||r.result.status!=='completed')throw new Error('session_completion_failed');
  r=await one(`select public.complete_experience_session_v1('${sessionId}'::uuid,'{"basket":"other"}'::jsonb,'provider-fixture') result`);
  if(!r.result.duplicate)throw new Error('completion_idempotency_failed');

  await db.exec(`update public.conversations set upsell_declined=true where id='${conv}'::uuid`);
  r=await one(`select public.plan_next_experience_v1('${conv}'::uuid,'upsell',4,4,false,'{}'::jsonb) plan`);
  if(r.plan.reason!=='upsell_suppressed'||r.plan.offer_suppressed!==true)throw new Error('declined_upsell_must_be_suppressed');
  await db.exec(`update public.conversations set upsell_declined=false,human_required=true,mode='human' where id='${conv}'::uuid`);
  r=await one(`select public.plan_next_experience_v1('${conv}'::uuid,'basket_customize',0,8,false,'{}'::jsonb) plan`);
  if(r.plan.action!=='human')throw new Error('human_takeover_must_win');
  await db.exec(`update public.conversations set human_required=false,mode='ai' where id='${conv}'::uuid`);

  const basket=(await one(`insert into public.basket_templates(name,description,base_price) values('Cesta Teste','Preço comercial próprio',199.90) returning id`)).id;
  const p1=(await one(`insert into public.products(name) values('Arroz 5 kg') returning id`)).id;
  const p2=(await one(`insert into public.products(name) values('Feijão 1 kg') returning id`)).id;
  await db.exec(`
    insert into public.basket_template_items(basket_id,product_id,quantity,removable,quantity_editable,min_quantity,max_quantity,sort_order) values
      ('${basket}'::uuid,'${p1}'::uuid,2,true,true,0,5,1),
      ('${basket}'::uuid,'${p2}'::uuid,1,false,false,1,1,2);
  `);
  r=await one(`select public.build_basket_flow_context_v1('${conv}'::uuid,'${basket}'::uuid) context`);
  if(r.context.policy.component_prices_visible!==false||r.context.policy.component_sum_is_commercial_price!==false)throw new Error('basket_pricing_policy_leak');
  if(Number(r.context.basket.commercial_price)!==199.9)throw new Error('basket_commercial_price_missing');
  for(const item of r.context.items){for(const forbidden of ['price','unit_price','line_total','cost','stock'])if(Object.hasOwn(item,forbidden))throw new Error(`component_price_or_stock_leak:${forbidden}`)}

  const validSelection=JSON.stringify([{product_id:p1,quantity:3},{product_id:p2,quantity:1}]).replaceAll("'","''");
  r=await one(`select public.validate_basket_flow_selection_v1('${basket}'::uuid,'${validSelection}'::jsonb) result`);
  if(!r.result.valid||r.result.normalized.length!==2)throw new Error('valid_basket_selection_rejected');
  const invalidSelection=JSON.stringify([{product_id:p1,quantity:3},{product_id:p2,quantity:0}]).replaceAll("'","''");
  r=await one(`select public.validate_basket_flow_selection_v1('${basket}'::uuid,'${invalidSelection}'::jsonb) result`);
  if(r.result.valid||!r.result.issues.some(x=>x.code==='quantity_out_of_range'||x.code==='product_not_removable'||x.code==='quantity_not_editable'))throw new Error('protected_component_change_accepted');
  const incompleteSelection=JSON.stringify([{product_id:p1,quantity:2}]).replaceAll("'","''");
  r=await one(`select public.validate_basket_flow_selection_v1('${basket}'::uuid,'${incompleteSelection}'::jsonb) result`);
  if(r.result.valid||!r.result.issues.some(x=>x.code==='missing_component'))throw new Error('incomplete_snapshot_accepted');

  r=await one(`select public.get_flow_contract_readiness_v1() readiness`);
  if(r.readiness.basket_personalization_v1.component_prices_visible!==false||r.readiness.basket_personalization_v1.contract_ready!==true)throw new Error('flow_readiness_contract_wrong');

  await db.exec(`update public.automation_config set experience_orchestrator_enabled=false where id=1`);
  let blocked=false;
  try{await db.exec(`select public.create_experience_session_v1('${conv}'::uuid,'flow-personalizar-cesta-v1','fixture-session-0002',null,null,'{}'::jsonb)`)}catch(e){blocked=String(e).includes('experience_feature_disabled')}
  if(!blocked)throw new Error('global_kill_switch_must_block_new_sessions');

  r=await one(`select public.get_experience_orchestrator_dashboard_v1() dashboard`);
  if(r.dashboard.config.orchestrator_enabled!==false)throw new Error('dashboard_state_wrong');
  if(!Array.isArray(r.dashboard.features)||r.dashboard.features.length<5)throw new Error('dashboard_features_missing');
  console.log('PASS: experience orchestrator + safe basket Flow contract, no component prices, idempotent sessions, routing, upsell suppression and human precedence.');
}finally{await db.close()}
