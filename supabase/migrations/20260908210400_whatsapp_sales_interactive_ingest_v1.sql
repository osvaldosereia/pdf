begin;

create or replace function public.ingest_whatsapp_message(
  p_phone_number_id text,
  p_waba_id text,
  p_from text,
  p_profile_name text,
  p_message_id text,
  p_message_timestamp timestamptz,
  p_message_type text,
  p_body_text text default null,
  p_media_id text default null,
  p_interactive_payload jsonb default '{}'::jsonb,
  p_referral jsonb default '{}'::jsonb,
  p_raw_event jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_release jsonb;
  v_result jsonb;
  v_cfg public.automation_config%rowtype;
  v_body text;
  v_welcome jsonb;
  v_conversation uuid;
  v_message uuid;
  v_ai_job uuid;
  v_ai_job_json jsonb;
  v_cohort text;
  v_bucket smallint;
  v_interactive_id text;
begin
  v_release:=public.whatsapp_release_decision(p_from,p_message_timestamp);
  if coalesce((v_release->>'allow_ingest')::boolean,false) is not true then
    return jsonb_build_object('ok',true,'ignored',true,'reason',coalesce(v_release->>'reason','release_blocked'),'release_mode',v_release->>'mode','should_reply',false);
  end if;

  v_result:=public.ingest_whatsapp_message_core_v1(
    p_phone_number_id,p_waba_id,p_from,p_profile_name,p_message_id,p_message_timestamp,p_message_type,
    p_body_text,p_media_id,p_interactive_payload,p_referral,p_raw_event
  );

  if coalesce((v_result->>'ok')::boolean,false)=true and coalesce((v_result->>'duplicate')::boolean,false)=false then
    v_conversation:=nullif(v_result->>'conversation_id','')::uuid;
    v_message:=nullif(v_result->>'message_row_id','')::uuid;
    v_ai_job:=nullif(coalesce(v_result->'ai_job'->>'id',v_result->'reply'->'ai_job'->>'id'),'')::uuid;
    v_cohort:=nullif(v_release->>'cohort','');
    v_bucket:=nullif(v_release->>'bucket','')::smallint;
    if v_conversation is not null then
      update public.conversations set automation_cohort=v_cohort,automation_bucket=v_bucket,updated_at=now() where id=v_conversation;
    end if;
    if coalesce((v_release->>'auto_reply_allowed')::boolean,false) is not true then
      if v_ai_job is not null then update public.ai_jobs set status='held',error_message='release_human_control',updated_at=now() where id=v_ai_job and status in ('pending','held'); end if;
      if v_conversation is not null then
        perform public.queue_human_handoff_v1(v_conversation,coalesce(v_release->>'reason','release_human_control'),v_message,2::smallint,'Atendimento retido pela liberação gradual.',jsonb_build_object('release_mode',v_release->>'mode','cohort',v_cohort,'bucket',v_bucket));
      end if;
      v_result:=jsonb_set(v_result,'{should_reply}','false'::jsonb,true);
      v_result:=jsonb_set(v_result,'{reply}',jsonb_build_object('kind','none'),true);
      return v_result||jsonb_build_object('ai_job',null,'mode','human','release',v_release);
    end if;
  end if;

  -- Botões/listas comerciais da Dona Antônia são processados pelo mesmo worker vendedor.
  v_interactive_id:=coalesce(p_interactive_payload->>'id','');
  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'duplicate')::boolean,false)=false
     and coalesce(v_result->>'mode','')='ai'
     and p_message_type='interactive'
     and v_interactive_id like 'da\_%' escape '\' then
    select * into v_cfg from public.automation_config where id=1;
    if coalesce(v_cfg.automation_enabled and v_cfg.ai_enabled and v_cfg.conversation_worker_enabled and v_cfg.whatsapp_sales_mvp_enabled,false) then
      v_ai_job_json:=public.queue_ai_job_for_message(v_message,'conversation',jsonb_build_object('source','whatsapp','interactive_id',v_interactive_id,'sales_mvp',true));
      v_result:=jsonb_set(v_result,'{should_reply}','false'::jsonb,true);
      v_result:=jsonb_set(v_result,'{reply}',jsonb_build_object('kind','needs_ai','ai_job',v_ai_job_json),true);
      return v_result||jsonb_build_object('ai_job',v_ai_job_json,'sales_interactive',true,'release',v_release);
    end if;
  end if;

  -- Preserva o menu determinístico de saudação existente.
  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'duplicate')::boolean,false)=false
     and coalesce((v_result->>'should_reply')::boolean,false)=false
     and coalesce(v_result->>'mode','')='ai'
     and p_message_type='text' then
    v_body:=translate(lower(trim(regexp_replace(coalesce(p_body_text,''),'\s+',' ','g'))),'áàãâéêíóôõúç','aaaaeeiooouc');
    v_body:=regexp_replace(v_body,'[.!?,;:]+$','','g');
    if v_body in ('oi','oii','oiii','ola','olaa','olaaa','bom dia','boa tarde','boa noite','menu','inicio','iniciar','comecar') then
      select * into v_cfg from public.automation_config where id=1;
      if coalesce(v_cfg.whatsapp_auto_reply_enabled,false) and coalesce(v_cfg.automation_enabled,false) and coalesce(v_cfg.outbound_enabled,false) and v_cfg.whatsapp_release_mode in ('homologation','live') then
        select jsonb_build_object('kind','interactive_buttons','body_text',qr.body_text,'buttons',qr.metadata->'buttons') into v_welcome
          from public.quick_replies qr where qr.key='welcome_menu' and qr.is_active=true limit 1;
        if v_welcome is not null then
          v_result:=jsonb_set(v_result,'{should_reply}','true'::jsonb,true);
          v_result:=jsonb_set(v_result,'{reply}',v_welcome,true);
          v_result:=v_result||jsonb_build_object('menu_reason','greeting_or_menu_command');
        end if;
      end if;
    end if;
  end if;
  return v_result||jsonb_build_object('release',v_release);
end $$;

revoke all on function public.ingest_whatsapp_message(text,text,text,text,text,timestamptz,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_whatsapp_message(text,text,text,text,text,timestamptz,text,text,text,jsonb,jsonb,jsonb) to service_role;

commit;
