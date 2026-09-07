begin;

-- Correção/hardening do claim exato da mesma rodada: mantém apenas colunas de ai_jobs
-- no rowtype e move leases expirados para review mesmo quando não chega outro job.
create or replace function public.claim_conversation_job_v2(p_worker text,p_expected_job_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  j public.ai_jobs%rowtype;
  m public.messages%rowtype;
  c public.conversations%rowtype;
  media jsonb;
  used integer;
  hourly_used integer;
  daily_in bigint;
  daily_out bigint;
  v_release jsonb;
  expired record;
begin
  if nullif(trim(p_worker),'') is null then raise exception 'worker_required'; end if;
  select * into cfg from public.automation_config where id=1 for update;
  if not coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled,false) then return null; end if;

  for expired in
    select a.id from public.ai_jobs a
     where a.status='processing' and a.locked_at<now()-interval '10 minutes' and a.locked_by like 'conversation-%'
     for update skip locked
  loop
    update public.ai_jobs set status='error',error_message='lease_expired_review_required',updated_at=now() where id=expired.id;
  end loop;

  select a.* into j
  from public.ai_jobs a
  join public.messages msg on msg.id=a.message_id
  join public.conversations cv on cv.id=a.conversation_id
  where a.status='pending' and a.not_before<=now() and a.attempts<a.max_attempts
    and (p_expected_job_id is null or a.id=p_expected_job_id)
    and a.job_type in ('transcription','vision','conversation') and cv.mode='ai'
    and not exists(select 1 from public.ai_jobs busy where busy.conversation_id=a.conversation_id and busy.status='processing')
    and msg.direction='inbound' and msg.raw_event->>'source' in ('shopping_room','whatsapp')
    and exists(select 1 from public.catalog_sessions s where s.conversation_id=cv.id and s.status='open' and s.expires_at>now())
  order by a.created_at,a.id for update of a skip locked limit 1;
  if not found then return null; end if;

  select * into m from public.messages where id=j.message_id;
  select * into c from public.conversations where id=j.conversation_id;

  if m.raw_event->>'source'='whatsapp' then
    if not coalesce(cfg.whatsapp_inbound_enabled and cfg.whatsapp_auto_reply_enabled,false)
       or cfg.whatsapp_release_mode not in ('homologation','live') then
      update public.ai_jobs set status='held',error_message='whatsapp_reply_gate_closed',updated_at=now() where id=j.id;
      return jsonb_build_object('skipped',true,'reason','whatsapp_reply_gate_closed','id',j.id);
    end if;
    v_release:=public.whatsapp_release_decision(c.wa_contact_e164,m.created_at);
    if coalesce((v_release->>'auto_reply_allowed')::boolean,false) is not true then
      update public.ai_jobs set status='held',error_message='release_human_control',updated_at=now() where id=j.id;
      return jsonb_build_object('skipped',true,'reason','release_human_control','id',j.id);
    end if;

    select count(*) into hourly_used
      from public.ai_usage_events u join public.messages mm on mm.id=u.message_id
     where u.created_at>=now()-interval '1 hour' and mm.raw_event->>'source'='whatsapp';
    if hourly_used>=cfg.whatsapp_live_max_ai_jobs_per_hour then
      update public.ai_jobs set status='held',error_message='ai_hourly_cap_human_required',updated_at=now() where id=j.id;
      return jsonb_build_object('skipped',true,'reason','ai_hourly_cap','id',j.id);
    end if;
  end if;

  select coalesce(sum(input_tokens),0),coalesce(sum(output_tokens),0) into daily_in,daily_out
    from public.ai_usage_events
   where status='done' and (created_at at time zone 'America/Cuiaba')::date=(now() at time zone 'America/Cuiaba')::date;
  if daily_in>=cfg.ai_daily_input_tokens_soft_limit or daily_out>=cfg.ai_daily_output_tokens_soft_limit then
    update public.ai_jobs set status='held',error_message='ai_daily_token_budget_human_required',updated_at=now() where id=j.id;
    return jsonb_build_object('skipped',true,'reason','ai_daily_token_budget','id',j.id);
  end if;

  select count(*) into used from public.ai_usage_events where message_id=j.message_id;
  if used>=cfg.max_ai_calls_per_event
     or (j.job_type='transcription' and cfg.max_transcriptions_per_event<1)
     or (j.job_type='vision' and cfg.max_vision_calls_per_event<1) then
    update public.ai_jobs set status='held',error_message='event_call_budget_human_required',updated_at=now() where id=j.id;
    return jsonb_build_object('skipped',true,'reason','event_call_budget','id',j.id);
  end if;

  update public.ai_jobs set status='processing',attempts=attempts+1,locked_by=p_worker,locked_at=now(),worker_dispatch_last_error=null,updated_at=now()
   where id=j.id returning * into j;
  insert into public.ai_usage_events(job_id,message_id,attempt) values(j.id,j.message_id,j.attempts);
  select to_jsonb(r) into media from public.room_media r where r.message_id=j.message_id and r.conversation_id=j.conversation_id order by r.created_at limit 1;
  return jsonb_build_object('id',j.id,'message_id',j.message_id,'conversation_id',j.conversation_id,'job_type',j.job_type,
    'attempt',j.attempts,'body_text',m.body_text,'message_type',m.message_type,'source',m.raw_event->>'source','media',media);
