import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderDecision,validateMedia} from './lib/conversation-core-v1.mjs';

const edgePath=new URL('../supabase/functions/whatsapp-ingest/index.ts',import.meta.url);
const outboundEdgePath=new URL('../supabase/functions/whatsapp-outbound-v1/index.ts',import.meta.url);
const migrationPath=new URL('../supabase/migrations/20260907184500_whatsapp_conversation_bridge_v1.sql',import.meta.url);
const mediaMigrationPath=new URL('../supabase/migrations/20260907184450_room_media_whatsapp_metadata.sql',import.meta.url);
const releaseGatePath=new URL('../supabase/migrations/20260907192800_whatsapp_live_release_gates_v1.sql',import.meta.url);
const dispatchPath=new URL('../supabase/migrations/20260907191500_whatsapp_outbound_event_dispatch_v2.sql',import.meta.url);
const dispatchV3Path=new URL('../supabase/migrations/20260907194000_whatsapp_outbound_webhook_response_v3.sql',import.meta.url);
const homologationPath=new URL('../supabase/migrations/20260907194600_whatsapp_homologation_allowlist_v1.sql',import.meta.url);

const fixtureJob={message_id:'m1',conversation_id:'c1',job_type:'transcription'};

test('WhatsApp responses are channel-native and never tell the user to open WhatsApp',()=>{
  const human=renderDecision({intent:'human'},{channel:'whatsapp'}).reply;
  const checkout=renderDecision({intent:'checkout'},{channel:'whatsapp'}).reply;
  const greeting=renderDecision({intent:'greeting'},{channel:'whatsapp'}).reply;
  assert.doesNotMatch(human,/Continuar pelo WhatsApp|toque/i);
  assert.doesNotMatch(checkout,/toque/i);
  assert.match(human,/equipe/i);
  assert.match(greeting,/áudio/i);
});

test('Shopping Room wording remains unchanged for its own UI semantics',()=>{
  assert.match(renderDecision({intent:'checkout'}).reply,/tocar em Confirmar pedido/i);
  assert.match(renderDecision({intent:'human'}).reply,/Continuar pelo WhatsApp/i);
});

test('WhatsApp OGG voice notes are accepted in the private scoped media path',()=>{
  const media={
    message_id:'m1',conversation_id:'c1',bucket:'shopping-room-media',catalog_session_id:'s1',kind:'audio',
    object_path:'sessions/s1/audio/whatsapp/voice.ogg',mime_type:'audio/ogg; codecs=opus',bytes:2048,expires_at:'2099-01-01'
  };
  assert.equal(validateMedia(media,fixtureJob),'audio/ogg');
  assert.throws(()=>validateMedia({...media,object_path:'sessions/s2/audio/whatsapp/voice.ogg'},fixtureJob),/invalid_media_path/);
  assert.throws(()=>validateMedia({...media,mime_type:'audio/amr'},fixtureJob),/media_conversion_required/);
});

test('WhatsApp ingest is flat-Make compatible, idempotent for media, and isolated from ERP',async()=>{
  const source=await readFile(edgePath,'utf8');
  assert.match(source,/make_flat_v1/);
  assert.match(source,/attach_media/);
  assert.match(source,/message_row_id/);
  assert.match(source,/meta_media_id/);
  assert.match(source,/maybeSingle\(\)/);
  assert.match(source,/queue_ai_job_for_message/);
  assert.match(source,/result\?\.ignored/);
  assert.doesNotMatch(source,/bling/i);
  assert.doesNotMatch(source,/confirm_order|room_confirm_order|order_sync/i);
});

test('Database bridge preserves gates, service window, official voice profile and queue dedupe',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/dona_antonia_marin_b_v1/);
  assert.match(sql,/gpt-4o-mini-tts/);
  assert.match(sql,/'marin'/);
  assert.match(sql,/msg\.raw_event->>'source' in \('shopping_room','whatsapp'\)/);
  assert.match(sql,/service_window_expires_at>now\(\)/);
  assert.match(sql,/job_type,recipient_e164,dedupe_key,payload/);
  assert.match(sql,/'seller_message'/);
  assert.match(sql,/on conflict\(dedupe_key\) do nothing/);
  assert.doesNotMatch(sql,/OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|META_ACCESS_TOKEN/);
});

test('Room media provenance is server-side JSON metadata',async()=>{
  const sql=await readFile(mediaMigrationPath,'utf8');
  assert.match(sql,/alter table public\.room_media/i);
  assert.match(sql,/metadata jsonb not null default '\{\}'::jsonb/i);
});

