begin;

-- Etapa 4: operação event-driven, liberação gradual e fallback humano.
-- Tudo nasce fechado. Esta migration NÃO coloca o WhatsApp em live.

alter table public.automation_config
  add column if not exists conversation_worker_dispatch_enabled boolean not null default false,
  add column if not exists conversation_worker_dispatch_max_attempts smallint not null default 5,
  add column if not exists whatsapp_live_canary_percent smallint not null default 0,
  add column if not exists whatsapp_live_max_new_conversations_per_hour integer not null default 10,
  add column if not exists whatsapp_live_max_ai_jobs_per_hour integer not null default 40,
  add column if not exists whatsapp_live_max_outbound_per_hour integer not null default 40,
  add column if not exists ai_daily_input_tokens_soft_limit integer not null default 150000,
  add column if not exists ai_daily_output_tokens_soft_limit integer not null default 30000,
  add column if not exists human_fallback_enabled boolean not null default true,
  add column if not exists whatsapp_live_started_at timestamptz,
  add column if not exists whatsapp_rollout_note text;

alter table public.ai_jobs
  add column if not exists worker_dispatch_request_id bigint,
  add column if not exists worker_dispatched_at timestamptz,
  add column if not exists worker_dispatch_attempts integer not null default 0,
  add column if not exists worker_dispatch_last_error text;

alter table public.conversations
  add column if not exists automation_cohort text,
  add column if not exists automation_bucket smallint;

create index if not exists ai_jobs_worker_recovery_idx
  on public.ai_jobs(status,worker_dispatched_at,created_at)
  where status='pending';
create index if not exists conversations_automation_cohort_idx
  on public.conversations(automation_cohort,created_at desc);

-- Constraints são adicionadas separadamente para manter a migration reexecutável em branches.
do $$ begin
  if not exists(select 1 from pg_constraint where conname='automation_config_worker_dispatch_attempts_check') then
    alter table public.automation_config add constraint automation_config_worker_dispatch_attempts_check
      check (conversation_worker_dispatch_max_attempts between 1 and 20);
  end if;
  if not exists(select 1 from pg_constraint where conname='automation_config_live_canary_check') then
    alter table public.automation_config add constraint automation_config_live_canary_check
      check (whatsapp_live_canary_percent between 0 and 100);
  end if;
  if not exists(select 1 from pg_constraint where conname='automation_config_live_caps_check') then
    alter table public.automation_config add constraint automation_config_live_caps_check
      check (whatsapp_live_max_new_conversations_per_hour between 1 and 10000
         and whatsapp_live_max_ai_jobs_per_hour between 1 and 100000
         and whatsapp_live_max_outbound_per_hour between 1 and 100000
         and ai_daily_input_tokens_soft_limit between 1000 and 100000000
         and ai_daily_output_tokens_soft_limit between 1000 and 100000000);
  end if;
  if not exists(select 1 from pg_constraint where conname='automation_config_observe_never_replies_check') then
    alter table public.automation_config add constraint automation_config_observe_never_replies_check
      check (not (whatsapp_release_mode in ('off','observe') and whatsapp_auto_reply_enabled));
  end if;
  if not exists(select 1 from pg_constraint where conname='conversations_automation_cohort_check') then
    alter table public.conversations add constraint conversations_automation_cohort_check
      check (automation_cohort is null or automation_cohort in ('homologation','observe','ai_canary','human_control'));
  end if;
  if not exists(select 1 from pg_constraint where conname='conversations_automation_bucket_check') then
    alter table public.conversations add constraint conversations_automation_bucket_check
      check (automation_bucket is null or automation_bucket between 0 and 99);
  end if;
end $$;

