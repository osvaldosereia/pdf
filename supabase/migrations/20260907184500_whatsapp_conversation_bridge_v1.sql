begin;

-- Perfil de voz versionado. A ponte de envio usa o id; credenciais nunca ficam no banco.
create table if not exists public.ai_voice_profiles(
  id text primary key,
  model text not null,
  voice text not null,
  speed numeric(4,2) not null default 1.00 check(speed between 0.25 and 4.00),
  instructions text not null,
  output_format text not null default 'mp3' check(output_format in ('mp3','opus','aac','flac','wav','pcm')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ai_voice_profiles enable row level security;
revoke all on public.ai_voice_profiles from public,anon,authenticated;
grant select,insert,update,delete on public.ai_voice_profiles to service_role;

insert into public.ai_voice_profiles(id,model,voice,speed,instructions,output_format,is_active)
values(
  'dona_antonia_marin_b_v1',
  'gpt-4o-mini-tts',
  'marin',
  1.00,
  'Fale em português brasileiro natural, como uma mulher adulta atendendo um cliente pelo WhatsApp. Soe calorosa, tranquila, próxima e espontânea. Não use voz de locutora, propaganda, URA ou atendimento corporativo. Use ritmo de conversa real, com pequenas variações naturais de velocidade, intensidade e entonação. Faça pausas curtas apenas onde uma pessoa normalmente respiraria ou pensaria. Evite dicção perfeita demais, entusiasmo artificial e final de frase cantado. Seja simpática de forma discreta, como uma atendente de mercado experiente conversando com um cliente conhecido.',
  'mp3',
  true
)
on conflict(id) do update set
  model=excluded.model,voice=excluded.voice,speed=excluded.speed,instructions=excluded.instructions,
  output_format=excluded.output_format,is_active=excluded.is_active,updated_at=now();

create index if not exists catalog_sessions_conversation_open_idx
  on public.catalog_sessions(conversation_id,status,expires_at desc);

-- Toda conversa WhatsApp recebe uma sessão técnica compartilhada com a Sala de Compra.
-- O token não é enviado automaticamente ao cliente; ele apenas preserva a mesma conversa/carrinho/mídia.
create or replace function public.ensure_whatsapp_catalog_session(p_conversation_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_session_id uuid;
  v_customer_id uuid;
begin
  select customer_id into v_customer_id
  from public.conversations where id=p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;

  select id into v_session_id
  from public.catalog_sessions
  where conversation_id=p_conversation_id and status='open' and expires_at>now()
  order by last_activity_at desc,created_at desc
  limit 1 for update;

  if v_session_id is null then
    insert into public.catalog_sessions(
      customer_id,conversation_id,kind,title,status,expires_at,experience,current_view,metadata
    ) values(
      v_customer_id,p_conversation_id,'manual','Atendimento WhatsApp','open',now()+interval '24 hours',
      'shopping_room','home',jsonb_build_object('source','whatsapp','technical_session',true)
    ) returning id into v_session_id;
  else
    update public.catalog_sessions
       set customer_id=coalesce(customer_id,v_customer_id),
           expires_at=greatest(expires_at,now()+interval '24 hours'),
           last_activity_at=now()
     where id=v_session_id;
  end if;
  return v_session_id;
end;
$$;
revoke all on function public.ensure_whatsapp_catalog_session(uuid) from public,anon,authenticated;
grant execute on function public.ensure_whatsapp_catalog_session(uuid) to service_role;

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
  v_account_id uuid;
  v_customer_id uuid;
  v_conversation_id uuid;
  v_message_row_id uuid;
  v_session_id uuid;
  v_phone text;
  v_event_inserted integer := 0;
  v_new_conversation boolean := false;
  v_source text := 'organic';
  v_pref text := 'auto';
  v_mode text := 'ai';
  v_cfg public.automation_config%rowtype;
  v_reply jsonb := '{}'::jsonb;
  v_ai_job jsonb := null;
begin
  if coalesce(p_message_id,'')='' then
    return jsonb_build_object('ok',false,'error','missing_message_id');
  end if;

  select id into v_account_id
  from public.whatsapp_accounts
  where phone_number_id=p_phone_number_id and is_active=true
  limit 1;
  if v_account_id is null then
    return jsonb_build_object('ok',false,'error','unknown_whatsapp_account','phone_number_id',p_phone_number_id);
  end if;

  insert into public.processed_events(event_id,source,payload_hash,processed_at)
  values(p_message_id,'meta_whatsapp',null,now())
  on conflict(event_id) do nothing;
  get diagnostics v_event_inserted=row_count;

  if v_event_inserted=0 then
    select id,conversation_id into v_message_row_id,v_conversation_id
    from public.messages where whatsapp_message_id=p_message_id limit 1;
    return jsonb_build_object(
      'ok',true,'duplicate',true,'conversation_id',v_conversation_id,'message_row_id',v_message_row_id,
      'should_reply',false
    );
  end if;

  v_phone:='+'||public.normalize_phone_digits(p_from);
  if p_referral is not null and p_referral<>'{}'::jsonb then v_source:='meta_ad'; end if;

  select cp.customer_id into v_customer_id
  from public.customer_phones cp
  where public.normalize_phone_digits(cp.phone_e164)=public.normalize_phone_digits(v_phone)
  limit 1;
  if v_customer_id is null then
    select c.id into v_customer_id from public.customers c
    where public.normalize_phone_digits(c.primary_whatsapp_e164)=public.normalize_phone_digits(v_phone)
    limit 1;
  end if;
  if v_customer_id is null then
    insert into public.customers(name,primary_whatsapp_e164)
    values(nullif(p_profile_name,''),v_phone)
    on conflict(primary_whatsapp_e164) do update
      set name=coalesce(public.customers.name,excluded.name),updated_at=now()
    returning id into v_customer_id;
  else
    update public.customers set name=coalesce(name,nullif(p_profile_name,'')),updated_at=now() where id=v_customer_id;
  end if;

  insert into public.customer_phones(customer_id,phone_e164,source,is_primary,verified_at)
  values(v_customer_id,v_phone,'whatsapp',true,now())
  on conflict(phone_e164) do update
    set customer_id=excluded.customer_id,verified_at=coalesce(public.customer_phones.verified_at,excluded.verified_at);

  select c.id,c.mode into v_conversation_id,v_mode
  from public.conversations c
  where c.whatsapp_account_id=v_account_id
    and public.normalize_phone_digits(c.wa_contact_e164)=public.normalize_phone_digits(v_phone)
    and c.status<>'closed'
  order by c.updated_at desc limit 1;

  if v_conversation_id is null then
    v_new_conversation:=true;
    insert into public.conversations(
      whatsapp_account_id,customer_id,wa_contact_e164,source,status,stage,response_preference,mode,referral,
      last_inbound_at,service_window_expires_at,free_entry_window_expires_at
    ) values(
      v_account_id,v_customer_id,v_phone,v_source,'open','new','auto','ai',coalesce(p_referral,'{}'::jsonb),
      p_message_timestamp,p_message_timestamp+interval '24 hours',
      case when v_source='meta_ad' then p_message_timestamp+interval '72 hours' else null end
    ) returning id,mode into v_conversation_id,v_mode;
  else
    update public.conversations
       set customer_id=coalesce(customer_id,v_customer_id),
           source=case when v_source='meta_ad' then 'meta_ad' else source end,
           referral=case when v_source='meta_ad' then coalesce(p_referral,'{}'::jsonb) else referral end,
           last_inbound_at=p_message_timestamp,
           service_window_expires_at=p_message_timestamp+interval '24 hours',
           free_entry_window_expires_at=case when v_source='meta_ad' then greatest(coalesce(free_entry_window_expires_at,p_message_timestamp),p_message_timestamp+interval '72 hours') else free_entry_window_expires_at end,
           status=case when status='waiting_customer' then 'open' else status end,
           updated_at=now()
     where id=v_conversation_id;
  end if;

  v_session_id:=public.ensure_whatsapp_catalog_session(v_conversation_id);
  select preferred_reply into v_pref from public.customers where id=v_customer_id;

  insert into public.messages(
    conversation_id,whatsapp_message_id,direction,message_type,body_text,media_id,ai_interpretation,raw_event,created_at
  ) values(
    v_conversation_id,p_message_id,'inbound',
    case when p_message_type in ('text','audio','image','video','document','interactive','location','contact','template','system','other') then p_message_type else 'other' end,
    p_body_text,p_media_id,coalesce(p_interactive_payload,'{}'::jsonb),
    coalesce(p_raw_event,'{}'::jsonb)||jsonb_build_object('source','whatsapp','meta_message_id',p_message_id,'phone_number_id',p_phone_number_id),
    p_message_timestamp
  ) returning id into v_message_row_id;

  select * into v_cfg from public.automation_config where id=1;

  if coalesce(v_cfg.automation_enabled,false)
     and coalesce(v_cfg.outbound_enabled,false)
     and v_mode='ai' then
    if v_new_conversation then
      select jsonb_build_object('kind','interactive_buttons','body_text',qr.body_text,'buttons',qr.metadata->'buttons')
      into v_reply from public.quick_replies qr where qr.key='welcome_menu' and qr.is_active=true;
    elsif p_message_type='interactive' then
      v_reply:=jsonb_build_object('kind','route_interactive','payload',coalesce(p_interactive_payload,'{}'::jsonb));
    elsif p_message_type in ('audio','image') then
      if coalesce(v_cfg.ai_enabled,false) and coalesce(v_cfg.conversation_worker_enabled,false) then
        v_reply:=jsonb_build_object('kind','needs_media_ai','media_type',p_message_type,'media_id',p_media_id);
      else
        v_reply:=jsonb_build_object('kind','none');
      end if;
    elsif p_message_type='text' and coalesce(v_cfg.ai_enabled,false) and coalesce(v_cfg.conversation_worker_enabled,false) then
      v_ai_job:=public.queue_ai_job_for_message(v_message_row_id,'conversation',jsonb_build_object('source','whatsapp'));
      v_reply:=jsonb_build_object('kind','needs_ai','ai_job',v_ai_job);
    else
      v_reply:=jsonb_build_object('kind','none');
    end if;
  else
    v_reply:=jsonb_build_object('kind','none');
  end if;

  insert into public.automation_usage(
    conversation_id,scenario_id,scenario_name,event_type,make_operations,ai_calls,transcription_calls,vision_calls,bling_calls
  ) values(v_conversation_id,6779824,'Dona Antônia - WhatsApp Bridge v1','whatsapp_ingest',2,0,0,0,0);

  return jsonb_build_object(
    'ok',true,'duplicate',false,'account_id',v_account_id,'customer_id',v_customer_id,
    'conversation_id',v_conversation_id,'message_row_id',v_message_row_id,'session_id',v_session_id,
    'new_conversation',v_new_conversation,'customer_phone',v_phone,'preferred_reply',coalesce(v_pref,'auto'),
    'mode',v_mode,'should_reply',(coalesce(v_reply->>'kind','none')<>'none'),'reply',v_reply,'ai_job',v_ai_job
  );
exception when others then
  delete from public.processed_events where event_id=p_message_id;
  raise;
end;
$$;

-- Worker passa a aceitar mensagens da Sala e mensagens reais do WhatsApp, mantendo sessão aberta e gates globais.
create or replace function public.claim_conversation_job(p_worker text)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  j public.ai_jobs%rowtype;
  m public.messages%rowtype;
  media jsonb;
  used integer;
begin
  if nullif(trim(p_worker),'') is null then raise exception 'worker_required'; end if;
  select * into cfg from public.automation_config where id=1 for update;
  if not coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled,false) then return null; end if;

  update public.ai_jobs set status='error',error_message='lease_expired_review_required',updated_at=now()
   where status='processing' and locked_at<now()-interval '10 minutes' and locked_by like 'conversation-%';

  select a.* into j
  from public.ai_jobs a
  join public.messages msg on msg.id=a.message_id
  join public.conversations c on c.id=a.conversation_id
  where a.status='pending' and a.not_before<=now() and a.attempts<a.max_attempts
    and a.job_type in ('transcription','vision','conversation') and c.mode='ai'
    and not exists(select 1 from public.ai_jobs busy where busy.conversation_id=a.conversation_id and busy.status='processing')
    and msg.direction='inbound' and msg.raw_event->>'source' in ('shopping_room','whatsapp')
    and exists(select 1 from public.catalog_sessions s where s.conversation_id=c.id and s.status='open' and s.expires_at>now())
  order by a.created_at,a.id
  for update of a skip locked limit 1;
  if not found then return null; end if;

  select count(*) into used from public.ai_usage_events where message_id=j.message_id;
  if used>=cfg.max_ai_calls_per_event
     or (j.job_type='transcription' and cfg.max_transcriptions_per_event<1)
     or (j.job_type='vision' and cfg.max_vision_calls_per_event<1) then
    update public.ai_jobs set status='held',error_message='event_call_budget',updated_at=now() where id=j.id;
    return jsonb_build_object('skipped',true,'reason','event_call_budget');
  end if;

  update public.ai_jobs set status='processing',attempts=attempts+1,locked_by=p_worker,locked_at=now(),updated_at=now()
   where id=j.id returning * into j;
  insert into public.ai_usage_events(job_id,message_id,attempt) values(j.id,j.message_id,j.attempts);
  select * into m from public.messages where id=j.message_id;
  select to_jsonb(r) into media from public.room_media r
   where r.message_id=j.message_id and r.conversation_id=j.conversation_id order by r.created_at limit 1;
  return jsonb_build_object(
    'id',j.id,'message_id',j.message_id,'conversation_id',j.conversation_id,'job_type',j.job_type,
    'attempt',j.attempts,'body_text',m.body_text,'message_type',m.message_type,'source',m.raw_event->>'source','media',media
  );
end;
$$;

create or replace function public.finish_conversation_job(
  p_job_id uuid,p_worker text,p_attempt integer,p_result jsonb,p_usage jsonb default '{}'::jsonb,p_error text default null
)
returns jsonb
language plpgsql
set search_path=''
as $$
declare
  j public.ai_jobs%rowtype;
  c public.conversations%rowtype;
  cfg public.automation_config%rowtype;
  inbound public.messages%rowtype;
  customer public.customers%rowtype;
  reply_id uuid;
  outbound_id uuid;
  v_intent text:=p_result->>'intent';
  enabled boolean;
  session_id uuid;
  v_source text;
  v_delivery_mode text;
begin
  select * into j from public.ai_jobs where id=p_job_id for update;
  if not found then raise exception 'job_not_found'; end if;
  if j.status='done' then return jsonb_build_object('status','done','duplicate',true); end if;
  if j.status<>'processing' or j.locked_by is distinct from p_worker or j.attempts<>p_attempt then raise exception 'stale_job_lease'; end if;

  select * into c from public.conversations where id=j.conversation_id for update;
  select * into inbound from public.messages where id=j.message_id;
  v_source:=coalesce(inbound.raw_event->>'source','shopping_room');
  if c.customer_id is not null then select * into customer from public.customers where id=c.customer_id; end if;
  select * into cfg from public.automation_config where id=1;
  select id into session_id from public.catalog_sessions
   where conversation_id=j.conversation_id and status='open' and expires_at>now()
   order by created_at desc limit 1;

  enabled:=coalesce(
    cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and c.mode='ai' and session_id is not null
    and (v_source<>'whatsapp' or c.service_window_expires_at>now()),false
  );

  update public.ai_usage_events set
    status=case when p_error is null then 'done' else 'error' end,
    model=left(p_usage->>'model',100),provider_request_id=left(p_usage->>'provider_request_id',200),
    input_tokens=nullif(p_usage->>'input_tokens','')::integer,output_tokens=nullif(p_usage->>'output_tokens','')::integer,
    audio_seconds=nullif(p_usage->>'audio_seconds','')::numeric,estimated_cost_usd=nullif(p_usage->>'estimated_cost_usd','')::numeric,
    pricing_version=left(p_usage->>'pricing_version',100),finished_at=now()
  where job_id=j.id and attempt=j.attempts;

  if p_error is not null then
    update public.ai_jobs set status='error',error_message=left(p_error,100),updated_at=now() where id=j.id;
    update public.room_media set processing_status='error',processing_error=left(p_error,100) where message_id=j.message_id;
    return jsonb_build_object('status','error');
  end if;

  if v_intent is null or v_intent not in ('greeting','baskets','offers','search','checkout','decline_upsell','fast_checkout','human','clarify')
     or nullif(p_result->>'reply','') is null or length(p_result->>'reply')>1000 then
    raise exception 'invalid_job_result';
  end if;

  update public.messages set
    transcript=case when j.job_type='transcription' then left(p_result->>'transcript',4000) else transcript end,
    ai_interpretation=jsonb_build_object('intent',v_intent,'description',left(p_result->>'description',1000),'source','conversation_worker_v1')
  where id=j.message_id;
  update public.room_media set processing_status='processed',processing_error=null where message_id=j.message_id;

  if enabled then
    if v_intent='decline_upsell' then
      perform public.record_sales_offer_event(j.conversation_id,'declined_all',null,v_source,jsonb_build_object('ai_job_id',j.id));
    elsif v_intent='fast_checkout' then
      update public.conversations set fast_checkout=true,sales_pressure_level=0,updated_at=now() where id=j.conversation_id;
    elsif v_intent='human' then
      update public.conversations set mode='human',updated_at=now() where id=j.conversation_id;
    end if;

    insert into public.messages(conversation_id,direction,message_type,body_text,ai_interpretation,raw_event)
    values(
      j.conversation_id,'outbound','text',p_result->>'reply',
      jsonb_build_object('source','conversation_worker_v1','intent',v_intent,'ui',p_result->'ui'),
      jsonb_build_object('source',v_source,'session_id',session_id,'ai_job_id',j.id)
    ) returning id into reply_id;

    if v_source='whatsapp' and coalesce(cfg.outbound_enabled,false) then
      v_delivery_mode:=case
        when customer.preferred_reply='audio' then 'audio'
        when customer.preferred_reply='text' then 'text'
        when inbound.message_type='audio' then 'audio'
        else 'text'
      end;
      insert into public.outbound_jobs(
        whatsapp_account_id,customer_id,conversation_id,job_type,recipient_e164,dedupe_key,payload
      ) values(
        c.whatsapp_account_id,c.customer_id,c.id,'seller_message',c.wa_contact_e164,'conversation_reply:'||reply_id::text,
        jsonb_build_object(
          'message_kind','conversation_reply','message_type','text','body_text',p_result->>'reply',
          'delivery_mode',v_delivery_mode,'voice_profile','dona_antonia_marin_b_v1',
          'reply_message_id',reply_id,'ai_job_id',j.id,'service_window_expires_at',c.service_window_expires_at
        )
      ) on conflict(dedupe_key) do nothing returning id into outbound_id;
    end if;
  end if;

  update public.ai_jobs set
    status='done',result=p_result||jsonb_build_object(
      'reply_message_id',reply_id,'outbound_job_id',outbound_id,'reply_suppressed',not enabled,'source',v_source
    ),error_message=null,updated_at=now()
  where id=j.id;

  return jsonb_build_object(
    'status','done','reply_message_id',reply_id,'outbound_job_id',outbound_id,'reply_suppressed',not enabled,'source',v_source
  );
end;
$$;

revoke all on function public.ingest_whatsapp_message(text,text,text,text,text,timestamptz,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ingest_whatsapp_message(text,text,text,text,text,timestamptz,text,text,text,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.claim_conversation_job(text) from public,anon,authenticated;
grant execute on function public.claim_conversation_job(text) to service_role;
revoke all on function public.finish_conversation_job(uuid,text,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_conversation_job(uuid,text,integer,jsonb,jsonb,text) to service_role;

commit;
