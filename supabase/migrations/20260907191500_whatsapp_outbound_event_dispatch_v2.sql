begin;

alter table public.outbound_jobs
  add column if not exists dispatch_attempts integer not null default 0,
  add column if not exists last_dispatch_at timestamptz,
  add column if not exists last_dispatch_request_id bigint;

alter table public.outbound_jobs
  drop constraint if exists outbound_jobs_dispatch_attempts_check;
alter table public.outbound_jobs
  add constraint outbound_jobs_dispatch_attempts_check check(dispatch_attempts >= 0);

create index if not exists outbound_jobs_dispatch_recovery_idx
  on public.outbound_jobs(status, last_dispatch_at, not_before, created_at)
  where job_type='seller_message';

-- Reivindica exatamente o job informado pelo webhook. Webhooks duplicados são inofensivos:
-- somente um processo consegue mudar pending/error -> processing.
create or replace function public.claim_whatsapp_conversation_outbound_by_id(
  p_worker text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_cfg public.automation_config%rowtype;
  v_job public.outbound_jobs%rowtype;
  v_profile public.ai_voice_profiles%rowtype;
  v_mode text;
begin
  if nullif(trim(coalesce(p_worker,'')),'') is null then raise exception 'worker_required'; end if;
  if p_job_id is null then raise exception 'job_id_required'; end if;

  select * into v_cfg from public.automation_config where id=1;
  if not coalesce(
    v_cfg.automation_enabled and v_cfg.outbound_enabled and v_cfg.ai_enabled and v_cfg.conversation_worker_enabled,
    false
  ) then return null; end if;

  select j.* into v_job
  from public.outbound_jobs j
  join public.conversations c on c.id=j.conversation_id
  where j.id=p_job_id
    and j.job_type='seller_message'
    and j.payload->>'message_kind'='conversation_reply'
    and j.status in ('pending','error')
    and coalesce(j.last_error,'') not in ('lease_expired_review_required','dispatch_unreachable_review_required')
    and j.not_before<=now()
    and j.attempts<j.max_attempts
    and c.mode='ai'
    and c.service_window_expires_at>now()
  for update of j;

  if not found then return jsonb_build_object('skipped',true,'reason','job_unavailable'); end if;

  v_mode:=coalesce(v_job.payload->>'delivery_mode','text');
  if v_mode not in ('text','audio') then v_mode:='text'; end if;
  if nullif(trim(coalesce(v_job.payload->>'body_text','')),'') is null then
    update public.outbound_jobs
       set status='cancelled',last_error='empty_conversation_reply',locked_at=null,locked_by=null,updated_at=now()
     where id=v_job.id;
    return jsonb_build_object('skipped',true,'reason','empty_conversation_reply');
  end if;

  if v_mode='audio' then
    select * into v_profile
    from public.ai_voice_profiles
    where id=coalesce(nullif(v_job.payload->>'voice_profile',''),'dona_antonia_marin_b_v1') and is_active=true;
    if not found then
      update public.outbound_jobs
         set status='error',last_error='voice_profile_unavailable',locked_at=null,locked_by=null,
             not_before=now()+interval '5 minutes',updated_at=now()
       where id=v_job.id;
      return jsonb_build_object('skipped',true,'reason','voice_profile_unavailable');
    end if;
  end if;

  update public.outbound_jobs
     set status='processing',attempts=attempts+1,locked_at=now(),locked_by=left(p_worker,120),
         last_error=null,updated_at=now()
   where id=v_job.id
   returning * into v_job;

  return jsonb_build_object(
    'id',v_job.id,
    'conversation_id',v_job.conversation_id,
    'customer_id',v_job.customer_id,
    'recipient_e164',v_job.recipient_e164,
    'attempt',v_job.attempts,
    'delivery_mode',v_mode,
    'body_text',left(coalesce(v_job.payload->>'body_text',''),4096),
    'reply_message_id',v_job.payload->>'reply_message_id',
    'service_window_expires_at',v_job.payload->>'service_window_expires_at',
    'voice_profile',case when v_mode='audio' then jsonb_build_object(
      'id',v_profile.id,'model',v_profile.model,'voice',v_profile.voice,'speed',v_profile.speed,
      'instructions',v_profile.instructions,'output_format',v_profile.output_format
    ) else null end
  );
end;
$$;

revoke all on function public.claim_whatsapp_conversation_outbound_by_id(text,uuid) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_conversation_outbound_by_id(text,uuid) to service_role;

-- Notifica o Make sem expor o webhook em código ou tabela pública.
-- O job continua pending/error até o Make reivindicá-lo por ID.
create or replace function public.dispatch_whatsapp_outbound_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_cfg public.automation_config%rowtype;
  v_job public.outbound_jobs%rowtype;
  v_webhook text;
  v_request_id bigint;
begin
  if p_job_id is null then return jsonb_build_object('ok',false,'reason','job_id_required'); end if;
  select * into v_cfg from public.automation_config where id=1;
  if not coalesce(
    v_cfg.automation_enabled and v_cfg.outbound_enabled and v_cfg.ai_enabled and v_cfg.conversation_worker_enabled,
    false
  ) then return jsonb_build_object('ok',true,'skipped','automation_disabled'); end if;

  select j.* into v_job
  from public.outbound_jobs j
  join public.conversations c on c.id=j.conversation_id
  where j.id=p_job_id
    and j.job_type='seller_message'
    and j.payload->>'message_kind'='conversation_reply'
    and j.status in ('pending','error')
    and coalesce(j.last_error,'') not in ('lease_expired_review_required','dispatch_unreachable_review_required')
    and j.not_before<=now()
    and j.attempts<j.max_attempts
    and j.dispatch_attempts<20
    and c.mode='ai'
    and c.service_window_expires_at>now()
  for update of j;

  if not found then return jsonb_build_object('ok',true,'skipped','job_unavailable'); end if;
  if v_job.last_dispatch_at is not null and v_job.last_dispatch_at>now()-interval '30 seconds' then
    return jsonb_build_object('ok',true,'skipped','recently_dispatched');
  end if;

  select decrypted_secret into v_webhook
  from vault.decrypted_secrets
  where name='dona_antonia_whatsapp_outbound_make_webhook'
  order by created_at desc
  limit 1;
  if nullif(v_webhook,'') is null then
    return jsonb_build_object('ok',false,'reason','webhook_unavailable');
  end if;

  v_request_id:=net.http_post(
    url:=v_webhook,
    body:=jsonb_build_object('event','outbound_ready','job_id',v_job.id::text),
    headers:='{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds:=5000
  );

  update public.outbound_jobs
     set dispatch_attempts=dispatch_attempts+1,last_dispatch_at=now(),last_dispatch_request_id=v_request_id,updated_at=now()
   where id=v_job.id;

  return jsonb_build_object('ok',true,'request_id',v_request_id,'job_id',v_job.id);
exception when others then
  return jsonb_build_object('ok',false,'reason','dispatch_failed');
end;
$$;

revoke all on function public.dispatch_whatsapp_outbound_job(uuid) from public,anon,authenticated;
grant execute on function public.dispatch_whatsapp_outbound_job(uuid) to service_role;

create or replace function public.notify_whatsapp_outbound_insert()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.job_type='seller_message' and new.payload->>'message_kind'='conversation_reply' then
    begin
      perform public.dispatch_whatsapp_outbound_job(new.id);
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_whatsapp_outbound_insert() from public,anon,authenticated;

drop trigger if exists outbound_jobs_whatsapp_event_dispatch on public.outbound_jobs;
create trigger outbound_jobs_whatsapp_event_dispatch
after insert on public.outbound_jobs
for each row execute function public.notify_whatsapp_outbound_insert();

-- Recuperação sem reenvio cego: lease expirado após possível envio vira revisão manual.
create or replace function public.recover_whatsapp_outbound_dispatch()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_dispatched integer:=0;
  v_blocked integer:=0;
begin
  update public.outbound_jobs
     set status='error',last_error='lease_expired_review_required',locked_at=null,locked_by=null,
         not_before=now()+interval '100 years',updated_at=now()
   where job_type='seller_message'
     and payload->>'message_kind'='conversation_reply'
     and status='processing'
     and locked_by='make-whatsapp-outbound-webhook-v2'
     and locked_at<now()-interval '10 minutes';
  get diagnostics v_blocked=row_count;

  update public.outbound_jobs
     set status='error',last_error='dispatch_unreachable_review_required',
         not_before=now()+interval '100 years',updated_at=now()
   where job_type='seller_message'
     and payload->>'message_kind'='conversation_reply'
     and status in ('pending','error')
     and dispatch_attempts>=20
     and coalesce(last_error,'')<>'lease_expired_review_required';

  for v_id in
    select j.id
    from public.outbound_jobs j
    join public.conversations c on c.id=j.conversation_id
    where j.job_type='seller_message'
      and j.payload->>'message_kind'='conversation_reply'
      and j.status in ('pending','error')
      and coalesce(j.last_error,'') not in ('lease_expired_review_required','dispatch_unreachable_review_required')
      and j.not_before<=now()
      and j.attempts<j.max_attempts
      and j.dispatch_attempts<20
      and (j.last_dispatch_at is null or j.last_dispatch_at<now()-interval '2 minutes')
      and c.mode='ai'
      and c.service_window_expires_at>now()
    order by j.created_at,j.id
    limit 20
  loop
    perform public.dispatch_whatsapp_outbound_job(v_id);
    v_dispatched:=v_dispatched+1;
  end loop;

  return jsonb_build_object('dispatched',v_dispatched,'review_blocked',v_blocked);
end;
$$;

revoke all on function public.recover_whatsapp_outbound_dispatch() from public,anon,authenticated;
grant execute on function public.recover_whatsapp_outbound_dispatch() to service_role;

-- Idempotente por nome; um único job de recuperação por minuto.
do $$
begin
  if not exists(select 1 from cron.job where jobname='dona-antonia-whatsapp-outbound-recovery-v2') then
    perform cron.schedule(
      'dona-antonia-whatsapp-outbound-recovery-v2',
      '* * * * *',
      'select public.recover_whatsapp_outbound_dispatch();'
    );
  end if;
end;
$$;

commit;
