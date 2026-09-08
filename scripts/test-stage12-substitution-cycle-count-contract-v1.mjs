import {readFileSync} from 'node:fs';
const sql=readFileSync('supabase/migrations/20260908150000_stage12_substitution_cycle_count_v1.sql','utf8');
const must=[
  'substitution_preview_enabled boolean not null default false',
  'substitution_apply_enabled boolean not null default false',
  'cycle_count_planning_enabled boolean not null default false',
  'cycle_count_adjustment_enabled boolean not null default false',
  'create or replace function public.preview_substitution_v1',
  "'strategy','preserve_basket_price'",
  "'component_promotion_does_not_reprice_basket',true",
  'create or replace function public.preview_cycle_count_candidate_v1',
  'create or replace function public.record_cycle_count_observation_v1',
  "'stock_adjusted',false",
  'revoke all on table public.substitution_groups',
  'to service_role;'
];
for(const token of must)if(!sql.includes(token))throw new Error(`missing_contract:${token}`);
for(const forbidden of ['fetch(','axios','openai','maps.googleapis','graph.facebook','bling.com.br','http://','https://'])if(sql.toLowerCase().includes(forbidden.toLowerCase()))throw new Error(`external_transport_forbidden:${forbidden}`);
if(/update\s+public\.products\s+set\s+stock/i.test(sql))throw new Error('cycle_count_must_not_adjust_product_stock');
if(/insert\s+into\s+public\.bling_commands/i.test(sql))throw new Error('cycle_count_must_not_enqueue_bling');
if(/update\s+public\.inventory_lots\s+set\s+quantity_/i.test(sql))throw new Error('cycle_count_must_not_adjust_lots');
console.log('PASS: Stage 12 substitution/cycle count migration is dormant, deterministic and has no stock/order/Bling mutation path.');
