begin;

-- Mantem o historico conversacional alinhado com o envio confirmado pela Meta.
-- O job ja e considerado enviado apenas depois de receber um provider_message_id valido.
create or replace function public.finish_outbound_job(
  p_job_id uuid,
  p_success boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_retry_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.outbound_jobs%rowtype;
  v_provider_id text;
  v_reply_message_id uuid;
  v_sent_at timestamptz;
begin
  select * into v from public.outbound_jobs where id=p_job_id for update;
  if not found then raise exception 'outbound_job_not_found'; end if;

  if p_success then
    v_provider_id:=nullif(trim(coalesce(p_provider_message_id,'')),'');

    update public.outbound_jobs
       set status='sent',
           provider_message_id=v_provider_id,
           last_error=null,
           sent_at=now(),
           locked_at=null,
           locked_by=null,
           updated_at=now()
     where id=p_job_id
     returning sent_at into v_sent_at;

    -- Metadata de rastreabilidade nao pode transformar uma entrega real em retry.
    -- Se houver qualquer problema aqui, preservamos o job como sent e apenas emitimos warning.
    begin
      if coalesce(v.payload->>'reply_message_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_reply_message_id:=(v.payload->>'reply_message_id')::uuid;

        update public.messages m
           set whatsapp_message_id=coalesce(m.whatsapp_message_id,v_provider_id),
               delivery_status='sent',
               updated_at=now()
         where m.id=v_reply_message_id
           and m.conversation_id=v.conversation_id
           and m.direction='outbound';
      end if;

      if v.conversation_id is not null then
        update public.conversations c
           set last_outbound_at=case
                 when c.last_outbound_at is null then v_sent_at
                 else greatest(c.last_outbound_at,v_sent_at)
               end,
               updated_at=now()
         where c.id=v.conversation_id;
      end if;
    exception when others then
      raise warning 'whatsapp_sent_metadata_update_failed job=%',p_job_id;
    end;
  else
    update public.outbound_jobs
       set status=case when attempts>=max_attempts then 'cancelled' else 'error' end,
           last_error=left(coalesce(p_error,'outbound_failed'),1800),
           not_before=now()+make_interval(secs=>greatest(30,least(coalesce(p_retry_seconds,120),3600))),
           locked_at=null,
           locked_by=null,
           updated_at=now()
     where id=p_job_id;
  end if;

  return jsonb_build_object('id',p_job_id,'success',p_success);
end;
$$;

revoke all on function public.finish_outbound_job(uuid,boolean,text,text,integer) from public,anon,authenticated;
grant execute on function public.finish_outbound_job(uuid,boolean,text,text,integer) to service_role;

-- Backfill generico de replies ja confirmados antes deste hotfix.
with sent_replies as (
  select
    o.id,
    o.conversation_id,
    o.provider_message_id,
    o.sent_at,
    (o.payload->>'reply_message_id')::uuid as reply_message_id
  from public.outbound_jobs o
  where o.job_type='seller_message'
    and o.status='sent'
    and nullif(trim(coalesce(o.provider_message_id,'')),'') is not null
    and coalesce(o.payload->>'reply_message_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
update public.messages m
   set whatsapp_message_id=coalesce(m.whatsapp_message_id,s.provider_message_id),
       delivery_status='sent',
       updated_at=now()
  from sent_replies s
 where m.id=s.reply_message_id
   and m.conversation_id=s.conversation_id
   and m.direction='outbound';

with sent_by_conversation as (
  select conversation_id,max(sent_at) as last_sent_at
  from public.outbound_jobs
  where job_type='seller_message'
    and status='sent'
    and conversation_id is not null
    and sent_at is not null
  group by conversation_id
)
update public.conversations c
   set last_outbound_at=case
         when c.last_outbound_at is null then s.last_sent_at
         else greatest(c.last_outbound_at,s.last_sent_at)
       end,
       updated_at=now()
  from sent_by_conversation s
 where c.id=s.conversation_id;

commit;
