begin;

-- Homologação do Worker V2: abre somente um telefone allowlisted por tempo limitado.
-- A expiração/fechamento corta também o dispatcher novo.

create or replace function public.arm_whatsapp_homologation_ai_v2(
  p_phone text,
  p_minutes integer default 30
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
  if v_phone !~ '^\+[0-9]{10,15}$' then raise exception 'invalid_test_phone'; end if;

  v_minutes:=greatest(5,least(coalesce(p_minutes,30),90));
  v_expires:=now()+make_interval(mins=>v_minutes);

  update public.whatsapp_test_allowlist
     set enabled=false,updated_at=now()
   where enabled=true;

  insert into public.whatsapp_test_allowlist(phone_e164,purpose,enabled,expires_at)
  values(v_phone,'controlled_worker_v2_homologation',true,v_expires)
  on conflict(phone_e164) do update
    set purpose='controlled_worker_v2_homologation',enabled=true,
        expires_at=excluded.expires_at,updated_at=now();

  update public.automation_config
     set whatsapp_release_mode='homologation',
         whatsapp_inbound_enabled=true,
         whatsapp_auto_reply_enabled=true,
         whatsapp_inbound_since=now(),
         ai_enabled=true,
         conversation_worker_enabled=true,
         conversation_worker_dispatch_enabled=true,
         whatsapp_live_canary_percent=0,
         emergency_stop_reason=null,
         whatsapp_rollout_note='Worker V2 controlled homologation',
         updated_at=now()
   where id=1;

  insert into public.whatsapp_ops_events(event_type,severity,details)
  values('worker_v2_homologation_armed','warning',
    jsonb_build_object('expires_at',v_expires,'scope','single_allowlisted_phone'));

  return jsonb_build_object(
    'mode','homologation',
    'expires_at',v_expires,
    'ai_enabled',true,
    'conversation_worker_enabled',true,
    'conversation_worker_dispatch_enabled',true,
    'scope','single_allowlisted_phone'
  );
end;
$$;

create or replace function public.close_whatsapp_homologation_v1()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.whatsapp_test_allowlist
     set enabled=false,updated_at=now()
   where enabled=true;

  update public.automation_config
     set whatsapp_release_mode='off',
         whatsapp_inbound_enabled=false,
         whatsapp_auto_reply_enabled=false,
         ai_enabled=false,
         conversation_worker_enabled=false,
         conversation_worker_dispatch_enabled=false,
         whatsapp_live_canary_percent=0,
         whatsapp_inbound_since=now(),
         whatsapp_rollout_note=null,
         updated_at=now()
   where id=1;

  insert into public.whatsapp_ops_events(event_type,severity,details)
  values('homologation_closed','info',jsonb_build_object('all_worker_gates_closed',true));

  return jsonb_build_object(
    'mode','off','closed',true,
    'ai_enabled',false,
    'conversation_worker_enabled',false,
    'conversation_worker_dispatch_enabled',false
  );
end;
$$;

create or replace function public.expire_whatsapp_homologation_v1()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_mode text;
  v_active boolean;
begin
  update public.whatsapp_test_allowlist
     set enabled=false,updated_at=now()
   where enabled=true and expires_at<=now();

  select whatsapp_release_mode into v_mode
    from public.automation_config where id=1;

  if v_mode<>'homologation' then
    return jsonb_build_object('closed',false,'reason','not_homologation');
  end if;

  select exists(
    select 1 from public.whatsapp_test_allowlist
     where enabled=true and expires_at>now()
  ) into v_active;

  if not v_active then
    perform public.close_whatsapp_homologation_v1();
    return jsonb_build_object('closed',true,'reason','allowlist_expired','dispatcher_closed',true);
  end if;

  return jsonb_build_object('closed',false,'reason','allowlist_active');
end;
$$;

revoke all on function public.arm_whatsapp_homologation_ai_v2(text,integer) from public,anon,authenticated;
revoke all on function public.close_whatsapp_homologation_v1() from public,anon,authenticated;
revoke all on function public.expire_whatsapp_homologation_v1() from public,anon,authenticated;
grant execute on function public.arm_whatsapp_homologation_ai_v2(text,integer) to service_role;
grant execute on function public.close_whatsapp_homologation_v1() to service_role;
grant execute on function public.expire_whatsapp_homologation_v1() to service_role;

-- Deploy/migration nunca deixa uma homologação aberta.
select public.close_whatsapp_homologation_v1();

commit;
