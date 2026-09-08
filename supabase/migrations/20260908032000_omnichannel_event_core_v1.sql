begin;

alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check check (channel in ('whatsapp','web','hybrid','instagram','messenger'));

create table if not exists public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp','web','instagram','messenger','email')),
  external_account_id text not null,
  display_name text,
  status text not null default 'dormant' check (status in ('dormant','observe','active','disabled')),
  inbound_enabled boolean not null default false,
  ai_enabled boolean not null default false,
  auto_reply_enabled boolean not null default false,
  outbound_enabled boolean not null default false,
  canary_percent smallint not null default 0 check (canary_percent between 0 and 100),
  capabilities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel,external_account_id)
);
alter table public.channel_accounts enable row level security;
revoke all on public.channel_accounts from public,anon,authenticated;
grant select,insert,update,delete on public.channel_accounts to service_role;

create table if not exists public.customer_channel_identities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','web','instagram','messenger','email')),
  channel_account_id uuid references public.channel_accounts(id) on delete restrict,
  external_user_id text not null,
  identity_kind text not null check (identity_kind in ('e164','igsid','psid','web_subject','email','other')),
  verification_status text not null default 'observed' check (verification_status in ('observed','verified','conflicted','revoked')),
  verified_at timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel,channel_account_id,external_user_id)
);
create index if not exists customer_channel_identities_customer_idx on public.customer_channel_identities(customer_id,channel);
alter table public.customer_channel_identities enable row level security;
revoke all on public.customer_channel_identities from public,anon,authenticated;
grant select,insert,update,delete on public.customer_channel_identities to service_role;

create table if not exists public.channel_raw_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp','web','instagram','messenger','email')),
  channel_account_id uuid references public.channel_accounts(id) on delete restrict,
  external_event_id text,
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  storage_ref text,
  received_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
create unique index if not exists channel_raw_events_external_uidx on public.channel_raw_events(channel,channel_account_id,external_event_id) where external_event_id is not null;
alter table public.channel_raw_events enable row level security;
revoke all on public.channel_raw_events from public,anon,authenticated;
grant select,insert,update,delete on public.channel_raw_events to service_role;

create table if not exists public.normalized_channel_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp','web','instagram','messenger','email')),
  channel_account_id uuid references public.channel_accounts(id) on delete restrict,
  external_user_id text not null,
  external_message_id text,
  external_event_id text,
  direction text not null check (direction in ('inbound','outbound','system')),
  message_type text not null check (message_type in ('text','image','audio','video','document','location','reaction','post','comment','button','quick_reply','card','carousel','unknown')),
  reply_to_external_message_id text,
  source text not null default 'unknown',
  referral jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  raw_event_id uuid references public.channel_raw_events(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  body_text text,
  media_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(media_refs)='array'),
  context jsonb not null default '{}'::jsonb,
  processing_status text not null default 'normalized' check (processing_status in ('normalized','held','accepted','ignored','error')),
  created_at timestamptz not null default now(),
  constraint normalized_channel_events_external_identity_check check (external_message_id is not null or external_event_id is not null)
);
create unique index if not exists normalized_channel_events_message_uidx on public.normalized_channel_events(channel,channel_account_id,external_message_id,direction) where external_message_id is not null;
create unique index if not exists normalized_channel_events_event_uidx on public.normalized_channel_events(channel,channel_account_id,external_event_id,direction) where external_event_id is not null;
create index if not exists normalized_channel_events_conversation_idx on public.normalized_channel_events(conversation_id,occurred_at,id);
create index if not exists normalized_channel_events_customer_idx on public.normalized_channel_events(customer_id,occurred_at desc);
alter table public.normalized_channel_events enable row level security;
revoke all on public.normalized_channel_events from public,anon,authenticated;
grant select,insert,update,delete on public.normalized_channel_events to service_role;

