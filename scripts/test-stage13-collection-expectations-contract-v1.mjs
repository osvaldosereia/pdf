import {readFileSync} from 'node:fs';
const files=[
  'supabase/migrations/20260908173000_stage13_collection_expectations_v1.sql',
  'supabase/migrations/20260908173100_stage13_collection_expectations_prepaid_fix_v2.sql'
];
const sql=files.map(f=>readFileSync(f,'utf8')).join('\n').toLowerCase();
const required=[
  'payment_expectation_preview_enabled boolean not null default false',
  'payment_expectation_recording_enabled boolean not null default false',
  'route_collection_manifest_preview_enabled boolean not null default false',
  'route_collection_manifest_recording_enabled boolean not null default false',
  'create table if not exists public.financial_payment_expectations',
  'create table if not exists public.financial_route_collection_manifests',
  'trg_financial_payment_expectations_append_only',
  'trg_financial_route_collection_manifests_append_only',
  'create or replace function public.financial_readiness_v2',
  'create or replace function public.preview_order_payment_expectation_v1',
  'create or replace function public.record_order_payment_expectation_v1',
  'create or replace function public.preview_route_collection_manifest_v1',
  'create or replace function public.record_route_collection_manifest_v1',
  "decision:='expected';reason:='prepayment_pending'",
  "'payment_confirmed',false",
  "'delivery_confirmed',false",
  "'fiscal_mutated',false",
  "'route_mutated',false",
  'from public.financial_ledger_entries',
  'from public.delivery_stops',
  'to service_role'
];
for(const s of required) if(!sql.includes(s)) throw new Error(`missing_contract:${s}`);
const forbidden=[
  'update public.orders',
  'update public.order_fiscal_controls',
  'update public.delivery_routes',
  'update public.delivery_jobs',
  'update public.delivery_stops',
  'confirm_order_payment_v1(',
  'refresh_order_fiscal_readiness_v1(',
  'prepare_bling_invoice_issue_job_v1(',
  'insert into public.bling_commands',
  'graph.facebook.com',
  'http_post',
  'net.http',
  'fetch(',
  'make.com',
  'openai'
];
for(const s of forbidden) if(sql.includes(s)) throw new Error(`forbidden_side_effect:${s}`);
console.log('PASS: Stage 13B payment expectations and route collection manifest are dormant, immutable and provider/fiscal/logistics safe.');
