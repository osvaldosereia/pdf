import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const sql=readFileSync('supabase/migrations/20260908230000_whatsapp_release_pregate_v1.sql','utf8');

assert.match(sql,/create or replace function public\.guard_whatsapp_ai_job_release_v1\(\)/i);
assert.match(sql,/release_decision:=public\.whatsapp_release_decision\(/i);
assert.match(sql,/new\.status:='held'/i);
assert.match(sql,/deterministic_side_effects_blocked/i);
assert.match(sql,/create trigger a0_whatsapp_release_gate_v1\s+before insert or update of status on public\.ai_jobs/i);

const triggerName='a0_whatsapp_release_gate_v1';
assert.ok(triggerName.localeCompare('aa_whatsapp_sales_greeting_fastpath')<0,'release gate must run before greeting fast path');
assert.ok(triggerName.localeCompare('trg_00_route_whatsapp_basket_swap_v1')<0,'release gate must run before basket swap fast path');
assert.ok(triggerName.localeCompare('trg_route_whatsapp_basic_sales_ai_job_v1')<0,'release gate must run before basic sales fast path');

console.log('OK whatsapp release pre-gate');
