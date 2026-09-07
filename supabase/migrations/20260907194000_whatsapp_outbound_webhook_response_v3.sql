begin;

alter table public.outbound_jobs
  add column if not exists dispatch_response_status integer,
  add column if not exists dispatch_response jsonb,
  add column if not exists dispatch_response_checked_at timestamptz;

comment on column public.outbound_jobs.dispatch_response_status is
  'HTTP status devolvido pelo webhook Make para o dispatch conversacional.';
comment on column public.outbound_jobs.dispatch_response is
  'Resposta JSON minima do Make; nunca deve conter credenciais.';
comment on column public.outbound_jobs.dispatch_response_checked_at is
  'Instante em que a resposta pg_net foi reconciliada.';

create or replace function public.dispatch_whatsapp_outbound_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_cfg public.automation_config%rowtype;
  v_job public.outbound_jobs%rowtype;
  v_profile public.ai_voice_profiles%rowtype;
  v_webhook text;
  v_request_id bigint;
  v_mode text;
  v_payload jsonb;
begin
  if p_job_id is null then
    return jsonb_build_object('ok',false,'reason','job_id_required');
  end if;

  select * into v_cfg from public.automation_config where id=1;
  if not coalesce(
    v_cfg.automation_enabled
    and v_cfg.outbound_enabled
    and v_cfg.ai_enabled
    and v_cfg.conversation_worker_enabled
    and v_cfg.whatsapp_inbound_enabled
    and v_cfg.whatsapp_auto_reply_enabled,
    false
  ) then
    return jsonb_build_object('ok',true,'skipped','automation_disabled');
  end if;

  select j.* into v_job
  from public.outbound_jobs j
  join public.conversations c on c.id=j.conversation_id
  where j.id=p_job_id
    and j.job_type='seller_message'
    and j.payload->>'message_kind'='conversation_reply'
    and j.status in ('pending','error')
    and coalesce(j.last_error,'') not in (
      'lease_expired_review_required',
      'dispatch_unreachable_review_required',
      'delivery_uncertain_review_required'
    )
    and j.not_before<=now()
    and j.attempts<j.max_attempts
    and c.mode='ai'
    and c.service_window_expires_at>now()
  for update of j;

  if not found then
    return jsonb_build_object('ok',true,'skipped','job_unavailable');
  end if;

  if nullif(trim(coalesce(v_job.payload->>'body_text','')),'') is null then
    update public.outbound_jobs
       set status='cancelled',last_error='empty_conversation_reply',locked_at=null,locked_by=null,updated_at=now()
     where id=v_job.id;
    return jsonb_build_object('ok',true,'skipped','empty_conversation_reply');
  end if;

  v_mode:=coalesce(v_job.payload->>'delivery_mode','text');
  if v_mode not in ('text','audio') then v_mode:='text'; end if;

  if v_mode='audio' then
    select * into v_profile
    from public.ai_voice_profiles
    where id=coalesce(nullif(v_job.payload->>'voice_profile',''),'dona_antonia_marin_b_v1')
      and is_active=true;
    if not found then
      update public.outbound_jobs
         set status='error',last_error='voice_profile_unavailable',not_before=now()+interval '5 minutes',
             locked_at=null,locked_by=null,updated_at=now()
       where id=v_job.id;
      return jsonb_build_object('ok',false,'reason','voice_profile_unavailable');
    end if;
  end if;

  select decrypted_secret into v_webhook
  from vault.decrypted_secrets
  where name='dona_antonia_whatsapp_outbound_make_webhook'
  order by created_at desc
  limit 1;

  if nullif(v_webhook,'') is null then
    update public.outbound_jobs
       set status='error',last_error='dispatch_webhook_unavailable',not_before=now()+interval '2 minutes',
           locked_at=null,locked_by=null,updated_at=now()
     where id=v_job.id;
    return jsonb_build_object('ok',false,'reason','webhook_unavailable');
  end if;

  update public.outbound_jobs
     set status='processing',attempts=attempts+1,locked_at=now(),locked_by='pgnet-make-outbound-v3',
         dispatch_attempts=dispatch_attempts+1,last_dispatch_at=now(),last_error=null,
         dispatch_response_status=null,dispatch_response=null,dispatch_response_checked_at=null,updated_at=now()
   where id=v_job.id
   returning * into v_job;

  v_payload:=jsonb_build_object(
    'event','outbound_delivery',
    'protocol_version',3,
    'job',jsonb_build_object(
      'id',v_job.id::text,
      'conversation_id',v_job.conversation_id::text,
      'recipient_e164',v_job.recipient_e164,
      'attempt',v_job.attempts,
      'delivery_mode',v_mode,
      'body_text',left(coalesce(v_job.payload->>'body_text',''),4096),
      'reply_message_id',v_job.payload->>'reply_message_id',
      'voice_profile',case when v_mode='audio' then jsonb_build_object(
        'id',v_profile.id,
        'model',v_profile.model,
        'voice',v_profile.voice,
        'speed',v_profile.speed,
        'instructions',v_profile.instructions,
        'output_format',v_profile.output_format
      ) else null end
    )
  );

  begin
    v_request_id:=net.http_post(
      url:=v_webhook,
      body:=v_payload,
      headers:='{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds:=30000
    );
  exception when others then
    update public.outbound_jobs
       set status='error',last_error='dispatch_enqueue_failed',not_before=now()+interval '2 minutes',
           locked_at=null,locked_by=null,updated_at=now()
     where id=v_job.id;
    return jsonb_build_object('ok',false,'reason','dispatch_enqueue_failed');
  end;

  update public.outbound_jobs
     set last_dispatch_request_id=v_request_id,updated_at=now()
   where id=v_job.id;

  return jsonb_build_object('ok',true,'request_id',v_request_id,'job_id',v_job.id,'protocol_version',3);
