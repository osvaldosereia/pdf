begin;

-- Defense in depth: tokens só podem nascer quando TODO o transporte estiver pronto.
create or replace function public.issue_whatsapp_flow_token_v1(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  a public.automation_config%rowtype;
  s public.experience_sessions%rowtype;
  d public.experience_definitions%rowtype;
  v_feature jsonb;
  v_readiness jsonb;
  v_token text;
  v_hash text;
  v_protocol text;
begin
  select * into a from public.automation_config where id=1;
  if not a.experience_orchestrator_enabled then raise exception 'experience_orchestrator_disabled'; end if;
  if not a.whatsapp_flow_data_exchange_enabled then raise exception 'whatsapp_flow_data_exchange_disabled'; end if;
  if not a.whatsapp_flow_send_enabled then raise exception 'whatsapp_flow_send_disabled'; end if;

  v_readiness:=public.get_whatsapp_flow_transport_readiness_v1();
  if not coalesce((v_readiness->>'send_ready')::boolean,false) then
    raise exception 'whatsapp_flow_transport_not_ready';
  end if;

  select * into s from public.experience_sessions where id=p_session_id for update;
  if not found then raise exception 'experience_session_not_found'; end if;
  if s.status not in ('offered','open') then raise exception 'experience_session_not_launchable'; end if;
  if s.expires_at<=now() then raise exception 'experience_session_expired'; end if;

  select * into d from public.experience_definitions where id=s.definition_id;
  if d.experience_type<>'whatsapp_flow' then raise exception 'experience_not_whatsapp_flow'; end if;
  if d.status not in ('ready','active') or coalesce(d.provider_id,'')='' then raise exception 'whatsapp_flow_provider_not_ready'; end if;
  v_feature:=public.experience_feature_state_v1(d.feature_key,s.conversation_id);
  if not coalesce((v_feature->>'enabled')::boolean,false) then raise exception 'experience_feature_disabled'; end if;

  v_token:=encode(extensions.gen_random_bytes(24),'hex');
  v_hash:=encode(extensions.digest(v_token,'sha256'),'hex');
  select protocol_version into v_protocol from public.whatsapp_flow_transport_config where id=1;

  update public.experience_sessions
     set flow_token_hash=v_hash,
         flow_token_issued_at=now(),
         flow_last_exchange_at=null,
         flow_exchange_count=0,
         updated_at=now()
   where id=s.id;

  insert into public.experience_events(conversation_id,session_id,definition_id,event_type,interface_type,cohort,event_data)
  select s.conversation_id,s.id,s.definition_id,'flow_token_issued','whatsapp_flow',c.automation_cohort,
         jsonb_build_object('definition_slug',d.slug,'provider_id',d.provider_id,'protocol_version',v_protocol)
    from public.conversations c where c.id=s.conversation_id;

  return jsonb_build_object(
    'ok',true,
    'session_id',s.id,
    'flow_token',v_token,
    'flow_id',d.provider_id,
    'flow_message_version',v_protocol,
    'flow_action',coalesce(nullif(d.config->>'flow_action',''),'data_exchange'),
    'flow_cta',coalesce(nullif(d.config->>'flow_cta',''),'Personalizar'),
    'definition_slug',d.slug,
    'expires_at',s.expires_at
  );
end;
$$;

-- O handler também revalida o gate, mesmo sendo chamado por service_role.
create or replace function public.handle_whatsapp_flow_exchange_v1(
  p_flow_token text,
  p_action text,
  p_screen text default null,
  p_data jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  a public.automation_config%rowtype;
  r jsonb;
  v_session_id uuid;
  v_definition text;
  v_context jsonb;
  v_basket_text text;
  v_basket_id uuid;
  v_validation jsonb;
  v_screen text:=coalesce(nullif(trim(p_screen),''),'');
  v_action text:=coalesce(nullif(trim(p_action),''),'');
begin
  select * into a from public.automation_config where id=1;
  if not a.whatsapp_flow_data_exchange_enabled then
    return jsonb_build_object('ok',false,'reason','whatsapp_flow_data_exchange_disabled');
  end if;

  r:=public.resolve_whatsapp_flow_token_v1(p_flow_token);
  if not coalesce((r->>'ok')::boolean,false) then return jsonb_build_object('ok',false,'reason',r->>'reason'); end if;
  v_session_id:=(r->>'session_id')::uuid;
  v_definition:=r->>'definition_slug';
  v_context:=coalesce(r->'context','{}'::jsonb);

  if v_definition<>'flow-personalizar-cesta-v1' then
    return jsonb_build_object('ok',false,'reason','flow_definition_handler_not_implemented','session_id',v_session_id);
  end if;

  v_basket_text:=coalesce(v_context->>'basket_id','');
  if v_basket_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok',false,'reason','basket_context_missing','session_id',v_session_id);
  end if;
  v_basket_id:=v_basket_text::uuid;

  if v_action='INIT' then
    return jsonb_build_object(
      'ok',true,
      'session_id',v_session_id,
      'response',jsonb_build_object(
        'screen','BASKET_EDIT',
        'data',public.build_basket_flow_context_v1((r->>'conversation_id')::uuid,v_basket_id)
      )
    );
  end if;

  if v_action='data_exchange' and v_screen='BASKET_EDIT' then
    v_validation:=public.validate_basket_flow_selection_v1(v_basket_id,coalesce(p_data->'selection','null'::jsonb));
    if coalesce((v_validation->>'valid')::boolean,false) then
      return jsonb_build_object(
        'ok',true,
        'session_id',v_session_id,
        'response',jsonb_build_object(
          'screen','BASKET_REVIEW',
          'data',jsonb_build_object(
            'validation',v_validation,
            'write_enabled',false,
            'message','Revise sua seleção. A aplicação no carrinho ainda está desativada nesta fase de homologação.'
          )
        )
      );
    end if;
    return jsonb_build_object(
      'ok',true,
      'session_id',v_session_id,
      'response',jsonb_build_object(
        'screen','BASKET_EDIT',
        'data',jsonb_build_object('validation',v_validation,'write_enabled',false)
      )
    );
  end if;

  if v_action='data_exchange' and v_screen='BASKET_REVIEW' then
    return jsonb_build_object(
      'ok',true,
      'session_id',v_session_id,
      'response',jsonb_build_object(
        'screen','BASKET_REVIEW',
        'data',jsonb_build_object(
          'write_enabled',false,
          'error_code','flow_cart_apply_not_enabled',
          'message','A confirmação final ainda está desativada nesta fase de homologação.'
        )
      )
    );
  end if;

  return jsonb_build_object('ok',false,'reason','flow_action_not_handled','session_id',v_session_id);
end;
$$;

revoke all on function public.issue_whatsapp_flow_token_v1(uuid) from public,anon,authenticated;
revoke all on function public.handle_whatsapp_flow_exchange_v1(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.issue_whatsapp_flow_token_v1(uuid) to service_role;
grant execute on function public.handle_whatsapp_flow_exchange_v1(text,text,text,jsonb) to service_role;

commit;
