begin;

-- ETAPA 5 — CRM unificado, identidades e caixa de entrada única.
-- Tudo nasce server-only/fail-closed. Esta migration não cria contas Meta,
-- não habilita canais e não retoma IA em handoffs humanos.

-- 1) Conversa deixa de depender estruturalmente de uma conta WhatsApp.
alter table public.conversations
  alter column whatsapp_account_id drop not null;

alter table public.conversations
  add column if not exists channel_account_id uuid references public.channel_accounts(id) on delete restrict,
  add column if not exists external_user_id text;

create index if not exists conversations_channel_identity_idx
  on public.conversations(channel,channel_account_id,external_user_id)
  where external_user_id is not null;

alter table public.conversations drop constraint if exists conversations_channel_identity_v1_check;
alter table public.conversations add constraint conversations_channel_identity_v1_check check (
  (channel='whatsapp' and whatsapp_account_id is not null)
  or (channel in ('instagram','messenger') and channel_account_id is not null and nullif(btrim(external_user_id),'') is not null)
  or channel in ('web','hybrid')
) not valid;
alter table public.conversations validate constraint conversations_channel_identity_v1_check;

-- 2) Identidades observadas podem existir antes de um vínculo confirmado.
alter table public.customer_channel_identities
  alter column customer_id drop not null;

alter table public.customer_channel_identities
  add column if not exists linked_at timestamptz,
  add column if not exists linked_by_admin_user_id uuid;

create unique index if not exists customer_channel_identity_null_account_uidx
  on public.customer_channel_identities(channel,external_user_id)
  where channel_account_id is null;

alter table public.customer_channel_identities drop constraint if exists customer_channel_identity_verified_link_check;
alter table public.customer_channel_identities add constraint customer_channel_identity_verified_link_check check (
  verification_status <> 'verified'
  or (customer_id is not null and verified_at is not null)
) not valid;
alter table public.customer_channel_identities validate constraint customer_channel_identity_verified_link_check;

-- 3) E-mails do CRM, separados de consentimento e sem auto-unificação por nome.
create table if not exists public.customer_emails (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  verification_status text not null default 'observed' check (verification_status in ('observed','verified','conflicted','revoked')),
  is_primary boolean not null default false,
  source text not null default 'observed',
  evidence jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  linked_at timestamptz,
  linked_by_admin_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(email_normalized) between 3 and 320),
  check (position('@' in email_normalized)>1),
  check (verification_status <> 'verified' or (customer_id is not null and verified_at is not null))
);
create unique index if not exists customer_emails_verified_uidx
  on public.customer_emails(email_normalized)
  where verification_status='verified';
create unique index if not exists customer_emails_primary_uidx
  on public.customer_emails(customer_id)
  where is_primary=true and verification_status='verified';
create index if not exists customer_emails_customer_idx
  on public.customer_emails(customer_id,verification_status,created_at desc);
alter table public.customer_emails enable row level security;
revoke all on public.customer_emails from public,anon,authenticated;
grant select,insert,update,delete on public.customer_emails to service_role;

-- 4) Consentimento separado por canal/finalidade. Nada aqui ativa marketing.
create table if not exists public.customer_channel_consents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','web','instagram','messenger','email')),
  channel_identity_id uuid references public.customer_channel_identities(id) on delete cascade,
  customer_email_id uuid references public.customer_emails(id) on delete cascade,
  purpose text not null check (purpose in ('service','transactional','marketing')),
  status text not null default 'unknown' check (status in ('unknown','granted','denied','revoked')),
  source text not null default 'system',
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (num_nonnulls(channel_identity_id,customer_email_id)<=1)
);
create unique index if not exists customer_channel_consents_identity_uidx
  on public.customer_channel_consents(customer_id,channel,purpose,channel_identity_id)
  where channel_identity_id is not null;
create unique index if not exists customer_channel_consents_email_uidx
  on public.customer_channel_consents(customer_id,channel,purpose,customer_email_id)
  where customer_email_id is not null;
create unique index if not exists customer_channel_consents_global_uidx
  on public.customer_channel_consents(customer_id,channel,purpose)
  where channel_identity_id is null and customer_email_id is null;
alter table public.customer_channel_consents enable row level security;
revoke all on public.customer_channel_consents from public,anon,authenticated;
grant select,insert,update,delete on public.customer_channel_consents to service_role;