end;
$$;

create or replace function public.reconcile_whatsapp_outbound_responses_v3()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.outbound_jobs%rowtype;
  v_resp record;
  v_json jsonb;
  v_sent integer:=0;
  v_review integer:=0;
  v_waiting integer:=0;
  v_provider_id text;
  v_mode text;
begin
  for v_job in
    select j.*
    from public.outbound_jobs j
    where j.job_type='seller_message'
      and j.payload->>'message_kind'='conversation_reply'
      and j.status='processing'
      and j.locked_by='pgnet-make-outbound-v3'
    order by j.locked_at,j.id
    limit 100
    for update skip locked
  loop
    if v_job.last_dispatch_request_id is null then
      if v_job.locked_at<now()-interval '2 minutes' then
        update public.outbound_jobs
           set status='error',last_error='delivery_uncertain_review_required',not_before=now()+interval '100 years',
               locked_at=null,locked_by=null,dispatch_response_checked_at=now(),updated_at=now()
         where id=v_job.id;
        v_review:=v_review+1;
      else
        v_waiting:=v_waiting+1;
      end if;
      continue;
    end if;

    select r.* into v_resp
    from net._http_response r
    where r.id=v_job.last_dispatch_request_id
    order by r.created desc
    limit 1;

    if not found then
      if v_job.locked_at<now()-interval '2 minutes' then
        update public.outbound_jobs
           set status='error',last_error='delivery_uncertain_review_required',not_before=now()+interval '100 years',
               locked_at=null,locked_by=null,dispatch_response_checked_at=now(),updated_at=now()
         where id=v_job.id;
        v_review:=v_review+1;
      else
        v_waiting:=v_waiting+1;
      end if;
      continue;
    end if;

    v_json:=null;
    begin
      if nullif(trim(coalesce(v_resp.content,'')),'') is not null then
        v_json:=v_resp.content::jsonb;
      end if;
    exception when others then
      v_json:=null;
    end;

    update public.outbound_jobs
       set dispatch_response_status=v_resp.status_code,
           dispatch_response=case when jsonb_typeof(v_json)='object' then v_json else null end,
           dispatch_response_checked_at=now(),updated_at=now()
     where id=v_job.id;

    if coalesce(v_resp.timed_out,false)
       or nullif(v_resp.error_msg,'') is not null
       or coalesce(v_resp.status_code,0)<200
       or coalesce(v_resp.status_code,0)>=300
       or jsonb_typeof(v_json) is distinct from 'object'
       or coalesce(v_json->>'ok','')<>'true'
       or coalesce(v_json->>'job_id','')<>v_job.id::text then
      update public.outbound_jobs
         set status='error',last_error='delivery_uncertain_review_required',not_before=now()+interval '100 years',
             locked_at=null,locked_by=null,updated_at=now()
       where id=v_job.id;
      v_review:=v_review+1;
      continue;
    end if;

    v_provider_id:=nullif(trim(coalesce(v_json->>'provider_message_id','')),'');
    v_mode:=coalesce(v_job.payload->>'delivery_mode','text');
    if v_mode not in ('text','audio') then v_mode:='text'; end if;

    if v_provider_id is null
       or length(v_provider_id)>500
       or coalesce(v_json->>'delivery_mode','')<>v_mode then
      update public.outbound_jobs
         set status='error',last_error='delivery_uncertain_review_required',not_before=now()+interval '100 years',
             locked_at=null,locked_by=null,updated_at=now()
       where id=v_job.id;
      v_review:=v_review+1;
      continue;
    end if;

    perform public.finish_outbound_job(v_job.id,true,v_provider_id,null,120);
    v_sent:=v_sent+1;
  end loop;

  return jsonb_build_object('sent',v_sent,'review_required',v_review,'waiting',v_waiting);
