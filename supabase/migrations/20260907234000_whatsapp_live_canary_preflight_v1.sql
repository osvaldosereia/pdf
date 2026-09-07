begin;

-- Preflight obrigatório antes de qualquer release live.
-- Não abre atendimento, não altera gates e não toca Bling/Meta/OpenAI.

create or replace function public.whatsapp_canary_bucket_v1(p_phone text)
returns smallint
language plpgsql
immutable
security definer
set search_path=''
as $$
declare
  v_phone text;
begin
  v_phone:='+'||public.normalize_phone_digits(p_phone);
  if v_phone !~ '^\+[0-9]{10,15}$' then
    raise exception 'invalid_phone';
  end if;
  return mod(abs(hashtext(v_phone)::bigint),100)::smallint;
end;
$$;

create or replace function public.whatsapp_live_preflight_v1(p_canary_percent smallint default 1)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  v_ai_active integer:=0;
  v_ai_review integer:=0;
  v_outbound_active integer:=0;
  v_outbound_review integer:=0;
  v_handoffs integer:=0;
  v_allowlist integer:=0;
  v_worker_secret boolean:=false;
  v_ingest_secret boolean:=false;
  v_provider_secret boolean:=false;
  v_canary_valid boolean:=false;
  v_release_clean boolean:=false;
  v_ready boolean:=false;
begin
  select * into cfg from public.automation_config where id=1;
  if not found then
    return jsonb_build_object('ready',false,'reason','config_missing');
  end if;

  v_canary_valid:=coalesce(p_canary_percent between 1 and 100,false);
  v_release_clean:=cfg.whatsapp_release_mode in ('off','observe','live');

  select count(*) into v_ai_active
    from public.ai_jobs
   where status in ('pending','processing');

  select count(*) into v_ai_review
    from public.ai_jobs
   where status in ('error','held')
     and coalesce(error_message,'') like '%review_required%';

  select count(*) into v_outbound_active
    from public.outbound_jobs
   where status in ('pending','processing');

  select count(*) into v_outbound_review
    from public.outbound_jobs
   where status='review_required'
      or coalesce(last_error,'') like '%review_required%';

  select count(*) into v_handoffs
    from public.human_handoffs
   where status in ('open','claimed');

  select count(*) into v_allowlist
    from public.whatsapp_test_allowlist
   where enabled=true and expires_at>now();

  select exists(
    select 1 from public.system_secrets
     where key_name='conversation_worker_webhook_v2' and is_active=true
  ) into v_worker_secret;

  select exists(
    select 1 from public.system_secrets
     where key_name='make_whatsapp_ingest' and is_active=true
  ) into v_ingest_secret;

  select exists(
    select 1 from public.system_secrets
     where key_name='openai_conversation_worker_v1' and is_active=true
  ) into v_provider_secret;

  v_ready:=
    v_canary_valid
    and v_release_clean
    and coalesce(cfg.automation_enabled,false)
    and coalesce(cfg.outbound_enabled,false)
    and coalesce(cfg.human_fallback_enabled,false)
    and cfg.emergency_stop_reason is null
    and v_ai_active=0
    and v_ai_review=0
    and v_outbound_active=0
    and v_outbound_review=0
    and v_handoffs=0
    and v_allowlist=0
    and v_worker_secret
    and v_ingest_secret
    and v_provider_secret;

  return jsonb_build_object(
    'ready',v_ready,
    'checked_at',now(),
    'requested_canary_percent',p_canary_percent,
    'release_mode',cfg.whatsapp_release_mode,
    'checks',jsonb_build_object(
      'canary_valid',v_canary_valid,
      'release_clean',v_release_clean,
      'automation_enabled',cfg.automation_enabled,
      'outbound_enabled',cfg.outbound_enabled,
      'human_fallback_enabled',cfg.human_fallback_enabled,
      'emergency_stop_clear',cfg.emergency_stop_reason is null,
      'worker_secret_configured',v_worker_secret,
      'ingest_secret_configured',v_ingest_secret,
      'provider_secret_configured',v_provider_secret
    ),
    'queues',jsonb_build_object(
      'ai_active',v_ai_active,
      'ai_review',v_ai_review,
      'outbound_active',v_outbound_active,
      'outbound_review',v_outbound_review,
      'human_handoffs_active',v_handoffs,
      'test_allowlist_active',v_allowlist
    )
  );
