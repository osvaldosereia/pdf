import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {PGlite}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/@electric-sql/pglite`:'@electric-sql/pglite');
const db=new PGlite();
const one=async q=>(await db.query(q)).rows?.[0]||null;
const json=async q=>{const r=await one(q);const v=Object.values(r||{})[0];return typeof v==='string'?JSON.parse(v):v;};
try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;`);
  await db.exec(readFileSync('supabase/migrations/20260908062000_ai_action_registry_stage9_v1.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260908171000_ai_commercial_decision_policy_v1.sql','utf8'));

  let ready=await json(`select public.commercial_decision_readiness_v1() x`);
  assert.equal(ready.enabled,false);assert.equal(ready.enabled_tools,0);assert.equal(ready.approved_cost_policies,0);assert.equal(ready.approved_confidence_policies,0);
  let off=await json(`select public.preview_safe_commercial_action_v1('CATALOGO',0.99,false,false,'default','system') x`);
  assert.equal(off.error,'commercial_action_preview_disabled');

  await db.exec(`
    update public.commercial_decision_runtime_config set enabled=true,execution_mode='homologation',cost_policy_preview_enabled=true,action_safety_preview_enabled=true,confidence_policy_preview_enabled=true,decision_recording_enabled=true where id=1;
    update public.decision_confidence_policy_versions set status='approved',approved_at=now() where scope_key='default' and version=1;
    update public.commercial_tool_registry set enabled=true,execution_mode='homologation' where tool_key in ('CATALOGO','BLING_INTERNO','WHATSAPP_STANDARD_TEXT');
    update public.ai_action_registry set enabled=true,execution_mode='homologation' where action_key='search_products';
  `);

  let high=await json(`select public.preview_safe_commercial_action_v1('CATALOGO',0.95,false,false,'default','system') x`);
  assert.equal(high.decision,'approved');assert.equal(high.allowed,true);
  let medium=await json(`select public.preview_safe_commercial_action_v1('CATALOGO',0.75,false,false,'default','system') x`);
  assert.equal(medium.decision,'execute_with_disclosure');assert.equal(medium.allowed,true);
  let low=await json(`select public.preview_safe_commercial_action_v1('CATALOGO',0.50,false,false,'default','system') x`);
  assert.equal(low.decision,'ask_clarification');assert.equal(low.allowed,false);
  let handoff=await json(`select public.preview_safe_commercial_action_v1('CATALOGO',0.99,false,true,'default','system') x`);
  assert.equal(handoff.decision,'awaiting_human');

  let commit=await json(`select public.preview_safe_commercial_action_v1('BLING_INTERNO',0.99,false,false,'default','system') x`);
  assert.equal(commit.decision,'awaiting_confirmation');
  commit=await json(`select public.preview_safe_commercial_action_v1('BLING_INTERNO',0.99,true,false,'default','system') x`);
  assert.equal(commit.decision,'approved');

  let cost=await json(`select public.preview_tool_cost_policy_v1('WHATSAPP_STANDARD_TEXT',now()) x`);
  assert.equal(cost.allowed,false);assert.equal(cost.reason,'approved_cost_policy_missing');
  await db.exec(`insert into public.channel_cost_policy_versions(channel,category,provider,version,currency,unit_cost_brl,max_allowed_unit_cost_brl,cost_status,status,effective_from,effective_to,verified_at) values('whatsapp','service','meta',1,'BRL',0.040000,0.035000,'current','approved',now()-interval '1 day',now()+interval '1 day',now());`);
  cost=await json(`select public.preview_tool_cost_policy_v1('WHATSAPP_STANDARD_TEXT',now()) x`);
  assert.equal(cost.allowed,false);assert.equal(cost.reason,'cost_limit_exceeded');
  await db.exec(`insert into public.channel_cost_policy_versions(channel,category,provider,version,currency,unit_cost_brl,max_allowed_unit_cost_brl,cost_status,status,effective_from,effective_to,verified_at) values('whatsapp','service','meta',2,'BRL',0.030000,0.035000,'current','approved',now()-interval '1 day',now()+interval '1 day',now());`);
  cost=await json(`select public.preview_tool_cost_policy_v1('WHATSAPP_STANDARD_TEXT',now()) x`);
  assert.equal(cost.allowed,true);assert.equal(Number(cost.unit_cost_brl),0.03);

  let recorded=await json(`select public.record_commercial_decision_evaluation_v1('CATALOGO',0.95,false,false,'default','system','decision-test-0001') x`);
  assert.equal(recorded.ok,true);assert.equal(recorded.replay,false);
  let replay=await json(`select public.record_commercial_decision_evaluation_v1('CATALOGO',0.95,false,false,'default','system','decision-test-0001') x`);
  assert.equal(replay.replay,true);

  const cart=await one(`select confirmation_required,autonomy_level,risk_class,confidence_autorun_allowed from public.ai_action_registry where action_key='create_cart'`);
  assert.equal(cart.confirmation_required,false);assert.equal(cart.autonomy_level,'A');assert.equal(cart.risk_class,'reversible_write');assert.equal(cart.confidence_autorun_allowed,true);

  console.log('PASS: Cost Policy blocks missing/expensive policies, confidence bands act correctly, handoff wins, commitments require confirmation and decisions are idempotent.');
} finally {await db.close();}
