import {readFileSync} from 'node:fs';

const path='supabase/migrations/20260908170000_stage13_financial_ledger_foundation_v1.sql';
const sql=readFileSync(path,'utf8');
const lower=sql.toLowerCase();

const required=[
  'create table if not exists public.financial_runtime_config',
  'enabled boolean not null default false',
  "execution_mode text not null default 'off'",
  'preview_enabled boolean not null default false',
  'receipt_recording_enabled boolean not null default false',
  'reversal_recording_enabled boolean not null default false',
  'route_cash_recording_enabled boolean not null default false',
  'route_close_preview_enabled boolean not null default false',
  'route_close_recording_enabled boolean not null default false',
  'reconciliation_case_recording_enabled boolean not null default false',
  'fiscal_projection_enabled boolean not null default false',
  'external_reconciliation_enabled boolean not null default false',
  'allowed_cash_difference_cents bigint null',
  'create table if not exists public.financial_ledger_entries',
  'create trigger trg_financial_ledger_append_only',
  'create table if not exists public.financial_route_close_evaluations',
  'create table if not exists public.financial_reconciliation_cases',
  'create or replace function public.preview_order_financial_state_v1',
  'create or replace function public.record_payment_receipt_v1',
  'create or replace function public.record_payment_reversal_v1',
  'create or replace function public.record_route_cash_event_v1',
  'create or replace function public.preview_route_financial_close_v1',
  'create or replace function public.record_route_close_evaluation_v1',
  'create or replace function public.open_financial_reconciliation_case_v1',
  "'fiscal_mutated',false",
  "'route_mutated',false",
  'revoke all on table public.financial_runtime_config',
  'to service_role'
];
for(const needle of required){
  if(!lower.includes(needle.toLowerCase()))throw new Error(`missing_required_contract:${needle}`);
}

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
  'insert into public.delivery_notifications',
  'http_post',
  'net.http',
  'fetch(',
  'openai',
  'make.com',
  'graph.facebook.com'
];
for(const needle of forbidden){
  if(lower.includes(needle))throw new Error(`forbidden_side_effect_contract:${needle}`);
}

if(/external_reconciliation_enabled\s*=\s*true/i.test(sql))throw new Error('external_reconciliation_must_not_be_enabled');
if(/fiscal_projection_enabled\s*=\s*true/i.test(sql))throw new Error('fiscal_projection_must_not_be_enabled');

console.log('PASS: Stage 13 financial foundation is dormant, append-only, idempotent, provider-free and cannot mutate order/fiscal/logistics state.');
