begin;

-- Mídia de conversa já assumida por humano nunca deve nascer como pending.
create or replace function public.queue_ai_job_for_message(p_message_id uuid,p_job_type text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_enabled boolean; v_conversation uuid; v_mode text; v_id uuid; v_status text;
begin
  if p_job_type not in ('transcription','vision','tts','conversation') then raise exception 'invalid_ai_job_type'; end if;
  select m.conversation_id,c.mode into v_conversation,v_mode
    from public.messages m join public.conversations c on c.id=m.conversation_id
   where m.id=p_message_id;
  if not found then raise exception 'message_not_found'; end if;
  select ai_enabled and automation_enabled and conversation_worker_enabled into v_enabled from public.automation_config where id=1;
  insert into public.ai_jobs(conversation_id,message_id,job_type,status,input)
  values(v_conversation,p_message_id,p_job_type,
    case when coalesce(v_enabled,false) and v_mode='ai' then 'pending' else 'held' end,
    coalesce(p_input,'{}'::jsonb))
  on conflict(message_id,job_type) do nothing;
  select id,status into v_id,v_status from public.ai_jobs where message_id=p_message_id and job_type=p_job_type;
  return jsonb_build_object('id',v_id,'status',v_status);
end $$;

-- O provider pode levar dezenas de segundos. O cliente pg_net deve esperar mais do que
-- o timeout do OpenAI para não induzir uma aparência artificial de falha no transporte.
create or replace function public.dispatch_conversation_worker_job_v2(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.automation_config%rowtype; j public.ai_jobs%rowtype; v_secret text; v_request bigint;
begin
  select * into cfg from public.automation_config where id=1;
  select * into j from public.ai_jobs where id=p_job_id for update;
  if not found then return jsonb_build_object('dispatched',false,'reason','job_not_found'); end if;
  if j.status<>'pending' then return jsonb_build_object('dispatched',false,'reason','job_not_pending','status',j.status); end if;
  if not coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and cfg.conversation_worker_dispatch_enabled,false) then
    return jsonb_build_object('dispatched',false,'reason','worker_dispatch_disabled');
  end if;
  if j.worker_dispatch_attempts>=cfg.conversation_worker_dispatch_max_attempts then
    update public.ai_jobs set status='held',error_message='worker_dispatch_exhausted_human_required',updated_at=now() where id=j.id;
    return jsonb_build_object('dispatched',false,'reason','dispatch_attempts_exhausted');
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='conversation_worker_webhook_key_v2' limit 1;
  if v_secret is null then
    update public.ai_jobs set worker_dispatch_last_error='worker_vault_secret_missing',updated_at=now() where id=j.id;
    return jsonb_build_object('dispatched',false,'reason','worker_secret_missing');
  end if;
  begin
    v_request:=net.http_post(
      url:='https://ssbesxgaijknwsjbsbcz.supabase.co/functions/v1/conversation-worker-v2',
      headers:=jsonb_build_object('Content-Type','application/json','x-da-worker-key',v_secret),
      body:=jsonb_build_object('job_id',j.id),
      timeout_milliseconds:=120000
    );
    update public.ai_jobs set worker_dispatch_request_id=v_request,worker_dispatched_at=now(),
      worker_dispatch_attempts=worker_dispatch_attempts+1,worker_dispatch_last_error=null,updated_at=now() where id=j.id;
    return jsonb_build_object('dispatched',true,'request_id',v_request,'job_id',j.id);
  exception when others then
    update public.ai_jobs set worker_dispatch_attempts=worker_dispatch_attempts+1,
      worker_dispatch_last_error='worker_dispatch_failed',worker_dispatched_at=now(),updated_at=now() where id=j.id;
    insert into public.whatsapp_ops_events(event_type,severity,ai_job_id,details)
    values('worker_dispatch_failed','warning',j.id,jsonb_build_object('job_type',j.job_type));
    return jsonb_build_object('dispatched',false,'reason','worker_dispatch_failed');
  end;
end;
$$;

revoke all on function public.queue_ai_job_for_message(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.dispatch_conversation_worker_job_v2(uuid) from public,anon,authenticated;
grant execute on function public.queue_ai_job_for_message(uuid,text,jsonb) to service_role;
grant execute on function public.dispatch_conversation_worker_job_v2(uuid) to service_role;

commit;
