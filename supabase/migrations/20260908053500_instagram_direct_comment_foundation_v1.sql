begin;

create table if not exists public.instagram_channel_controls (
  channel_account_id uuid primary key references public.channel_accounts(id) on delete cascade,
  webhook_ingest_enabled boolean not null default false,
  direct_observe_enabled boolean not null default false,
  comment_observe_enabled boolean not null default false,
  private_reply_prepare_enabled boolean not null default false,
  private_reply_send_enabled boolean not null default false,
  policy_version text,
  policy_verified_at timestamptz,
  private_reply_window_seconds integer not null default 0 check (private_reply_window_seconds between 0 and 604800),
  updated_at timestamptz not null default now(),
  constraint instagram_channel_controls_policy_check check (
    (policy_verified_at is null and private_reply_window_seconds=0)
    or (policy_verified_at is not null and policy_version is not null and private_reply_window_seconds>0)
  )
);
alter table public.instagram_channel_controls enable row level security;
revoke all on public.instagram_channel_controls from public,anon,authenticated;
grant select,insert,update,delete on public.instagram_channel_controls to service_role;

create table if not exists public.instagram_comment_observations (
  id uuid primary key default gen_random_uuid(),
  channel_account_id uuid not null references public.channel_accounts(id) on delete restrict,
  normalized_event_id uuid not null unique references public.normalized_channel_events(id) on delete cascade,
  external_comment_id text not null,
  external_media_id text,
  external_user_id text not null,
  intent text,
  intent_confidence numeric(5,4) check (intent_confidence is null or intent_confidence between 0 and 1),
  review_status text not null default 'observed' check (review_status in ('observed','candidate','ignored','human_review','expired')),
  private_reply_job_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel_account_id,external_comment_id)
);
create index if not exists instagram_comment_observations_media_idx on public.instagram_comment_observations(channel_account_id,external_media_id,created_at desc);
alter table public.instagram_comment_observations enable row level security;
revoke all on public.instagram_comment_observations from public,anon,authenticated;
grant select,insert,update,delete on public.instagram_comment_observations to service_role;

create table if not exists public.instagram_private_reply_jobs (
  id uuid primary key default gen_random_uuid(),
  channel_account_id uuid not null references public.channel_accounts(id) on delete restrict,
  comment_observation_id uuid not null unique references public.instagram_comment_observations(id) on delete cascade,
  recipient_external_user_id text not null,
  external_comment_id text not null,
  message_text text not null check (char_length(message_text) between 1 and 1000),
  state text not null default 'held' check (state in ('held','ready','dispatching','sent','review_required','cancelled','expired')),
  hold_reason text not null default 'instagram_transport_not_enabled',
  idempotency_key text not null unique check (idempotency_key ~ '^[a-f0-9]{64}$'),
  requires_user_response boolean not null default true,
  policy_version text,
  policy_expires_at timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 1),
  external_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists instagram_private_reply_jobs_state_idx on public.instagram_private_reply_jobs(state,created_at);
alter table public.instagram_private_reply_jobs enable row level security;
revoke all on public.instagram_private_reply_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.instagram_private_reply_jobs to service_role;

alter table public.instagram_comment_observations
  drop constraint if exists instagram_comment_observations_private_reply_job_id_fkey;
alter table public.instagram_comment_observations
  add constraint instagram_comment_observations_private_reply_job_id_fkey
  foreign key(private_reply_job_id) references public.instagram_private_reply_jobs(id) on delete set null;

