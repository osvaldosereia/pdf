begin;

-- ETAPA 6 v2 — complementa a fundação já aplicada pela PR #190.
-- Não cria conta Meta, não liga gates e não implementa transporte Graph API.

alter table public.instagram_comment_observations
  add column if not exists comment_text text,
  add column if not exists comment_created_at timestamptz,
  add column if not exists is_live boolean not null default false,
  add column if not exists intent_source text not null default 'unknown';

alter table public.instagram_private_reply_jobs
  add column if not exists approved_by_admin_user_id uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists review_decision text check (review_decision is null or review_decision in ('approved','cancelled')),
  add column if not exists recipient_replied_at timestamptz,
  add column if not exists followup_window_expires_at timestamptz;

create table if not exists public.instagram_conversation_windows (
  id uuid primary key default gen_random_uuid(),
  channel_account_id uuid not null references public.channel_accounts(id) on delete cascade,
  external_user_id text not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  last_inbound_at timestamptz,
  private_reply_sent_at timestamptz,
  recipient_replied_at timestamptz,
  response_window_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel_account_id,external_user_id)
);
alter table public.instagram_conversation_windows enable row level security;
revoke all on public.instagram_conversation_windows from public,anon,authenticated;
grant select,insert,update,delete on public.instagram_conversation_windows to service_role;

