import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async q=>(await db.query(q)).rows?.[0]||null;
try{
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create table public.products(
      id uuid primary key default gen_random_uuid(),sku text,name text not null,gtin text,
      price numeric,cost numeric,stock numeric,is_active boolean not null default true,
      physically_verified boolean not null default false,last_counted_at timestamptz,min_stock numeric
    );
    create table public.customers(id uuid primary key default gen_random_uuid());
    create table public.basket_templates(id uuid primary key default gen_random_uuid(),base_price numeric not null,is_active boolean not null default true);
    create table public.basket_template_items(id uuid primary key default gen_random_uuid(),basket_id uuid not null references public.basket_templates(id),product_id uuid not null references public.products(id),quantity numeric not null,sort_order integer not null default 0,created_at timestamptz not null default now());
    create table public.warehouse_locations(id uuid primary key default gen_random_uuid());
    create table public.warehouse_staff(id uuid primary key default gen_random_uuid());
    create table public.inventory_count_items(id uuid primary key default gen_random_uuid(),product_id uuid not null references public.products(id),previous_stock numeric,counted_stock numeric not null,counted_at timestamptz not null default now());
    create table public.fulfillment_items(id uuid primary key default gen_random_uuid(),product_id uuid not null references public.products(id));
    create table public.fulfillment_exceptions(id uuid primary key default gen_random_uuid(),fulfillment_item_id uuid references public.fulfillment_items(id),status text not null,type text not null);
  `);
  for(const f of ['supabase/migrations/20260908130000_stage12_commercial_truth_foundation_v1.sql','supabase/migrations/20260908150000_stage12_substitution_cycle_count_v1.sql'])await db.exec(readFileSync(f,'utf8'));

  let cfg=await one(`select * from public.commercial_truth_runtime_config where id=1`);
  for(const k of ['substitution_preview_enabled','substitution_recording_enabled','substitution_apply_enabled','cycle_count_planning_enabled','cycle_count_recording_enabled','cycle_count_adjustment_enabled'])if(cfg[k]!==false)throw new Error(`unsafe_default_${k}`);

  const original=(await one(`insert into public.products(sku,name,gtin,price,cost,stock,is_active,physically_verified,min_stock) values('ARROZ-A','Arroz A','78901',10,6,2,true,false,3) returning id`)).id;
  const candidate=(await one(`insert into public.products(sku,name,gtin,price,cost,stock,is_active,physically_verified,min_stock) values('ARROZ-B','Arroz B','78902',11,6.5,10,true,true,2) returning id`)).id;
  const other=(await one(`insert into public.products(sku,name,gtin,price,cost,stock,is_active,physically_verified,min_stock) values('FEIJAO','Feijao','78903',9,5,10,true,true,2) returning id`)).id;
  await db.exec(`insert into public.inventory_lots(product_id,lot_code,received_at,expires_at,quantity_received,quantity_available,quantity_reserved,status,physically_verified) values('${candidate}','CAND-OK',now(),'2027-06-01',10,10,0,'available',true)`);
  const group=(await one(`insert into public.substitution_groups(code,name,status,policy) values('ARROZ_EQ','Arroz equivalente','active','{"minimum_margin_percent":20,"standalone_price_strategy":"preserve_original_price","max_customer_price_increase_percent":15}') returning id`)).id;
  await db.exec(`insert into public.substitution_group_items(group_id,product_id,status,priority) values('${group}','${original}','active',10),('${group}','${candidate}','active',20)`);
  const customer=(await one(`insert into public.customers default values returning id`)).id;

  let r=await one(`select public.preview_substitution_v1('${original}','${candidate}',1,'2027-01-15','${customer}',null,'manual',null) x`);
  if(r.x.error!=='substitution_preview_disabled')throw new Error('substitution_must_fail_closed');
  await db.exec(`update public.commercial_truth_runtime_config set enabled=true,execution_mode='observe',substitution_preview_enabled=true where id=1`);
  r=await one(`select public.preview_substitution_v1('${original}','${candidate}',1,'2027-01-15','${customer}',null,'manual',null) x`);
  if(r.x.decision!=='ask'||r.x.preference!=='ask'||r.x.pricing.strategy!=='preserve_original_price')throw new Error('default_customer_confirmation_failed');
  if(r.x.inventory.lines.length!==1||r.x.inventory.lines[0].lot_code!=='CAND-OK')throw new Error('candidate_fefo_validation_failed');

  await db.exec(`insert into public.customer_substitution_preferences(customer_id,product_id,preference) values('${customer}','${original}','no_substitute')`);
  r=await one(`select public.preview_substitution_v1('${original}','${candidate}',1,'2027-01-15','${customer}',null,'manual',null) x`);
  if(r.x.decision!=='block'||r.x.reason!=='customer_no_substitute')throw new Error('no_substitute_preference_failed');
  await db.exec(`update public.customer_substitution_preferences set preference='allow_rule' where customer_id='${customer}' and product_id='${original}'`);
  r=await one(`select public.preview_substitution_v1('${original}','${candidate}',1,'2027-01-15','${customer}',null,'manual',null) x`);
  if(r.x.decision!=='allow')throw new Error('allow_rule_failed');

  const basket=(await one(`insert into public.basket_templates(base_price,is_active) values(30,true) returning id`)).id;
  await db.exec(`insert into public.basket_template_items(basket_id,product_id,quantity,sort_order) values('${basket}','${original}',1,1),('${basket}','${other}',2,2)`);
  r=await one(`select public.preview_substitution_v1('${original}','${candidate}',1,'2027-01-15','${customer}','${basket}','manual',null) x`);
  if(r.x.decision!=='allow'||r.x.pricing.strategy!=='preserve_basket_price'||r.x.pricing.component_promotion_does_not_reprice_basket!==true)throw new Error('basket_price_preservation_failed');
  if(Number(r.x.pricing.basket_price)!==30)throw new Error('basket_commercial_price_changed');

  r=await one(`select public.preview_substitution_v1('${original}','${other}',1,'2027-01-15','${customer}',null,'manual',null) x`);
  if(r.x.decision!=='block'||r.x.reason!=='products_not_in_active_equivalence_group')throw new Error('unauthorized_equivalence_allowed');

  r=await one(`select public.record_substitution_evaluation_v1('${original}','${candidate}',1,'2027-01-15','${customer}',null,'manual',null,'sub-eval:0000001') x`);
  if(r.x.error!=='substitution_recording_disabled')throw new Error('substitution_record_gate_failed');
  await db.exec(`update public.commercial_truth_runtime_config set substitution_recording_enabled=true where id=1`);
  r=await one(`select public.record_substitution_evaluation_v1('${original}','${candidate}',1,'2027-01-15','${customer}',null,'manual',null,'sub-eval:0000001') x`);
  if(r.x.ok!==true||r.x.replay!==false||r.x.applied!==false)throw new Error('substitution_record_failed');
  r=await one(`select public.record_substitution_evaluation_v1('${original}','${candidate}',1,'2027-01-15','${customer}',null,'manual',null,'sub-eval:0000001') x`);
  if(r.x.replay!==true)throw new Error('substitution_record_idempotency_failed');

  await db.exec(`insert into public.commercial_policy_versions(policy_key,version,status,policy) values('cycle_count',1,'active','{"minimum_priority_score":50,"expiry_window_days":60,"absolute_quantity_threshold":0,"difference_percent_threshold":0,"weights":{"physically_unverified":30,"never_counted":30,"low_stock":20,"inventory_divergence":20,"picking_exception":30,"expiry_risk":10}}')`);
  r=await one(`select public.preview_cycle_count_candidate_v1('${original}',null) x`);
  if(r.x.error!=='cycle_count_planning_disabled')throw new Error('cycle_count_preview_gate_failed');
  await db.exec(`update public.commercial_truth_runtime_config set cycle_count_planning_enabled=true where id=1`);
  r=await one(`select public.preview_cycle_count_candidate_v1('${original}',null) x`);
  if(r.x.result!=='eligible'||r.x.eligible_for_task!==true||Number(r.x.priority_score)<80)throw new Error('cycle_count_risk_scoring_failed');

  await db.exec(`update public.commercial_truth_runtime_config set execution_mode='homologation' where id=1`);
  r=await one(`select public.create_cycle_count_task_v1('${original}',null,null,'low_stock',true,'cycle-task:000001') x`);
  if(r.x.ok!==true||r.x.status!=='draft'||r.x.stock_adjusted!==false)throw new Error('cycle_count_task_draft_failed');
  const task=r.x.task_id;
  if(Number((await one(`select stock from public.products where id='${original}'`)).stock)!==2)throw new Error('task_mutated_stock');

  r=await one(`select public.record_cycle_count_observation_v1('${task}',2,null,'count:0001','{}') x`);
  if(r.x.error!=='cycle_count_recording_disabled')throw new Error('cycle_count_record_gate_failed');
  await db.exec(`update public.commercial_truth_runtime_config set cycle_count_recording_enabled=true where id=1`);
  r=await one(`select public.record_cycle_count_observation_v1('${task}',2,null,'count:0001','{}') x`);
  if(r.x.decision!=='within_tolerance'||r.x.stock_adjusted!==false||r.x.adjustment_gate_enabled!==false)throw new Error('within_tolerance_observation_failed');
  if(Number((await one(`select stock from public.products where id='${original}'`)).stock)!==2)throw new Error('observation_mutated_stock');
  r=await one(`select public.record_cycle_count_observation_v1('${task}',2,null,'count:0001','{}') x`);
  if(r.x.replay!==true)throw new Error('cycle_count_observation_idempotency_failed');

  const task2=(await one(`select public.create_cycle_count_task_v1('${original}',null,null,'manual',true,'cycle-task:000002') x`)).x.task_id;
  r=await one(`select public.record_cycle_count_observation_v1('${task2}',0,null,'count:0002','{}') x`);
  if(r.x.decision!=='review_required'||r.x.stock_adjusted!==false)throw new Error('divergence_must_review');
  const kpi=(await one(`select public.cycle_count_kpis_v1(null,null) x`)).x;
  if(Number(kpi.observations)!==2||Number(kpi.within_tolerance)!==1||Number(kpi.review_required)!==1||Number(kpi.inventory_accuracy_percent)!==50)throw new Error('inventory_accuracy_kpi_failed');

  const counts=await one(`select (select count(*)::int from public.substitution_evaluations) substitutions,(select count(*)::int from public.cycle_count_tasks) tasks,(select count(*)::int from public.cycle_count_observations) observations`);
  if(Number(counts.substitutions)!==1||Number(counts.tasks)!==2||Number(counts.observations)!==2)throw new Error('unexpected_audit_counts');
  console.log('PASS: substitution preserves basket pricing and customer preference; cycle count remains blind/reviewable and never mutates stock.');
}finally{await db.close();}
