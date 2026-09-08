import {readFileSync} from 'node:fs';
const sql=readFileSync('supabase/migrations/20260908153000_stage12_label_recall_control_tower_v1.sql','utf8');
const must=[
  'enabled boolean not null default false',
  'label_dispatch_enabled boolean not null default false',
  'recall_quarantine_enabled boolean not null default false',
  'sla_exception_recording_enabled boolean not null default false',
  "width_mm integer not null default 100",
  "height_mm integer not null default 150",
  "'amount_visible',false",
  "'price_fields',jsonb_build_array()",
  'create or replace function public.preview_lot_reverse_trace_v1',
  "'quarantine_applied',false",
  "'notifications_sent',false",
  'create or replace function public.control_tower_order_snapshot_v1',
  'create or replace function public.preview_order_aging_v1',
  'create or replace function public.record_sla_exception_v1',
  'revoke all on table public.operational_control_runtime_config',
  'to service_role;'
];
for(const token of must)if(!sql.includes(token))throw new Error(`missing_contract:${token}`);
for(const forbidden of ['fetch(','axios','openai','maps.googleapis','graph.facebook','bling.com.br','http://','https://'])if(sql.toLowerCase().includes(forbidden.toLowerCase()))throw new Error(`external_transport_forbidden:${forbidden}`);
if(/update\s+public\.inventory_lots/i.test(sql))throw new Error('recall_v1_must_not_quarantine_stock');
if(/insert\s+into\s+public\.delivery_notifications/i.test(sql))throw new Error('recall_v1_must_not_send_notifications');
if(/insert\s+into\s+public\.bling_commands/i.test(sql))throw new Error('stage12_ops_must_not_enqueue_bling');
if(/update\s+public\.orders/i.test(sql))throw new Error('control_tower_must_not_mutate_orders');
console.log('PASS: labels, recall, Control Tower and SLA V1 are dormant/server-only and contain no printer, stock, order, notification or Bling executor.');