create or replace function public.ingest_normalized_channel_event_v1(p_event jsonb)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_channel text:=lower(btrim(coalesce(p_event->>'channel','')));
  v_direction text:=lower(btrim(coalesce(p_event->>'direction','')));
  v_type text:=lower(btrim(coalesce(p_event->>'message_type','unknown')));
  v_account uuid;
  v_external_user text:=nullif(btrim(coalesce(p_event->>'external_user_id','')),'');
  v_message text:=nullif(btrim(coalesce(p_event->>'external_message_id','')),'');
  v_event text:=nullif(btrim(coalesce(p_event->>'external_event_id','')),'');
  v_id uuid;
  v_existing uuid;
  v_status text:='held';
  v_account_status text;
  v_inbound boolean:=false;
begin
  if v_channel not in ('whatsapp','web','instagram','messenger','email') then raise exception 'invalid_channel'; end if;
  if v_direction not in ('inbound','outbound','system') then raise exception 'invalid_direction'; end if;
  if v_external_user is null then raise exception 'external_user_id_required'; end if;
  if v_message is null and v_event is null then raise exception 'external_message_or_event_required'; end if;
  if v_type not in ('text','image','audio','video','document','location','reaction','post','comment','button','quick_reply','card','carousel','unknown') then v_type:='unknown'; end if;
  if nullif(p_event->>'channel_account_id','') is not null then v_account:=(p_event->>'channel_account_id')::uuid; end if;

  if v_message is not null then
    select id into v_existing from public.normalized_channel_events where channel=v_channel and channel_account_id is not distinct from v_account and external_message_id=v_message and direction=v_direction limit 1;
  end if;
  if v_existing is null and v_event is not null then
    select id into v_existing from public.normalized_channel_events where channel=v_channel and channel_account_id is not distinct from v_account and external_event_id=v_event and direction=v_direction limit 1;
  end if;
  if v_existing is not null then return jsonb_build_object('id',v_existing,'idempotent_replay',true); end if;

  if v_account is not null then
    select status,inbound_enabled into v_account_status,v_inbound from public.channel_accounts where id=v_account and channel=v_channel;
    if not found then raise exception 'channel_account_not_found'; end if;
    if v_direction='inbound' and v_account_status in ('observe','active') and v_inbound then v_status:='accepted'; end if;
  elsif v_channel='web' then
    v_status:='accepted';
  end if;

  insert into public.normalized_channel_events(channel,channel_account_id,external_user_id,external_message_id,external_event_id,direction,message_type,reply_to_external_message_id,source,referral,occurred_at,raw_event_id,conversation_id,customer_id,body_text,media_refs,context,processing_status)
  values(v_channel,v_account,v_external_user,v_message,v_event,v_direction,v_type,nullif(p_event->>'reply_to',''),coalesce(nullif(p_event->>'source',''),'unknown'),coalesce(p_event->'referral','{}'::jsonb),coalesce((p_event->>'timestamp')::timestamptz,now()),nullif(p_event->>'raw_event_id','')::uuid,nullif(p_event->>'conversation_id','')::uuid,nullif(p_event->>'customer_id','')::uuid,nullif(p_event->>'body_text',''),coalesce(p_event->'media_refs','[]'::jsonb),coalesce(p_event->'context','{}'::jsonb),v_status)
  returning id into v_id;
  return jsonb_build_object('id',v_id,'status',v_status,'idempotent_replay',false);
exception when unique_violation then
  select id into v_existing from public.normalized_channel_events where channel=v_channel and channel_account_id is not distinct from v_account and direction=v_direction and ((v_message is not null and external_message_id=v_message) or (v_event is not null and external_event_id=v_event)) order by created_at limit 1;
  if v_existing is not null then return jsonb_build_object('id',v_existing,'idempotent_replay',true); end if;
  raise;
end;
$$;
revoke all on function public.ingest_normalized_channel_event_v1(jsonb) from public,anon,authenticated;
grant execute on function public.ingest_normalized_channel_event_v1(jsonb) to service_role;

commit;