end;
$$;

create or replace function public.configure_whatsapp_release_v1(
  p_mode text,
  p_canary_percent smallint default 0,
  p_note text default null,
  p_confirmation text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  v_mode text:=lower(trim(coalesce(p_mode,'')));
  v_preflight jsonb:=null;
begin
  select * into cfg from public.automation_config where id=1 for update;
  if not found then raise exception 'config_missing'; end if;
  if v_mode not in ('off','observe','live') then raise exception 'invalid_release_mode'; end if;

  if v_mode='off' then
    update public.automation_config
       set whatsapp_release_mode='off',
           whatsapp_inbound_enabled=false,
           whatsapp_auto_reply_enabled=false,
           ai_enabled=false,
           conversation_worker_enabled=false,
           conversation_worker_dispatch_enabled=false,
           whatsapp_live_canary_percent=0,
           whatsapp_inbound_since=now(),
           whatsapp_rollout_note=left(p_note,500),
           updated_at=now()
     where id=1;
  elsif v_mode='observe' then
    update public.automation_config
       set whatsapp_release_mode='observe',
           whatsapp_inbound_enabled=true,
           whatsapp_auto_reply_enabled=false,
           ai_enabled=false,
           conversation_worker_enabled=false,
           conversation_worker_dispatch_enabled=false,
           whatsapp_live_canary_percent=0,
           whatsapp_inbound_since=now(),
           whatsapp_rollout_note=left(p_note,500),
           updated_at=now()
     where id=1;
  else
    if p_confirmation is distinct from 'LIBERAR_ATENDIMENTO_REAL' then
      raise exception 'live_confirmation_required';
    end if;
    if p_canary_percent<1 or p_canary_percent>100 then
      raise exception 'invalid_canary_percent';
    end if;

    v_preflight:=public.whatsapp_live_preflight_v1(p_canary_percent);
    if coalesce((v_preflight->>'ready')::boolean,false) is not true then
      raise exception 'live_preflight_failed' using detail=v_preflight::text;
    end if;

    update public.automation_config
       set whatsapp_release_mode='live',
           whatsapp_inbound_enabled=true,
           whatsapp_auto_reply_enabled=true,
           ai_enabled=true,
           conversation_worker_enabled=true,
           conversation_worker_dispatch_enabled=true,
           whatsapp_live_canary_percent=p_canary_percent,
           whatsapp_live_started_at=coalesce(whatsapp_live_started_at,now()),
           whatsapp_inbound_since=case when cfg.whatsapp_release_mode<>'live' then now() else whatsapp_inbound_since end,
           emergency_stop_reason=null,
           whatsapp_rollout_note=left(p_note,500),
           updated_at=now()
     where id=1;
  end if;

  insert into public.whatsapp_ops_events(event_type,severity,details)
  values(
    'release_configured',
    case when v_mode='live' then 'warning' else 'info' end,
    jsonb_build_object(
      'mode',v_mode,
      'canary_percent',case when v_mode='live' then p_canary_percent else 0 end,
      'preflight_passed',case when v_mode='live' then true else null end
    )
  );

  return public.get_whatsapp_bridge_health_v1()
    || case when v_preflight is null then '{}'::jsonb else jsonb_build_object('preflight',v_preflight) end;
end;
$$;

revoke all on function public.whatsapp_canary_bucket_v1(text) from public,anon,authenticated;
revoke all on function public.whatsapp_live_preflight_v1(smallint) from public,anon,authenticated;
revoke all on function public.configure_whatsapp_release_v1(text,smallint,text,text) from public,anon,authenticated;
grant execute on function public.whatsapp_canary_bucket_v1(text) to service_role;
grant execute on function public.whatsapp_live_preflight_v1(smallint) to service_role;
grant execute on function public.configure_whatsapp_release_v1(text,smallint,text,text) to service_role;

-- Esta migration deliberadamente não altera o release atual.
commit;
