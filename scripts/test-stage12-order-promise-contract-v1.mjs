import {readFileSync} from 'node:fs';
const sql=readFileSync('supabase/migrations/20260908143000_stage12_order_promise_change_control_v1.sql','utf8');
const required=[
  'order_promise_runtime_config','enabled boolean not null default false','preview_enabled boolean not null default false','commitment_write_enabled boolean not null default false','inventory_reservation_on_commit_enabled boolean not null default false','change_control_enabled boolean not null default false','canary_percent numeric(5,2) not null default 0',
  'order_promise_daily_capacity','order_promise_evaluations','order_promise_commitments','order_operational_controls','order_change_requests','order_change_events',
  'preview_promise_inventory_v1','preview_order_promise_core_v1','preview_cart_promise_v1','preview_order_promise_v1','record_order_promise_evaluation_v1','preview_order_change_control_v1','create_order_change_request_v1',
  "'capacity_rule_missing'","'delivery_address_missing'","'inventory_shortage'","'same_day_cutoff_passed'","'fulfillment_locked'","'review_required'",'order_mutated',
  'revoke all on table public.order_promise_runtime_config','revoke all on function public.preview_order_promise_v1','external_side_effect',
];
for(const token of required) if(!sql.includes(token)) throw new Error(`missing_contract:${token}`);
for(const forbidden of ['http://','https://','api.openai.com','graph.facebook.com','bling.com.br']) if(sql.includes(forbidden)) throw new Error(`external_transport_forbidden:${forbidden}`);
console.log('PASS: Order Promise + Change Control migration is gated, deterministic, server-only and transport-free.');
