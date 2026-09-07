begin;

-- Observação real segura: reaproveita release=homologation, mas diferencia o
-- propósito da allowlist. Somente o telefone temporariamente autorizado entra;
-- nenhuma resposta automática/IA é permitida e o wrapper de ingest encaminha
-- a conversa para human_handoffs.

create or replace function public.arm_whatsapp_observe_homologation_v1(
  p_phone text,
  p_minutes integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_phone text;
  v_minutes integer;
  v_expires timestamptz;
begin
  v_phone:='+'||public.normalize_phone_digits(p_phone);
  if v_phone !~ '^\+[0-9]{10,15}$' then
    raise exception 'invalid_test_phone';
  end if;

  v_minutes:=greatest(5,least(coalesce(p_minutes,20),60));
  v_expires:=now()+make_interval(mins=>v_minutes);

  -- Uma única identidade pode estar autorizada durante a observação.
  update public.whatsapp_test_allowlist
     set enabled=false,updated_at=now()
   where enabled=true;

  insert into public.whatsapp_test_allowlist(phone_e164,purpose,enabled,expires_at)
  values(v_phone,'controlled_observe_homologation',true,v_expires)
  on conflict(phone_e164) do update
    set purpose='controlled_observe_homologation',
        enabled=true,
        expires_at=excluded.expires_at,
        updated_at=now();

  update public.automation_config
     set whatsapp_release_mode='homologation',
         whatsapp_inbound_enabled=true,
         whatsapp_auto_reply_enabled=false,
         whatsapp_inbound_since=now(),
         ai_enabled=false,
         conversation_worker_enabled=false,
         conversation_worker_dispatch_enabled=false,
         whatsapp_live_canary_percent=0,
         emergency_stop_reason=null,
         whatsapp_rollout_note='Controlled observe homologation: single allowlisted phone, human only',
         updated_at=now()
   where id=1;

  insert into public.whatsapp_ops_events(event_type,severity,details)
  values(
    'observe_homologation_armed',
    'warning',
    jsonb_build_object(
      'expires_at',v_expires,
      'scope','single_allowlisted_phone',
      'auto_reply',false,
      'ai',false,
      'human_only',true
    )
  );

  return jsonb_build_object(
    'mode','homologation',
    'profile','observe_human_only',
    'expires_at',v_expires,
    'scope','single_allowlisted_phone',
    'inbound_enabled',true,
    'auto_reply_allowed',false,
    'ai_enabled',false,
    'conversation_worker_enabled',false,
    'conversation_worker_dispatch_enabled',false
  );
end;
$$;

-- Mantém toda a lógica live/observe existente e torna a ramificação
-- homologation sensível ao purpose da allowlist.
create or replace function public.whatsapp_release_decision(
  p_from text,
  p_message_timestamp timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  v_phone text;
  v_allowed boolean:=false;
  v_purpose text:=null;
  v_existing boolean:=false;
  v_bucket integer:=null;
  v_new_last_hour integer:=0;
begin
  select * into cfg from public.automation_config where id=1;
  if not found then
    return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','config_missing');
  end if;

  if not coalesce(cfg.whatsapp_inbound_enabled,false) or cfg.whatsapp_release_mode='off' then
    return jsonb_build_object(
      'allow_ingest',false,'auto_reply_allowed',false,
      'reason','whatsapp_inbound_disabled','mode',cfg.whatsapp_release_mode
    );
  end if;

  if p_message_timestamp is null or p_message_timestamp<cfg.whatsapp_inbound_since then
    return jsonb_build_object(
      'allow_ingest',false,'auto_reply_allowed',false,
      'reason','before_whatsapp_cutover','mode',cfg.whatsapp_release_mode
    );
  end if;

  v_phone:='+'||public.normalize_phone_digits(p_from);

  if cfg.whatsapp_release_mode='homologation' then
    select true,a.purpose
      into v_allowed,v_purpose
      from public.whatsapp_test_allowlist a
     where a.phone_e164=v_phone
       and a.enabled=true
       and a.expires_at>now()
     order by a.updated_at desc
     limit 1;

    v_allowed:=coalesce(v_allowed,false);

    if not v_allowed then
      return jsonb_build_object(
        'allow_ingest',false,
        'auto_reply_allowed',false,
        'reason','homologation_phone_blocked',
        'mode','homologation',
        'cohort',null
      );
    end if;

    if v_purpose='controlled_observe_homologation' then
      return jsonb_build_object(
        'allow_ingest',true,
        'auto_reply_allowed',false,
        'reason','observe_homologation_allowlist',
        'mode','homologation',
        'cohort','observe',
        'profile','observe_human_only'
      );
    end if;

    return jsonb_build_object(
      'allow_ingest',true,
      'auto_reply_allowed',true,
      'reason','homologation_allowlist',
      'mode','homologation',
      'cohort','homologation',
      'profile','automation_test'
    );
  end if;

  if cfg.whatsapp_release_mode='observe' then
    return jsonb_build_object(
      'allow_ingest',true,
      'auto_reply_allowed',false,
      'reason','observe_human_only',
      'mode','observe',
      'cohort','observe'
    );
  end if;

  if cfg.whatsapp_release_mode<>'live' then
    return jsonb_build_object(
      'allow_ingest',false,
      'auto_reply_allowed',false,
      'reason','invalid_release_mode',
      'mode',cfg.whatsapp_release_mode
    );
  end if;

  v_bucket:=mod(abs(hashtext(v_phone)::bigint),100)::integer;

  select exists(
    select 1
      from public.conversations c
     where c.status<>'closed'
       and public.normalize_phone_digits(c.wa_contact_e164)=public.normalize_phone_digits(v_phone)
  ) into v_existing;

  if cfg.whatsapp_live_canary_percent<=0 or v_bucket>=cfg.whatsapp_live_canary_percent then
    return jsonb_build_object(
      'allow_ingest',true,
      'auto_reply_allowed',false,
      'reason','live_canary_human_control',
      'mode','live',
      'cohort','human_control',
      'bucket',v_bucket,
      'canary_percent',cfg.whatsapp_live_canary_percent
    );
  end if;

  if not v_existing then
    select count(*) into v_new_last_hour
      from public.conversations c
     where c.whatsapp_account_id is not null
       and c.created_at>=now()-interval '1 hour'
       and c.automation_cohort='ai_canary';

    if v_new_last_hour>=cfg.whatsapp_live_max_new_conversations_per_hour then
      return jsonb_build_object(
        'allow_ingest',true,
        'auto_reply_allowed',false,
        'reason','live_new_conversation_cap_human_control',
        'mode','live',
        'cohort','human_control',
        'bucket',v_bucket,
        'new_conversations_last_hour',v_new_last_hour
      );
    end if;
  end if;

  return jsonb_build_object(
    'allow_ingest',true,
    'auto_reply_allowed',true,
    'reason','live_canary_ai',
    'mode','live',
    'cohort','ai_canary',
    'bucket',v_bucket,
    'canary_percent',cfg.whatsapp_live_canary_percent
  );
end;
$$;

revoke all on function public.arm_whatsapp_observe_homologation_v1(text,integer) from public,anon,authenticated;
revoke all on function public.whatsapp_release_decision(text,timestamptz) from public,anon,authenticated;
grant execute on function public.arm_whatsapp_observe_homologation_v1(text,integer) to service_role;
grant execute on function public.whatsapp_release_decision(text,timestamptz) to service_role;

-- Migration nunca deixa uma homologação acidentalmente aberta.
select public.close_whatsapp_homologation_v1();

commit;
