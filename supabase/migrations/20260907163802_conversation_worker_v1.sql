begin;
-- Independent release gate; existing automation flags are deliberately preserved.
alter table public.automation_config add column if not exists conversation_worker_enabled boolean not null default false;
create table public.ai_usage_events (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.ai_jobs(id) on delete cascade,
 message_id uuid not null references public.messages(id) on delete cascade,
 attempt integer not null, status text not null default 'reserved' check(status in ('reserved','done','error')),
 model text, provider_request_id text, input_tokens integer, output_tokens integer,
 audio_seconds numeric, estimated_cost_usd numeric, pricing_version text,
 created_at timestamptz not null default now(), finished_at timestamptz,
 unique(job_id,attempt)
);
create index ai_usage_events_message_idx on public.ai_usage_events(message_id);
alter table public.ai_usage_events enable row level security;
revoke all on public.ai_usage_events from public,anon,authenticated;
grant select,insert,update,delete on public.ai_usage_events to service_role;
create index if not exists room_media_message_idx on public.room_media(message_id);
create index if not exists messages_conversation_poll_idx on public.messages(conversation_id,created_at desc,id desc);

-- A repeated enqueue must neither replace the first payload nor misreport a done job as pending.
create or replace function public.queue_ai_job_for_message(p_message_id uuid,p_job_type text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_enabled boolean; v_conversation uuid; v_id uuid; v_status text;
begin
 if p_job_type not in ('transcription','vision','tts','conversation') then raise exception 'invalid_ai_job_type'; end if;
 select conversation_id into v_conversation from public.messages where id=p_message_id;
 if not found then raise exception 'message_not_found'; end if;
 select ai_enabled and automation_enabled and conversation_worker_enabled into v_enabled from public.automation_config where id=1;
 insert into public.ai_jobs(conversation_id,message_id,job_type,status,input)
 values(v_conversation,p_message_id,p_job_type,case when coalesce(v_enabled,false) then 'pending' else 'held' end,coalesce(p_input,'{}'))
 on conflict(message_id,job_type) do nothing;
 select id,status into v_id,v_status from public.ai_jobs where message_id=p_message_id and job_type=p_job_type;
 return jsonb_build_object('id',v_id,'status',v_status);
end $$;

-- A single claim serializes the budget reservation. No automatic reclaim of paid requests.
create function public.claim_conversation_job(p_worker text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cfg public.automation_config%rowtype; j public.ai_jobs%rowtype; m public.messages%rowtype;
 media jsonb; used integer;
begin
 if nullif(trim(p_worker),'') is null then raise exception 'worker_required'; end if;
 select * into cfg from public.automation_config where id=1 for update;
 if not coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled,false) then return null; end if;
 update public.ai_jobs set status='error',error_message='lease_expired_review_required',updated_at=now()
 where status='processing' and locked_at<now()-interval '10 minutes' and locked_by like 'conversation-%';
 select a.* into j from public.ai_jobs a join public.messages msg on msg.id=a.message_id
 join public.conversations c on c.id=a.conversation_id
 where a.status='pending' and a.not_before<=now() and a.attempts<a.max_attempts
 and a.job_type in ('transcription','vision','conversation') and c.mode='ai'
 and not exists(select 1 from public.ai_jobs busy where busy.conversation_id=a.conversation_id and busy.status='processing')
 and msg.direction='inbound' and msg.raw_event->>'source'='shopping_room'
 and exists(select 1 from public.catalog_sessions s where s.conversation_id=c.id and s.status='open' and s.expires_at>now())
 order by a.created_at,a.id for update of a skip locked limit 1;
 if not found then return null; end if;
 select count(*) into used from public.ai_usage_events where message_id=j.message_id;
 if used>=cfg.max_ai_calls_per_event or (j.job_type='transcription' and cfg.max_transcriptions_per_event<1)
 or (j.job_type='vision' and cfg.max_vision_calls_per_event<1) then
   update public.ai_jobs set status='held',error_message='event_call_budget',updated_at=now() where id=j.id;
   return jsonb_build_object('skipped',true,'reason','event_call_budget');
 end if;
 update public.ai_jobs set status='processing',attempts=attempts+1,locked_by=p_worker,locked_at=now(),updated_at=now()
 where id=j.id returning * into j;
 insert into public.ai_usage_events(job_id,message_id,attempt) values(j.id,j.message_id,j.attempts);
 select * into m from public.messages where id=j.message_id;
 select to_jsonb(r) into media from public.room_media r where r.message_id=j.message_id and r.conversation_id=j.conversation_id order by r.created_at limit 1;
 return jsonb_build_object('id',j.id,'message_id',j.message_id,'conversation_id',j.conversation_id,'job_type',j.job_type,
 'attempt',j.attempts,'body_text',m.body_text,'media',media);
end $$;

create function public.finish_conversation_job(p_job_id uuid,p_worker text,p_attempt integer,p_result jsonb,p_usage jsonb default '{}',p_error text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.ai_jobs%rowtype; c public.conversations%rowtype; cfg public.automation_config%rowtype;
 reply_id uuid; v_intent text:=p_result->>'intent'; enabled boolean; session_id uuid;
begin
 select * into j from public.ai_jobs where id=p_job_id for update;
 if not found then raise exception 'job_not_found'; end if;
 if j.status='done' then return jsonb_build_object('status','done','duplicate',true); end if;
 if j.status<>'processing' or j.locked_by is distinct from p_worker or j.attempts<>p_attempt then raise exception 'stale_job_lease'; end if;
 select * into c from public.conversations where id=j.conversation_id for update;
 select * into cfg from public.automation_config where id=1;
 select id into session_id from public.catalog_sessions where conversation_id=j.conversation_id and status='open' and expires_at>now() order by created_at desc limit 1;
 enabled:=coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and c.mode='ai' and session_id is not null,false);
 update public.ai_usage_events set status=case when p_error is null then 'done' else 'error' end,
 model=left(p_usage->>'model',100),provider_request_id=left(p_usage->>'provider_request_id',200),
 input_tokens=nullif(p_usage->>'input_tokens','')::integer,output_tokens=nullif(p_usage->>'output_tokens','')::integer,
 audio_seconds=nullif(p_usage->>'audio_seconds','')::numeric,estimated_cost_usd=nullif(p_usage->>'estimated_cost_usd','')::numeric,
 pricing_version=left(p_usage->>'pricing_version',100),finished_at=now()
 where job_id=j.id and attempt=j.attempts;
 if p_error is not null then
   update public.ai_jobs set status='error',error_message=left(p_error,100),updated_at=now() where id=j.id;
   update public.room_media set processing_status='error',processing_error=left(p_error,100) where message_id=j.message_id;
   return jsonb_build_object('status','error');
 end if;
 if v_intent is null or v_intent not in ('greeting','baskets','offers','search','checkout','decline_upsell','fast_checkout','human','clarify')
 or nullif(p_result->>'reply','') is null or length(p_result->>'reply')>1000 then raise exception 'invalid_job_result'; end if;
 update public.messages set transcript=case when j.job_type='transcription' then left(p_result->>'transcript',4000) else transcript end,
 ai_interpretation=jsonb_build_object('intent',v_intent,'description',left(p_result->>'description',1000),'source','conversation_worker_v1') where id=j.message_id;
 update public.room_media set processing_status='processed',processing_error=null where message_id=j.message_id;
 if enabled then
   if v_intent='decline_upsell' then
     perform public.record_sales_offer_event(j.conversation_id,'declined_all',null,'shopping_room',jsonb_build_object('ai_job_id',j.id));
   elsif v_intent='fast_checkout' then
     update public.conversations set fast_checkout=true,sales_pressure_level=0,updated_at=now() where id=j.conversation_id;
   elsif v_intent='human' then
     update public.conversations set mode='human',updated_at=now() where id=j.conversation_id;
   end if;
   insert into public.messages(conversation_id,direction,message_type,body_text,ai_interpretation,raw_event)
   values(j.conversation_id,'outbound','text',p_result->>'reply',jsonb_build_object('source','conversation_worker_v1','intent',v_intent,'ui',p_result->'ui'),jsonb_build_object('source','shopping_room','session_id',session_id,'ai_job_id',j.id)) returning id into reply_id;
 end if;
 -- Completion and reply commit together. No WhatsApp outbound job or cart mutation here.
 update public.ai_jobs set status='done',result=p_result||jsonb_build_object('reply_message_id',reply_id,'reply_suppressed',not enabled),error_message=null,updated_at=now() where id=j.id;
 return jsonb_build_object('status','done','reply_message_id',reply_id,'reply_suppressed',not enabled);
end $$;
revoke execute on function public.queue_ai_job_for_message(uuid,text,jsonb),public.claim_conversation_job(text),public.finish_conversation_job(uuid,text,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.queue_ai_job_for_message(uuid,text,jsonb),public.claim_conversation_job(text),public.finish_conversation_job(uuid,text,integer,jsonb,jsonb,text) to service_role;
commit;