create or replace function public.ingest_instagram_observation_v1(
  p_channel_account_id uuid,
  p_kind text,
  p_event jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_account public.channel_accounts%rowtype;
  v_controls public.instagram_channel_controls%rowtype;
  v_ingest jsonb;
  v_event_id uuid;
  v_observation_id uuid;
  v_external_comment_id text;
  v_external_media_id text;
  v_external_user_id text;
begin
  if p_kind not in ('direct','comment') then raise exception 'invalid_instagram_event_kind'; end if;

  select * into v_account from public.channel_accounts where id=p_channel_account_id and channel='instagram';
  if not found then raise exception 'instagram_channel_account_not_found'; end if;

  select * into v_controls from public.instagram_channel_controls where channel_account_id=p_channel_account_id;
  if not found or not v_controls.webhook_ingest_enabled then
    return jsonb_build_object('accepted',false,'reason','instagram_webhook_disabled');
  end if;
  if v_account.status not in ('observe','active') or not v_account.inbound_enabled then
    return jsonb_build_object('accepted',false,'reason','instagram_account_inbound_disabled');
  end if;
  if p_kind='direct' and not v_controls.direct_observe_enabled then
    return jsonb_build_object('accepted',false,'reason','instagram_direct_observe_disabled');
  end if;
  if p_kind='comment' and not v_controls.comment_observe_enabled then
    return jsonb_build_object('accepted',false,'reason','instagram_comment_observe_disabled');
  end if;

  p_event:=coalesce(p_event,'{}'::jsonb)
    || jsonb_build_object('channel','instagram','channel_account_id',p_channel_account_id::text,'direction','inbound');
  v_ingest:=public.ingest_normalized_channel_event_v1(p_event);
  v_event_id:=(v_ingest->>'id')::uuid;

  if p_kind='comment' then
    v_external_comment_id:=nullif(btrim(coalesce(p_event->>'external_message_id','')),'');
    v_external_user_id:=nullif(btrim(coalesce(p_event->>'external_user_id','')),'');
    v_external_media_id:=nullif(btrim(coalesce(p_event#>>'{referral,media_id}','')),'');
    if v_external_comment_id is null or v_external_user_id is null then raise exception 'instagram_comment_identity_required'; end if;

    insert into public.instagram_comment_observations(channel_account_id,normalized_event_id,external_comment_id,external_media_id,external_user_id)
    values(p_channel_account_id,v_event_id,v_external_comment_id,v_external_media_id,v_external_user_id)
    on conflict(channel_account_id,external_comment_id) do update
      set normalized_event_id=excluded.normalized_event_id,
          external_media_id=coalesce(excluded.external_media_id,public.instagram_comment_observations.external_media_id),
          updated_at=now()
    returning id into v_observation_id;
  end if;

  return jsonb_build_object('accepted',true,'kind',p_kind,'normalized_event_id',v_event_id,'comment_observation_id',v_observation_id,'idempotent_replay',coalesce((v_ingest->>'idempotent_replay')::boolean,false));
end;
$$;
revoke all on function public.ingest_instagram_observation_v1(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_instagram_observation_v1(uuid,text,jsonb) to service_role;

create or replace function public.prepare_instagram_private_reply_v1(
  p_comment_observation_id uuid,
  p_message_text text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_obs public.instagram_comment_observations%rowtype;
  v_controls public.instagram_channel_controls%rowtype;
  v_event public.normalized_channel_events%rowtype;
  v_job_id uuid;
  v_key text;
  v_expires timestamptz;
  v_reason text:='instagram_transport_not_enabled';
begin
  if nullif(btrim(coalesce(p_message_text,'')),'') is null then raise exception 'private_reply_message_required'; end if;
  if char_length(p_message_text)>1000 then raise exception 'private_reply_message_too_long'; end if;

  select * into v_obs from public.instagram_comment_observations where id=p_comment_observation_id for update;
  if not found then raise exception 'instagram_comment_observation_not_found'; end if;
  if v_obs.private_reply_job_id is not null then
    return jsonb_build_object('id',v_obs.private_reply_job_id,'idempotent_replay',true,'state','held');
  end if;

  select * into v_controls from public.instagram_channel_controls where channel_account_id=v_obs.channel_account_id;
  if not found or not v_controls.private_reply_prepare_enabled then
    v_reason:='instagram_private_reply_prepare_disabled';
  elsif v_controls.policy_verified_at is null or v_controls.policy_version is null or v_controls.private_reply_window_seconds<=0 then
    v_reason:='meta_policy_not_verified';
  else
    select * into v_event from public.normalized_channel_events where id=v_obs.normalized_event_id;
    v_expires:=v_event.occurred_at + make_interval(secs=>v_controls.private_reply_window_seconds);
    if v_expires<=now() then v_reason:='meta_private_reply_window_expired'; else v_reason:='instagram_transport_not_enabled'; end if;
  end if;

  v_key:=encode(extensions.digest((v_obs.channel_account_id::text||':'||v_obs.external_comment_id||':'||coalesce(v_controls.policy_version,'unverified'))::bytea,'sha256'),'hex');

  insert into public.instagram_private_reply_jobs(channel_account_id,comment_observation_id,recipient_external_user_id,external_comment_id,message_text,state,hold_reason,idempotency_key,requires_user_response,policy_version,policy_expires_at)
  values(v_obs.channel_account_id,v_obs.id,v_obs.external_user_id,v_obs.external_comment_id,btrim(p_message_text),'held',v_reason,v_key,true,v_controls.policy_version,v_expires)
  on conflict(comment_observation_id) do update set updated_at=now()
  returning id into v_job_id;

  update public.instagram_comment_observations set private_reply_job_id=v_job_id,review_status='human_review',updated_at=now() where id=v_obs.id;
  return jsonb_build_object('id',v_job_id,'state','held','hold_reason',v_reason,'idempotent_replay',false);
end;
$$;
revoke all on function public.prepare_instagram_private_reply_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_instagram_private_reply_v1(uuid,text) to service_role;

create or replace function public.get_instagram_readiness_v1()
returns jsonb
language sql security definer set search_path=''
as $$
  select jsonb_build_object(
    'accounts',coalesce((select count(*) from public.channel_accounts where channel='instagram'),0),
    'active_accounts',coalesce((select count(*) from public.channel_accounts where channel='instagram' and status='active'),0),
    'webhook_enabled_accounts',coalesce((select count(*) from public.instagram_channel_controls where webhook_ingest_enabled),0),
    'private_reply_send_enabled_accounts',coalesce((select count(*) from public.instagram_channel_controls where private_reply_send_enabled),0),
    'policy_verified_accounts',coalesce((select count(*) from public.instagram_channel_controls where policy_verified_at is not null),0),
    'comment_observations',coalesce((select count(*) from public.instagram_comment_observations),0),
    'private_reply_jobs',coalesce((select count(*) from public.instagram_private_reply_jobs),0),
    'ready_private_reply_jobs',coalesce((select count(*) from public.instagram_private_reply_jobs where state='ready'),0),
    'transport_implemented',false,
    'customer_runtime_released',false
  );
$$;
revoke all on function public.get_instagram_readiness_v1() from public,anon,authenticated;
grant execute on function public.get_instagram_readiness_v1() to service_role;

commit;