test('WhatsApp live release is fail-closed and ignores backlog before creating customers',async()=>{
  const sql=await readFile(releaseGatePath,'utf8');
  assert.match(sql,/whatsapp_inbound_enabled boolean not null default false/i);
  assert.match(sql,/whatsapp_auto_reply_enabled boolean not null default false/i);
  assert.match(sql,/whatsapp_inbound_since timestamptz not null default now\(\)/i);
  const disabled=sql.indexOf("reason','whatsapp_inbound_disabled");
  const customerWrite=sql.indexOf('insert into public.customers');
  assert.ok(disabled>0 && customerWrite>disabled,'gate must execute before customer persistence');
  assert.match(sql,/p_message_timestamp < v_cfg\.whatsapp_inbound_since/);
  assert.match(sql,/before_whatsapp_cutover/);
  assert.match(sql,/v_cfg\.whatsapp_auto_reply_enabled/);
  assert.match(sql,/cfg\.whatsapp_auto_reply_enabled/);
});

test('Outbound event dispatcher is exact-job, event-driven and never blind-retries uncertain sends',async()=>{
  const sql=await readFile(dispatchPath,'utf8');
  assert.match(sql,/claim_whatsapp_conversation_outbound_by_id/);
  assert.match(sql,/j\.id=p_job_id/);
  assert.match(sql,/net\.http_post/);
  assert.match(sql,/dona_antonia_whatsapp_outbound_make_webhook/);
  assert.match(sql,/lease_expired_review_required/);
  assert.match(sql,/dispatch_unreachable_review_required/);
  assert.match(sql,/cron\.schedule/);
  assert.doesNotMatch(sql,/https:\/\/hook\./i,'Make webhook must stay in Vault, not GitHub');
});

test('Outbound v3 sends the locked job to Make and reconciles only an explicit matching provider id',async()=>{
  const sql=await readFile(dispatchV3Path,'utf8');
  assert.match(sql,/event','outbound_delivery'/);
  assert.match(sql,/protocol_version',3/);
  assert.match(sql,/locked_by='pgnet-make-outbound-v3'/);
  assert.match(sql,/timeout_milliseconds:=30000/);
  assert.match(sql,/net\._http_response/);
  assert.match(sql,/coalesce\(v_json->>'job_id',''\)<>v_job\.id::text/);
  assert.match(sql,/provider_message_id/);
  assert.match(sql,/delivery_uncertain_review_required/);
  assert.match(sql,/now\(\)\+interval '100 years'/);
  assert.match(sql,/dispatch_whatsapp_outbound_healthcheck_v3/);
  assert.doesNotMatch(sql,/https:\/\/hook\./i,'webhook URL must remain in Vault');
  assert.doesNotMatch(sql,/META_ACCESS_TOKEN|OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test('Legacy outbound Edge can only report health and cannot claim or finish jobs',async()=>{
  const source=await readFile(outboundEdgePath,'utf8');
  assert.match(source,/deprecated_event_driven_v3/);
  assert.match(source,/legacy_claim_finish_disabled:true/);
  assert.match(source,/pg_net_make_webhook_response_v3/);
  assert.doesNotMatch(source,/claim_whatsapp_conversation_outbound_by_id/);
  assert.doesNotMatch(source,/finish_whatsapp_conversation_outbound/);
});

test('Controlled homologation is DB-enforced, allowlisted and auto-expires fail-closed',async()=>{
  const sql=await readFile(homologationPath,'utf8');
  assert.match(sql,/whatsapp_release_mode in \('off','observe','homologation','live'\)/);
  assert.match(sql,/create table if not exists public\.whatsapp_test_allowlist/);
  assert.match(sql,/alter table public\.whatsapp_test_allowlist enable row level security/);
  assert.match(sql,/rename to ingest_whatsapp_message_core_v1/);
  const releaseCall=sql.indexOf('v_release:=public.whatsapp_release_decision');
  const coreCall=sql.indexOf('return public.ingest_whatsapp_message_core_v1');
  assert.ok(releaseCall>0 && coreCall>releaseCall,'allowlist decision must happen before core ingest');
  assert.match(sql,/homologation_phone_blocked/);
  assert.match(sql,/arm_whatsapp_homologation_v1/);
  assert.match(sql,/ai_enabled=false/);
  assert.match(sql,/conversation_worker_enabled=false/);
  assert.match(sql,/dona-antonia-whatsapp-homologation-expiry-v1/);
  assert.match(sql,/perform public\.close_whatsapp_homologation_v1\(\)/);
  assert.doesNotMatch(sql,/\+5565[0-9]+/,'test phone must never be committed');
});