-- 5) Auditoria de vínculos de identidade. Evidência deve ser hash/referência, nunca segredo cru.
create table if not exists public.customer_identity_link_events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  identity_type text not null check (identity_type in ('channel','email')),
  channel_identity_id uuid references public.customer_channel_identities(id) on delete set null,
  customer_email_id uuid references public.customer_emails(id) on delete set null,
  action text not null check (action in ('confirmed','conflicted','revoked')),
  evidence_type text not null check (evidence_type in ('verified_phone_challenge','verified_email_challenge','authenticated_session','provider_verified_login','manual_documented')),
  evidence_ref_hash text not null check (evidence_ref_hash ~ '^[a-f0-9]{64}$'),
  actor_admin_user_id uuid not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  check (
    (identity_type='channel' and channel_identity_id is not null and customer_email_id is null)
    or (identity_type='email' and customer_email_id is not null and channel_identity_id is null)
  )
);
create index if not exists customer_identity_link_events_customer_idx
  on public.customer_identity_link_events(customer_id,occurred_at desc);
alter table public.customer_identity_link_events enable row level security;
revoke all on public.customer_identity_link_events from public,anon,authenticated;
grant select,insert on public.customer_identity_link_events to service_role;

create or replace function public.confirm_customer_channel_identity_v1(
  p_identity_id uuid,
  p_customer_id uuid,
  p_evidence_type text,
  p_evidence_ref_hash text,
  p_actor_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_identity public.customer_channel_identities%rowtype;
  v_admin public.admin_users%rowtype;
  v_type text:=lower(btrim(coalesce(p_evidence_type,'')));
  v_hash text:=lower(btrim(coalesce(p_evidence_ref_hash,'')));
begin
  select * into v_admin from public.admin_users where user_id=p_actor_admin_user_id and is_active=true;
  if not found or v_admin.role not in ('owner','operator') then raise exception 'admin_not_authorized'; end if;
  if p_customer_id is null or not exists(select 1 from public.customers where id=p_customer_id) then raise exception 'customer_not_found'; end if;
  if v_type not in ('verified_phone_challenge','authenticated_session','provider_verified_login','manual_documented') then raise exception 'unsafe_identity_evidence'; end if;
  if v_hash !~ '^[a-f0-9]{64}$' then raise exception 'evidence_hash_required'; end if;

  select * into v_identity from public.customer_channel_identities where id=p_identity_id for update;
  if not found then raise exception 'identity_not_found'; end if;
  if v_identity.verification_status='revoked' then raise exception 'identity_revoked'; end if;
  if v_identity.customer_id is not null and v_identity.customer_id<>p_customer_id then raise exception 'identity_already_linked'; end if;

  update public.customer_channel_identities
     set customer_id=p_customer_id,
         verification_status='verified',
         verified_at=coalesce(verified_at,now()),
         linked_at=now(),
         linked_by_admin_user_id=p_actor_admin_user_id,
         evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('evidence_type',v_type,'evidence_ref_hash',v_hash),
         updated_at=now()
   where id=p_identity_id;

  insert into public.customer_identity_link_events(customer_id,identity_type,channel_identity_id,action,evidence_type,evidence_ref_hash,actor_admin_user_id)
  values(p_customer_id,'channel',p_identity_id,'confirmed',v_type,v_hash,p_actor_admin_user_id);

  return jsonb_build_object('ok',true,'identity_id',p_identity_id,'customer_id',p_customer_id,'verification_status','verified');
end;
$$;
revoke all on function public.confirm_customer_channel_identity_v1(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.confirm_customer_channel_identity_v1(uuid,uuid,text,text,uuid) to service_role;

create or replace function public.confirm_customer_email_v1(
  p_email_id uuid,
  p_customer_id uuid,
  p_evidence_type text,
  p_evidence_ref_hash text,
  p_actor_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_email public.customer_emails%rowtype;
  v_admin public.admin_users%rowtype;
  v_type text:=lower(btrim(coalesce(p_evidence_type,'')));
  v_hash text:=lower(btrim(coalesce(p_evidence_ref_hash,'')));
begin
  select * into v_admin from public.admin_users where user_id=p_actor_admin_user_id and is_active=true;
  if not found or v_admin.role not in ('owner','operator') then raise exception 'admin_not_authorized'; end if;
  if p_customer_id is null or not exists(select 1 from public.customers where id=p_customer_id) then raise exception 'customer_not_found'; end if;
  if v_type not in ('verified_email_challenge','authenticated_session','provider_verified_login','manual_documented') then raise exception 'unsafe_email_evidence'; end if;
  if v_hash !~ '^[a-f0-9]{64}$' then raise exception 'evidence_hash_required'; end if;

  select * into v_email from public.customer_emails where id=p_email_id for update;
  if not found then raise exception 'email_not_found'; end if;
  if v_email.verification_status='revoked' then raise exception 'email_revoked'; end if;
  if v_email.customer_id is not null and v_email.customer_id<>p_customer_id then raise exception 'email_already_linked'; end if;
  if exists(select 1 from public.customer_emails e where e.id<>p_email_id and e.email_normalized=v_email.email_normalized and e.verification_status='verified' and e.customer_id<>p_customer_id) then
    raise exception 'email_verified_for_other_customer';
  end if;

  update public.customer_emails
     set customer_id=p_customer_id,
         verification_status='verified',
         verified_at=coalesce(verified_at,now()),
         linked_at=now(),
         linked_by_admin_user_id=p_actor_admin_user_id,
         evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object('evidence_type',v_type,'evidence_ref_hash',v_hash),
         updated_at=now()
   where id=p_email_id;

  insert into public.customer_identity_link_events(customer_id,identity_type,customer_email_id,action,evidence_type,evidence_ref_hash,actor_admin_user_id)
  values(p_customer_id,'email',p_email_id,'confirmed',v_type,v_hash,p_actor_admin_user_id);

  return jsonb_build_object('ok',true,'email_id',p_email_id,'customer_id',p_customer_id,'verification_status','verified');
end;
$$;
revoke all on function public.confirm_customer_email_v1(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.confirm_customer_email_v1(uuid,uuid,text,text,uuid) to service_role;

-- 6) Handoff é generalizado por canal e ganha SLA sem alterar estado dos atuais.
alter table public.human_handoffs
  add column if not exists channel text,
  add column if not exists channel_account_id uuid references public.channel_accounts(id) on delete restrict,
  add column if not exists first_response_at timestamptz,
  add column if not exists last_operator_reply_at timestamptz,
  add column if not exists sla_due_at timestamptz;

update public.human_handoffs h
   set channel=c.channel,
       channel_account_id=c.channel_account_id,
       sla_due_at=coalesce(h.sla_due_at,h.created_at + case when h.priority>=3 then interval '5 minutes' when h.priority=2 then interval '15 minutes' else interval '30 minutes' end)
  from public.conversations c
 where c.id=h.conversation_id
   and (h.channel is null or h.sla_due_at is null);

alter table public.human_handoffs alter column channel set not null;
alter table public.human_handoffs drop constraint if exists human_handoffs_channel_check;
alter table public.human_handoffs add constraint human_handoffs_channel_check check (channel in ('whatsapp','web','hybrid','instagram','messenger'));
create index if not exists human_handoffs_unified_inbox_idx
  on public.human_handoffs(status,channel,priority desc,sla_due_at,created_at)
  where status in ('open','claimed');

create or replace function public.sync_handoff_channel_context_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_channel text;
  v_account uuid;
begin
  select c.channel,c.channel_account_id into v_channel,v_account from public.conversations c where c.id=new.conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  new.channel:=v_channel;
  new.channel_account_id:=v_account;
  if new.sla_due_at is null then
    new.sla_due_at:=coalesce(new.created_at,now()) + case when new.priority>=3 then interval '5 minutes' when new.priority=2 then interval '15 minutes' else interval '30 minutes' end;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_handoff_channel_context_v1() from public,anon,authenticated;
drop trigger if exists human_handoffs_channel_context_v1 on public.human_handoffs;
create trigger human_handoffs_channel_context_v1
before insert or update of conversation_id,priority on public.human_handoffs
for each row execute function public.sync_handoff_channel_context_v1();

-- 7) Respostas humanas pelo Admin possuem fila separada da IA.
create table if not exists public.operator_reply_jobs (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  handoff_id uuid not null references public.human_handoffs(id) on delete restrict,
  channel text not null check (channel in ('whatsapp','web','hybrid','instagram','messenger')),
  channel_account_id uuid references public.channel_accounts(id) on delete restrict,
  admin_user_id uuid not null,
  body_text text not null check (length(btrim(body_text)) between 1 and 4096),
  status text not null default 'held' check (status in ('held','pending','dispatching','sent','review_required','cancelled')),
  blocked_reason text,
  provider_message_id text,
  dispatch_request_id bigint,
  dispatch_response_status integer,
  dispatch_response jsonb,
  dispatched_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists operator_reply_jobs_status_idx on public.operator_reply_jobs(status,created_at);
create index if not exists operator_reply_jobs_conversation_idx on public.operator_reply_jobs(conversation_id,created_at desc);
alter table public.operator_reply_jobs enable row level security;
revoke all on public.operator_reply_jobs from public,anon,authenticated;
grant select,insert,update on public.operator_reply_jobs to service_role;

create or replace function public.dispatch_operator_reply_whatsapp_v1(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.operator_reply_jobs%rowtype;
  v_conv public.conversations%rowtype;
  v_handoff public.human_handoffs%rowtype;
  v_cfg public.automation_config%rowtype;
  v_webhook text;
  v_request_id bigint;
begin
  select * into v_job from public.operator_reply_jobs where id=p_job_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','job_not_found'); end if;
  if v_job.status<>'pending' then return jsonb_build_object('ok',true,'skipped','job_not_pending'); end if;

  select * into v_conv from public.conversations where id=v_job.conversation_id;
  select * into v_handoff from public.human_handoffs where id=v_job.handoff_id;
  if v_conv.channel<>'whatsapp' or v_job.channel<>'whatsapp' then
    update public.operator_reply_jobs set status='held',blocked_reason='channel_transport_not_enabled',updated_at=now() where id=v_job.id;
    return jsonb_build_object('ok',true,'skipped','channel_transport_not_enabled');
  end if;
  if v_conv.mode<>'human' or not v_conv.human_required or v_handoff.status<>'claimed' or v_handoff.claimed_by is distinct from v_job.admin_user_id then
    update public.operator_reply_jobs set status='held',blocked_reason='human_control_not_owned',updated_at=now() where id=v_job.id;
    return jsonb_build_object('ok',true,'skipped','human_control_not_owned');
  end if;
  if v_conv.service_window_expires_at is null or v_conv.service_window_expires_at<=now() then
    update public.operator_reply_jobs set status='held',blocked_reason='service_window_closed',updated_at=now() where id=v_job.id;
    return jsonb_build_object('ok',true,'skipped','service_window_closed');
  end if;

  select * into v_cfg from public.automation_config where id=1;
  if not coalesce(v_cfg.automation_enabled and v_cfg.outbound_enabled and v_cfg.whatsapp_inbound_enabled,false) then
    update public.operator_reply_jobs set status='held',blocked_reason='whatsapp_outbound_gate_closed',updated_at=now() where id=v_job.id;
    return jsonb_build_object('ok',true,'skipped','whatsapp_outbound_gate_closed');
  end if;

  select decrypted_secret into v_webhook from vault.decrypted_secrets
   where name='dona_antonia_whatsapp_outbound_make_webhook' order by created_at desc limit 1;
  if nullif(v_webhook,'') is null then
    update public.operator_reply_jobs set status='held',blocked_reason='transport_unavailable',updated_at=now() where id=v_job.id;
    return jsonb_build_object('ok',false,'reason','transport_unavailable');
  end if;

  update public.operator_reply_jobs
     set status='dispatching',blocked_reason=null,dispatched_at=now(),updated_at=now()
   where id=v_job.id;

  begin
    v_request_id:=net.http_post(
      url:=v_webhook,
      body:=jsonb_build_object(
        'event','outbound_delivery',
        'protocol_version',3,
        'job',jsonb_build_object(
          'id',v_job.id::text,
          'conversation_id',v_job.conversation_id::text,
          'recipient_e164',v_conv.wa_contact_e164,
          'attempt',1,
          'delivery_mode','text',
          'body_text',left(v_job.body_text,4096),
          'reply_message_id',null
        )
      ),
      headers:='{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds:=30000
    );
  exception when others then
    update public.operator_reply_jobs set status='review_required',blocked_reason='dispatch_enqueue_uncertain',updated_at=now() where id=v_job.id;
    return jsonb_build_object('ok',false,'reason','dispatch_enqueue_uncertain');
  end;

  update public.operator_reply_jobs set dispatch_request_id=v_request_id,updated_at=now() where id=v_job.id;
  return jsonb_build_object('ok',true,'job_id',v_job.id,'request_id',v_request_id,'status','dispatching');
end;
$$;
revoke all on function public.dispatch_operator_reply_whatsapp_v1(uuid) from public,anon,authenticated;
grant execute on function public.dispatch_operator_reply_whatsapp_v1(uuid) to service_role;

create or replace function public.queue_operator_reply_v1(
  p_conversation_id uuid,
  p_admin_user_id uuid,
  p_body_text text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin public.admin_users%rowtype;
  v_conv public.conversations%rowtype;
  v_handoff public.human_handoffs%rowtype;
  v_body text:=btrim(coalesce(p_body_text,''));
  v_job_id uuid;
  v_status text:='held';
  v_reason text;
  v_dispatch jsonb;
begin
  select * into v_admin from public.admin_users where user_id=p_admin_user_id and is_active=true;
  if not found or v_admin.role not in ('owner','operator') then raise exception 'admin_not_authorized'; end if;
  if length(v_body)<1 or length(v_body)>4096 then raise exception 'invalid_message_body'; end if;

  select * into v_conv from public.conversations where id=p_conversation_id for update;
  if not found then raise exception 'conversation_not_found'; end if;
  if v_conv.mode<>'human' or not v_conv.human_required then raise exception 'conversation_not_in_human_control'; end if;

  select * into v_handoff from public.human_handoffs
   where conversation_id=p_conversation_id and status in ('open','claimed')
   order by created_at desc limit 1 for update;
  if not found then raise exception 'active_handoff_required'; end if;
  if v_handoff.status='open' then raise exception 'handoff_must_be_claimed'; end if;
  if v_handoff.claimed_by is distinct from p_admin_user_id then raise exception 'handoff_claimed_by_other'; end if;

  if v_conv.channel='whatsapp' then
    v_status:='pending';
  else
    v_status:='held';
    v_reason:='channel_transport_not_enabled';
  end if;

  insert into public.operator_reply_jobs(conversation_id,customer_id,handoff_id,channel,channel_account_id,admin_user_id,body_text,status,blocked_reason)
  values(v_conv.id,v_conv.customer_id,v_handoff.id,v_conv.channel,v_conv.channel_account_id,p_admin_user_id,v_body,v_status,v_reason)
  returning id into v_job_id;

  if v_status='pending' then
    v_dispatch:=public.dispatch_operator_reply_whatsapp_v1(v_job_id);
  else
    v_dispatch:=jsonb_build_object('ok',true,'skipped',v_reason);
  end if;

  return jsonb_build_object('ok',true,'job_id',v_job_id,'channel',v_conv.channel,'dispatch',v_dispatch);
end;
$$;
revoke all on function public.queue_operator_reply_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.queue_operator_reply_v1(uuid,uuid,text) to service_role;

create or replace function public.reconcile_operator_reply_responses_v1()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.operator_reply_jobs%rowtype;
  v_resp record;
  v_json jsonb;
  v_provider text;
  v_sent integer:=0;
  v_review integer:=0;
  v_waiting integer:=0;
begin
  for v_job in
    select * from public.operator_reply_jobs
     where status='dispatching'
     order by dispatched_at,id
     limit 100
     for update skip locked
  loop
    if v_job.dispatch_request_id is null then
      if v_job.dispatched_at<now()-interval '2 minutes' then
        update public.operator_reply_jobs set status='review_required',blocked_reason='delivery_uncertain_review_required',updated_at=now() where id=v_job.id;
        v_review:=v_review+1;
      else v_waiting:=v_waiting+1; end if;
      continue;
    end if;

    select r.* into v_resp from net._http_response r where r.id=v_job.dispatch_request_id order by r.created desc limit 1;
    if not found then
      if v_job.dispatched_at<now()-interval '2 minutes' then
        update public.operator_reply_jobs set status='review_required',blocked_reason='delivery_uncertain_review_required',updated_at=now() where id=v_job.id;
        v_review:=v_review+1;
      else v_waiting:=v_waiting+1; end if;
      continue;
    end if;

    v_json:=null;
    begin
      if nullif(btrim(coalesce(v_resp.content,'')),'') is not null then v_json:=v_resp.content::jsonb; end if;
    exception when others then v_json:=null; end;

    update public.operator_reply_jobs
       set dispatch_response_status=v_resp.status_code,
           dispatch_response=case when jsonb_typeof(v_json)='object' then v_json else null end,
           updated_at=now()
     where id=v_job.id;

    if coalesce(v_resp.timed_out,false)
       or nullif(v_resp.error_msg,'') is not null
       or coalesce(v_resp.status_code,0)<200 or coalesce(v_resp.status_code,0)>=300
       or jsonb_typeof(v_json) is distinct from 'object'
       or coalesce(v_json->>'ok','')<>'true'
       or coalesce(v_json->>'job_id','')<>v_job.id::text
       or coalesce(v_json->>'delivery_mode','')<>'text' then
      update public.operator_reply_jobs set status='review_required',blocked_reason='delivery_uncertain_review_required',updated_at=now() where id=v_job.id;
      v_review:=v_review+1;
      continue;
    end if;

    v_provider:=nullif(btrim(coalesce(v_json->>'provider_message_id','')),'');
    if v_provider is null or length(v_provider)>500 then
      update public.operator_reply_jobs set status='review_required',blocked_reason='provider_message_id_missing',updated_at=now() where id=v_job.id;
      v_review:=v_review+1;
      continue;
    end if;

    update public.operator_reply_jobs set status='sent',provider_message_id=v_provider,sent_at=now(),blocked_reason=null,updated_at=now() where id=v_job.id;
    update public.human_handoffs set first_response_at=coalesce(first_response_at,now()),last_operator_reply_at=now(),updated_at=now() where id=v_job.handoff_id;
    update public.conversations set last_human_message_at=now(),last_outbound_at=now(),updated_at=now() where id=v_job.conversation_id;
    v_sent:=v_sent+1;
  end loop;

  return jsonb_build_object('sent',v_sent,'review_required',v_review,'waiting',v_waiting);
end;
$$;
revoke all on function public.reconcile_operator_reply_responses_v1() from public,anon,authenticated;
grant execute on function public.reconcile_operator_reply_responses_v1() to service_role;

do $$
begin
  if not exists(select 1 from cron.job where jobname='dona-antonia-operator-reply-reconcile-v1') then
    perform cron.schedule('dona-antonia-operator-reply-reconcile-v1','* * * * *','select public.reconcile_operator_reply_responses_v1();');
  end if;
end;
$$;

-- 8) Timeline única. Mensagem normalizada tem precedência; legado entra somente quando não espelhado.
create or replace view public.customer_timeline_v1
with (security_invoker=true)
as
select
  n.customer_id,
  n.conversation_id,
  n.occurred_at,
  n.channel,
  'message'::text as event_kind,
  n.direction,
  n.message_type as title,
  n.body_text,
  n.id::text as reference_id,
  jsonb_build_object('source','normalized_channel_events','source_detail',n.source,'referral',n.referral,'media_refs',n.media_refs,'processing_status',n.processing_status) as metadata
from public.normalized_channel_events n
union all
select
  c.customer_id,
  m.conversation_id,
  m.created_at,
  c.channel,
  'message'::text,
  m.direction,
  m.message_type,
  coalesce(m.body_text,m.transcript),
  m.id::text,
  jsonb_build_object('source','legacy_messages','delivery_status',m.delivery_status,'whatsapp_message_id',m.whatsapp_message_id)
from public.messages m
join public.conversations c on c.id=m.conversation_id
where not exists(
  select 1 from public.normalized_channel_events n
  where n.conversation_id=m.conversation_id
    and m.whatsapp_message_id is not null
    and n.external_message_id=m.whatsapp_message_id
)
union all
select
  o.customer_id,
  o.conversation_id,
  coalesce(o.external_status_updated_at,o.confirmed_at,o.created_at),
  coalesce(c.channel,'commerce'),
  'order'::text,
  'system'::text,
  o.status,
  null::text,
  o.id::text,
  jsonb_build_object('source','orders','total',o.total,'currency',o.currency,'sync_status',o.sync_status,'delivered_at',o.delivered_at,'cancelled_at',o.cancelled_at,'returned_at',o.returned_at)
from public.orders o
left join public.conversations c on c.id=o.conversation_id
union all
select
  h.customer_id,
  h.conversation_id,
  h.created_at,
  h.channel,
  'handoff'::text,
  'system'::text,
  h.reason,
  h.summary,
  h.id::text,
  jsonb_build_object('source','human_handoffs','status',h.status,'priority',h.priority,'claimed_at',h.claimed_at,'resolved_at',h.resolved_at,'sla_due_at',h.sla_due_at)
from public.human_handoffs h
union all
select
  r.customer_id,
  r.conversation_id,
  coalesce(r.sent_at,r.created_at),
  r.channel,
  'operator_reply'::text,
  'outbound'::text,
  r.status,
  r.body_text,
  r.id::text,
  jsonb_build_object('source','operator_reply_jobs','status',r.status,'blocked_reason',r.blocked_reason,'provider_message_id',r.provider_message_id,'admin_user_id',r.admin_user_id)
from public.operator_reply_jobs r;

revoke all on public.customer_timeline_v1 from public,anon,authenticated;
grant select on public.customer_timeline_v1 to service_role;

-- 9) Inbox única, uma linha por conversa com handoff ativo e última atividade.
create or replace view public.unified_inbox_v1
with (security_invoker=true)
as
select
  c.id as conversation_id,
  c.customer_id,
  c.channel,
  c.channel_account_id,
  c.external_user_id,
  c.status as conversation_status,
  c.stage,
  c.mode,
  c.human_required,
  c.assigned_admin_user_id,
  coalesce(cu.name,'Cliente') as customer_name,
  cu.primary_whatsapp_e164,
  h.id as handoff_id,
  h.status as handoff_status,
  h.reason as handoff_reason,
  h.priority,
  h.claimed_by,
  h.claimed_at,
  h.first_response_at,
  h.last_operator_reply_at,
  h.sla_due_at,
  coalesce(last_event.occurred_at,c.last_inbound_at,c.last_outbound_at,c.updated_at,c.opened_at) as last_activity_at,
  last_event.direction as last_direction,
  last_event.event_kind as last_event_kind,
  last_event.title as last_event_title,
  left(coalesce(last_event.body_text,c.context_summary,''),280) as last_preview,
  case when h.id is not null and h.status in ('open','claimed') and h.sla_due_at<now() then true else false end as sla_overdue
from public.conversations c
left join public.customers cu on cu.id=c.customer_id
left join lateral (
  select hh.* from public.human_handoffs hh
   where hh.conversation_id=c.id and hh.status in ('open','claimed')
   order by hh.priority desc,hh.created_at desc limit 1
) h on true
left join lateral (
  select t.occurred_at,t.direction,t.event_kind,t.title,t.body_text
  from public.customer_timeline_v1 t
  where t.conversation_id=c.id
  order by t.occurred_at desc,t.reference_id desc
  limit 1
) last_event on true;

revoke all on public.unified_inbox_v1 from public,anon,authenticated;
grant select on public.unified_inbox_v1 to service_role;

create or replace function public.get_unified_inbox_metrics_v1()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  with active as (
    select * from public.human_handoffs where status in ('open','claimed')
  ), channel_counts as (
    select channel,count(*)::int as total from active group by channel
  ), reason_counts as (
    select reason,count(*)::int as total from active group by reason order by count(*) desc,reason limit 20
  )
  select jsonb_build_object(
    'active_total',(select count(*) from active),
    'open_total',(select count(*) from active where status='open'),
    'claimed_total',(select count(*) from active where status='claimed'),
    'sla_overdue',(select count(*) from active where sla_due_at<now()),
    'first_response_avg_seconds',(
      select case when count(*)=0 then null else round(avg(extract(epoch from (first_response_at-created_at)))::numeric,1) end
      from public.human_handoffs where first_response_at is not null
    ),
    'by_channel',coalesce((select jsonb_object_agg(channel,total) from channel_counts),'{}'::jsonb),
    'by_reason',coalesce((select jsonb_object_agg(reason,total) from reason_counts),'{}'::jsonb)
  );
$$;
revoke all on function public.get_unified_inbox_metrics_v1() from public,anon,authenticated;
grant execute on function public.get_unified_inbox_metrics_v1() to service_role;

commit;