end;
$$;

create or replace function public.recover_whatsapp_outbound_dispatch()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_reconcile jsonb;
  v_requeued integer:=0;
begin
  v_reconcile:=public.reconcile_whatsapp_outbound_responses_v3();

  for v_id in
    select j.id
    from public.outbound_jobs j
    join public.conversations c on c.id=j.conversation_id
    cross join public.automation_config cfg
    where cfg.id=1
      and cfg.automation_enabled
      and cfg.outbound_enabled
      and cfg.ai_enabled
      and cfg.conversation_worker_enabled
      and cfg.whatsapp_inbound_enabled
      and cfg.whatsapp_auto_reply_enabled
      and j.job_type='seller_message'
      and j.payload->>'message_kind'='conversation_reply'
      and j.status in ('pending','error')
      and coalesce(j.last_error,'') in ('','dispatch_enqueue_failed','dispatch_webhook_unavailable','voice_profile_unavailable')
      and j.not_before<=now()
      and j.attempts<j.max_attempts
      and c.mode='ai'
      and c.service_window_expires_at>now()
    order by j.created_at,j.id
    limit 20
  loop
    perform public.dispatch_whatsapp_outbound_job(v_id);
    v_requeued:=v_requeued+1;
  end loop;

  return v_reconcile||jsonb_build_object('safe_redispatch_candidates',v_requeued);
end;
$$;

create or replace function public.dispatch_whatsapp_outbound_healthcheck_v3()
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_webhook text;
  v_request_id bigint;
begin
  select decrypted_secret into v_webhook
  from vault.decrypted_secrets
  where name='dona_antonia_whatsapp_outbound_make_webhook'
  order by created_at desc
  limit 1;
  if nullif(v_webhook,'') is null then raise exception 'webhook_unavailable'; end if;

  v_request_id:=net.http_post(
    url:=v_webhook,
    body:=jsonb_build_object('event','healthcheck','protocol_version',3),
    headers:='{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds:=5000
  );
  return v_request_id;
end;
$$;

revoke all on function public.dispatch_whatsapp_outbound_job(uuid) from public,anon,authenticated;
grant execute on function public.dispatch_whatsapp_outbound_job(uuid) to service_role;
revoke all on function public.reconcile_whatsapp_outbound_responses_v3() from public,anon,authenticated;
grant execute on function public.reconcile_whatsapp_outbound_responses_v3() to service_role;
revoke all on function public.recover_whatsapp_outbound_dispatch() from public,anon,authenticated;
grant execute on function public.recover_whatsapp_outbound_dispatch() to service_role;
revoke all on function public.dispatch_whatsapp_outbound_healthcheck_v3() from public,anon,authenticated;
grant execute on function public.dispatch_whatsapp_outbound_healthcheck_v3() to service_role;

-- O trigger existente continua chamando dispatch_whatsapp_outbound_job(), agora com protocolo v3.
-- O cron v2 existente continua chamando recover_whatsapp_outbound_dispatch(), cujo corpo agora reconcilia v3.

commit;
