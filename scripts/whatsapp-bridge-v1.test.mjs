import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderDecision,validateMedia} from './lib/conversation-core-v1.mjs';

const edgePath=new URL('../supabase/functions/whatsapp-ingest/index.ts',import.meta.url);
const migrationPath=new URL('../supabase/migrations/20260907184500_whatsapp_conversation_bridge_v1.sql',import.meta.url);
const mediaMigrationPath=new URL('../supabase/migrations/20260907184450_room_media_whatsapp_metadata.sql',import.meta.url);

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
