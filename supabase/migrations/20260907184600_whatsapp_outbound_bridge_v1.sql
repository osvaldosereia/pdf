begin;

create or replace function public.claim_whatsapp_conversation_outbound(p_worker text)
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
  select * into v_cfg from public.automation_config where id=1;
  if not coalesce(v_cfg.automation_enabled and v_cfg.outbound_enabled,false) then return null; end if;

  -- Conversa nunca deve ficar presa indefinidamente. Lease vencido volta para revisão/retry controlado.
  update public.outbound_jobs
     set status=case when attempts>=max_attempts then 'cancelled' else 'error' end,
         last_error='lease_expired_review_required',locked_at=null,locked_by=null,
         not_before=now()+interval '2 minutes',updated_at=now()
   where job_type='seller_message' and status='processing'
     and locked_at<now()-interval '10 minutes';

  select j.* into v_job
  from public.outbound_jobs j
  join public.conversations c on c.id=j.conversation_id
  where j.job_type='seller_message'
    and j.payload->>'message_kind'='conversation_reply'
    and j.status in ('pending','error')
    and j.not_before<=now()
    and j.attempts<j.max_attempts
    and c.mode='ai'
    and c.service_window_expires_at>now()
  order by j.created_at,j.id
  for update of j skip locked
  limit 1;

  if not found then return null; end if;

  update public.outbound_jobs
     set status='processing',attempts=attempts+1,locked_at=now(),locked_by=left(p_worker,120),updated_at=now()
   where id=v_job.id returning * into v_job;

  v_mode:=coalesce(v_job.payload->>'delivery_mode','text');
  if v_mode not in ('text','audio') then v_mode:='text'; end if;

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

create or replace function public.finish_whatsapp_conversation_outbound(
  p_job_id uuid,
  p_worker text,
  p_success boolean,
  p_provider_message_id text default null,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.outbound_jobs%rowtype;
begin
  select * into v_job from public.outbound_jobs where id=p_job_id for update;
  if not found then raise exception 'outbound_job_not_found'; end if;
  if v_job.status='sent' and p_success then return jsonb_build_object('id',p_job_id,'success',true,'duplicate',true); end if;
  if v_job.job_type<>'seller_message' or v_job.payload->>'message_kind'<>'conversation_reply' then raise exception 'outbound_job_scope_mismatch'; end if;
  if v_job.status<>'processing' or v_job.locked_by is distinct from left(p_worker,120) then raise exception 'stale_outbound_lease'; end if;
  return public.finish_outbound_job(p_job_id,p_success,p_provider_message_id,p_error,120);
end;
$$;

revoke all on function public.claim_whatsapp_conversation_outbound(text) from public,anon,authenticated;
grant execute on function public.claim_whatsapp_conversation_outbound(text) to service_role;
revoke all on function public.finish_whatsapp_conversation_outbound(uuid,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.finish_whatsapp_conversation_outbound(uuid,text,boolean,text,text) to service_role;

commit;
