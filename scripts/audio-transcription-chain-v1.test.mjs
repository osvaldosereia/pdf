import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migrationPath=new URL('../supabase/migrations/20260907204500_audio_transcription_chain_v1.sql',import.meta.url);

test('audio chain allows exactly the two-stage budget needed for transcription plus conversation',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  assert.match(sql,/max_ai_calls_per_event=greatest\(max_ai_calls_per_event,2\)/i);
  assert.match(sql,/max_transcriptions_per_event=least\(greatest\(max_transcriptions_per_event,1\),1\)/i);
});

test('transcription persists text and queues conversation instead of replying directly',async()=>{
  const sql=await readFile(migrationPath,'utf8');
  const transcriptionBranch=sql.indexOf("if j.job_type='transcription' then");
  const queueConversation=sql.indexOf("'conversation'",transcriptionBranch);
  const transcriptReturn=sql.indexOf("'transcript_saved',true",transcriptionBranch);
  const intentValidation=sql.indexOf('if v_intent is null',transcriptionBranch);
  const outboundInsert=sql.indexOf('insert into public.outbound_jobs',transcriptionBranch);
  assert.ok(transcriptionBranch>0,'transcription branch must exist');
  assert.ok(queueConversation>transcriptionBranch,'transcription must queue a conversation job');
  assert.ok(transcriptReturn>queueConversation,'transcription must finish without seller reply');
  assert.ok(intentValidation>transcriptReturn,'intent validation belongs only to the follow-up job');
  assert.ok(outboundInsert>intentValidation,'seller outbound can only happen after conversation classification');
  assert.match(sql,/body_text=v_transcript/i);
  assert.match(sql,/reply_suppressed',true/i);
  assert.match(sql,/from_transcription_job_id/i);
});
