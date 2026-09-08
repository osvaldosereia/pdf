import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async sql=>(await db.query(sql)).rows?.[0]||null;
try{
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create table public.automation_config(id smallint primary key,experience_orchestrator_enabled boolean not null default false,whatsapp_flow_data_exchange_enabled boolean not null default false,whatsapp_flow_send_enabled boolean not null default false); insert into public.automation_config(id) values(1);
 create table public.conversations(id uuid primary key default gen_random_uuid(),channel text not null default 'whatsapp',human_required boolean not null default false,mode text not null default 'ai');
 create table public.human_handoffs(id uuid primary key default gen_random_uuid(),conversation_id uuid references public.conversations(id),status text not null default 'open');
 create or replace function public.plan_next_experience_v1(uuid,text,integer,integer,boolean,jsonb) returns jsonb language sql stable as $$select jsonb_build_object('ok',true,'action','whatsapp_flow','side_effects',false)$$;`);
 await db.exec(readFileSync('supabase/migrations/20260908052000_stage8_channel_aware_orchestrator_v1.sql','utf8'));
 let r=await one(`select count(*)::int n from public.experience_channel_capabilities where enabled`); if(r.n!==0) throw new Error('capabilities_must_default_off');
 r=await one(`select public.get_channel_experience_readiness_v1() x`); if(r.x.orchestrator_enabled!==false||r.x.flow_send_enabled!==false||r.x.flow_data_exchange_enabled!==false) throw new Error('readiness_must_be_dormant');
 const conv=(await one(`insert into public.conversations(channel) values('whatsapp') returning id`)).id;
 r=await one(`select public.plan_channel_experience_v2('${conv}'::uuid,'basket_customize',0,4,false,'{}') x`); if(r.x.action!=='conversation'||r.x.reason!=='orchestrator_disabled') throw new Error('global_gate_not_fail_closed');
 await db.exec(`update public.automation_config set experience_orchestrator_enabled=true where id=1; update public.experience_channel_capabilities set enabled=true where channel='whatsapp' and experience_type='conversation';`);
 r=await one(`select public.plan_channel_experience_v2('${conv}'::uuid,'basket_customize',0,4,false,'{}') x`); if(r.x.action!=='conversation'||r.x.reason!=='channel_capability_fallback') throw new Error('disabled_flow_must_fallback');
 await db.exec(`insert into public.human_handoffs(conversation_id,status) values('${conv}','open')`);
 r=await one(`select public.plan_channel_experience_v2('${conv}'::uuid,'basket_customize',0,4,false,'{}') x`); if(r.x.action!=='human'||r.x.reason!=='human_precedence') throw new Error('open_handoff_must_win');
 console.log('PASS: stage8 DB capability registry is dormant, fail-closed and preserves human handoff.');
} finally { await db.close(); }
