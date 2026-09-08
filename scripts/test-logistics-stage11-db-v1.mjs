import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async sql=>(await db.query(sql)).rows?.[0]||null;
const migrations=[
  'supabase/migrations/20260908112000_stage11_logistics_foundation_v1.sql',
  'supabase/migrations/20260908112100_stage11_driver_actions_v1.sql',
  'supabase/migrations/20260908112200_stage11_logistics_policy_v2.sql',
  'supabase/migrations/20260908112300_stage11_route_drafts_notifications_v3.sql',
  'supabase/migrations/20260908112400_stage11_delivery_payment_fiscal_gate_v1.sql',
];
try{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.customers(id uuid primary key default gen_random_uuid(), name text);
    create table public.orders(
      id uuid primary key default gen_random_uuid(),
      customer_id uuid references public.customers(id),
      status text not null default 'confirmed',
      total numeric not null default 0,
      delivery_address jsonb not null default '{}'::jsonb,
      customer_snapshot jsonb not null default '{}'::jsonb,
      external_status_updated_at timestamptz,
      delivered_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  for(const file of migrations)await db.exec(readFileSync(file,'utf8'));

  let r=await one(`select public.logistics_readiness_v1() x`);
  for(const key of ['enabled','job_creation_enabled','routing_enabled','driver_app_enabled','gps_tracking_enabled','notifications_enabled','external_provider_enabled'])if(r.x[key]!==false)throw new Error(`default_${key}_must_be_false`);
  if(r.x.execution_mode!=='off'||r.x.provider_name!=='none'||Number(r.x.canary_percent)!==0)throw new Error('runtime_defaults_must_be_off');
  if(Number(r.x.jobs)!==0||Number(r.x.routes)!==0||Number(r.x.provider_calls_performed)!==0||Number(r.x.notifications_sent)!==0)throw new Error('runtime_counts_must_start_zero');

  const fiscalCfg=await one(`select enabled,execution_mode,bling_invoice_prepare_enabled,bling_invoice_send_enabled,require_delivery_confirmation,require_payment_confirmation,canary_percent from public.fiscal_runtime_config where id=1`);
  if(fiscalCfg.enabled!==false||fiscalCfg.execution_mode!=='off'||fiscalCfg.bling_invoice_prepare_enabled!==false||fiscalCfg.bling_invoice_send_enabled!==false||fiscalCfg.require_delivery_confirmation!==true||fiscalCfg.require_payment_confirmation!==true||Number(fiscalCfg.canary_percent)!==0)throw new Error('fiscal_runtime_must_start_fail_closed');

  const customer=(await one(`insert into public.customers(name) values('Teste Logística') returning id`)).id;
  const order=(await one(`insert into public.orders(customer_id,status,total,delivery_address,customer_snapshot,external_status_updated_at) values(
    '${customer}'::uuid,'ready',159.90,
    '{"street":"Rua Teste","number":"123","city":"Cuiabá","latitude":-15.601,"longitude":-56.097,"coordinate_source":"admin_confirmed","coordinate_confidence":0.99,"volumes":2}'::jsonb,
    '{"name":"Cliente Teste","whatsapp_e164":"+5565999999999"}'::jsonb,now()
  ) returning id`)).id;

  r=await one(`select public.preview_bling_invoice_eligibility_v1('${order}'::uuid) x`);
  if(r.x.eligible!==false||r.x.reason!=='fiscal_control_missing'||r.x.external_side_effect!==false)throw new Error('invoice_preview_before_delivery_must_be_blocked');

  r=await one(`select public.confirm_order_payment_v1('${order}'::uuid,'prepaid_pix','test',159.90,now()) x`);
  if(r.x.fiscal_status!=='blocked'||r.x.block_reason!=='delivery_not_confirmed'||r.x.external_side_effect!==false)throw new Error('prepaid_payment_must_not_issue_before_delivery');

  await db.exec(`update public.orders set status='delivered',delivered_at=now(),updated_at=now() where id='${order}'::uuid`);
  r=await one(`select public.refresh_order_fiscal_readiness_v1('${order}'::uuid) x`);
  if(r.x.fiscal_status!=='ready'||r.x.block_reason!==null||r.x.external_side_effect!==false)throw new Error('delivered_plus_paid_must_be_fiscal_ready');
  r=await one(`select public.preview_bling_invoice_eligibility_v1('${order}'::uuid) x`);
  if(r.x.eligible!==true||r.x.fiscal_status!=='ready'||r.x.external_side_effect!==false)throw new Error('invoice_preview_should_be_eligible_after_delivery_and_payment');

  r=await one(`select public.prepare_bling_invoice_issue_job_v1('${order}'::uuid,'invoice:${order}:v1') x`);
  if(r.x.error!=='fiscal_runtime_disabled'||r.x.external_side_effect!==false||r.x.side_effect_performed!==false)throw new Error('fiscal_job_must_fail_closed_by_default');
  if(Number((await one(`select count(*)::int n from public.fiscal_issue_jobs`)).n)!==0)throw new Error('disabled_fiscal_runtime_must_not_create_job');

  const mismatchOrder=(await one(`insert into public.orders(customer_id,status,total,delivery_address,customer_snapshot,delivered_at,external_status_updated_at) values(
    '${customer}'::uuid,'delivered',100.00,'{}'::jsonb,'{}'::jsonb,now(),now()
  ) returning id`)).id;
  r=await one(`select public.confirm_order_payment_v1('${mismatchOrder}'::uuid,'cash','driver_app',90.00,now()) x`);
  if(r.x.fiscal_status!=='review_required'||r.x.block_reason!=='settled_amount_mismatch')throw new Error('payment_mismatch_must_require_review');

  const unpaidOrder=(await one(`insert into public.orders(customer_id,status,total,delivery_address,customer_snapshot,delivered_at,external_status_updated_at) values(
    '${customer}'::uuid,'delivered',80.00,'{}'::jsonb,'{}'::jsonb,now(),now()
  ) returning id`)).id;
  r=await one(`select public.refresh_order_fiscal_readiness_v1('${unpaidOrder}'::uuid) x`);
  if(r.x.fiscal_status!=='blocked'||r.x.block_reason!=='payment_not_confirmed')throw new Error('delivered_without_payment_must_stay_blocked');

  const cancelledOrder=(await one(`insert into public.orders(customer_id,status,total,delivery_address,customer_snapshot,external_status_updated_at) values(
    '${customer}'::uuid,'cancelled',50.00,'{}'::jsonb,'{}'::jsonb,now()
  ) returning id`)).id;
  r=await one(`select public.refresh_order_fiscal_readiness_v1('${cancelledOrder}'::uuid) x`);
  if(r.x.fiscal_status!=='cancelled'||r.x.block_reason!=='order_cancelled')throw new Error('cancelled_delivery_must_never_be_fiscal_ready');

  r=await one(`select public.preview_delivery_job_from_ready_order_v1('${order}'::uuid) x`);
  if(r.x.error!=='order_not_ready')throw new Error('delivered_order_must_not_return_to_ready_logistics');

  const routeOrder=(await one(`insert into public.orders(customer_id,status,total,delivery_address,customer_snapshot,external_status_updated_at) values(
    '${customer}'::uuid,'ready',159.90,
    '{"street":"Rua Teste","number":"123","city":"Cuiabá","latitude":-15.601,"longitude":-56.097,"coordinate_source":"admin_confirmed","coordinate_confidence":0.99,"volumes":2}'::jsonb,
    '{"name":"Cliente Teste","whatsapp_e164":"+5565999999999"}'::jsonb,now()
  ) returning id`)).id;
  r=await one(`select public.preview_delivery_job_from_ready_order_v1('${routeOrder}'::uuid) x`);
  if(r.x.ok!==true||r.x.side_effect_performed!==false||r.x.geocode_status!=='not_required')throw new Error('ready_preview_failed');
  r=await one(`select public.create_delivery_job_from_ready_order_v1('${routeOrder}'::uuid,'order:${routeOrder}:attempt:1') x`);
  if(r.x.error!=='logistics_job_creation_disabled'||r.x.side_effect_performed!==false)throw new Error('ready_job_gate_not_fail_closed');
  if(Number((await one(`select count(*)::int n from public.delivery_jobs`)).n)!==0)throw new Error('disabled_job_creation_must_not_write');

  await db.exec(`update public.logistics_runtime_config set enabled=true,execution_mode='observe',job_creation_enabled=true where id=1`);
  r=await one(`select public.create_delivery_job_from_ready_order_v1('${routeOrder}'::uuid,'order:${routeOrder}:attempt:1') x`);
  if(r.x.ok!==true||r.x.replay!==false||r.x.side_effect_performed!==true)throw new Error('ready_job_creation_failed');
  const job=r.x.delivery_job_id;
  r=await one(`select public.create_delivery_job_from_ready_order_v1('${routeOrder}'::uuid,'order:${routeOrder}:attempt:1') x`);
  if(r.x.replay!==true||r.x.side_effect_performed!==false||r.x.delivery_job_id!==job)throw new Error('ready_job_idempotency_failed');

  r=await one(`select public.create_delivery_route_draft_v1(array['${job}'::uuid],null,null,current_date,null,'db_test') x`);
  if(r.x.ok!==true||r.x.geographically_optimized!==false||r.x.external_side_effect!==false)throw new Error('route_draft_failed');
  const route=r.x.route_id;
  const stop=(await one(`select id,status,locked from public.delivery_stops where route_id='${route}'::uuid order by sequence_no limit 1`));
  if(stop.status!=='planned'||stop.locked!==false)throw new Error('draft_stop_must_be_unlocked');

  await db.exec(`update public.logistics_runtime_config set enabled=false,execution_mode='off',job_creation_enabled=false where id=1`);
  r=await one(`select public.publish_delivery_route_v1('${route}'::uuid,null,'db_test') x`);
  if(r.x.error!=='route_publish_disabled'||r.x.side_effect_performed!==false)throw new Error('route_publish_gate_not_fail_closed');

  r=await one(`select public.prepare_delivery_notification_v1('${stop.id}'::uuid,'next_stop','next:${stop.id}') x`);
  if(r.x.ok!==true||r.x.status!=='held'||r.x.dispatcher_implemented!==false||r.x.send_allowed!==false)throw new Error('notification_prepare_must_be_held');
  const notification=r.x.notification_id;
  let s=await one(`select status,locked from public.delivery_stops where id='${stop.id}'::uuid`);
  if(s.locked!==false||s.status!=='planned')throw new Error('notification_prepare_must_not_lock_stop');
  r=await one(`select public.mark_delivery_notification_receipt_v1('${notification}'::uuid,'sent','provider-test-1') x`);
  if(r.x.ok!==true||r.x.next_stop_locked!==true)throw new Error('next_stop_receipt_must_lock');
  s=await one(`select status,locked from public.delivery_stops where id='${stop.id}'::uuid`);
  if(s.locked!==true||s.status!=='locked_next')throw new Error('next_stop_lock_state_failed');

  r=await one(`select public.record_driver_location_v1(gen_random_uuid(), '${route}'::uuid,-15.60,-56.10,10,now(),'gps:disabled:1') x`);
  if(r.x.error!=='gps_tracking_disabled'||r.x.side_effect_performed!==false)throw new Error('gps_must_fail_closed');

  r=await one(`select public.kill_logistics_runtime_v1('db_test',null) x`);
  if(r.x.ok!==true||r.x.enabled!==false||r.x.execution_mode!=='off')throw new Error('kill_switch_failed');
  r=await one(`select public.logistics_readiness_v1() x`);
  if(r.x.enabled!==false||r.x.external_provider_enabled!==false||r.x.provider_name!=='none'||Number(r.x.canary_percent)!==0)throw new Error('kill_switch_did_not_close_all_gates');

  console.log('PASS: stage11 DB is logistics-safe and NF-e remains blocked until delivery + payment confirmation.');
} finally { await db.close(); }
