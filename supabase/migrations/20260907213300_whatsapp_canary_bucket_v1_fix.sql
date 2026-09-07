begin;

create or replace function public.whatsapp_release_decision(p_from text,p_message_timestamp timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  v_phone text;
  v_allowed boolean:=false;
  v_existing boolean:=false;
  v_bucket integer:=null;
  v_new_last_hour integer:=0;
begin
  select * into cfg from public.automation_config where id=1;
  if not found then return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','config_missing'); end if;
  if not coalesce(cfg.whatsapp_inbound_enabled,false) or cfg.whatsapp_release_mode='off' then
    return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','whatsapp_inbound_disabled','mode',cfg.whatsapp_release_mode);
  end if;
  if p_message_timestamp is null or p_message_timestamp<cfg.whatsapp_inbound_since then
    return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','before_whatsapp_cutover','mode',cfg.whatsapp_release_mode);
  end if;

  v_phone:='+'||public.normalize_phone_digits(p_from);

  if cfg.whatsapp_release_mode='homologation' then
    select exists(select 1 from public.whatsapp_test_allowlist a where a.phone_e164=v_phone and a.enabled=true and a.expires_at>now()) into v_allowed;
    return jsonb_build_object('allow_ingest',v_allowed,'auto_reply_allowed',v_allowed,
      'reason',case when v_allowed then 'homologation_allowlist' else 'homologation_phone_blocked' end,
      'mode',cfg.whatsapp_release_mode,'cohort',case when v_allowed then 'homologation' else null end);
  end if;

  if cfg.whatsapp_release_mode='observe' then
    return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',false,'reason','observe_human_only','mode','observe','cohort','observe');
  end if;

  if cfg.whatsapp_release_mode<>'live' then
    return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','invalid_release_mode','mode',cfg.whatsapp_release_mode);
  end if;

  -- hashtext é estável dentro do PostgreSQL para a mesma string. Convertemos para bigint
  -- antes do abs para evitar overflow de int32 e obtemos bucket 0..99.
  v_bucket:=mod(abs(hashtext(v_phone)::bigint),100)::integer;
  select exists(
    select 1 from public.conversations c
     where c.status<>'closed' and public.normalize_phone_digits(c.wa_contact_e164)=public.normalize_phone_digits(v_phone)
  ) into v_existing;

  if cfg.whatsapp_live_canary_percent<=0 or v_bucket>=cfg.whatsapp_live_canary_percent then
    return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',false,'reason','live_canary_human_control',
      'mode','live','cohort','human_control','bucket',v_bucket,'canary_percent',cfg.whatsapp_live_canary_percent);
  end if;

  if not v_existing then
    select count(*) into v_new_last_hour from public.conversations c
     where c.whatsapp_account_id is not null and c.created_at>=now()-interval '1 hour' and c.automation_cohort='ai_canary';
    if v_new_last_hour>=cfg.whatsapp_live_max_new_conversations_per_hour then
      return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',false,'reason','live_new_conversation_cap_human_control',
        'mode','live','cohort','human_control','bucket',v_bucket,'new_conversations_last_hour',v_new_last_hour);
    end if;
  end if;

  return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',true,'reason','live_canary_ai',
    'mode','live','cohort','ai_canary','bucket',v_bucket,'canary_percent',cfg.whatsapp_live_canary_percent);
end;
$$;

revoke all on function public.whatsapp_release_decision(text,timestamptz) from public,anon,authenticated;
grant execute on function public.whatsapp_release_decision(text,timestamptz) to service_role;

commit;
