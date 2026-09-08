begin;

-- Corrige incompatibilidade de tipo no fallback humano de ai_jobs.
-- queue_human_handoff_v1 exige smallint para priority; CASE sem cast retorna integer
-- e fazia qualquer transição de job para error/held falhar, quebrando a finalização do worker v3.
create or replace function public.ai_job_human_fallback_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_source text;
  v_cfg public.automation_config%rowtype;
begin
  if new.status not in ('error','held') or old.status is not distinct from new.status then
    return new;
  end if;

  select * into v_cfg from public.automation_config where id=1;
  if not coalesce(v_cfg.human_fallback_enabled,true) then
    return new;
  end if;

  select raw_event->>'source' into v_source
    from public.messages
   where id=new.message_id;

  if v_source='whatsapp'
     and (
       new.status='error'
       or coalesce(new.error_message,'') like '%human_required%'
       or new.error_message in ('release_human_control','lease_expired_review_required')
     ) then
    perform public.queue_human_handoff_v1(
      new.conversation_id,
      coalesce(new.error_message,'ai_job_review_required'),
      new.message_id,
      (case when new.status='error' then 4 else 3 end)::smallint,
      'A automação interrompeu este atendimento antes de uma nova resposta.',
      jsonb_build_object('ai_job_id',new.id,'job_type',new.job_type,'status',new.status)
    );
  end if;

  return new;
end
$$;

revoke all on function public.ai_job_human_fallback_trigger_v1() from public,anon,authenticated;
grant execute on function public.ai_job_human_fallback_trigger_v1() to service_role;

commit;
