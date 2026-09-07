begin;

-- Reabre o menu deterministico para saudacoes curtas/comando "menu" mesmo quando
-- a conversa ja existe. Evita silencio durante homologacao com IA desligada e
-- reduz chamadas de IA desnecessarias em producao.
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
begin
  v_release:=public.whatsapp_release_decision(p_from,p_message_timestamp);
  if coalesce((v_release->>'allow_ingest')::boolean,false) is not true then
    return jsonb_build_object(
      'ok',true,
      'ignored',true,
      'reason',coalesce(v_release->>'reason','release_blocked'),
      'release_mode',v_release->>'mode',
      'should_reply',false
    );
  end if;

  v_result:=public.ingest_whatsapp_message_core_v1(
    p_phone_number_id,p_waba_id,p_from,p_profile_name,p_message_id,p_message_timestamp,p_message_type,
    p_body_text,p_media_id,p_interactive_payload,p_referral,p_raw_event
  );

  -- Nao interfere em duplicatas, bloqueios, modo humano ou respostas ja decididas.
  if coalesce((v_result->>'ok')::boolean,false)=true
     and coalesce((v_result->>'duplicate')::boolean,false)=false
     and coalesce((v_result->>'should_reply')::boolean,false)=false
     and coalesce(v_result->>'mode','')='ai'
     and p_message_type='text' then

    v_body:=translate(
      lower(trim(regexp_replace(coalesce(p_body_text,''),'\s+',' ','g'))),
      'áàãâéêíóôõúç',
      'aaaaeeiooouc'
    );
    v_body:=regexp_replace(v_body,'[.!?,;:]+$','','g');

    if v_body in (
      'oi','oii','oiii','ola','olaa','olaaa',
      'bom dia','boa tarde','boa noite',
      'menu','inicio','iniciar','comecar'
    ) then
      select * into v_cfg from public.automation_config where id=1;

      if coalesce(v_cfg.whatsapp_auto_reply_enabled,false)
         and coalesce(v_cfg.automation_enabled,false)
         and coalesce(v_cfg.outbound_enabled,false) then
        select jsonb_build_object(
          'kind','interactive_buttons',
          'body_text',qr.body_text,
          'buttons',qr.metadata->'buttons'
        ) into v_welcome
        from public.quick_replies qr
        where qr.key='welcome_menu' and qr.is_active=true
        limit 1;

        if v_welcome is not null then
          v_result:=jsonb_set(v_result,'{should_reply}','true'::jsonb,true);
          v_result:=jsonb_set(v_result,'{reply}',v_welcome,true);
          v_result:=v_result||jsonb_build_object('menu_reason','greeting_or_menu_command');
        end if;
      end if;
    end if;
  end if;

  return v_result;
end;
$$;

revoke all on function public.ingest_whatsapp_message(
  text,text,text,text,text,timestamptz,text,text,text,jsonb,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.ingest_whatsapp_message(
  text,text,text,text,text,timestamptz,text,text,text,jsonb,jsonb,jsonb
) to service_role;

commit;
