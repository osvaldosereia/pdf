begin;

create table if not exists public.messenger_channel_controls (
  channel_account_id uuid primary key references public.channel_accounts(id) on delete cascade,
  webhook_ingest_enabled boolean not null default false,
  message_observe_enabled boolean not null default false,
  referral_observe_enabled boolean not null default false,
  conversations_api_read_enabled boolean not null default false,
  transport_send_enabled boolean not null default false,
  policy_verified_at timestamptz,
  policy_version text,
  max_outbound_per_minute integer not null default 0 check (max_outbound_per_minute between 0 and 600),
  updated_at timestamptz not null default now(),
  constraint messenger_channel_controls_policy_check check (
    (policy_verified_at is null and policy_version is null and transport_send_enabled=false)
    or (policy_verified_at is not null and nullif(btrim(policy_version),'') is not null)
  )
);

alter table public.messenger_channel_controls enable row level security;
revoke all on public.messenger_channel_controls from public, anon, authenticated;
grant select, insert, update, delete on public.messenger_channel_controls to service_role;

create table if not exists public.meta_channel_attribution_events (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('instagram','messenger')),
  channel_account_id uuid references public.channel_accounts(id) on delete set null,
  external_user_id text,
  normalized_event_id uuid references public.normalized_channel_events(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  source_type text not null default 'unknown',
  ad_id text,
  ref_code text,
  payload_hash text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(channel, channel_account_id, normalized_event_id)
);

create index if not exists meta_channel_attribution_events_conversation_idx on public.meta_channel_attribution_events(conversation_id, occurred_at desc);
create index if not exists meta_channel_attribution_events_ad_idx on public.meta_channel_attribution_events(ad_id) where ad_id is not null;
alter table public.meta_channel_attribution_events enable row level security;
revoke all on public.meta_channel_attribution_events from public, anon, authenticated;
grant select, insert, update, delete on public.meta_channel_attribution_events to service_role;

create or replace function public.get_messenger_stage7_readiness_v1()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'messenger_accounts', (select count(*) from public.channel_accounts where channel='messenger'),
    'messenger_controls', (select count(*) from public.messenger_channel_controls),
    'transport_enabled_accounts', (
      select count(*)
      from public.channel_accounts a
      join public.messenger_channel_controls c on c.channel_account_id=a.id
      where a.channel='messenger' and a.outbound_enabled=true and c.transport_send_enabled=true
    ),
    'policy_verified_accounts', (select count(*) from public.messenger_channel_controls where policy_verified_at is not null),
    'meta_attribution_events', (select count(*) from public.meta_channel_attribution_events),
    'transport_implemented', false,
    'default_state', 'off'
  );
$$;
revoke all on function public.get_messenger_stage7_readiness_v1() from public, anon, authenticated;
grant execute on function public.get_messenger_stage7_readiness_v1() to service_role;

commit;
