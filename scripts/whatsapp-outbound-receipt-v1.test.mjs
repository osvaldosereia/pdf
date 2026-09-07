import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migrationPath=new URL('../supabase/migrations/20260907203500_whatsapp_outbound_message_receipt_v1.sql',import.meta.url);

test('confirmed WhatsApp sends persist provider id, sent status and conversation last outbound timestamp',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/create or replace function public\.finish_outbound_job/i);
  assert.match(sql,/provider_message_id=v_provider_id/i);
  assert.match(sql,/delivery_status='sent'/i);
  assert.match(sql,/whatsapp_message_id=coalesce\(m\.whatsapp_message_id,v_provider_id\)/i);
  assert.match(sql,/last_outbound_at=/i);
  assert.match(sql,/reply_message_id/i);
  assert.match(sql,/Backfill generico/i);
  assert.doesNotMatch(sql,/OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|META_ACCESS_TOKEN|x-da-ingest-key/i);
});
