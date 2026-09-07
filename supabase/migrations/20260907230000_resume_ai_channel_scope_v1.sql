begin;

-- Corrige o escopo do gate de release ao devolver uma conversa para IA.
-- conversations.whatsapp_account_id é obrigatório mesmo para canal web; portanto
-- ele não pode ser usado como sinal de que a conversa depende do release WhatsApp.
create or replace function public.resume_conversation_ai_admin_v1(
  p_conversation_id uuid,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  c public.conversations%rowtype;
  v_ok boolean;
  v_release jsonb;
begin
  select exists(
    select 1
      from public.admin_users
     where user_id=p_admin_user_id
       and is_active=true
       and role in ('owner','operator')
  ) into v_ok;

  if not v_ok then
    raise exception 'admin_not_authorized';
  end if;

  if exists(
    select 1
      from public.human_handoffs
     where conversation_id=p_conversation_id
       and status in ('open','claimed')
  ) then
    raise exception 'active_handoff_must_be_resolved';
  end if;

  select * into c
    from public.conversations
   where id=p_conversation_id
   for update;

  if not found then
    raise exception 'conversation_not_found';
  end if;

  -- Somente canais que realmente dependem do WhatsApp precisam pertencer
  -- a um cohort com auto-reply liberado. Canal web/Sala pode retomar IA
  -- independentemente de whatsapp_release_mode.
  if c.channel in ('whatsapp','hybrid') then
    v_release:=public.whatsapp_release_decision(c.wa_contact_e164,now());
    if coalesce((v_release->>'auto_reply_allowed')::boolean,false) is not true then
      raise exception 'conversation_not_in_ai_release_cohort';
    end if;
  end if;

  update public.conversations
     set mode='ai',
         human_required=false,
         status='open',
         assigned_admin_user_id=null,
         ai_resume_at=now(),
         automation_cohort=case
           when c.channel in ('whatsapp','hybrid')
             then coalesce(v_release->>'cohort',automation_cohort)
           else automation_cohort
         end,
         updated_at=now()
   where id=p_conversation_id;

  insert into public.whatsapp_ops_events(event_type,severity,conversation_id,details)
  values(
    'conversation_ai_resumed',
    'info',
    p_conversation_id,
    jsonb_build_object('channel',c.channel,'admin_user_id',p_admin_user_id)
  );

  return jsonb_build_object(
    'ok',true,
    'conversation_id',p_conversation_id,
    'mode','ai',
    'channel',c.channel
  );
end;
$$;

revoke all on function public.resume_conversation_ai_admin_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.resume_conversation_ai_admin_v1(uuid,uuid) to service_role;

commit;
