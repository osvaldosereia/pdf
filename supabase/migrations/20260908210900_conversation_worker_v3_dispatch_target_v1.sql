begin;

-- Corrige a divergência de runtime após o deploy do conversation-worker-v3.
-- Mantém o mesmo contrato de autenticação, retries e auditoria do dispatcher v2;
-- altera somente o endpoint interno de destino para o worker v3.
create or replace function public.dispatch_conversation_worker_job_v2(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  j public.ai_jobs%rowtype;
  v_secret text;
  v_request bigint;
begin
  select * into cfg from public.automation_config where id=1;
  select * into j from public.ai_jobs where id=p_job_id for update;
  if not found then
    return jsonb_build_object('dispatched',false,'reason','job_not_found');
  end if;
  if j.status<>'pending' then
    return jsonb_build_object('dispatched',false,'reason','job_not_pending','status',j.status);
  end if;
  if not coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and cfg.conversation_worker_dispatch_enabled,false) then
    return jsonb_build_object('dispatched',false,'reason','worker_dispatch_disabled');
  end if;
  if j.worker_dispatch_attempts>=cfg.conversation_worker_dispatch_max_attempts then
    update public.ai_jobs
      set status='held',error_message='worker_dispatch_exhausted_human_required',updated_at=now()
      where id=j.id;
    return jsonb_build_object('dispatched',false,'reason','dispatch_attempts_exhausted');
  end if;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
    where name='conversation_worker_webhook_key_v2'
    order by created_at desc
    limit 1;
  if v_secret is null then
    update public.ai_jobs
      set worker_dispatch_last_error='worker_vault_secret_missing',updated_at=now()
      where id=j.id;
    return jsonb_build_object('dispatched',false,'reason','worker_secret_missing');
  end if;

  begin
    v_request:=net.http_post(
      url:='https://ssbesxgaijknwsjbsbcz.supabase.co/functions/v1/conversation-worker-v3',
      headers:=jsonb_build_object('Content-Type','application/json','x-da-worker-key',v_secret),
      body:=jsonb_build_object('job_id',j.id),
      timeout_milliseconds:=120000
    );
    update public.ai_jobs
      set worker_dispatch_request_id=v_request,
          worker_dispatched_at=now(),
          worker_dispatch_attempts=worker_dispatch_attempts+1,
          worker_dispatch_last_error=null,
          updated_at=now()
      where id=j.id;
    return jsonb_build_object('dispatched',true,'request_id',v_request,'job_id',j.id,'worker_version',3);
  exception when others then
    update public.ai_jobs
      set worker_dispatch_attempts=worker_dispatch_attempts+1,
          worker_dispatch_last_error='worker_dispatch_failed',
          worker_dispatched_at=now(),
          updated_at=now()
      where id=j.id;
    insert into public.whatsapp_ops_events(event_type,severity,ai_job_id,details)
      values('worker_dispatch_failed','warning',j.id,jsonb_build_object('job_type',j.job_type,'worker_version',3));
    return jsonb_build_object('dispatched',false,'reason','worker_dispatch_failed');
  end;
end $$;

revoke all on function public.dispatch_conversation_worker_job_v2(uuid) from public,anon,authenticated;
grant execute on function public.dispatch_conversation_worker_job_v2(uuid) to service_role;

commit;
