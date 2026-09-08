begin;

-- Fast-path determinístico para saudações curtas do MVP de vendas.
-- Objetivos: reduzir custo/latência e impedir que histórico comercial antigo
-- transforme uma saudação simples em ação de carrinho.
create or replace function public.whatsapp_sales_greeting_ai_job_fastpath_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  m public.messages%rowtype;
  c public.conversations%rowtype;
  v_text text;
  v_norm text;
  v_reply jsonb;
begin
  if new.status <> 'pending' or new.job_type <> 'conversation' or new.message_id is null then
    return new;
  end if;

  select * into cfg from public.automation_config where id=1;
  if not found or not coalesce(
    cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and
    cfg.whatsapp_sales_mvp_enabled and cfg.outbound_enabled and
    cfg.whatsapp_inbound_enabled and cfg.whatsapp_auto_reply_enabled,
    false
  ) then
    return new;
  end if;

  select * into m from public.messages where id=new.message_id;
  if not found or m.direction <> 'inbound' or m.message_type <> 'text' or coalesce(m.raw_event->>'source','') <> 'whatsapp' then
    return new;
  end if;

  select * into c from public.conversations where id=new.conversation_id;
  if not found or c.mode <> 'ai' or c.status='closed' or c.service_window_expires_at <= now() then
    return new;
  end if;

  v_text:=coalesce(m.body_text,m.transcript,'');
  v_norm:=translate(lower(trim(regexp_replace(v_text,'\s+',' ','g'))),'áàãâéêíóôõúç','aaaaeeiooouc');
  v_norm:=regexp_replace(v_norm,'[.!?,;:]+$','','g');

  if v_norm not in ('oi','oii','oiii','ola','olaa','olaaa','bom dia','boa tarde','boa noite','menu','inicio','iniciar') then
    return new;
  end if;

  begin
    v_reply:=public.queue_whatsapp_sales_reply_v1(
      new.conversation_id,
      new.message_id,
      'Oi! Pode me dizer o que você precisa. Eu consigo procurar produtos, montar e ajustar seu pedido por aqui.',
      'text',
      null,
      null,
      'greeting',
      jsonb_build_object('fast_path',true,'current_message_priority',true),
      1
    );

    new.status:='held';
    new.error_message:='deterministic_greeting_fastpath';
    new.result:=coalesce(new.result,'{}'::jsonb)||jsonb_build_object(
      'fast_path','greeting',
      'reply',coalesce(v_reply,'{}'::jsonb),
      'current_message_priority',true
    );

    insert into public.whatsapp_ops_events(event_type,severity,conversation_id,ai_job_id,details)
    values('sales_greeting_fastpath','info',new.conversation_id,new.id,
      jsonb_build_object('openai_called',false,'historical_intent_ignored',true));
  exception when others then
    -- Falha do fast-path não quebra ingestão; deixa o job seguir para o worker.
    insert into public.whatsapp_ops_events(event_type,severity,conversation_id,ai_job_id,details)
    values('sales_greeting_fastpath_failed','warning',new.conversation_id,new.id,
      jsonb_build_object('sqlstate',sqlstate));
  end;

  return new;
end;
$$;

-- Nome alfabeticamente anterior ao dispatcher para que o fast-path rode primeiro
-- entre triggers BEFORE INSERT existentes/futuros.
drop trigger if exists aa_whatsapp_sales_greeting_fastpath on public.ai_jobs;
create trigger aa_whatsapp_sales_greeting_fastpath
before insert on public.ai_jobs
for each row execute function public.whatsapp_sales_greeting_ai_job_fastpath_v1();

revoke all on function public.whatsapp_sales_greeting_ai_job_fastpath_v1() from public,anon,authenticated;
grant execute on function public.whatsapp_sales_greeting_ai_job_fastpath_v1() to service_role;

commit;
