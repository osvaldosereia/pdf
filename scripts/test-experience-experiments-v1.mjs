import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async(sql)=>{const r=await db.query(sql);return r.rows?.[0]||null};
try{
  await db.exec(`
    create role anon;create role authenticated;create role service_role bypassrls;
    create table public.automation_config(id integer primary key,whatsapp_release_mode text default 'off',whatsapp_live_canary_percent smallint default 0,updated_at timestamptz default now());
    insert into public.automation_config(id) values(1);
    create table public.customers(id uuid primary key default gen_random_uuid());
    create table public.messages(id uuid primary key default gen_random_uuid());
    create table public.carts(id uuid primary key default gen_random_uuid());
    create table public.conversations(
      id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),mode text not null default 'ai',human_required boolean not null default false,
      fast_checkout boolean not null default false,upsell_declined boolean not null default false,automation_bucket smallint,automation_cohort text,channel text not null default 'whatsapp'
    );
  `);
  await db.exec(readFileSync('supabase/migrations/20260908001000_experience_orchestrator_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908004000_experience_experiments_v1.sql','utf8'));

  let r=await one(`select status,allocation_percent from public.experience_experiments where slug='basket-flow-vs-conversation-v1'`);
  if(r.status!=='draft'||Number(r.allocation_percent)!==0)throw new Error('experiment_must_default_dormant');
  const conv=(await one(`insert into public.conversations(automation_cohort) values('fixture') returning id`)).id;
  r=await one(`select public.preview_experience_experiment_v1('basket-flow-vs-conversation-v1','${conv}'::uuid) preview`);
  if(r.preview.eligible!==false||r.preview.reason!=='experiment_not_running')throw new Error('draft_experiment_must_not_assign');
  r=await one(`select public.assign_experience_experiment_v1('basket-flow-vs-conversation-v1','${conv}'::uuid,'{}'::jsonb) result`);
  if(r.result.assigned!==false)throw new Error('draft_experiment_assignment_created');
  r=await one(`select count(*)::int n from public.experience_experiment_assignments`);if(r.n!==0)throw new Error('draft_assignment_persisted');

  await db.exec(`update public.experience_experiments set status='running',allocation_percent=100,starts_at=now()-interval '1 minute' where slug='basket-flow-vs-conversation-v1'`);
  const p1=(await one(`select public.preview_experience_experiment_v1('basket-flow-vs-conversation-v1','${conv}'::uuid) preview`)).preview;
  const p2=(await one(`select public.preview_experience_experiment_v1('basket-flow-vs-conversation-v1','${conv}'::uuid) preview`)).preview;
  if(!p1.eligible||p1.variant!==p2.variant||p1.bucket!==p2.bucket)throw new Error('experiment_preview_not_stable');
  if(!['conversation_control','flow_treatment'].includes(p1.variant))throw new Error('invalid_variant');
  r=await one(`select public.assign_experience_experiment_v1('basket-flow-vs-conversation-v1','${conv}'::uuid,'{"source":"fixture"}'::jsonb) result`);
  if(!r.result.assigned||r.result.duplicate)throw new Error('experiment_assignment_failed');
  const assignmentId=r.result.assignment_id;
  r=await one(`select public.assign_experience_experiment_v1('basket-flow-vs-conversation-v1','${conv}'::uuid,'{}'::jsonb) result`);
  if(!r.result.duplicate||r.result.assignment_id!==assignmentId||r.result.variant!==p1.variant)throw new Error('experiment_assignment_not_idempotent');
  r=await one(`select count(*)::int n from public.experience_events where conversation_id='${conv}'::uuid and event_type='experiment_assigned'`);
  if(r.n!==1)throw new Error('experiment_assignment_event_not_deduped');

  const human=(await one(`insert into public.conversations(mode,human_required) values('human',true) returning id`)).id;
  r=await one(`select public.preview_experience_experiment_v1('basket-flow-vs-conversation-v1','${human}'::uuid) preview`);
  if(r.preview.eligible!==false||r.preview.reason!=='human_takeover')throw new Error('human_conversation_entered_experiment');

  await db.exec(`update public.experience_experiments set allocation_percent=1 where slug='basket-flow-vs-conversation-v1'`);
  let outside=null;
  for(let i=0;i<500&&!outside;i++){
    const id=(await one(`insert into public.conversations default values returning id`)).id;
    const preview=(await one(`select public.preview_experience_experiment_v1('basket-flow-vs-conversation-v1','${id}'::uuid) preview`)).preview;
    if(preview.reason==='outside_allocation')outside=preview;
  }
  if(!outside)throw new Error('allocation_control_not_proven');

  r=await one(`select public.get_experience_experiment_dashboard_v1() dashboard`);
  const exp=r.dashboard.experiments.find(x=>x.slug==='basket-flow-vs-conversation-v1');
  if(!exp||Number(exp.assignments)!==1||Number(exp.variant_counts[p1.variant])!==1)throw new Error('experiment_dashboard_wrong');
  console.log('PASS: experiments default dormant, stable preview, idempotent assignment, human exclusion and allocation control.');
}finally{await db.close()}
