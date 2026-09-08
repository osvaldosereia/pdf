begin;

-- Garante que nenhum fast-path determinístico produza efeitos externos antes
-- da decisão de release/canary. O nome do trigger começa com a0 para executar
-- antes de aa_whatsapp_sales_greeting_fastpath e dos triggers trg_* existentes.
create or replace function public.guard_whatsapp_ai_job_release_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  m public.messages%rowtype;
  c public.conversations%rowtype;
  release_decision jsonb;
begin
  if new.job_type <> 'conversation'
     or new.status <> 'pending'
     or new.message_id is null
     or new.conversation_id is null then
    return new;
  end if;

  select * into m
  from public.messages
  where id=new.message_id;

  if not found
     or m.direction <> 'inbound'
     or coalesce(m.raw_event->>'source','') <> 'whatsapp' then
    return new;
  end if;

  select * into c
  from public.conversations
  where id=new.conversation_id;

  if not found
     or c.channel not in ('whatsapp','hybrid')
     or c.wa_contact_e164 is null then
    return new;
  end if;

  release_decision:=public.whatsapp_release_decision(
    c.wa_contact_e164,
    coalesce(m.created_at,now())
  );

  if coalesce((release_decision->>'auto_reply_allowed')::boolean,false) is true then
    return new;
  end if;

  new.status:='held';
  new.error_message:='release_human_control_pre_gate';
  new.result:=coalesce(new.result,'{}'::jsonb)||jsonb_build_object(
    'release_pre_gate',release_decision,
    'deterministic_side_effects_blocked',true
  );
  new.updated_at:=now();
  return new;
end $$;

revoke all on function public.guard_whatsapp_ai_job_release_v1() from public,anon,authenticated;
grant execute on function public.guard_whatsapp_ai_job_release_v1() to service_role;

drop trigger if exists a0_whatsapp_release_gate_v1 on public.ai_jobs;
create trigger a0_whatsapp_release_gate_v1
before insert or update of status on public.ai_jobs
for each row execute function public.guard_whatsapp_ai_job_release_v1();

comment on function public.guard_whatsapp_ai_job_release_v1() is
'Pre-gate de release do WhatsApp: bloqueia fast paths determinísticos antes de qualquer resposta automática fora do cohort liberado.';

commit;
