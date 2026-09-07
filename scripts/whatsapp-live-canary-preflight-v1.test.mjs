import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(new URL('../supabase/migrations/20260907234000_whatsapp_live_canary_preflight_v1.sql',import.meta.url),'utf8');
const has=(re,msg)=>assert.match(sql,re,msg);

test('canary bucket is deterministic and server-side',()=>{
  has(/create or replace function public\.whatsapp_canary_bucket_v1/);
  has(/normalize_phone_digits\(p_phone\)/);
  has(/mod\(abs\(hashtext\(v_phone\)::bigint\),100\)::smallint/);
  has(/grant execute on function public\.whatsapp_canary_bucket_v1\(text\) to service_role/);
});

test('live preflight blocks dirty queues, handoffs and missing secrets',()=>{
  has(/create or replace function public\.whatsapp_live_preflight_v1/);
  has(/status in \('pending','processing'\)/,'AI/outbound active queues must be checked');
  has(/review_required/,'uncertain external states must block live');
  has(/human_handoffs[\s\S]*status in \('open','claimed'\)/,'active human queue must block live');
  has(/whatsapp_test_allowlist[\s\S]*enabled=true/,'test allowlist must be empty before live');
  has(/conversation_worker_webhook_v2/);
  has(/make_whatsapp_ingest/);
  has(/openai_conversation_worker_v1/);
  has(/human_fallback_enabled/);
  has(/emergency_stop_reason is null/);
});

test('configure live requires confirmation and successful preflight before opening gates',()=>{
  has(/p_confirmation is distinct from 'LIBERAR_ATENDIMENTO_REAL'/);
  has(/v_preflight:=public\.whatsapp_live_preflight_v1\(p_canary_percent\)/);
  has(/live_preflight_failed/);
  const preflightPos=sql.indexOf('v_preflight:=public.whatsapp_live_preflight_v1');
  const liveUpdatePos=sql.indexOf("set whatsapp_release_mode='live'");
  assert.ok(preflightPos>=0 && liveUpdatePos>preflightPos,'preflight must execute before live gates open');
  has(/conversation_worker_dispatch_enabled=true/);
  has(/preflight_passed/);
});

test('migration itself does not activate live',()=>{
  has(/Esta migration deliberadamente não altera o release atual/);
  assert.doesNotMatch(sql,/select\s+public\.configure_whatsapp_release_v1\(\s*'live'/i);
});