create table if not exists public.channel_attribution_events (
  id uuid primary key default gen_random_uuid(),
  normalized_event_id uuid not null unique references public.normalized_channel_events(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','web','instagram','messenger','email')),
  channel_account_id uuid references public.channel_accounts(id) on delete restrict,
  external_user_id text not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  touchpoint_type text not null check (touchpoint_type in ('comment','direct','share','post','reel','story','live','ad','unknown')),
  external_content_id text,
  parent_content_id text,
  campaign_id text,
  adset_id text,
  ad_id text,
  creative_id text,
  referral jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists channel_attribution_identity_idx
  on public.channel_attribution_events(channel,channel_account_id,external_user_id,occurred_at desc);
create index if not exists channel_attribution_conversation_idx
  on public.channel_attribution_events(conversation_id,occurred_at desc)
  where conversation_id is not null;
alter table public.channel_attribution_events enable row level security;
revoke all on public.channel_attribution_events from public,anon,authenticated;
grant select,insert,update on public.channel_attribution_events to service_role;

create unique index if not exists conversations_instagram_open_identity_uidx
  on public.conversations(channel_account_id,external_user_id)
  where channel='instagram' and status<>'closed' and channel_account_id is not null and external_user_id is not null;

create or replace function public.record_instagram_attribution_v2(p_normalized_event_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.normalized_channel_events%rowtype;
  v_id uuid;
  v_touch text;
  v_ref jsonb;
  v_content text;
begin
  select * into v_event from public.normalized_channel_events where id=p_normalized_event_id;
  if not found or v_event.channel<>'instagram' then raise exception 'instagram_event_required'; end if;
  v_ref:=coalesce(v_event.referral,'{}'::jsonb);
  v_touch:=lower(coalesce(nullif(v_event.context->>'touchpoint_type',''),case when v_event.message_type='comment' then 'comment' else 'direct' end));
  if v_touch not in ('comment','direct','share','post','reel','story','live','ad','unknown') then v_touch:='unknown'; end if;
  v_content:=coalesce(nullif(v_ref->>'media_id',''),nullif(v_ref->>'post_id',''),nullif(v_ref->>'reel_id',''),nullif(v_ref->>'ad_id',''));

  insert into public.channel_attribution_events(
    normalized_event_id,channel,channel_account_id,external_user_id,conversation_id,customer_id,touchpoint_type,
    external_content_id,parent_content_id,campaign_id,adset_id,ad_id,creative_id,referral,occurred_at,metadata
  ) values(
    v_event.id,'instagram',v_event.channel_account_id,v_event.external_user_id,v_event.conversation_id,v_event.customer_id,v_touch,
    v_content,nullif(v_ref->>'parent_id',''),nullif(v_ref->>'campaign_id',''),nullif(v_ref->>'adset_id',''),nullif(v_ref->>'ad_id',''),nullif(v_ref->>'creative_id',''),
    v_ref,v_event.occurred_at,jsonb_build_object('source',v_event.source)
  )
  on conflict(normalized_event_id) do update set
    conversation_id=coalesce(excluded.conversation_id,public.channel_attribution_events.conversation_id),
    customer_id=coalesce(excluded.customer_id,public.channel_attribution_events.customer_id),
    referral=excluded.referral,
    metadata=public.channel_attribution_events.metadata||excluded.metadata
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.record_instagram_attribution_v2(uuid) from public,anon,authenticated;
grant execute on function public.record_instagram_attribution_v2(uuid) to service_role;

create or replace function public.ensure_instagram_direct_human_v2(p_normalized_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.normalized_channel_events%rowtype;
  v_account public.channel_accounts%rowtype;
  v_controls public.instagram_channel_controls%rowtype;
  v_customer uuid;
  v_conversation uuid;
  v_handoff uuid;
  v_ref jsonb;
  v_source text;
begin
  select * into v_event from public.normalized_channel_events where id=p_normalized_event_id for update;
  if not found or v_event.channel<>'instagram' or v_event.direction<>'inbound' or v_event.message_type='comment' then raise exception 'instagram_direct_event_required'; end if;
  if v_event.channel_account_id is null then raise exception 'instagram_account_required'; end if;

  select * into v_account from public.channel_accounts where id=v_event.channel_account_id and channel='instagram';
  if not found then raise exception 'instagram_account_not_found'; end if;
  select * into v_controls from public.instagram_channel_controls where channel_account_id=v_event.channel_account_id;
  if not found or not v_controls.webhook_ingest_enabled or not v_controls.direct_observe_enabled
     or v_account.status not in ('observe','active') or not v_account.inbound_enabled then
    return jsonb_build_object('ok',true,'held',true,'reason','instagram_direct_observe_disabled');
  end if;

  insert into public.customer_channel_identities(customer_id,channel,channel_account_id,external_user_id,identity_kind,verification_status,evidence)
  values(null,'instagram',v_event.channel_account_id,v_event.external_user_id,'igsid','observed',jsonb_build_object('source','instagram_direct_webhook'))
  on conflict(channel,channel_account_id,external_user_id) do nothing;

  select customer_id into v_customer
    from public.customer_channel_identities
   where channel='instagram' and channel_account_id=v_event.channel_account_id and external_user_id=v_event.external_user_id
     and verification_status='verified'
   limit 1;

  select id into v_conversation
    from public.conversations
   where channel='instagram' and channel_account_id=v_event.channel_account_id and external_user_id=v_event.external_user_id and status<>'closed'
   order by updated_at desc limit 1 for update;

  v_ref:=coalesce(v_event.referral,'{}'::jsonb);
  v_source:=case when nullif(v_ref->>'ad_id','') is not null then 'meta_ad' else 'organic' end;

  if v_conversation is null then
    begin
      insert into public.conversations(
        customer_id,source,status,stage,human_required,referral,last_inbound_at,service_window_expires_at,
        mode,human_takeover_at,channel,automation_cohort,channel_account_id,external_user_id
      ) values(
        v_customer,v_source,'needs_human','new',true,v_ref,v_event.occurred_at,v_event.occurred_at+interval '24 hours',
        'human',now(),'instagram','human_control',v_event.channel_account_id,v_event.external_user_id
      ) returning id into v_conversation;
    exception when unique_violation then
      select id into v_conversation
        from public.conversations
       where channel='instagram' and channel_account_id=v_event.channel_account_id and external_user_id=v_event.external_user_id and status<>'closed'
       order by updated_at desc limit 1;
    end;
  else
    update public.conversations set
      customer_id=coalesce(customer_id,v_customer),
      source=case when source='unknown' then v_source else source end,
      status='needs_human',mode='human',human_required=true,human_takeover_at=coalesce(human_takeover_at,now()),
      referral=coalesce(referral,'{}'::jsonb)||v_ref,
      last_inbound_at=greatest(coalesce(last_inbound_at,v_event.occurred_at),v_event.occurred_at),
      service_window_expires_at=greatest(coalesce(service_window_expires_at,v_event.occurred_at+interval '24 hours'),v_event.occurred_at+interval '24 hours'),
      updated_at=now()
    where id=v_conversation;
  end if;

  update public.normalized_channel_events
     set conversation_id=v_conversation,customer_id=coalesce(customer_id,v_customer),processing_status='accepted'
   where id=v_event.id;

  perform public.record_instagram_attribution_v2(v_event.id);
  update public.channel_attribution_events set conversation_id=v_conversation,customer_id=coalesce(customer_id,v_customer)
   where channel='instagram' and channel_account_id=v_event.channel_account_id and external_user_id=v_event.external_user_id
     and conversation_id is null and occurred_at>=v_event.occurred_at-interval '7 days';

  select id into v_handoff
    from public.human_handoffs
   where conversation_id=v_conversation and status in ('open','claimed')
   order by created_at desc limit 1;
  if v_handoff is null then
    insert into public.human_handoffs(conversation_id,customer_id,reason,priority,status,summary,context)
    values(v_conversation,v_customer,'instagram_direct_human_first',2::smallint,'open',left(coalesce(v_event.body_text,'Novo Direct no Instagram'),500),
      jsonb_build_object('normalized_event_id',v_event.id,'policy','human_first','source',v_event.source))
    returning id into v_handoff;
  end if;

  insert into public.instagram_conversation_windows(channel_account_id,external_user_id,conversation_id,last_inbound_at)
  values(v_event.channel_account_id,v_event.external_user_id,v_conversation,v_event.occurred_at)
  on conflict(channel_account_id,external_user_id) do update set
    conversation_id=excluded.conversation_id,
    last_inbound_at=greatest(coalesce(public.instagram_conversation_windows.last_inbound_at,excluded.last_inbound_at),excluded.last_inbound_at),
    recipient_replied_at=case
      when public.instagram_conversation_windows.private_reply_sent_at is not null and excluded.last_inbound_at>public.instagram_conversation_windows.private_reply_sent_at
      then excluded.last_inbound_at else public.instagram_conversation_windows.recipient_replied_at end,
    response_window_expires_at=case
      when public.instagram_conversation_windows.private_reply_sent_at is not null and excluded.last_inbound_at>public.instagram_conversation_windows.private_reply_sent_at
      then excluded.last_inbound_at+interval '24 hours' else public.instagram_conversation_windows.response_window_expires_at end,
    updated_at=now();

  return jsonb_build_object('ok',true,'conversation_id',v_conversation,'handoff_id',v_handoff,'mode','human','human_required',true);
end;
$$;
revoke all on function public.ensure_instagram_direct_human_v2(uuid) from public,anon,authenticated;
grant execute on function public.ensure_instagram_direct_human_v2(uuid) to service_role;

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
  v_intent text;
  v_intent_source text;
  v_conf numeric;
  v_is_live boolean:=false;
  v_human jsonb;
begin
  if p_kind not in ('direct','comment') then raise exception 'invalid_instagram_event_kind'; end if;
  select * into v_account from public.channel_accounts where id=p_channel_account_id and channel='instagram';
  if not found then raise exception 'instagram_channel_account_not_found'; end if;
  select * into v_controls from public.instagram_channel_controls where channel_account_id=p_channel_account_id;
  if not found or not v_controls.webhook_ingest_enabled then return jsonb_build_object('accepted',false,'reason','instagram_webhook_disabled'); end if;
  if v_account.status not in ('observe','active') or not v_account.inbound_enabled then return jsonb_build_object('accepted',false,'reason','instagram_account_inbound_disabled'); end if;
  if p_kind='direct' and not v_controls.direct_observe_enabled then return jsonb_build_object('accepted',false,'reason','instagram_direct_observe_disabled'); end if;
  if p_kind='comment' and not v_controls.comment_observe_enabled then return jsonb_build_object('accepted',false,'reason','instagram_comment_observe_disabled'); end if;

  p_event:=coalesce(p_event,'{}'::jsonb)||jsonb_build_object('channel','instagram','channel_account_id',p_channel_account_id::text,'direction','inbound');
  v_ingest:=public.ingest_normalized_channel_event_v1(p_event);
  v_event_id:=(v_ingest->>'id')::uuid;

  if p_kind='comment' then
    v_external_comment_id:=nullif(btrim(coalesce(p_event->>'external_message_id','')),'');
    v_external_user_id:=nullif(btrim(coalesce(p_event->>'external_user_id','')),'');
    v_external_media_id:=nullif(btrim(coalesce(p_event#>>'{referral,media_id}','')),'');
    if v_external_comment_id is null or v_external_user_id is null then raise exception 'instagram_comment_identity_required'; end if;
    v_intent:=lower(coalesce(nullif(p_event#>>'{context,comment_intent}',''),'other'));
    if v_intent not in ('purchase_interest','question','support','spam','other') then v_intent:='other'; end if;
    v_intent_source:=coalesce(nullif(p_event#>>'{context,comment_intent_source}',''),'unknown');
    begin v_conf:=(p_event#>>'{context,comment_intent_confidence}')::numeric; exception when others then v_conf:=null; end;
    if v_conf is not null then v_conf:=greatest(0,least(1,v_conf)); end if;
    begin v_is_live:=coalesce((p_event#>>'{context,is_live}')::boolean,false); exception when others then v_is_live:=false; end;

    insert into public.instagram_comment_observations(
      channel_account_id,normalized_event_id,external_comment_id,external_media_id,external_user_id,
      comment_text,comment_created_at,is_live,intent,intent_confidence,intent_source
    ) values(
      p_channel_account_id,v_event_id,v_external_comment_id,v_external_media_id,v_external_user_id,
      nullif(p_event->>'body_text',''),coalesce((p_event->>'timestamp')::timestamptz,now()),v_is_live,v_intent,v_conf,v_intent_source
    )
    on conflict(channel_account_id,external_comment_id) do update set
      normalized_event_id=excluded.normalized_event_id,
      external_media_id=coalesce(excluded.external_media_id,public.instagram_comment_observations.external_media_id),
      comment_text=excluded.comment_text,comment_created_at=excluded.comment_created_at,is_live=excluded.is_live,
      intent=excluded.intent,intent_confidence=excluded.intent_confidence,intent_source=excluded.intent_source,updated_at=now()
    returning id into v_observation_id;
    perform public.record_instagram_attribution_v2(v_event_id);
  else
    perform public.record_instagram_attribution_v2(v_event_id);
    v_human:=public.ensure_instagram_direct_human_v2(v_event_id);
  end if;

  return jsonb_build_object(
    'accepted',true,'kind',p_kind,'normalized_event_id',v_event_id,'comment_observation_id',v_observation_id,
    'human_control',v_human,'idempotent_replay',coalesce((v_ingest->>'idempotent_replay')::boolean,false)
  );
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
  v_existing public.instagram_private_reply_jobs%rowtype;
  v_job_id uuid;
  v_key text;
  v_expires timestamptz;
  v_reason text:='instagram_transport_not_enabled';
  v_state text:='held';
begin
  if nullif(btrim(coalesce(p_message_text,'')),'') is null then raise exception 'private_reply_message_required'; end if;
  if char_length(p_message_text)>1000 then raise exception 'private_reply_message_too_long'; end if;
  select * into v_obs from public.instagram_comment_observations where id=p_comment_observation_id for update;
  if not found then raise exception 'instagram_comment_observation_not_found'; end if;
  if v_obs.private_reply_job_id is not null then
    select * into v_existing from public.instagram_private_reply_jobs where id=v_obs.private_reply_job_id;
    return jsonb_build_object('id',v_obs.private_reply_job_id,'idempotent_replay',true,'state',coalesce(v_existing.state,'held'),'hold_reason',v_existing.hold_reason);
  end if;

  select * into v_controls from public.instagram_channel_controls where channel_account_id=v_obs.channel_account_id;
  select * into v_event from public.normalized_channel_events where id=v_obs.normalized_event_id;
  if v_obs.intent not in ('purchase_interest','question','support') then
    v_reason:='comment_intent_not_eligible';
  elsif v_obs.is_live then
    v_reason:='live_state_not_verified';
  elsif not found or not v_controls.private_reply_prepare_enabled then
    v_reason:='instagram_private_reply_prepare_disabled';
  elsif v_controls.policy_verified_at is null or v_controls.policy_version is null or v_controls.private_reply_window_seconds<=0 then
    v_reason:='meta_policy_not_verified';
  else
    v_expires:=v_event.occurred_at+make_interval(secs=>v_controls.private_reply_window_seconds);
    if v_expires<=now() then v_state:='expired';v_reason:='meta_private_reply_window_expired'; else v_reason:='human_approval_required'; end if;
  end if;

  v_key:=encode(extensions.digest((v_obs.channel_account_id::text||':'||v_obs.external_comment_id||':'||coalesce(v_controls.policy_version,'unverified'))::bytea,'sha256'),'hex');
  insert into public.instagram_private_reply_jobs(
    channel_account_id,comment_observation_id,recipient_external_user_id,external_comment_id,message_text,state,hold_reason,
    idempotency_key,requires_user_response,policy_version,policy_expires_at
  ) values(
    v_obs.channel_account_id,v_obs.id,v_obs.external_user_id,v_obs.external_comment_id,btrim(p_message_text),v_state,v_reason,
    v_key,true,v_controls.policy_version,v_expires
  )
  on conflict(comment_observation_id) do update set updated_at=now()
  returning id into v_job_id;
  update public.instagram_comment_observations set private_reply_job_id=v_job_id,review_status='human_review',updated_at=now() where id=v_obs.id;
  return jsonb_build_object('id',v_job_id,'state',v_state,'hold_reason',v_reason,'idempotent_replay',false,'sent',false);
end;
$$;
revoke all on function public.prepare_instagram_private_reply_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_instagram_private_reply_v1(uuid,text) to service_role;

create or replace function public.review_instagram_private_reply_v2(
  p_job_id uuid,
  p_admin_user_id uuid,
  p_decision text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_admin public.admin_users%rowtype;
  v_job public.instagram_private_reply_jobs%rowtype;
  v_obs public.instagram_comment_observations%rowtype;
  v_controls public.instagram_channel_controls%rowtype;
  v_account public.channel_accounts%rowtype;
  v_decision text:=lower(btrim(coalesce(p_decision,'')));
begin
  select * into v_admin from public.admin_users where user_id=p_admin_user_id and is_active=true;
  if not found or v_admin.role not in ('owner','operator') then raise exception 'admin_not_authorized'; end if;
  if v_decision not in ('approve','cancel') then raise exception 'invalid_review_decision'; end if;
  select * into v_job from public.instagram_private_reply_jobs where id=p_job_id for update;
  if not found then raise exception 'private_reply_job_not_found'; end if;
  if v_job.state='sent' then raise exception 'private_reply_already_sent'; end if;

  if v_decision='cancel' then
    update public.instagram_private_reply_jobs set state='cancelled',hold_reason='cancelled_by_operator',review_decision='cancelled',approved_by_admin_user_id=null,approved_at=null,updated_at=now() where id=v_job.id;
    return jsonb_build_object('ok',true,'job_id',v_job.id,'state','cancelled','sent',false);
  end if;
  if v_job.state='cancelled' then raise exception 'private_reply_cancelled'; end if;

  select * into v_obs from public.instagram_comment_observations where id=v_job.comment_observation_id;
  select * into v_controls from public.instagram_channel_controls where channel_account_id=v_job.channel_account_id;
  select * into v_account from public.channel_accounts where id=v_job.channel_account_id and channel='instagram';
  if not found then raise exception 'instagram_account_not_found'; end if;
  if v_obs.intent not in ('purchase_interest','question','support') then raise exception 'comment_intent_not_eligible'; end if;
  if v_obs.is_live then raise exception 'live_state_not_verified'; end if;
  if v_controls.policy_verified_at is null or v_controls.policy_version is null or v_controls.private_reply_window_seconds<=0 then raise exception 'meta_policy_not_verified'; end if;
  if v_job.policy_expires_at is null or now()>v_job.policy_expires_at then raise exception 'meta_private_reply_window_expired'; end if;
  if v_account.status not in ('observe','active') or not v_account.inbound_enabled then raise exception 'instagram_account_inbound_disabled'; end if;

  -- Aprovação é apenas decisão humana; o job continua held e sem dispatcher.
  update public.instagram_private_reply_jobs
     set state='held',hold_reason='instagram_transport_not_enabled',review_decision='approved',approved_by_admin_user_id=p_admin_user_id,approved_at=now(),updated_at=now()
   where id=v_job.id;
  return jsonb_build_object('ok',true,'job_id',v_job.id,'state','held','approved',true,'sent',false,'hold_reason','instagram_transport_not_enabled');
end;
$$;
revoke all on function public.review_instagram_private_reply_v2(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_instagram_private_reply_v2(uuid,uuid,text) to service_role;

create or replace function public.verify_instagram_policy_snapshot_v2(
  p_channel_account_id uuid,
  p_admin_user_id uuid,
  p_policy_version text,
  p_private_reply_window_seconds integer,
  p_confirmation text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_admin public.admin_users%rowtype;
begin
  select * into v_admin from public.admin_users where user_id=p_admin_user_id and is_active=true;
  if not found or v_admin.role<>'owner' then raise exception 'owner_required'; end if;
  if coalesce(p_confirmation,'')<>'CONFIRMAR_POLITICA_INSTAGRAM' then raise exception 'policy_confirmation_required'; end if;
  if p_policy_version is null or btrim(p_policy_version)='' then raise exception 'policy_version_required'; end if;
  if p_private_reply_window_seconds<1 or p_private_reply_window_seconds>604800 then raise exception 'invalid_private_reply_window'; end if;
  if not exists(select 1 from public.channel_accounts where id=p_channel_account_id and channel='instagram') then raise exception 'instagram_account_not_found'; end if;

  insert into public.instagram_channel_controls(channel_account_id,policy_version,policy_verified_at,private_reply_window_seconds)
  values(p_channel_account_id,btrim(p_policy_version),now(),p_private_reply_window_seconds)
  on conflict(channel_account_id) do update set policy_version=excluded.policy_version,policy_verified_at=excluded.policy_verified_at,
    private_reply_window_seconds=excluded.private_reply_window_seconds,updated_at=now();

  -- Não liga webhook, observe, prepare ou send.
  return jsonb_build_object('ok',true,'channel_account_id',p_channel_account_id,'policy_version',btrim(p_policy_version),
    'private_reply_window_seconds',p_private_reply_window_seconds,'gates_changed',false);
end;
$$;
revoke all on function public.verify_instagram_policy_snapshot_v2(uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.verify_instagram_policy_snapshot_v2(uuid,uuid,text,integer,text) to service_role;

create or replace view public.instagram_private_reply_review_v2
with (security_invoker=true)
as
select
  j.id as job_id,j.state,j.hold_reason,j.message_text,j.policy_version,j.policy_expires_at,j.requires_user_response,
  j.review_decision,j.approved_by_admin_user_id,j.approved_at,j.sent_at,j.external_message_id,
  o.id as observation_id,o.external_comment_id,o.external_media_id,o.external_user_id,o.comment_text,o.comment_created_at,o.is_live,
  o.intent,o.intent_confidence,o.intent_source,o.review_status,
  c.channel_account_id,c.policy_verified_at,c.private_reply_window_seconds,c.private_reply_prepare_enabled,c.private_reply_send_enabled,
  a.status as account_status,a.inbound_enabled,a.outbound_enabled,a.auto_reply_enabled,
  (o.intent in ('purchase_interest','question','support') and not o.is_live and c.policy_verified_at is not null
    and j.policy_expires_at>now() and a.status in ('observe','active') and a.inbound_enabled and j.state='held') as can_review
from public.instagram_private_reply_jobs j
join public.instagram_comment_observations o on o.id=j.comment_observation_id
join public.instagram_channel_controls c on c.channel_account_id=j.channel_account_id
join public.channel_accounts a on a.id=j.channel_account_id and a.channel='instagram';
revoke all on public.instagram_private_reply_review_v2 from public,anon,authenticated;
grant select on public.instagram_private_reply_review_v2 to service_role;

create or replace function public.get_instagram_stage6_metrics_v2()
returns jsonb
language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'accounts',(select count(*) from public.channel_accounts where channel='instagram'),
    'webhook_enabled_accounts',(select count(*) from public.instagram_channel_controls where webhook_ingest_enabled),
    'policy_verified_accounts',(select count(*) from public.instagram_channel_controls where policy_verified_at is not null),
    'comments',(select count(*) from public.instagram_comment_observations),
    'private_reply_jobs',(select count(*) from public.instagram_private_reply_jobs),
    'approved_reviews',(select count(*) from public.instagram_private_reply_jobs where review_decision='approved'),
    'private_reply_sent',(select count(*) from public.instagram_private_reply_jobs where state='sent'),
    'instagram_handoffs_active',(select count(*) from public.human_handoffs where channel='instagram' and status in ('open','claimed')),
    'attribution_events',(select count(*) from public.channel_attribution_events where channel='instagram'),
    'transport_implemented',false,
    'customer_runtime_released',false
  );
$$;
revoke all on function public.get_instagram_stage6_metrics_v2() from public,anon,authenticated;
grant execute on function public.get_instagram_stage6_metrics_v2() to service_role;

commit;