end;
$$;

create or replace function public.claim_conversation_job(p_worker text)
returns jsonb language sql security definer set search_path='' as $$
  select public.claim_conversation_job_v2(p_worker,null);
$$;

create or replace function public.recover_conversation_worker_dispatch_v2()
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.automation_config%rowtype; r record; v_dispatched integer:=0; v_held integer:=0; v_expired integer:=0;
begin
  select * into cfg from public.automation_config where id=1;

  -- Processamento incerto não volta para pending: vai para erro/revisão humana.
  for r in
    select id from public.ai_jobs
     where status='processing' and locked_at<now()-interval '10 minutes' and locked_by like 'conversation-%'
     order by locked_at limit 20 for update skip locked
  loop
    update public.ai_jobs set status='error',error_message='lease_expired_review_required',updated_at=now() where id=r.id;
    v_expired:=v_expired+1;
  end loop;

  if not coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and cfg.conversation_worker_dispatch_enabled,false) then
    return jsonb_build_object('active',false,'dispatched',0,'held',0,'expired_to_review',v_expired);
  end if;

  for r in
    select id,worker_dispatch_attempts from public.ai_jobs
     where status='pending' and not_before<=now()
       and (worker_dispatched_at is null or worker_dispatched_at<now()-interval '75 seconds')
     order by created_at limit 10 for update skip locked
  loop
    if r.worker_dispatch_attempts>=cfg.conversation_worker_dispatch_max_attempts then
      update public.ai_jobs set status='held',error_message='worker_dispatch_exhausted_human_required',updated_at=now() where id=r.id;
      v_held:=v_held+1;
    else
      perform public.dispatch_conversation_worker_job_v2(r.id);
      v_dispatched:=v_dispatched+1;
    end if;
  end loop;
  return jsonb_build_object('active',true,'dispatched',v_dispatched,'held',v_held,'expired_to_review',v_expired);
end;
$$;

revoke all on function public.claim_conversation_job_v2(text,uuid) from public,anon,authenticated;
revoke all on function public.claim_conversation_job(text) from public,anon,authenticated;
revoke all on function public.recover_conversation_worker_dispatch_v2() from public,anon,authenticated;
grant execute on function public.claim_conversation_job_v2(text,uuid) to service_role;
grant execute on function public.claim_conversation_job(text) to service_role;
grant execute on function public.recover_conversation_worker_dispatch_v2() to service_role;

commit;
