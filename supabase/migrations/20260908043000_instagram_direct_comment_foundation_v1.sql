begin;

-- ETAPA 6 — fundação dormente de Instagram Direct + comentários/private reply.
-- Não cria channel_accounts, não habilita Meta, não envia mensagens e não faz HTTP outbound.

create unique index if not exists conversations_instagram_open_identity_uidx
  on public.conversations(channel_account_id,external_user_id)
  where channel='instagram' and status<>'closed' and channel_account_id is not null and external_user_id is not null;

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

create table if not exists public.instagram_comment_events (
  id uuid primary key default gen_random_uuid(),
  normalized_event_id uuid not null unique references public.normalized_channel_events(id) on delete cascade,
  channel_account_id uuid not null references public.channel_accounts(id) on delete restrict,
  external_comment_id text not null,
  external_user_id text not null,
  media_id text,
  media_product_type text,
  parent_comment_id text,
  comment_text text,
  comment_created_at timestamptz not null,
  is_live boolean not null default false,
  intent text not null default 'unknown' check (intent in ('purchase_interest','question','support','spam','other','unknown')),
  intent_confidence numeric(5,4) check (intent_confidence is null or (intent_confidence>=0 and intent_confidence<=1)),
  intent_source text not null default 'unknown',
  private_reply_policy_eligible boolean not null default false,
  private_reply_eligible_until timestamptz,
  policy_version text not null default 'meta_instagram_private_reply_2026_09_08_v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel_account_id,external_comment_id)
);
create index if not exists instagram_comment_intent_idx
  on public.instagram_comment_events(intent,comment_created_at desc);
create index if not exists instagram_comment_user_idx
  on public.instagram_comment_events(channel_account_id,external_user_id,comment_created_at desc);
alter table public.instagram_comment_events enable row level security;
revoke all on public.instagram_comment_events from public,anon,authenticated;
grant select,insert,update on public.instagram_comment_events to service_role;

-- Um comentário só pode originar um private reply. Esta fila NÃO possui dispatcher nesta etapa.
create table if not exists public.instagram_private_reply_jobs (
  id uuid primary key default gen_random_uuid(),
  comment_event_id uuid not null unique references public.instagram_comment_events(id) on delete restrict,
  channel_account_id uuid not null references public.channel_accounts(id) on delete restrict,
  external_comment_id text not null,
  external_user_id text not null,
  intent text not null,
  draft_text text not null check (length(btrim(draft_text)) between 1 and 1000),
  status text not null default 'held' check (status in ('held','draft','approved','sent','expired','review_required','cancelled')),
  blocked_reason text,
  policy_eligible boolean not null default false,
  eligible_until timestamptz,
  approved_by_admin_user_id uuid,
  approved_at timestamptz,
  provider_message_id text,
  sent_at timestamptz,
  recipient_replied_at timestamptz,
  followup_window_expires_at timestamptz,
  policy_version text not null default 'meta_instagram_private_reply_2026_09_08_v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(channel_account_id,external_comment_id)
);
create index if not exists instagram_private_reply_status_idx
  on public.instagram_private_reply_jobs(status,eligible_until,created_at);
alter table public.instagram_private_reply_jobs enable row level security;
revoke all on public.instagram_private_reply_jobs from public,anon,authenticated;
grant select,insert,update on public.instagram_private_reply_jobs to service_role;

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
grant select,insert,update on public.instagram_conversation_windows to service_role;

create or replace function public.record_instagram_attribution_v1(p_normalized_event_id uuid)
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
    v_event.id,v_event.channel,v_event.channel_account_id,v_event.external_user_id,v_event.conversation_id,v_event.customer_id,v_touch,
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
revoke all on function public.record_instagram_attribution_v1(uuid) from public,anon,authenticated;
grant execute on function public.record_instagram_attribution_v1(uuid) to service_role;

