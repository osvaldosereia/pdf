-- Run in one transaction. All fixtures and temporary flags are rolled back.
begin;
do $$
declare room jsonb; cid uuid; mid uuid; q1 jsonb; q2 jsonb; job jsonb; finished jsonb; reply_count integer;
begin
 if has_function_privilege('anon','public.claim_conversation_job(text)','execute') or
    has_function_privilege('authenticated','public.finish_conversation_job(uuid,text,integer,jsonb,jsonb,text)','execute') then raise exception 'worker_publicly_callable'; end if;
 if not (select relrowsecurity from pg_class where oid='public.ai_usage_events'::regclass) then raise exception 'usage_rls_missing'; end if;
 if public.preview_expiry_offer(100,'2026-11-07','2026-09-07')->>'discount_percent'<>'0' then raise exception '61d'; end if;
 if public.preview_expiry_offer(100,'2026-11-06','2026-09-07')->>'discount_percent'<>'20' then raise exception '60d'; end if;
 if public.preview_expiry_offer(100,'2026-10-08','2026-09-07')->>'discount_percent'<>'20' then raise exception '31d'; end if;
 if public.preview_expiry_offer(100,'2026-10-07','2026-09-07')->>'discount_percent'<>'30' then raise exception '30d'; end if;
 if public.preview_expiry_offer(100,'2026-09-07','2026-09-07')->>'suggested_price'<>'70.00' then raise exception '0d'; end if;
 if public.preview_expiry_offer(100,'2026-09-06','2026-09-07')->>'suggested_price' is not null then raise exception 'expired'; end if;
 if public.preview_expiry_offer(100,null,'2026-09-07')->>'discount_percent'<>'0' then raise exception 'missing_date'; end if;
 -- Do not claim any existing production job during this test.
 if exists(select 1 from public.ai_jobs where status in ('pending','processing')) then raise exception 'run_fixture_in_isolated_database'; end if;
 room:=public.room_start_web_session();
 select conversation_id into cid from public.catalog_sessions where public_token=room->>'token';
 update public.conversations set mode='ai' where id=cid;
 insert into public.messages(conversation_id,direction,message_type,body_text,raw_event)
 values(cid,'inbound','text','teste isolado',jsonb_build_object('source','shopping_room')) returning id into mid;
 update public.automation_config set ai_enabled=false,conversation_worker_enabled=false where id=1;
 q1:=public.queue_ai_job_for_message(mid,'conversation','{"first":true}');
 if q1->>'status'<>'held' then raise exception 'held_gate'; end if;
 if public.claim_conversation_job('conversation-test') is not null then raise exception 'disabled_claim'; end if;
 update public.automation_config set automation_enabled=true,ai_enabled=true,conversation_worker_enabled=true where id=1;
 update public.ai_jobs set status='pending' where id=(q1->>'id')::uuid;
 job:=public.claim_conversation_job('conversation-test');
 if job->>'id' is distinct from q1->>'id' then raise exception 'claim_failed'; end if;
 if public.claim_conversation_job('conversation-other') is not null then raise exception 'duplicate_claim'; end if;
 begin
 perform public.finish_conversation_job((job->>'id')::uuid,'conversation-wrong',1,'{}');
 raise exception 'wrong_worker_accepted';
 exception when others then if sqlerrm<>'stale_job_lease' then raise; end if; end;
 finished:=public.finish_conversation_job((job->>'id')::uuid,'conversation-test',1,'{"intent":"decline_upsell","reply":"Tudo bem.","ui":{"type":"checkout"}}','{"model":"mock","input_tokens":1,"output_tokens":1}');
 perform public.finish_conversation_job((job->>'id')::uuid,'conversation-test',1,'{}');
 select count(*) into reply_count from public.messages where conversation_id=cid and direction='outbound' and raw_event->>'ai_job_id'=job->>'id';
 if reply_count<>1 then raise exception 'reply_dedupe_failed'; end if;
 if not (select upsell_declined and sales_pressure_level=0 from public.conversations where id=cid) then raise exception 'decline_not_respected'; end if;
 q2:=public.queue_ai_job_for_message(mid,'conversation','{"replacement":true}');
 if q2->>'status'<>'done' then raise exception 'duplicate_status_wrong'; end if;
 if not (select input='{"first":true}'::jsonb from public.ai_jobs where id=(q1->>'id')::uuid) then raise exception 'payload_overwritten'; end if;
end $$;
rollback;
