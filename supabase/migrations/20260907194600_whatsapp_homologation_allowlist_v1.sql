begin;

alter table public.automation_config
  add column if not exists whatsapp_release_mode text not null default 'off';

alter table public.automation_config
  drop constraint if exists automation_config_whatsapp_release_mode_check;
alter table public.automation_config
  add constraint automation_config_whatsapp_release_mode_check
  check (whatsapp_release_mode in ('off','observe','homologation','live'));

comment on column public.automation_config.whatsapp_release_mode is
  'off=fecha canal; observe=persiste sem responder; homologation=aceita somente allowlist; live=canal geral sujeito aos demais gates.';

create table if not exists public.whatsapp_test_allowlist (
  phone_e164 text primary key,
  purpose text not null default 'homologation',
  enabled boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_test_allowlist_phone_check check (phone_e164 ~ '^\+[0-9]{10,15}$')
);

alter table public.whatsapp_test_allowlist enable row level security;
revoke all on table public.whatsapp_test_allowlist from anon,authenticated;
grant select,insert,update,delete on table public.whatsapp_test_allowlist to service_role;

create index if not exists whatsapp_test_allowlist_active_idx
  on public.whatsapp_test_allowlist(enabled,expires_at);

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
  v_cfg public.automation_config%rowtype;
  v_phone text;
  v_allowed boolean:=false;
begin
  select * into v_cfg from public.automation_config where id=1;
  if not found then
    return jsonb_build_object('allow_ingest',false,'reason','config_missing');
  end if;

  if not coalesce(v_cfg.whatsapp_inbound_enabled,false) or v_cfg.whatsapp_release_mode='off' then
    return jsonb_build_object('allow_ingest',false,'reason','whatsapp_inbound_disabled','mode',v_cfg.whatsapp_release_mode);
  end if;

  if p_message_timestamp is null or p_message_timestamp < v_cfg.whatsapp_inbound_since then
    return jsonb_build_object('allow_ingest',false,'reason','before_whatsapp_cutover','mode',v_cfg.whatsapp_release_mode);
  end if;

  if v_cfg.whatsapp_release_mode in ('observe','live') then
    return jsonb_build_object('allow_ingest',true,'reason','mode_allowed','mode',v_cfg.whatsapp_release_mode);
  end if;

  v_phone:='+'||public.normalize_phone_digits(p_from);
  select exists(
    select 1
    from public.whatsapp_test_allowlist a
    where a.phone_e164=v_phone
      and a.enabled=true
      and a.expires_at>now()
  ) into v_allowed;

  return jsonb_build_object(
    'allow_ingest',v_allowed,
    'reason',case when v_allowed then 'homologation_allowlist' else 'homologation_phone_blocked' end,
    'mode',v_cfg.whatsapp_release_mode
  );
end;
$$;

create or replace function public.arm_whatsapp_homologation_v1(
  p_phone text,
  p_minutes integer default 60
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
  v_minutes:=greatest(5,least(coalesce(p_minutes,60),180));
  v_expires:=now()+make_interval(mins=>v_minutes);

  update public.whatsapp_test_allowlist set enabled=false,updated_at=now() where enabled=true;
  insert into public.whatsapp_test_allowlist(phone_e164,purpose,enabled,expires_at)
  values(v_phone,'controlled_homologation',true,v_expires)
  on conflict(phone_e164) do update
    set purpose='controlled_homologation',enabled=true,expires_at=excluded.expires_at,updated_at=now();

  update public.automation_config
     set whatsapp_release_mode='homologation',
         whatsapp_inbound_enabled=true,
         whatsapp_auto_reply_enabled=true,
         whatsapp_inbound_since=now(),
         ai_enabled=false,
         conversation_worker_enabled=false,
         updated_at=now()
   where id=1;

  return jsonb_build_object(
    'mode','homologation','phone_e164',v_phone,'expires_at',v_expires,
    'ai_enabled',false,'conversation_worker_enabled',false
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
  update public.whatsapp_test_allowlist set enabled=false,updated_at=now() where enabled=true;
  update public.automation_config
     set whatsapp_release_mode='off',
         whatsapp_inbound_enabled=false,
         whatsapp_auto_reply_enabled=false,
         ai_enabled=false,
         conversation_worker_enabled=false,
         whatsapp_inbound_since=now(),
         updated_at=now()
   where id=1;
  return jsonb_build_object('mode','off','closed',true);
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

  select whatsapp_release_mode into v_mode from public.automation_config where id=1;
  if v_mode<>'homologation' then
    return jsonb_build_object('closed',false,'reason','not_homologation');
  end if;

  select exists(
    select 1 from public.whatsapp_test_allowlist where enabled=true and expires_at>now()
  ) into v_active;

  if not v_active then
    perform public.close_whatsapp_homologation_v1();
    return jsonb_build_object('closed',true,'reason','allowlist_expired');
  end if;

  return jsonb_build_object('closed',false,'reason','allowlist_active');
end;
$$;

revoke all on function public.whatsapp_release_decision(text,timestamptz) from public,anon,authenticated;
grant execute on function public.whatsapp_release_decision(text,timestamptz) to service_role;
revoke all on function public.arm_whatsapp_homologation_v1(text,integer) from public,anon,authenticated;
grant execute on function public.arm_whatsapp_homologation_v1(text,integer) to service_role;
revoke all on function public.close_whatsapp_homologation_v1() from public,anon,authenticated;
grant execute on function public.close_whatsapp_homologation_v1() to service_role;
revoke all on function public.expire_whatsapp_homologation_v1() from public,anon,authenticated;
grant execute on function public.expire_whatsapp_homologation_v1() to service_role;

do $$
begin
  if not exists(select 1 from cron.job where jobname='dona-antonia-whatsapp-homologation-expiry-v1') then
    perform cron.schedule(
      'dona-antonia-whatsapp-homologation-expiry-v1',
      '* * * * *',
      'select public.expire_whatsapp_homologation_v1();'
    );
  end if;
end;
$$;

-- Deploy sempre fecha o modo de release. A abertura e runtime-only via RPC service-role.
update public.automation_config
set whatsapp_release_mode='off',
    whatsapp_inbound_enabled=false,
    whatsapp_auto_reply_enabled=false,
    ai_enabled=false,
    conversation_worker_enabled=false,
    whatsapp_inbound_since=now(),
    updated_at=now()
where id=1;

commit;