create or replace function public.evaluate_instagram_private_reply_candidate_v1(p_comment_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_comment public.instagram_comment_events%rowtype;
  v_account public.channel_accounts%rowtype;
  v_deadline timestamptz;
  v_eligible boolean:=false;
  v_status text:='held';
  v_reason text;
  v_draft text;
  v_job uuid;
begin
  select * into v_comment from public.instagram_comment_events where id=p_comment_event_id for update;
  if not found then raise exception 'instagram_comment_not_found'; end if;
  select * into v_account from public.channel_accounts where id=v_comment.channel_account_id and channel='instagram';
  if not found then raise exception 'instagram_account_not_found'; end if;

  v_deadline:=v_comment.comment_created_at + interval '7 days';
  if v_comment.is_live then
    v_reason:='live_state_not_verified';
  elsif now()>v_deadline then
    v_status:='expired'; v_reason:='private_reply_window_expired';
  else
    v_eligible:=true;
    if v_account.status not in ('observe','active') or not v_account.inbound_enabled then
      v_reason:='instagram_observe_gate_closed';
    elsif not v_account.outbound_enabled then
      v_reason:='channel_outbound_disabled';
    elsif not v_account.auto_reply_enabled then
      v_status:='draft'; v_reason:='human_approval_required';
    else
      -- Mesmo com gates futuros abertos, esta etapa não possui dispatcher Meta.
      v_status:='draft'; v_reason:='dispatcher_not_released';
    end if;
  end if;

  v_draft:=case v_comment.intent
    when 'purchase_interest' then 'Oi! Vi seu comentário. Posso te ajudar por aqui com opções e disponibilidade. Se quiser continuar, responda esta mensagem.'
    when 'question' then 'Oi! Vi sua dúvida no comentário. Posso te explicar por aqui. Se quiser continuar, responda esta mensagem.'
    when 'support' then 'Oi! Vi seu comentário e quero entender melhor para ajudar. Se puder, responda esta mensagem com os detalhes.'
    else 'Oi! Vi seu comentário. Se quiser conversar com a Dona Antônia por aqui, responda esta mensagem.'
  end;

  update public.instagram_comment_events
     set private_reply_policy_eligible=v_eligible,
         private_reply_eligible_until=case when v_comment.is_live then null else v_deadline end,
         updated_at=now()
   where id=v_comment.id;

  insert into public.instagram_private_reply_jobs(
    comment_event_id,channel_account_id,external_comment_id,external_user_id,intent,draft_text,status,blocked_reason,policy_eligible,eligible_until
  ) values(
    v_comment.id,v_comment.channel_account_id,v_comment.external_comment_id,v_comment.external_user_id,v_comment.intent,v_draft,v_status,v_reason,v_eligible,
    case when v_comment.is_live then null else v_deadline end
  )
  on conflict(comment_event_id) do update set
    intent=excluded.intent,draft_text=excluded.draft_text,
    status=case when public.instagram_private_reply_jobs.status in ('sent','cancelled') then public.instagram_private_reply_jobs.status else excluded.status end,
    blocked_reason=case when public.instagram_private_reply_jobs.status in ('sent','cancelled') then public.instagram_private_reply_jobs.blocked_reason else excluded.blocked_reason end,
    policy_eligible=excluded.policy_eligible,eligible_until=excluded.eligible_until,updated_at=now()
  returning id into v_job;

  return jsonb_build_object('ok',true,'job_id',v_job,'status',v_status,'blocked_reason',v_reason,'policy_eligible',v_eligible,'eligible_until',case when v_comment.is_live then null else v_deadline end);
end;
$$;
revoke all on function public.evaluate_instagram_private_reply_candidate_v1(uuid) from public,anon,authenticated;
grant execute on function public.evaluate_instagram_private_reply_candidate_v1(uuid) to service_role;

create or replace function public.record_instagram_comment_event_v1(p_normalized_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.normalized_channel_events%rowtype;
  v_account public.channel_accounts%rowtype;
  v_comment uuid;
  v_intent text;
  v_conf numeric;
  v_source text;
  v_ref jsonb;
  v_is_live boolean;
  v_candidate jsonb;
begin
  select * into v_event from public.normalized_channel_events where id=p_normalized_event_id;
  if not found or v_event.channel<>'instagram' or v_event.message_type<>'comment' or v_event.direction<>'inbound' then
    raise exception 'instagram_comment_event_required';
  end if;
  if v_event.channel_account_id is null then raise exception 'instagram_account_required'; end if;
  select * into v_account from public.channel_accounts where id=v_event.channel_account_id and channel='instagram';
  if not found then raise exception 'instagram_account_not_found'; end if;

  v_ref:=coalesce(v_event.referral,'{}'::jsonb);
  v_intent:=lower(coalesce(nullif(v_event.context->>'comment_intent',''),'unknown'));
  if v_intent not in ('purchase_interest','question','support','spam','other','unknown') then v_intent:='unknown'; end if;
  begin v_conf:=(v_event.context->>'comment_intent_confidence')::numeric; exception when others then v_conf:=null; end;
  if v_conf is not null then v_conf:=greatest(0,least(1,v_conf)); end if;
  v_source:=coalesce(nullif(v_event.context->>'comment_intent_source',''),'unknown');
  v_is_live:=coalesce((v_event.context->>'is_live')::boolean,false);

  insert into public.instagram_comment_events(
    normalized_event_id,channel_account_id,external_comment_id,external_user_id,media_id,media_product_type,parent_comment_id,
    comment_text,comment_created_at,is_live,intent,intent_confidence,intent_source
  ) values(
    v_event.id,v_event.channel_account_id,coalesce(v_event.external_event_id,v_event.external_message_id),v_event.external_user_id,
    nullif(v_ref->>'media_id',''),nullif(v_ref->>'media_product_type',''),nullif(v_ref->>'parent_id',''),
    v_event.body_text,v_event.occurred_at,v_is_live,v_intent,v_conf,v_source
  )
  on conflict(channel_account_id,external_comment_id) do update set
    comment_text=excluded.comment_text,media_id=coalesce(excluded.media_id,public.instagram_comment_events.media_id),
    media_product_type=coalesce(excluded.media_product_type,public.instagram_comment_events.media_product_type),
    intent=excluded.intent,intent_confidence=excluded.intent_confidence,intent_source=excluded.intent_source,updated_at=now()
  returning id into v_comment;

  perform public.record_instagram_attribution_v1(v_event.id);
  v_candidate:=public.evaluate_instagram_private_reply_candidate_v1(v_comment);
  return jsonb_build_object('ok',true,'comment_event_id',v_comment,'candidate',v_candidate);
end;
$$;
revoke all on function public.record_instagram_comment_event_v1(uuid) from public,anon,authenticated;
grant execute on function public.record_instagram_comment_event_v1(uuid) to service_role;

create or replace function public.ensure_instagram_direct_human_v1(p_normalized_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.normalized_channel_events%rowtype;
  v_account public.channel_accounts%rowtype;
  v_customer uuid;
  v_conversation uuid;
  v_handoff uuid;
  v_source text;
  v_ref jsonb;
begin
  select * into v_event from public.normalized_channel_events where id=p_normalized_event_id for update;
  if not found or v_event.channel<>'instagram' or v_event.direction<>'inbound' or v_event.message_type='comment' then
    raise exception 'instagram_direct_event_required';
  end if;
  if v_event.channel_account_id is null then raise exception 'instagram_account_required'; end if;
  select * into v_account from public.channel_accounts where id=v_event.channel_account_id and channel='instagram';
  if not found then raise exception 'instagram_account_not_found'; end if;
  if v_account.status not in ('observe','active') or not v_account.inbound_enabled then
    return jsonb_build_object('ok',true,'held',true,'reason','instagram_observe_gate_closed');
  end if;

  insert into public.customer_channel_identities(customer_id,channel,channel_account_id,external_user_id,identity_kind,verification_status,evidence)
  values(null,'instagram',v_event.channel_account_id,v_event.external_user_id,'igsid','observed',jsonb_build_object('source','instagram_direct_webhook'))
  on conflict(channel,channel_account_id,external_user_id) do nothing;

  select customer_id into v_customer from public.customer_channel_identities
   where channel='instagram' and channel_account_id=v_event.channel_account_id and external_user_id=v_event.external_user_id
     and verification_status='verified' limit 1;

  select id into v_conversation from public.conversations
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
      select id into v_conversation from public.conversations
       where channel='instagram' and channel_account_id=v_event.channel_account_id and external_user_id=v_event.external_user_id and status<>'closed'
       order by updated_at desc limit 1;
    end;
  else
    update public.conversations set
      customer_id=coalesce(customer_id,v_customer),source=case when source='unknown' then v_source else source end,
      status='needs_human',mode='human',human_required=true,human_takeover_at=coalesce(human_takeover_at,now()),
      referral=coalesce(referral,'{}'::jsonb)||v_ref,last_inbound_at=greatest(coalesce(last_inbound_at,v_event.occurred_at),v_event.occurred_at),
      service_window_expires_at=greatest(coalesce(service_window_expires_at,v_event.occurred_at+interval '24 hours'),v_event.occurred_at+interval '24 hours'),
      updated_at=now()
    where id=v_conversation;
  end if;

  update public.normalized_channel_events
     set conversation_id=v_conversation,customer_id=coalesce(customer_id,v_customer),processing_status='accepted'
   where id=v_event.id;

  perform public.record_instagram_attribution_v1(v_event.id);
  update public.channel_attribution_events set conversation_id=v_conversation,customer_id=coalesce(customer_id,v_customer)
   where channel='instagram' and channel_account_id=v_event.channel_account_id and external_user_id=v_event.external_user_id
     and conversation_id is null and occurred_at>=v_event.occurred_at-interval '7 days';

  select id into v_handoff from public.human_handoffs
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
    conversation_id=excluded.conversation_id,last_inbound_at=greatest(coalesce(public.instagram_conversation_windows.last_inbound_at,excluded.last_inbound_at),excluded.last_inbound_at),
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
revoke all on function public.ensure_instagram_direct_human_v1(uuid) from public,anon,authenticated;
grant execute on function public.ensure_instagram_direct_human_v1(uuid) to service_role;

commit;
