begin;

-- Permite homologar um contato específico enquanto o canal global permanece em live.
-- Demais contatos continuam sujeitos ao canary normal. Não altera percentual global.
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
  cfg public.automation_config%rowtype;
  v_phone text;
  v_allowed boolean:=false;
  v_purpose text:=null;
  v_existing boolean:=false;
  v_bucket integer:=null;
  v_new_last_hour integer:=0;
begin
  select * into cfg from public.automation_config where id=1;
  if not found then
    return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','config_missing');
  end if;

  if not coalesce(cfg.whatsapp_inbound_enabled,false) or cfg.whatsapp_release_mode='off' then
    return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','whatsapp_inbound_disabled','mode',cfg.whatsapp_release_mode);
  end if;

  if p_message_timestamp is null or p_message_timestamp<cfg.whatsapp_inbound_since then
    return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','before_whatsapp_cutover','mode',cfg.whatsapp_release_mode);
  end if;

  v_phone:='+'||public.normalize_phone_digits(p_from);

  if cfg.whatsapp_release_mode='homologation' then
    select true,a.purpose into v_allowed,v_purpose
      from public.whatsapp_test_allowlist a
     where a.phone_e164=v_phone and a.enabled=true and a.expires_at>now()
     order by a.updated_at desc limit 1;
    v_allowed:=coalesce(v_allowed,false);
    if not v_allowed then
      return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','homologation_phone_blocked','mode','homologation','cohort',null);
    end if;
    if v_purpose='controlled_observe_homologation' then
      return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',false,'reason','observe_homologation_allowlist','mode','homologation','cohort','observe','profile','observe_human_only');
    end if;
    return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',true,'reason','homologation_allowlist','mode','homologation','cohort','homologation','profile','automation_test');
  end if;

  if cfg.whatsapp_release_mode='observe' then
    return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',false,'reason','observe_human_only','mode','observe','cohort','observe');
  end if;

  if cfg.whatsapp_release_mode<>'live' then
    return jsonb_build_object('allow_ingest',false,'auto_reply_allowed',false,'reason','invalid_release_mode','mode',cfg.whatsapp_release_mode);
  end if;

  -- Exceção temporária, explícita e auditável para homologação em live.
  select true,a.purpose into v_allowed,v_purpose
    from public.whatsapp_test_allowlist a
   where a.phone_e164=v_phone
     and a.enabled=true
     and a.expires_at>now()
     and a.purpose='controlled_live_homologation'
   order by a.updated_at desc limit 1;
  if coalesce(v_allowed,false) then
    return jsonb_build_object(
      'allow_ingest',true,'auto_reply_allowed',true,
      'reason','controlled_live_homologation',
      'mode','live','cohort','homologation','profile','automation_test',
      'canary_percent',cfg.whatsapp_live_canary_percent
    );
  end if;

  v_bucket:=mod(abs(hashtext(v_phone)::bigint),100)::integer;
  select exists(
    select 1 from public.conversations c
     where c.status<>'closed'
       and public.normalize_phone_digits(c.wa_contact_e164)=public.normalize_phone_digits(v_phone)
  ) into v_existing;

  if cfg.whatsapp_live_canary_percent<=0 or v_bucket>=cfg.whatsapp_live_canary_percent then
    return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',false,'reason','live_canary_human_control','mode','live','cohort','human_control','bucket',v_bucket,'canary_percent',cfg.whatsapp_live_canary_percent);
  end if;

  if not v_existing then
    select count(*) into v_new_last_hour from public.conversations c
     where c.whatsapp_account_id is not null
       and c.created_at>=now()-interval '1 hour'
       and c.automation_cohort='ai_canary';
    if v_new_last_hour>=cfg.whatsapp_live_max_new_conversations_per_hour then
      return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',false,'reason','live_new_conversation_cap_human_control','mode','live','cohort','human_control','bucket',v_bucket,'new_conversations_last_hour',v_new_last_hour);
    end if;
  end if;

  return jsonb_build_object('allow_ingest',true,'auto_reply_allowed',true,'reason','live_canary_ai','mode','live','cohort','ai_canary','bucket',v_bucket,'canary_percent',cfg.whatsapp_live_canary_percent);
end;
$$;