create table if not exists public.human_handoffs(
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  source_message_id uuid references public.messages(id) on delete set null,
  reason text not null,
  priority smallint not null default 2 check(priority between 1 and 5),
  status text not null default 'open' check(status in ('open','claimed','resolved','cancelled')),
  summary text,
  context jsonb not null default '{}'::jsonb,
  claimed_by uuid,
  claimed_at timestamptz,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists human_handoffs_one_active_per_conversation
  on public.human_handoffs(conversation_id) where status in ('open','claimed');
create index if not exists human_handoffs_queue_idx
  on public.human_handoffs(status,priority,created_at);

create table if not exists public.whatsapp_ops_events(
  id bigserial primary key,
  event_type text not null,
  severity text not null default 'info' check(severity in ('info','warning','critical')),
  conversation_id uuid references public.conversations(id) on delete set null,
  ai_job_id uuid references public.ai_jobs(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_ops_events_recent_idx on public.whatsapp_ops_events(created_at desc);

alter table public.human_handoffs enable row level security;
alter table public.whatsapp_ops_events enable row level security;
revoke all on public.human_handoffs,public.whatsapp_ops_events from public,anon,authenticated;
grant select,insert,update,delete on public.human_handoffs,public.whatsapp_ops_events to service_role;
grant usage,select on sequence public.whatsapp_ops_events_id_seq to service_role;

create or replace function public.queue_human_handoff_v1(
  p_conversation_id uuid,
  p_reason text,
  p_source_message_id uuid default null,
  p_priority smallint default 2,
  p_summary text default null,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_id uuid; v_customer uuid; v_reason text:=left(coalesce(nullif(trim(p_reason),''),'manual_review'),100);
begin
  select customer_id into v_customer from public.conversations where id=p_conversation_id for update;
  if not found then raise exception 'conversation_not_found'; end if;

  select id into v_id from public.human_handoffs
   where conversation_id=p_conversation_id and status in ('open','claimed')
   order by created_at limit 1 for update;

  if v_id is null then
    insert into public.human_handoffs(conversation_id,customer_id,source_message_id,reason,priority,summary,context)
    values(p_conversation_id,v_customer,p_source_message_id,v_reason,least(5,greatest(1,coalesce(p_priority,2))),left(p_summary,1000),coalesce(p_context,'{}'::jsonb))
    returning id into v_id;
  else
    update public.human_handoffs
       set reason=v_reason,
           source_message_id=coalesce(p_source_message_id,source_message_id),
           priority=greatest(priority,least(5,greatest(1,coalesce(p_priority,2)))),
           summary=coalesce(left(p_summary,1000),summary),
           context=context||coalesce(p_context,'{}'::jsonb),
           updated_at=now()
     where id=v_id;
  end if;

  update public.conversations
     set mode='human',human_required=true,status='needs_human',human_takeover_at=coalesce(human_takeover_at,now()),updated_at=now()
   where id=p_conversation_id;

  insert into public.whatsapp_ops_events(event_type,severity,conversation_id,details)
  values('human_handoff_queued',case when p_priority>=4 then 'critical' else 'warning' end,p_conversation_id,
    jsonb_build_object('handoff_id',v_id,'reason',v_reason,'priority',least(5,greatest(1,coalesce(p_priority,2)))));
  return v_id;
end;
$$;

-- A decisão de release separa "pode ingerir" de "pode responder automaticamente".
-- Assim observe/canary nunca perdem mensagens: clientes fora do cohort entram em fallback humano.
create or replace function public.whatsapp_release_decision(p_from text,p_message_timestamp timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  v_phone text;
  v_allowed boolean:=false;
  v_existing boolean:=false;
  v_bucket integer:=null;
  v_new_last_hour integer:=0;
begin
  select * into cfg from public.automation_config where id=1;
  if not found then return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','config_missing'); end if;
  if not coalesce(cfg.whatsapp_inbound_enabled,false) or cfg.whatsapp_release_mode='off' then
    return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','whatsapp_inbound_disabled','mode',cfg.whatsapp_release_mode);
  end if;
  if p_message_timestamp is null or p_message_timestamp<cfg.whatsapp_inbound_since then
    return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','before_whatsapp_cutover','mode',cfg.whatsapp_release_mode);
  end if;

  v_phone:='+'||public.normalize_phone_digits(p_from);

  if cfg.whatsapp_release_mode='homologation' then
    select exists(select 1 from public.whatsapp_test_allowlist a where a.phone_e164=v_phone and a.enabled=true and a.expires_at>now()) into v_allowed;
    return jsonb_build_object('allow_ingest',v_allowed,'auto_reply_allowed',v_allowed,
      'reason',case when v_allowed then 'homologation_allowlist' else 'homologation_phone_blocked' end,
      'mode',cfg.whatsapp_release_mode,'cohort',case when v_allowed then 'homologation' else null end);
  end if;

  if cfg.whatsapp_release_mode='observe' then
    return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',false,'reason','observe_human_only','mode','observe','cohort','observe');
  end if;

  if cfg.whatsapp_release_mode<>'live' then
    return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','invalid_release_mode','mode',cfg.whatsapp_release_mode);
  end if;

  v_bucket:=mod(abs((('x'||substr(md5(v_phone),1,8))::bit(32)::bigint)),100)::integer;
  select exists(
    select 1 from public.conversations c
     where c.status<>'closed' and public.normalize_phone_digits(c.wa_contact_e164)=public.normalize_phone_digits(v_phone)
  ) into v_existing;

  if cfg.whatsapp_live_canary_percent<=0 or v_bucket>=cfg.whatsapp_live_canary_percent then
    return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',false,'reason','live_canary_human_control',
      'mode','live','cohort','human_control','bucket',v_bucket,'canary_percent',cfg.whatsapp_live_canary_percent);
  end if;

  if not v_existing then
    select count(*) into v_new_last_hour from public.conversations c
     where c.whatsapp_account_id is not null and c.created_at>=now()-interval '1 hour' and c.automation_cohort='ai_canary';
    if v_new_last_hour>=cfg.whatsapp_live_max_new_conversations_per_hour then
      return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',false,'reason','live_new_conversation_cap_human_control',
        'mode','live','cohort','human_control','bucket',v_bucket,'new_conversations_last_hour',v_new_last_hour);
    end if;
  end if;

  return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',true,'reason','live_canary_ai',
    'mode','live','cohort','ai_canary','bucket',v_bucket,'canary_percent',cfg.whatsapp_live_canary_percent);
end;
$$;

-- Wrapper atual: mantém o core já homologado e acrescenta cohort/fallback antes de qualquer resposta sair do Make.
create or replace function public.ingest_whatsapp_message(
  p_phone_number_id text,
  p_waba_id text,
  p_from text,
  p_profile_name text,
  p_message_id text,
  p_message_timestamp timestamptz,
  p_message_type text,
  p_body_text text default null,
  p_media_id text default null,
  p_interactive_payload jsonb default '{}'::jsonb,
  p_referral jsonb default '{}'::jsonb,
  p_raw_event jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_release jsonb;
  v_result jsonb;
  v_cfg public.automation_config%rowtype;
  v_body text;
  v_welcome jsonb;
  v_conversation uuid;
  v_message uuid;
  v_ai_job uuid;
  v_cohort text;
  v_bucket smallint;
begin
  v_release:=public.whatsapp_release_decision(p_from,p_message_timestamp);
  if coalesce((v_release->>'allow_ingest')::boolean,false) is not true then
    return jsonb_build_object('ok',true,'ignored',true,'reason',coalesce(v_release->>'reason','release_blocked'),
      'release_mode',v_release->>'mode','should_reply',false);
  end if;

  v_result:=public.ingest_whatsapp_message_core_v1(
    p_phone_number_id,p_waba_id,p_from,p_profile_name,p_message_id,p_message_timestamp,p_message_type,
    p_body_text,p_media_id,p_interactive_payload,p_referral,p_raw_event
  );

  if coalesce((v_result->>'ok')::boolean,false)=true and coalesce((v_result->>'duplicate')::boolean,false)=false then
    v_conversation:=nullif(v_result->>'conversation_id','')::uuid;
    v_message:=nullif(v_result->>'message_row_id','')::uuid;
    v_ai_job:=nullif(coalesce(v_result->'ai_job'->>'id',v_result->'reply'->'ai_job'->>'id'),'')::uuid;
    v_cohort:=nullif(v_release->>'cohort','');
    v_bucket:=nullif(v_release->>'bucket','')::smallint;

    if v_conversation is not null then
      update public.conversations set automation_cohort=v_cohort,automation_bucket=v_bucket,updated_at=now() where id=v_conversation;
    end if;

    -- Observe e clientes fora do canary sempre vão para humano e nunca respondem pelo caminho direto do Make.
    if coalesce((v_release->>'auto_reply_allowed')::boolean,false) is not true then
      if v_ai_job is not null then
        update public.ai_jobs set status='held',error_message='release_human_control',updated_at=now()
         where id=v_ai_job and status in ('pending','held');
      end if;
      if v_conversation is not null then
        perform public.queue_human_handoff_v1(v_conversation,coalesce(v_release->>'reason','release_human_control'),v_message,2,
          'Atendimento retido pela liberação gradual.',jsonb_build_object('release_mode',v_release->>'mode','cohort',v_cohort,'bucket',v_bucket));
      end if;
      v_result:=jsonb_set(v_result,'{should_reply}','false'::jsonb,true);
      v_result:=jsonb_set(v_result,'{reply}',jsonb_build_object('kind','none'),true);
      v_result:=v_result||jsonb_build_object('ai_job',null,'mode','human','release',v_release);
      return v_result;
    end if;
  end if;

  -- Reabre o menu em saudações curtas, preservando a regra já homologada.
  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'duplicate')::boolean,false)=false
     and coalesce((v_result->>'should_reply')::boolean,false)=false
     and coalesce(v_result->>'mode','')='ai'
     and p_message_type='text' then
    v_body:=translate(lower(trim(regexp_replace(coalesce(p_body_text,''),'\s+',' ','g'))),'áàãâéêíóôõúç','aaaaeeiooouc');
    v_body:=regexp_replace(v_body,'[.!?,;:]+$','','g');
    if v_body in ('oi','oii','oiii','ola','olaa','olaaa','bom dia','boa tarde','boa noite','menu','inicio','iniciar','comecar') then
      select * into v_cfg from public.automation_config where id=1;
      if coalesce(v_cfg.whatsapp_auto_reply_enabled,false) and coalesce(v_cfg.automation_enabled,false)
         and coalesce(v_cfg.outbound_enabled,false) and v_cfg.whatsapp_release_mode in ('homologation','live') then
        select jsonb_build_object('kind','interactive_buttons','body_text',qr.body_text,'buttons',qr.metadata->'buttons') into v_welcome
          from public.quick_replies qr where qr.key='welcome_menu' and qr.is_active=true limit 1;
        if v_welcome is not null then
          v_result:=jsonb_set(v_result,'{should_reply}','true'::jsonb,true);
          v_result:=jsonb_set(v_result,'{reply}',v_welcome,true);
          v_result:=v_result||jsonb_build_object('menu_reason','greeting_or_menu_command');
        end if;
      end if;
    end if;
  end if;

  return v_result||jsonb_build_object('release',v_release);
end;
$$;

create or replace function public.claim_conversation_job_v2(p_worker text,p_expected_job_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  j public.ai_jobs%rowtype;
  m public.messages%rowtype;
  c public.conversations%rowtype;
  media jsonb;
  used integer;
  hourly_used integer;
  daily_in bigint;
  daily_out bigint;
  v_release jsonb;
  expired record;
begin
  if nullif(trim(p_worker),'') is null then raise exception 'worker_required'; end if;
  select * into cfg from public.automation_config where id=1 for update;
  if not coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled,false) then return null; end if;

  -- Uma chamada externa paga nunca é reexecutada cegamente após lease expirar.
  for expired in
    select a.id,a.conversation_id,a.message_id from public.ai_jobs a join public.messages mm on mm.id=a.message_id
     where a.status='processing' and a.locked_at<now()-interval '10 minutes' and a.locked_by like 'conversation-%'
     for update of a skip locked
  loop
    update public.ai_jobs set status='error',error_message='lease_expired_review_required',updated_at=now() where id=expired.id;
  end loop;

  select a.*,msg.id as ignored into j
  from public.ai_jobs a
  join public.messages msg on msg.id=a.message_id
  join public.conversations cv on cv.id=a.conversation_id
  where a.status='pending' and a.not_before<=now() and a.attempts<a.max_attempts
    and (p_expected_job_id is null or a.id=p_expected_job_id)
    and a.job_type in ('transcription','vision','conversation') and cv.mode='ai'
    and not exists(select 1 from public.ai_jobs busy where busy.conversation_id=a.conversation_id and busy.status='processing')
    and msg.direction='inbound' and msg.raw_event->>'source' in ('shopping_room','whatsapp')
    and exists(select 1 from public.catalog_sessions s where s.conversation_id=cv.id and s.status='open' and s.expires_at>now())
  order by a.created_at,a.id for update of a skip locked limit 1;
  if not found then return null; end if;

  select * into m from public.messages where id=j.message_id;
  select * into c from public.conversations where id=j.conversation_id;

  if m.raw_event->>'source'='whatsapp' then
    if not coalesce(cfg.whatsapp_inbound_enabled and cfg.whatsapp_auto_reply_enabled,false)
       or cfg.whatsapp_release_mode not in ('homologation','live') then
      update public.ai_jobs set status='held',error_message='whatsapp_reply_gate_closed',updated_at=now() where id=j.id;
      return jsonb_build_object('skipped',true,'reason','whatsapp_reply_gate_closed','id',j.id);
    end if;
    v_release:=public.whatsapp_release_decision(c.wa_contact_e164,m.created_at);
    if coalesce((v_release->>'auto_reply_allowed')::boolean,false) is not true then
      update public.ai_jobs set status='held',error_message='release_human_control',updated_at=now() where id=j.id;
      return jsonb_build_object('skipped',true,'reason','release_human_control','id',j.id);
    end if;

    select count(*) into hourly_used
      from public.ai_usage_events u join public.messages mm on mm.id=u.message_id
     where u.created_at>=now()-interval '1 hour' and mm.raw_event->>'source'='whatsapp';
    if hourly_used>=cfg.whatsapp_live_max_ai_jobs_per_hour then
      update public.ai_jobs set status='held',error_message='ai_hourly_cap_human_required',updated_at=now() where id=j.id;
      return jsonb_build_object('skipped',true,'reason','ai_hourly_cap','id',j.id);
    end if;
  end if;

  select coalesce(sum(input_tokens),0),coalesce(sum(output_tokens),0) into daily_in,daily_out
    from public.ai_usage_events
   where status='done' and (created_at at time zone 'America/Cuiaba')::date=(now() at time zone 'America/Cuiaba')::date;
  if daily_in>=cfg.ai_daily_input_tokens_soft_limit or daily_out>=cfg.ai_daily_output_tokens_soft_limit then
    update public.ai_jobs set status='held',error_message='ai_daily_token_budget_human_required',updated_at=now() where id=j.id;
    return jsonb_build_object('skipped',true,'reason','ai_daily_token_budget','id',j.id);
  end if;

  select count(*) into used from public.ai_usage_events where message_id=j.message_id;
  if used>=cfg.max_ai_calls_per_event
     or (j.job_type='transcription' and cfg.max_transcriptions_per_event<1)
     or (j.job_type='vision' and cfg.max_vision_calls_per_event<1) then
    update public.ai_jobs set status='held',error_message='event_call_budget_human_required',updated_at=now() where id=j.id;
    return jsonb_build_object('skipped',true,'reason','event_call_budget','id',j.id);
  end if;

  update public.ai_jobs set status='processing',attempts=attempts+1,locked_by=p_worker,locked_at=now(),worker_dispatch_last_error=null,updated_at=now()
   where id=j.id returning * into j;
  insert into public.ai_usage_events(job_id,message_id,attempt) values(j.id,j.message_id,j.attempts);
  select to_jsonb(r) into media from public.room_media r where r.message_id=j.message_id and r.conversation_id=j.conversation_id order by r.created_at limit 1;
  return jsonb_build_object('id',j.id,'message_id',j.message_id,'conversation_id',j.conversation_id,'job_type',j.job_type,
    'attempt',j.attempts,'body_text',m.body_text,'message_type',m.message_type,'source',m.raw_event->>'source','media',media);
end;
$$;

create or replace function public.claim_conversation_job(p_worker text)
returns jsonb language sql security definer set search_path='' as $$
  select public.claim_conversation_job_v2(p_worker,null);
$$;

-- Jobs que terminam de forma insegura ou estouram budget viram atendimento humano.
create or replace function public.ai_job_human_fallback_trigger_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_source text; v_cfg public.automation_config%rowtype;
begin
  if new.status not in ('error','held') or old.status is not distinct from new.status then return new; end if;
  select * into v_cfg from public.automation_config where id=1;
  if not coalesce(v_cfg.human_fallback_enabled,true) then return new; end if;
  select raw_event->>'source' into v_source from public.messages where id=new.message_id;
  if v_source='whatsapp' and (
       new.status='error' or coalesce(new.error_message,'') like '%human_required%'
       or new.error_message in ('release_human_control','lease_expired_review_required')
     ) then
    perform public.queue_human_handoff_v1(new.conversation_id,coalesce(new.error_message,'ai_job_review_required'),new.message_id,
      case when new.status='error' then 4 else 3 end,'A automação interrompeu este atendimento antes de uma nova resposta.',
      jsonb_build_object('ai_job_id',new.id,'job_type',new.job_type,'status',new.status));
  end if;
  return new;
end;
$$;
drop trigger if exists ai_job_human_fallback_v1 on public.ai_jobs;
create trigger ai_job_human_fallback_v1 after update of status,error_message on public.ai_jobs
  for each row execute function public.ai_job_human_fallback_trigger_v1();

-- Pedido explícito por humano é detectado no resultado estruturado do worker.
create or replace function public.message_human_intent_trigger_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if coalesce(new.raw_event->>'source','')='whatsapp'
     and new.direction='inbound'
     and new.ai_interpretation->>'intent'='human'
     and coalesce(old.ai_interpretation->>'intent','')<>'human' then
    perform public.queue_human_handoff_v1(new.conversation_id,'customer_requested_human',new.id,4,
      'Cliente pediu atendimento humano.',jsonb_build_object('source','ai_intent'));
  end if;
  return new;
end;
$$;
drop trigger if exists message_human_intent_v1 on public.messages;
create trigger message_human_intent_v1 after update of ai_interpretation on public.messages
  for each row execute function public.message_human_intent_trigger_v1();

-- Cap de outbound: cancelar a inserção é seguro e não desfaz a chamada paga já concluída.
create or replace function public.guard_whatsapp_ai_outbound_rate_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare cfg public.automation_config%rowtype; v_count integer;
begin
  if new.job_type<>'seller_message' or coalesce(new.payload->>'message_kind','')<>'conversation_reply' then return new; end if;
  select * into cfg from public.automation_config where id=1;
  select count(*) into v_count from public.outbound_jobs o
   where o.job_type='seller_message' and o.created_at>=now()-interval '1 hour'
     and coalesce(o.payload->>'message_kind','')='conversation_reply'
     and o.status in ('pending','processing','sent');
  if v_count>=cfg.whatsapp_live_max_outbound_per_hour then
    if new.conversation_id is not null and coalesce(cfg.human_fallback_enabled,true) then
      perform public.queue_human_handoff_v1(new.conversation_id,'outbound_hourly_cap_human_required',null,4,
        'Limite operacional de respostas automáticas atingido.',jsonb_build_object('outbound_last_hour',v_count));
    end if;
    insert into public.whatsapp_ops_events(event_type,severity,conversation_id,details)
    values('outbound_rate_limited','critical',new.conversation_id,jsonb_build_object('outbound_last_hour',v_count));
    return null;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_whatsapp_ai_outbound_rate_v1 on public.outbound_jobs;
create trigger guard_whatsapp_ai_outbound_rate_v1 before insert on public.outbound_jobs
  for each row execute function public.guard_whatsapp_ai_outbound_rate_v1();

-- Segredo interno gerado dentro do banco: plaintext fica somente no Vault; hash fica em system_secrets.
do $$
declare v_secret text; v_secret_id uuid;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='conversation_worker_webhook_key_v2' limit 1;
  if v_secret is null then
    v_secret:=encode(gen_random_bytes(32),'hex');
    perform vault.create_secret(v_secret,'conversation_worker_webhook_key_v2','Internal key for event-driven conversation worker v2');
  end if;
  insert into public.system_secrets(key_name,key_hash,is_active,rotated_at)
  values('conversation_worker_webhook_v2',encode(digest(v_secret,'sha256'),'hex'),true,now())
  on conflict(key_name) do update set key_hash=excluded.key_hash,is_active=true,rotated_at=now();
end $$;

create or replace function public.dispatch_conversation_worker_job_v2(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.automation_config%rowtype; j public.ai_jobs%rowtype; v_secret text; v_request bigint;
begin
  select * into cfg from public.automation_config where id=1;
  select * into j from public.ai_jobs where id=p_job_id for update;
  if not found then return jsonb_build_object('dispatched',false,'reason','job_not_found'); end if;
  if j.status<>'pending' then return jsonb_build_object('dispatched',false,'reason','job_not_pending','status',j.status); end if;
  if not coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and cfg.conversation_worker_dispatch_enabled,false) then
    return jsonb_build_object('dispatched',false,'reason','worker_dispatch_disabled');
  end if;
  if j.worker_dispatch_attempts>=cfg.conversation_worker_dispatch_max_attempts then
    update public.ai_jobs set status='held',error_message='worker_dispatch_exhausted_human_required',updated_at=now() where id=j.id;
    return jsonb_build_object('dispatched',false,'reason','dispatch_attempts_exhausted');
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='conversation_worker_webhook_key_v2' limit 1;
  if v_secret is null then
    update public.ai_jobs set worker_dispatch_last_error='worker_vault_secret_missing',updated_at=now() where id=j.id;
    return jsonb_build_object('dispatched',false,'reason','worker_secret_missing');
  end if;
  begin
    v_request:=net.http_post(
      url:='https://ssbesxgaijknwsjbsbcz.supabase.co/functions/v1/conversation-worker-v2',
      headers:=jsonb_build_object('Content-Type','application/json','x-da-worker-key',v_secret),
      body:=jsonb_build_object('job_id',j.id),
      timeout_milliseconds:=10000
    );
    update public.ai_jobs set worker_dispatch_request_id=v_request,worker_dispatched_at=now(),
      worker_dispatch_attempts=worker_dispatch_attempts+1,worker_dispatch_last_error=null,updated_at=now() where id=j.id;
    return jsonb_build_object('dispatched',true,'request_id',v_request,'job_id',j.id);
  exception when others then
    update public.ai_jobs set worker_dispatch_attempts=worker_dispatch_attempts+1,
      worker_dispatch_last_error='worker_dispatch_failed',worker_dispatched_at=now(),updated_at=now() where id=j.id;
    insert into public.whatsapp_ops_events(event_type,severity,ai_job_id,details)
    values('worker_dispatch_failed','warning',j.id,jsonb_build_object('job_type',j.job_type));
    return jsonb_build_object('dispatched',false,'reason','worker_dispatch_failed');
  end;
end;
$$;

create or replace function public.ai_job_dispatch_trigger_v2()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='pending' and (tg_op='INSERT' or old.status is distinct from new.status) then
    perform public.dispatch_conversation_worker_job_v2(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists ai_job_event_dispatch_v2 on public.ai_jobs;
create trigger ai_job_event_dispatch_v2 after insert or update of status on public.ai_jobs
  for each row execute function public.ai_job_dispatch_trigger_v2();

create or replace function public.recover_conversation_worker_dispatch_v2()
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.automation_config%rowtype; r record; v_dispatched integer:=0; v_held integer:=0;
begin
  select * into cfg from public.automation_config where id=1;
  if not coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and cfg.conversation_worker_dispatch_enabled,false) then
    return jsonb_build_object('active',false,'dispatched',0,'held',0);
  end if;
  for r in
    select id from public.ai_jobs
     where status='pending' and not_before<=now()
       and (worker_dispatched_at is null or worker_dispatched_at<now()-interval '75 seconds')
     order by created_at limit 10 for update skip locked
  loop
    if (select worker_dispatch_attempts from public.ai_jobs where id=r.id)>=cfg.conversation_worker_dispatch_max_attempts then
      update public.ai_jobs set status='held',error_message='worker_dispatch_exhausted_human_required',updated_at=now() where id=r.id;
      v_held:=v_held+1;
    else
      perform public.dispatch_conversation_worker_job_v2(r.id); v_dispatched:=v_dispatched+1;
    end if;
  end loop;
  return jsonb_build_object('active',true,'dispatched',v_dispatched,'held',v_held);
end;
$$;

-- Atualiza o emergency stop para também cortar o dispatcher novo.
create or replace function public.whatsapp_bridge_emergency_stop_v1(p_reason text default 'manual_emergency_stop')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_reason text:=left(coalesce(nullif(trim(p_reason),''),'manual_emergency_stop'),200); v_cancelled integer:=0; v_review integer:=0;
begin
  update public.automation_config set whatsapp_release_mode='off',whatsapp_inbound_enabled=false,whatsapp_auto_reply_enabled=false,
    ai_enabled=false,conversation_worker_enabled=false,conversation_worker_dispatch_enabled=false,whatsapp_inbound_since=now(),
    emergency_stop_reason=v_reason,updated_at=now() where id=1;
  update public.whatsapp_test_allowlist set enabled=false,updated_at=now() where enabled=true;
  update public.outbound_jobs set status='cancelled',last_error='emergency_stop_cancelled_before_send:'||v_reason,locked_at=null,locked_by=null,updated_at=now()
   where job_type='seller_message' and payload->>'message_kind'='conversation_reply' and status in ('pending','error') and coalesce(last_error,'') not like '%review_required%';
  get diagnostics v_cancelled=row_count;
  update public.outbound_jobs set status='error',last_error='emergency_stop_delivery_uncertain_review_required:'||v_reason,not_before=now()+interval '100 years',
    locked_at=null,locked_by=null,dispatch_response_checked_at=coalesce(dispatch_response_checked_at,now()),updated_at=now()
   where job_type='seller_message' and payload->>'message_kind'='conversation_reply' and status='processing';
  get diagnostics v_review=row_count;
  insert into public.whatsapp_ops_events(event_type,severity,details) values('emergency_stop','critical',jsonb_build_object('reason',v_reason));
  return jsonb_build_object('stopped',true,'reason',v_reason,'cancelled_before_send',v_cancelled,'processing_moved_to_review',v_review,'health',public.get_whatsapp_bridge_health_v1());
end;
$$;

-- Transições de release centralizadas. Live exige frase de confirmação server-side.
create or replace function public.configure_whatsapp_release_v1(
  p_mode text,
  p_canary_percent smallint default 0,
  p_note text default null,
  p_confirmation text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.automation_config%rowtype; v_mode text:=lower(trim(coalesce(p_mode,'')));
begin
  select * into cfg from public.automation_config where id=1 for update;
  if v_mode not in ('off','observe','live') then raise exception 'invalid_release_mode'; end if;
  if v_mode='off' then
    update public.automation_config set whatsapp_release_mode='off',whatsapp_inbound_enabled=false,whatsapp_auto_reply_enabled=false,
      ai_enabled=false,conversation_worker_enabled=false,conversation_worker_dispatch_enabled=false,whatsapp_live_canary_percent=0,
      whatsapp_inbound_since=now(),whatsapp_rollout_note=left(p_note,500),updated_at=now() where id=1;
  elsif v_mode='observe' then
    update public.automation_config set whatsapp_release_mode='observe',whatsapp_inbound_enabled=true,whatsapp_auto_reply_enabled=false,
      ai_enabled=false,conversation_worker_enabled=false,conversation_worker_dispatch_enabled=false,whatsapp_live_canary_percent=0,
      whatsapp_inbound_since=now(),whatsapp_rollout_note=left(p_note,500),updated_at=now() where id=1;
  else
    if p_confirmation is distinct from 'LIBERAR_ATENDIMENTO_REAL' then raise exception 'live_confirmation_required'; end if;
    if p_canary_percent<1 or p_canary_percent>100 then raise exception 'invalid_canary_percent'; end if;
    if not coalesce(cfg.automation_enabled and cfg.outbound_enabled,false) then raise exception 'global_gates_not_ready'; end if;
    update public.automation_config set whatsapp_release_mode='live',whatsapp_inbound_enabled=true,whatsapp_auto_reply_enabled=true,
      ai_enabled=true,conversation_worker_enabled=true,conversation_worker_dispatch_enabled=true,whatsapp_live_canary_percent=p_canary_percent,
      whatsapp_live_started_at=coalesce(whatsapp_live_started_at,now()),whatsapp_inbound_since=case when cfg.whatsapp_release_mode<>'live' then now() else whatsapp_inbound_since end,
      emergency_stop_reason=null,whatsapp_rollout_note=left(p_note,500),updated_at=now() where id=1;
  end if;
  insert into public.whatsapp_ops_events(event_type,severity,details)
  values('release_configured',case when v_mode='live' then 'warning' else 'info' end,jsonb_build_object('mode',v_mode,'canary_percent',case when v_mode='live' then p_canary_percent else 0 end));
  return public.get_whatsapp_bridge_health_v1();
end;
$$;

create or replace function public.claim_human_handoff_admin_v1(p_handoff_id uuid,p_admin_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.human_handoffs%rowtype; v_ok boolean;
begin
  select exists(select 1 from public.admin_users where user_id=p_admin_user_id and is_active=true and role in ('owner','operator')) into v_ok;
  if not v_ok then raise exception 'admin_not_authorized'; end if;
  select * into h from public.human_handoffs where id=p_handoff_id for update;
  if not found then raise exception 'handoff_not_found'; end if;
  if h.status not in ('open','claimed') then raise exception 'handoff_not_claimable'; end if;
  update public.human_handoffs set status='claimed',claimed_by=p_admin_user_id,claimed_at=coalesce(claimed_at,now()),updated_at=now() where id=h.id;
  update public.conversations set mode='human',human_required=true,status='needs_human',assigned_admin_user_id=p_admin_user_id,
    human_takeover_at=coalesce(human_takeover_at,now()),updated_at=now() where id=h.conversation_id;
  return jsonb_build_object('ok',true,'handoff_id',h.id,'status','claimed');
end;
$$;

create or replace function public.resolve_human_handoff_admin_v1(p_handoff_id uuid,p_admin_user_id uuid,p_notes text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.human_handoffs%rowtype; v_ok boolean;
begin
  select exists(select 1 from public.admin_users where user_id=p_admin_user_id and is_active=true and role in ('owner','operator')) into v_ok;
  if not v_ok then raise exception 'admin_not_authorized'; end if;
  select * into h from public.human_handoffs where id=p_handoff_id for update;
  if not found then raise exception 'handoff_not_found'; end if;
  update public.human_handoffs set status='resolved',resolved_at=now(),resolution_notes=left(p_notes,2000),updated_at=now() where id=h.id;
  return jsonb_build_object('ok',true,'handoff_id',h.id,'status','resolved','conversation_id',h.conversation_id);
end;
$$;

create or replace function public.resume_conversation_ai_admin_v1(p_conversation_id uuid,p_admin_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.conversations%rowtype; v_ok boolean; v_release jsonb;
begin
  select exists(select 1 from public.admin_users where user_id=p_admin_user_id and is_active=true and role in ('owner','operator')) into v_ok;
  if not v_ok then raise exception 'admin_not_authorized'; end if;
  if exists(select 1 from public.human_handoffs where conversation_id=p_conversation_id and status in ('open','claimed')) then raise exception 'active_handoff_must_be_resolved'; end if;
  select * into c from public.conversations where id=p_conversation_id for update;
  if not found then raise exception 'conversation_not_found'; end if;
  if c.channel='whatsapp' or c.whatsapp_account_id is not null then
    v_release:=public.whatsapp_release_decision(c.wa_contact_e164,now());
    if coalesce((v_release->>'auto_reply_allowed')::boolean,false) is not true then raise exception 'conversation_not_in_ai_release_cohort'; end if;
  end if;
  update public.conversations set mode='ai',human_required=false,status='open',assigned_admin_user_id=null,ai_resume_at=now(),
    automation_cohort=case when c.whatsapp_account_id is not null then coalesce(v_release->>'cohort',automation_cohort) else automation_cohort end,updated_at=now()
   where id=p_conversation_id;
  return jsonb_build_object('ok',true,'conversation_id',p_conversation_id,'mode','ai');
end;
$$;

create or replace function public.get_whatsapp_ops_dashboard_v1()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object(
    'checked_at',now(),
    'config',(select jsonb_build_object(
      'release_mode',whatsapp_release_mode,'inbound_enabled',whatsapp_inbound_enabled,'auto_reply_enabled',whatsapp_auto_reply_enabled,
      'ai_enabled',ai_enabled,'worker_enabled',conversation_worker_enabled,'dispatch_enabled',conversation_worker_dispatch_enabled,
      'canary_percent',whatsapp_live_canary_percent,'max_new_conversations_per_hour',whatsapp_live_max_new_conversations_per_hour,
      'max_ai_jobs_per_hour',whatsapp_live_max_ai_jobs_per_hour,'max_outbound_per_hour',whatsapp_live_max_outbound_per_hour,
      'daily_input_tokens_soft_limit',ai_daily_input_tokens_soft_limit,'daily_output_tokens_soft_limit',ai_daily_output_tokens_soft_limit,
      'human_fallback_enabled',human_fallback_enabled,'emergency_stop_reason',emergency_stop_reason,'rollout_note',whatsapp_rollout_note
    ) from public.automation_config where id=1),
    'queues',jsonb_build_object(
      'ai_pending',(select count(*) from public.ai_jobs where status='pending'),
      'ai_processing',(select count(*) from public.ai_jobs where status='processing'),
      'ai_error',(select count(*) from public.ai_jobs where status='error'),
      'outbound_pending',(select count(*) from public.outbound_jobs where job_type='seller_message' and status='pending'),
      'outbound_processing',(select count(*) from public.outbound_jobs where job_type='seller_message' and status='processing'),
      'outbound_review',(select count(*) from public.outbound_jobs where job_type='seller_message' and status='error' and coalesce(last_error,'') like '%review_required%'),
      'human_open',(select count(*) from public.human_handoffs where status='open'),
      'human_claimed',(select count(*) from public.human_handoffs where status='claimed')
    ),
    'last_hour',jsonb_build_object(
      'inbound',(select count(*) from public.messages where direction='inbound' and raw_event->>'source'='whatsapp' and created_at>=now()-interval '1 hour'),
      'ai_calls',(select count(*) from public.ai_usage_events u join public.messages m on m.id=u.message_id where m.raw_event->>'source'='whatsapp' and u.created_at>=now()-interval '1 hour'),
      'ai_errors',(select count(*) from public.ai_usage_events u join public.messages m on m.id=u.message_id where m.raw_event->>'source'='whatsapp' and u.created_at>=now()-interval '1 hour' and u.status='error'),
      'outbound_sent',(select count(*) from public.outbound_jobs where job_type='seller_message' and status='sent' and sent_at>=now()-interval '1 hour'),
      'new_ai_canary_conversations',(select count(*) from public.conversations where automation_cohort='ai_canary' and created_at>=now()-interval '1 hour')
    ),
    'today_usage',jsonb_build_object(
      'input_tokens',(select coalesce(sum(input_tokens),0) from public.ai_usage_events where status='done' and (created_at at time zone 'America/Cuiaba')::date=(now() at time zone 'America/Cuiaba')::date),
      'output_tokens',(select coalesce(sum(output_tokens),0) from public.ai_usage_events where status='done' and (created_at at time zone 'America/Cuiaba')::date=(now() at time zone 'America/Cuiaba')::date),
      'estimated_cost_usd',(select coalesce(sum(estimated_cost_usd),0) from public.ai_usage_events where status='done' and (created_at at time zone 'America/Cuiaba')::date=(now() at time zone 'America/Cuiaba')::date)
    ),
    'recent_ai_errors',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (
      select id,conversation_id,message_id,job_type,error_message,updated_at from public.ai_jobs where status='error' order by updated_at desc limit 10
    ) x),
    'recent_ops_events',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (
      select id,event_type,severity,conversation_id,ai_job_id,details,created_at from public.whatsapp_ops_events order by created_at desc limit 20
    ) x)
  );
$$;

-- Revoke direct access; somente service_role / Edge admin autenticada.
revoke all on function public.queue_human_handoff_v1(uuid,text,uuid,smallint,text,jsonb) from public,anon,authenticated;
revoke all on function public.claim_conversation_job_v2(text,uuid) from public,anon,authenticated;
revoke all on function public.dispatch_conversation_worker_job_v2(uuid) from public,anon,authenticated;
revoke all on function public.recover_conversation_worker_dispatch_v2() from public,anon,authenticated;
revoke all on function public.configure_whatsapp_release_v1(text,smallint,text,text) from public,anon,authenticated;
revoke all on function public.claim_human_handoff_admin_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.resolve_human_handoff_admin_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.resume_conversation_ai_admin_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_whatsapp_ops_dashboard_v1() from public,anon,authenticated;

grant execute on function public.queue_human_handoff_v1(uuid,text,uuid,smallint,text,jsonb) to service_role;
grant execute on function public.claim_conversation_job_v2(text,uuid) to service_role;
grant execute on function public.claim_conversation_job(text) to service_role;
grant execute on function public.dispatch_conversation_worker_job_v2(uuid) to service_role;
grant execute on function public.recover_conversation_worker_dispatch_v2() to service_role;
grant execute on function public.configure_whatsapp_release_v1(text,smallint,text,text) to service_role;
grant execute on function public.claim_human_handoff_admin_v1(uuid,uuid) to service_role;
grant execute on function public.resolve_human_handoff_admin_v1(uuid,uuid,text) to service_role;
grant execute on function public.resume_conversation_ai_admin_v1(uuid,uuid) to service_role;
grant execute on function public.get_whatsapp_ops_dashboard_v1() to service_role;

-- Recovery é leve e só redispara jobs ainda pending. Nunca toca jobs processing.
do $$ declare v_job bigint; begin
  select jobid into v_job from cron.job where jobname='dona-antonia-conversation-worker-recovery-v2' limit 1;
  if v_job is not null then perform cron.unschedule(v_job); end if;
  perform cron.schedule('dona-antonia-conversation-worker-recovery-v2','* * * * *','select public.recover_conversation_worker_dispatch_v2();');
end $$;

-- Deploy permanece fechado, mesmo se uma branch anterior deixou algum gate aberto.
update public.automation_config
   set conversation_worker_dispatch_enabled=false,
       whatsapp_live_canary_percent=0,
       updated_at=now()
 where id=1 and whatsapp_release_mode<>'live';

commit;
