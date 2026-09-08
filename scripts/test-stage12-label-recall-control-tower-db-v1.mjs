import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async q=>(await db.query(q)).rows?.[0]||null;
try{
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create table public.customers(id uuid primary key default gen_random_uuid(),name text,primary_whatsapp_e164 text);
    create table public.orders(
      id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),status text not null default 'confirmed',
      delivery_address jsonb not null default '{}',customer_snapshot jsonb not null default '{}',confirmed_at timestamptz,
      delivered_at timestamptz,cancelled_at timestamptz,returned_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
    );
    create table public.fulfillment_orders(
      id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),status text not null default 'pending',
      started_picking_at timestamptz,picked_at timestamptz,checking_started_at timestamptz,checked_at timestamptz,packed_at timestamptz,ready_at timestamptz,loaded_at timestamptz,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now()
    );
    create table public.order_packages(
      id uuid primary key default gen_random_uuid(),fulfillment_order_id uuid not null references public.fulfillment_orders(id),package_no integer not null,package_count integer not null default 1,
      barcode text not null,status text not null default 'packed',created_at timestamptz not null default now()
    );
    create table public.inventory_lots(
      id uuid primary key default gen_random_uuid(),product_id uuid not null,lot_code text not null,status text not null default 'available',expires_at date,
      quantity_available numeric not null default 0,quantity_reserved numeric not null default 0,physically_verified boolean not null default false
    );
    create table public.warehouse_locations(id uuid primary key default gen_random_uuid());
    create table public.fulfillment_items(
      id uuid primary key default gen_random_uuid(),fulfillment_order_id uuid not null references public.fulfillment_orders(id),lot_id uuid references public.inventory_lots(id),expected_quantity numeric not null
    );
    create table public.inventory_lot_movements(
      id uuid primary key default gen_random_uuid(),lot_id uuid not null references public.inventory_lots(id),movement_type text not null,quantity numeric not null,
      reference_type text,reference_id text,created_at timestamptz not null default now()
    );
    create table public.delivery_jobs(
      id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),attempt_no smallint not null default 1,status text not null default 'waiting_route',
      ready_at timestamptz not null default now(),delivered_at timestamptz,failed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
    );
    create table public.order_fiscal_controls(
      order_id uuid primary key references public.orders(id),delivery_status text not null default 'pending',delivery_confirmed_at timestamptz,
      payment_status text not null default 'pending',fiscal_status text not null default 'blocked',fiscal_ready_at timestamptz,issued_at timestamptz,updated_at timestamptz not null default now()
    );
    create table public.order_promise_commitments(
      id uuid primary key default gen_random_uuid(),order_id uuid not null references public.orders(id),promised_date date not null,item_units numeric not null default 0,
      status text not null default 'held',created_at timestamptz not null default now()
    );
  `);
  await db.exec(readFileSync('supabase/migrations/20260908153000_stage12_label_recall_control_tower_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908153100_stage12_label_recall_control_tower_v1_fix.sql','utf8'));

  let cfg=await one(`select * from public.operational_control_runtime_config where id=1`);
  for(const k of ['enabled','label_preview_enabled','label_recording_enabled','label_dispatch_enabled','recall_preview_enabled','recall_case_enabled','recall_quarantine_enabled','control_tower_enabled','sla_preview_enabled','sla_exception_recording_enabled'])if(cfg[k]!==false)throw new Error(`unsafe_default_${k}`);
  if(cfg.execution_mode!=='off'||Number(cfg.canary_percent)!==0)throw new Error('unsafe_runtime_default');

  const customer=(await one(`insert into public.customers(name,primary_whatsapp_e164) values('Cliente Teste','+5565999999999') returning id`)).id;
  const order=(await one(`insert into public.orders(customer_id,status,delivery_address,confirmed_at,created_at) values('${customer}','confirmed','{"street":"Rua Teste","number":"10","city":"Cuiaba"}',now()-interval '2 hours',now()-interval '2 hours') returning id`)).id;
  const fo=(await one(`insert into public.fulfillment_orders(order_id,status,started_picking_at,created_at) values('${order}','picking',now()-interval '90 minutes',now()-interval '100 minutes') returning id`)).id;
  const pkg=(await one(`insert into public.order_packages(fulfillment_order_id,package_no,package_count,barcode,status) values('${fo}',1,2,'PKG-ABC-001','packed') returning id`)).id;
  await db.exec(`insert into public.order_packages(fulfillment_order_id,package_no,package_count,barcode,status) values('${fo}',2,2,'PKG-ABC-002','packed')`);
  const lot=(await one(`insert into public.inventory_lots(product_id,lot_code,status,expires_at,quantity_available,quantity_reserved,physically_verified) values(gen_random_uuid(),'LOTE-TESTE','available','2027-12-31',10,2,true) returning id`)).id;
  await db.exec(`insert into public.fulfillment_items(fulfillment_order_id,lot_id,expected_quantity) values('${fo}','${lot}',2);insert into public.inventory_lot_movements(lot_id,movement_type,quantity,reference_type,reference_id) values('${lot}','reserve',2,'fulfillment','${fo}')`);

  let r=await one(`select public.preview_fulfillment_label_v1('${fo}','package','${pkg}') x`);
  if(r.x.error!=='label_preview_disabled')throw new Error('label_preview_must_fail_closed');
  await db.exec(`update public.operational_control_runtime_config set enabled=true,execution_mode='observe',label_preview_enabled=true,recall_preview_enabled=true,control_tower_enabled=true,sla_preview_enabled=true where id=1`);
  r=await one(`select public.preview_fulfillment_label_v1('${fo}','package','${pkg}') x`);
  if(r.x.ok!==true||r.x.preview_only!==true||Number(r.x.payload.format_mm.width)!==100||Number(r.x.payload.format_mm.height)!==150)throw new Error('label_format_failed');
  if(r.x.payload.barcode!=='PKG-ABC-001'||r.x.payload.volume_text!=='1/2'||r.x.payload.amount_visible!==false||r.x.payload.price_fields.length!==0)throw new Error('label_payload_safety_failed');

  r=await one(`select public.record_label_draft_v1('${fo}','package','${pkg}','label:${pkg}:v1','warehouse',null) x`);
  if(r.x.error!=='label_recording_disabled')throw new Error('label_recording_gate_failed');
  await db.exec(`update public.operational_control_runtime_config set execution_mode='homologation',label_recording_enabled=true where id=1`);
  r=await one(`select public.record_label_draft_v1('${fo}','package','${pkg}','label:${pkg}:v1','warehouse',null) x`);
  if(r.x.ok!==true||r.x.status!=='draft'||r.x.print_dispatched!==false)throw new Error('label_draft_record_failed');
  const label=r.x.label_document_id;
  r=await one(`select public.record_label_draft_v1('${fo}','package','${pkg}','label:${pkg}:v1','warehouse',null) x`);
  if(r.x.replay!==true)throw new Error('label_idempotency_failed');
  const lstate=await one(`select status,print_count,external_side_effect from public.label_documents where id='${label}'`);
  if(lstate.status!=='draft'||Number(lstate.print_count)!==0||lstate.external_side_effect!==false)throw new Error('label_must_remain_unprinted');

  r=await one(`select public.preview_lot_reverse_trace_v1('${lot}') x`);
  if(r.x.ok!==true||Number(r.x.affected_order_count)!==1||r.x.affected_orders[0].order_id!==order)throw new Error('reverse_trace_failed');
  if(r.x.quarantine_applied!==false||r.x.notifications_sent!==false||r.x.movements.length!==1)throw new Error('recall_preview_side_effect_detected');

  r=await one(`select public.create_recall_case_draft_v1('RC-001','Recall teste','Teste de rastreabilidade','high','internal',array['${lot}'::uuid],'recall:test:000001',null) x`);
  if(r.x.error!=='recall_case_creation_disabled')throw new Error('recall_case_gate_failed');
  await db.exec(`update public.operational_control_runtime_config set recall_case_enabled=true where id=1`);
  r=await one(`select public.create_recall_case_draft_v1('RC-001','Recall teste','Teste de rastreabilidade','high','internal',array['${lot}'::uuid],'recall:test:000001',null) x`);
  if(r.x.ok!==true||r.x.status!=='draft'||r.x.quarantine_applied!==false||r.x.notifications_sent!==false)throw new Error('recall_draft_failed');
  if((await one(`select status from public.inventory_lots where id='${lot}'`)).status!=='available')throw new Error('recall_draft_quarantined_lot');

  r=await one(`select public.control_tower_order_snapshot_v1('${order}') x`);
  if(r.x.ok!==true||r.x.current_stage!=='picking'||r.x.fulfillment.fulfillment_order_id!==fo||Number(r.x.fulfillment.package_count)!==2)throw new Error('control_tower_snapshot_failed');
  r=await one(`select public.preview_order_aging_v1('${order}',now()) x`);
  if(r.x.result!=='review'||r.x.reason!=='sla_policy_missing')throw new Error('sla_missing_policy_must_review');
  await db.exec(`insert into public.operational_sla_policies(stage,version_no,status,threshold_minutes,severity) values('picking',1,'active',30,'warning')`);
  r=await one(`select public.preview_order_aging_v1('${order}',now()) x`);
  if(r.x.result!=='breach'||r.x.breach!==true||Number(r.x.age_minutes)<89||Number(r.x.threshold_minutes)!==30)throw new Error('sla_breach_failed');

  r=await one(`select public.record_sla_exception_v1('${order}',now(),'sla:${order}:v1') x`);
  if(r.x.error!=='sla_exception_recording_disabled')throw new Error('sla_record_gate_failed');
  await db.exec(`update public.operational_control_runtime_config set sla_exception_recording_enabled=true where id=1`);
  r=await one(`select public.record_sla_exception_v1('${order}',now(),'sla:${order}:v1') x`);
  if(r.x.ok!==true||r.x.recorded!==true||r.x.stage!=='picking')throw new Error('sla_exception_record_failed');
  r=await one(`select public.record_sla_exception_v1('${order}',now(),'sla:${order}:v1') x`);
  if(r.x.replay!==true)throw new Error('sla_exception_idempotency_failed');

  const queue=(await one(`select public.control_tower_queue_v1(10) x`)).x;
  if(queue.ok!==true||Number(queue.count)!==1||queue.orders[0].order.order_id!==order)throw new Error('control_tower_queue_failed');

  const counts=await one(`select (select count(*)::int from public.label_documents) labels,(select count(*)::int from public.recall_cases) recalls,(select count(*)::int from public.operational_sla_exceptions) sla`);
  if(Number(counts.labels)!==1||Number(counts.recalls)!==1||Number(counts.sla)!==1)throw new Error('unexpected_audit_counts');
  console.log('PASS: 100x150 no-price label drafts, reverse recall trace, read-only Control Tower and SLA exception recording are deterministic and side-effect-safe.');
}finally{await db.close();}