create or replace function public.arm_whatsapp_live_homologation_for_conversation_v1(
  p_conversation_id uuid,
  p_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  c public.conversations%rowtype;
  v_phone text;
  v_minutes integer;
  v_expires timestamptz;
  v_claimed integer;
  v_manual integer;
begin
  select * into cfg from public.automation_config where id=1;
  if not found or cfg.whatsapp_release_mode<>'live' then raise exception 'live_mode_required'; end if;
  if coalesce(cfg.bling_order_sync_enabled,false) or coalesce(cfg.whatsapp_sales_bling_submit_enabled,false) then raise exception 'bling_must_be_off_for_homologation'; end if;

  select * into c from public.conversations where id=p_conversation_id for update;
  if not found or c.channel<>'whatsapp' or c.whatsapp_account_id is null then raise exception 'whatsapp_conversation_required'; end if;
  v_phone:='+'||public.normalize_phone_digits(c.wa_contact_e164);
  if v_phone !~ '^\+[0-9]{10,15}$' then raise exception 'invalid_test_phone'; end if;

  select count(*) into v_claimed from public.human_handoffs where conversation_id=c.id and status='claimed';
  if v_claimed>0 then raise exception 'handoff_claimed_by_human'; end if;
  select count(*) into v_manual from public.human_handoffs
   where conversation_id=c.id and status='open'
     and reason not in ('live_canary_human_control','live_new_conversation_cap_human_control','release_human_control');
  if v_manual>0 then raise exception 'manual_handoff_active'; end if;

  v_minutes:=greatest(5,least(coalesce(p_minutes,30),60));
  v_expires:=now()+make_interval(mins=>v_minutes);

  update public.whatsapp_test_allowlist
     set enabled=false,updated_at=now()
   where enabled=true and purpose='controlled_live_homologation';

  insert into public.whatsapp_test_allowlist(phone_e164,purpose,enabled,expires_at)
  values(v_phone,'controlled_live_homologation',true,v_expires)
  on conflict(phone_e164) do update
    set purpose='controlled_live_homologation',enabled=true,expires_at=excluded.expires_at,updated_at=now();

  update public.human_handoffs
     set status='resolved',resolved_at=now(),resolution_notes='controlled_live_homologation',updated_at=now()
   where conversation_id=c.id and status='open'
     and reason in ('live_canary_human_control','live_new_conversation_cap_human_control','release_human_control');

  update public.conversations
     set mode='ai',human_required=false,status='open',automation_cohort='homologation',updated_at=now()
   where id=c.id;

  insert into public.whatsapp_ops_events(event_type,severity,conversation_id,details)
  values('controlled_live_homologation_armed','warning',c.id,
    jsonb_build_object('expires_at',v_expires,'global_canary_percent',cfg.whatsapp_live_canary_percent,'bling_enabled',false));

  return jsonb_build_object('ok',true,'conversation_id',c.id,'expires_at',v_expires,'profile','controlled_live_homologation','global_canary_percent',cfg.whatsapp_live_canary_percent);
end;
$$;

create or replace function public.close_whatsapp_live_homologation_for_conversation_v1(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare c public.conversations%rowtype; v_phone text;
begin
  select * into c from public.conversations where id=p_conversation_id for update;
  if not found then raise exception 'conversation_not_found'; end if;
  v_phone:='+'||public.normalize_phone_digits(c.wa_contact_e164);
  update public.whatsapp_test_allowlist set enabled=false,updated_at=now()
   where phone_e164=v_phone and purpose='controlled_live_homologation';
  insert into public.whatsapp_ops_events(event_type,severity,conversation_id,details)
  values('controlled_live_homologation_closed','info',c.id,'{}'::jsonb);
  return jsonb_build_object('ok',true,'closed',true,'conversation_id',c.id);
end;
$$;

revoke all on function public.whatsapp_release_decision(text,timestamptz) from public,anon,authenticated;
revoke all on function public.arm_whatsapp_live_homologation_for_conversation_v1(uuid,integer) from public,anon,authenticated;
revoke all on function public.close_whatsapp_live_homologation_for_conversation_v1(uuid) from public,anon,authenticated;
grant execute on function public.whatsapp_release_decision(text,timestamptz) to service_role;
grant execute on function public.arm_whatsapp_live_homologation_for_conversation_v1(uuid,integer) to service_role;
grant execute on function public.close_whatsapp_live_homologation_for_conversation_v1(uuid) to service_role;

commit;
