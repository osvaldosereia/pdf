import {readFileSync} from 'node:fs';
const basePath='supabase/migrations/20260908171000_ai_commercial_decision_policy_v1.sql';
const v2Path='supabase/migrations/20260908171100_ai_commercial_decision_context_channel_v2.sql';
const sql=readFileSync(basePath,'utf8');
const v2=readFileSync(v2Path,'utf8');
const all=`${sql}\n${v2}`;
const lower=all.toLowerCase();
const required=[
  'create table if not exists public.commercial_decision_runtime_config',
  'cost_policy_preview_enabled boolean not null default false',
  'action_safety_preview_enabled boolean not null default false',
  'confidence_policy_preview_enabled boolean not null default false',
  'decision_recording_enabled boolean not null default false',
  'create table if not exists public.commercial_tool_registry',
  'create table if not exists public.channel_cost_policy_versions',
  'create table if not exists public.decision_confidence_policy_versions',
  "values('default',1,0.6000,0.9000,'draft')",
  'create or replace function public.preview_tool_cost_policy_v1',
  'create or replace function public.preview_safe_commercial_action_v2',
  'create or replace function public.record_commercial_decision_evaluation_v2',
  'context_channel text null',
  "'context_channel_required'",
  "'tool_channel',t.channel",
  "'context_channel',context_channel",
  "'approved_cost_policy_missing'",
  "'cost_unknown_or_stale'",
  "'cost_limit_exceeded'",
  "'ask_clarification'",
  "'awaiting_confirmation'",
  "'execute_with_disclosure'",
  "'human_handoff_open'",
  "array['resolve_correctly','make_purchase_easy','close_sale','increase_ticket_when_relevant']",
  'revoke all on table public.commercial_decision_runtime_config',
  'to service_role'
];
for(const n of required)if(!lower.includes(n.toLowerCase()))throw new Error(`missing_required_contract:${n}`);
const forbidden=[
  'graph.facebook.com','http_post','net.http','fetch(','make.com',
  '0.035','0.3217','unit_cost_brl,0.','max_allowed_unit_cost_brl,0.',
  "status='approved' where scope_key='default'",
  "enabled=true where tool_key",
  'update public.orders','update public.order_fiscal_controls'
];
for(const n of forbidden)if(lower.includes(n))throw new Error(`forbidden_contract:${n}`);
if(/insert\s+into\s+public\.channel_cost_policy_versions[\s\S]*values/i.test(sql))throw new Error('live_cost_policy_must_not_be_seeded');
if(!v2.includes("simulate_ai_action_v1(t.ai_action_key,'{}'::jsonb,context_channel"))throw new Error('ai_action_registry_must_use_context_channel');
if(v2.includes("simulate_ai_action_v1(t.ai_action_key,'{}'::jsonb,t.channel"))throw new Error('tool_channel_must_not_be_forwarded_as_context_channel');
console.log('PASS: configurable Cost Policy, safe-action, confidence and explicit conversation-context foundation is dormant, price-free and fail-closed.');
