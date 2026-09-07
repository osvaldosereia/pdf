begin;

-- Audio precisa de duas chamadas separadas e auditáveis:
-- 1) transcrição; 2) classificação/conversa sobre o texto transcrito.
-- Texto comum continua consumindo apenas uma chamada.
update public.automation_config
set max_ai_calls_per_event=greatest(max_ai_calls_per_event,2),
    max_transcriptions_per_event=least(greatest(max_transcriptions_per_event,1),1),
    updated_at=now()
where id=1;

create or replace function public.finish_conversation_job(
  p_job_id uuid,p_worker text,p_attempt integer,p_result jsonb,p_usage jsonb default '{}'::jsonb,p_error text default null
)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  j public.ai_jobs%rowtype; c public.conversations%rowtype; cfg public.automation_config%rowtype;
  inbound public.messages%rowtype; customer public.customers%rowtype; reply_id uuid; outbound_id uuid;
  v_intent text:=p_result->>'intent'; enabled boolean; session_id uuid; v_source text; v_delivery_mode text;
  v_transcript text; v_followup jsonb;
begin
  select * into j from public.ai_jobs where id=p_job_id for update;
  if not found then raise exception 'job_not_found'; end if;
  if j.status='done' then return jsonb_build_object('status','done','duplicate',true); end if;
  if j.status<>'processing' or j.locked_by is distinct from p_worker or j.attempts<>p_attempt then raise exception 'stale_job_lease'; end if;

  select * into c from public.conversations where id=j.conversation_id for update;
  select * into inbound from public.messages where id=j.message_id for update;
  v_source:=coalesce(inbound.raw_event->>'source','shopping_room');
  if c.customer_id is not null then select * into customer from public.customers where id=c.customer_id; end if;
  select * into cfg from public.automation_config where id=1;
  select id into session_id from public.catalog_sessions where conversation_id=j.conversation_id and status='open' and expires_at>now() order by created_at desc limit 1;

  enabled:=coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and c.mode='ai' and session_id is not null
    and (v_source<>'whatsapp' or (cfg.whatsapp_inbound_enabled and cfg.whatsapp_auto_reply_enabled and c.service_window_expires_at>now())),false);

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

  -- Transcrição nunca responde ao cliente diretamente. Ela só persiste texto e
  -- cria o job de conversa que usa o classificador inteligente normal.
  if j.job_type='transcription' then
    v_transcript:=left(trim(coalesce(p_result->>'transcript','')),4000);
    if v_transcript='' then raise exception 'invalid_transcript_result'; end if;

    update public.messages
       set transcript=v_transcript,
           body_text=v_transcript,
           ai_interpretation=coalesce(ai_interpretation,'{}'::jsonb)||jsonb_build_object(
             'transcription_job_id',j.id,
             'transcription_source','conversation_worker_v1'
           )
     where id=j.message_id;

    update public.room_media
       set processing_status='processed',processing_error=null
     where message_id=j.message_id;

    v_followup:=public.queue_ai_job_for_message(
      j.message_id,
      'conversation',
      jsonb_build_object('source',v_source,'from_transcription_job_id',j.id)
    );

    update public.ai_jobs
       set status='done',
           result=jsonb_build_object(
             'transcript',v_transcript,
             'followup_job_id',v_followup->>'id',
             'followup_status',v_followup->>'status',
             'reply_suppressed',true,
             'source',v_source
           ),
           error_message=null,
           updated_at=now()
     where id=j.id;

    return jsonb_build_object(
      'status','done',
      'transcript_saved',true,
      'followup_job_id',v_followup->>'id',
      'followup_status',v_followup->>'status',
      'reply_suppressed',true,
      'source',v_source
    );
  end if;

  if v_intent is null or v_intent not in ('greeting','baskets','offers','search','checkout','decline_upsell','fast_checkout','human','clarify')
     or nullif(p_result->>'reply','') is null or length(p_result->>'reply')>1000 then raise exception 'invalid_job_result'; end if;

  update public.messages
     set ai_interpretation=coalesce(ai_interpretation,'{}'::jsonb)||jsonb_build_object(
       'intent',v_intent,
       'description',left(p_result->>'description',1000),
       'source','conversation_worker_v1'
     )
   where id=j.message_id;

  if j.job_type='vision' then
    update public.room_media set processing_status='processed',processing_error=null where message_id=j.message_id;
  end if;

  if enabled then
    if v_intent='decline_upsell' then perform public.record_sales_offer_event(j.conversation_id,'declined_all',null,v_source,jsonb_build_object('ai_job_id',j.id));
    elsif v_intent='fast_checkout' then update public.conversations set fast_checkout=true,sales_pressure_level=0,updated_at=now() where id=j.conversation_id;
    elsif v_intent='human' then update public.conversations set mode='human',updated_at=now() where id=j.conversation_id; end if;

    insert into public.messages(conversation_id,direction,message_type,body_text,ai_interpretation,raw_event)
    values(j.conversation_id,'outbound','text',p_result->>'reply',jsonb_build_object('source','conversation_worker_v1','intent',v_intent,'ui',p_result->'ui'),
      jsonb_build_object('source',v_source,'session_id',session_id,'ai_job_id',j.id)) returning id into reply_id;

    if v_source='whatsapp' and coalesce(cfg.outbound_enabled,false) and coalesce(cfg.whatsapp_auto_reply_enabled,false) then
      v_delivery_mode:=case
        when customer.preferred_reply='audio' then 'audio'
        when customer.preferred_reply='text' then 'text'
        when inbound.message_type='audio' then 'audio'
        else 'text'
      end;
      insert into public.outbound_jobs(whatsapp_account_id,customer_id,conversation_id,job_type,recipient_e164,dedupe_key,payload)
      values(c.whatsapp_account_id,c.customer_id,c.id,'seller_message',c.wa_contact_e164,'conversation_reply:'||reply_id::text,
        jsonb_build_object('message_kind','conversation_reply','message_type','text','body_text',p_result->>'reply','delivery_mode',v_delivery_mode,
          'voice_profile','dona_antonia_marin_b_v1','reply_message_id',reply_id,'ai_job_id',j.id,'service_window_expires_at',c.service_window_expires_at))
      on conflict(dedupe_key) do nothing returning id into outbound_id;
    end if;
  end if;

  update public.ai_jobs
     set status='done',
         result=p_result||jsonb_build_object('reply_message_id',reply_id,'outbound_job_id',outbound_id,'reply_suppressed',not enabled,'source',v_source),
         error_message=null,updated_at=now()
   where id=j.id;

  return jsonb_build_object('status','done','reply_message_id',reply_id,'outbound_job_id',outbound_id,'reply_suppressed',not enabled,'source',v_source);
end;
$$;

revoke all on function public.finish_conversation_job(uuid,text,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_conversation_job(uuid,text,integer,jsonb,jsonb,text) to service_role;

commit;
