begin;

-- Hardening V1.1: anti-replay, máquina de estados e budget por sessão.
-- Continua 100% dormente: não habilita Data Exchange, envio, Flow, carrinho ou Bling.
alter table public.automation_config
  add column if not exists whatsapp_flow_max_exchanges_per_session smallint not null default 40;

alter table public.experience_sessions
  add column if not exists flow_current_screen text,
  add column if not exists flow_state_version integer not null default 0,
  add column if not exists flow_last_request_fingerprint text;

alter table public.whatsapp_flow_exchange_events
  add column if not exists is_replay boolean not null default false;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='automation_config_flow_exchange_budget_check') then
    alter table public.automation_config add constraint automation_config_flow_exchange_budget_check
      check (whatsapp_flow_max_exchanges_per_session between 5 and 200);
  end if;
  if not exists(select 1 from pg_constraint where conname='experience_sessions_flow_screen_check') then
    alter table public.experience_sessions add constraint experience_sessions_flow_screen_check
      check (flow_current_screen is null or flow_current_screen ~ '^[A-Z0-9_:-]{1,120}$');
  end if;
  if not exists(select 1 from pg_constraint where conname='experience_sessions_flow_state_version_check') then
    alter table public.experience_sessions add constraint experience_sessions_flow_state_version_check
      check (flow_state_version between 0 and 1000000);
  end if;
  if not exists(select 1 from pg_constraint where conname='experience_sessions_flow_fingerprint_check') then
    alter table public.experience_sessions add constraint experience_sessions_flow_fingerprint_check
      check (flow_last_request_fingerprint is null or flow_last_request_fingerprint ~ '^[0-9a-f]{64}$');
  end if;
end $$;

create table if not exists public.whatsapp_flow_request_guard (
  request_fingerprint text primary key,
  request_id text not null,
  session_id uuid references public.experience_sessions(id) on delete set null,
  action text not null,
  screen text,
  first_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  constraint whatsapp_flow_request_guard_fingerprint_check check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_flow_request_guard_action_check check (action ~ '^[A-Za-z0-9_:-]{1,80}$'),
  constraint whatsapp_flow_request_guard_screen_check check (screen is null or screen ~ '^[A-Za-z0-9_:-]{1,120}$')
);
create index if not exists idx_whatsapp_flow_request_guard_expires
  on public.whatsapp_flow_request_guard(expires_at);

alter table public.whatsapp_flow_request_guard enable row level security;
revoke all on table public.whatsapp_flow_request_guard from public,anon,authenticated;
grant select,insert,update,delete on table public.whatsapp_flow_request_guard to service_role;

create or replace function public.claim_whatsapp_flow_request_v1(
  p_request_fingerprint text,
  p_request_id text,
  p_session_id uuid default null,
  p_action text default 'unknown',
  p_screen text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_fingerprint text:=lower(trim(coalesce(p_request_fingerprint,'')));
  v_request_id text:=left(trim(coalesce(p_request_id,'')),120);
  v_action text:=left(trim(coalesce(p_action,'unknown')),80);
  v_screen text:=nullif(left(trim(coalesce(p_screen,'')),120),'');
  v_rows integer:=0;
  v_expires timestamptz;
begin
  if v_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false,'claimed',false,'replay',false,'reason','invalid_request_fingerprint');
  end if;
  if v_request_id='' then raise exception 'request_id_required'; end if;
  if v_action !~ '^[A-Za-z0-9_:-]{1,80}$' then v_action:='invalid_action'; end if;
  if v_screen is not null and v_screen !~ '^[A-Za-z0-9_:-]{1,120}$' then v_screen:=null; end if;

  -- Permite reuso da impressão digital somente depois do TTL; sessões normais expiram muito antes disso.
  delete from public.whatsapp_flow_request_guard
   where request_fingerprint=v_fingerprint and expires_at<=now();

  insert into public.whatsapp_flow_request_guard(request_fingerprint,request_id,session_id,action,screen)
  values(v_fingerprint,v_request_id,p_session_id,v_action,v_screen)
  on conflict(request_fingerprint) do nothing;
  get diagnostics v_rows=row_count;

  select expires_at into v_expires
    from public.whatsapp_flow_request_guard where request_fingerprint=v_fingerprint;

  return jsonb_build_object(
    'ok',true,
    'claimed',(v_rows=1),
    'replay',(v_rows=0),
    'request_fingerprint',v_fingerprint,
    'expires_at',v_expires
  );
end;
$$;

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
         flow_current_screen=null,
         flow_state_version=0,
         flow_last_request_fingerprint=null,
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

create or replace function public.resolve_whatsapp_flow_token_v1(p_flow_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_token text:=trim(coalesce(p_flow_token,''));
  v_hash text;
  s public.experience_sessions%rowtype;
  d public.experience_definitions%rowtype;
  c public.conversations%rowtype;
begin
  if length(v_token)<32 or length(v_token)>200 then return jsonb_build_object('ok',false,'reason','invalid_flow_token'); end if;
  v_hash:=encode(extensions.digest(v_token,'sha256'),'hex');
  select * into s from public.experience_sessions where flow_token_hash=v_hash;
  if not found then return jsonb_build_object('ok',false,'reason','flow_session_not_found'); end if;
  select * into d from public.experience_definitions where id=s.definition_id;
  select * into c from public.conversations where id=s.conversation_id;
  if s.expires_at<=now() or s.status not in ('offered','open') then return jsonb_build_object('ok',false,'reason','flow_session_inactive','session_id',s.id); end if;
  if c.human_required or c.mode='human' then return jsonb_build_object('ok',false,'reason','conversation_requires_human','session_id',s.id); end if;
  return jsonb_build_object(
    'ok',true,
    'session_id',s.id,
    'conversation_id',s.conversation_id,
    'customer_id',s.customer_id,
    'definition_id',s.definition_id,
    'definition_slug',d.slug,
    'feature_key',d.feature_key,
    'context',s.context,
    'status',s.status,
    'expires_at',s.expires_at,
    'current_screen',s.flow_current_screen,
    'state_version',s.flow_state_version,
    'exchange_count',s.flow_exchange_count
  );
end;
$$;

-- A versão endurecida remove o overload antigo antes de recriar a assinatura com replay explícito.
drop function if exists public.handle_whatsapp_flow_exchange_v1(text,text,text,jsonb);
create function public.handle_whatsapp_flow_exchange_v1(
  p_flow_token text,
  p_action text,
  p_screen text default null,
  p_data jsonb default '{}'::jsonb,
  p_request_fingerprint text default null,
  p_is_replay boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  a public.automation_config%rowtype;
  r jsonb;
  s public.experience_sessions%rowtype;
  v_session_id uuid;
  v_definition text;
  v_context jsonb;
  v_basket_text text;
  v_basket_id uuid;
  v_validation jsonb;
  v_screen text:=coalesce(nullif(trim(p_screen),''),'');
  v_action text:=coalesce(nullif(trim(p_action),''),'');
  v_fingerprint text:=nullif(lower(trim(coalesce(p_request_fingerprint,''))),'');
  v_replay boolean:=coalesce(p_is_replay,false);
  v_current text;
  v_next_version integer;
  v_mode text;
  v_human boolean;
begin
  select * into a from public.automation_config where id=1;
  if not a.whatsapp_flow_data_exchange_enabled then
    return jsonb_build_object('ok',false,'reason','whatsapp_flow_data_exchange_disabled');
  end if;
  if v_fingerprint is not null and v_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok',false,'reason','invalid_request_fingerprint');
  end if;

  r:=public.resolve_whatsapp_flow_token_v1(p_flow_token);
  if not coalesce((r->>'ok')::boolean,false) then return jsonb_build_object('ok',false,'reason',r->>'reason'); end if;
  v_session_id:=(r->>'session_id')::uuid;
  v_definition:=r->>'definition_slug';
  v_context:=coalesce(r->'context','{}'::jsonb);

  -- Lock de sessão + revalidação do takeover humano fecham corrida entre resolve e execução.
  select * into s from public.experience_sessions where id=v_session_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','flow_session_not_found'); end if;
  select c.mode,c.human_required into v_mode,v_human from public.conversations c where c.id=s.conversation_id;
  if coalesce(v_human,false) or v_mode='human' then return jsonb_build_object('ok',false,'reason','conversation_requires_human','session_id',s.id); end if;
  if s.expires_at<=now() or s.status not in ('offered','open') then return jsonb_build_object('ok',false,'reason','flow_session_inactive','session_id',s.id); end if;
  if s.flow_exchange_count>=a.whatsapp_flow_max_exchanges_per_session then
    return jsonb_build_object('ok',false,'reason','flow_exchange_limit_reached','session_id',s.id,'exchange_count',s.flow_exchange_count);
  end if;

  if v_definition<>'flow-personalizar-cesta-v1' then
    return jsonb_build_object('ok',false,'reason','flow_definition_handler_not_implemented','session_id',v_session_id);
  end if;

  v_basket_text:=coalesce(v_context->>'basket_id','');
  if v_basket_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('ok',false,'reason','basket_context_missing','session_id',v_session_id);
  end if;
  v_basket_id:=v_basket_text::uuid;
  v_current:=coalesce(s.flow_current_screen,'');

  if v_action='INIT' then
    if v_replay then
      if v_current='BASKET_REVIEW' then
        return jsonb_build_object('ok',true,'session_id',v_session_id,'replayed',true,
          'response',jsonb_build_object('screen','BASKET_REVIEW','data',jsonb_build_object(
            'write_enabled',false,'replayed',true,'state_version',s.flow_state_version,
            'message','Esta sessão já avançou para revisão.'
          )));
      end if;
      return jsonb_build_object('ok',true,'session_id',v_session_id,'replayed',true,
        'response',jsonb_build_object('screen','BASKET_EDIT','data',
          public.build_basket_flow_context_v1((r->>'conversation_id')::uuid,v_basket_id)
          ||jsonb_build_object('replayed',true,'state_version',s.flow_state_version)));
    end if;

    if v_current not in ('','BASKET_EDIT') then
      return jsonb_build_object('ok',false,'reason','flow_transition_invalid','session_id',s.id,'expected_screen',v_current,'received_action',v_action);
    end if;
    v_next_version:=s.flow_state_version+case when v_current='' then 1 else 0 end;
    update public.experience_sessions
       set flow_current_screen='BASKET_EDIT',
           flow_state_version=v_next_version,
           flow_last_request_fingerprint=coalesce(v_fingerprint,flow_last_request_fingerprint),
           updated_at=now()
     where id=s.id;
    return jsonb_build_object(
      'ok',true,'session_id',v_session_id,'state_version',v_next_version,
      'response',jsonb_build_object(
        'screen','BASKET_EDIT',
        'data',public.build_basket_flow_context_v1((r->>'conversation_id')::uuid,v_basket_id)
          ||jsonb_build_object('state_version',v_next_version)
      )
    );
  end if;

  if v_action='data_exchange' and v_screen='BASKET_EDIT' then
    v_validation:=public.validate_basket_flow_selection_v1(v_basket_id,coalesce(p_data->'selection','null'::jsonb));
    if v_replay then
      if coalesce((v_validation->>'valid')::boolean,false) then
        return jsonb_build_object('ok',true,'session_id',v_session_id,'replayed',true,
          'response',jsonb_build_object('screen','BASKET_REVIEW','data',jsonb_build_object(
            'validation',v_validation,'write_enabled',false,'replayed',true,'state_version',s.flow_state_version,
            'message','Repetição reconhecida; nenhuma ação foi aplicada novamente.'
          )));
      end if;
      return jsonb_build_object('ok',true,'session_id',v_session_id,'replayed',true,
        'response',jsonb_build_object('screen','BASKET_EDIT','data',jsonb_build_object(
          'validation',v_validation,'write_enabled',false,'replayed',true,'state_version',s.flow_state_version
        )));
    end if;

    if v_current<>'BASKET_EDIT' then
      return jsonb_build_object('ok',false,'reason','flow_transition_invalid','session_id',s.id,'expected_screen',v_current,'received_screen',v_screen);
    end if;
    if coalesce((v_validation->>'valid')::boolean,false) then
      v_next_version:=s.flow_state_version+1;
      update public.experience_sessions
         set flow_current_screen='BASKET_REVIEW',flow_state_version=v_next_version,
             flow_last_request_fingerprint=coalesce(v_fingerprint,flow_last_request_fingerprint),updated_at=now()
       where id=s.id;
      return jsonb_build_object(
        'ok',true,'session_id',v_session_id,'state_version',v_next_version,
        'response',jsonb_build_object(
          'screen','BASKET_REVIEW',
          'data',jsonb_build_object(
            'validation',v_validation,
            'write_enabled',false,
            'state_version',v_next_version,
            'message','Revise sua seleção. A aplicação no carrinho ainda está desativada nesta fase de homologação.'
          )
        )
      );
    end if;
    update public.experience_sessions
       set flow_last_request_fingerprint=coalesce(v_fingerprint,flow_last_request_fingerprint),updated_at=now()
     where id=s.id;
    return jsonb_build_object(
      'ok',true,'session_id',v_session_id,'state_version',s.flow_state_version,
      'response',jsonb_build_object(
        'screen','BASKET_EDIT',
        'data',jsonb_build_object('validation',v_validation,'write_enabled',false,'state_version',s.flow_state_version)
      )
    );
  end if;

  if v_action='data_exchange' and v_screen='BASKET_REVIEW' then
    if not v_replay and v_current<>'BASKET_REVIEW' then
      return jsonb_build_object('ok',false,'reason','flow_transition_invalid','session_id',s.id,'expected_screen',v_current,'received_screen',v_screen);
    end if;
    if not v_replay then
      update public.experience_sessions
         set flow_last_request_fingerprint=coalesce(v_fingerprint,flow_last_request_fingerprint),updated_at=now()
       where id=s.id;
    end if;
    return jsonb_build_object(
      'ok',true,'session_id',v_session_id,'replayed',v_replay,'state_version',s.flow_state_version,
      'response',jsonb_build_object(
        'screen','BASKET_REVIEW',
        'data',jsonb_build_object(
          'write_enabled',false,
          'replayed',v_replay,
          'state_version',s.flow_state_version,
          'error_code','flow_cart_apply_not_enabled',
          'message','A confirmação final ainda está desativada nesta fase de homologação.'
        )
      )
    );
  end if;

  return jsonb_build_object('ok',false,'reason','flow_action_not_handled','session_id',v_session_id,'expected_screen',v_current);
end;
$$;

-- Auditoria sem payload: registra somente metadados operacionais e se foi replay.
drop function if exists public.record_whatsapp_flow_exchange_v1(uuid,text,text,text,text,text);
create function public.record_whatsapp_flow_exchange_v1(
  p_session_id uuid,
  p_request_id text,
  p_action text,
  p_screen text,
  p_status text,
  p_error_code text default null,
  p_is_replay boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.experience_sessions%rowtype;
  d public.experience_definitions%rowtype;
  v_action text:=left(trim(coalesce(p_action,'unknown')),80);
  v_screen text:=nullif(left(trim(coalesce(p_screen,'')),120),'');
  v_status text:=lower(trim(coalesce(p_status,'error')));
  v_error text:=nullif(left(trim(coalesce(p_error_code,'')),120),'');
begin
  if v_action !~ '^[A-Za-z0-9_:-]{1,80}$' then v_action:='invalid_action'; end if;
  if v_status not in ('accepted','rejected','error','acknowledged') then v_status:='error'; end if;
  select * into s from public.experience_sessions where id=p_session_id for update;
  if not found then raise exception 'experience_session_not_found'; end if;
  select * into d from public.experience_definitions where id=s.definition_id;
  update public.experience_sessions
     set flow_last_exchange_at=now(),flow_exchange_count=flow_exchange_count+1,updated_at=now()
   where id=s.id;
  insert into public.whatsapp_flow_exchange_events(session_id,conversation_id,definition_id,request_id,action,screen,status,error_code,is_replay)
  values(s.id,s.conversation_id,s.definition_id,nullif(left(trim(coalesce(p_request_id,'')),120),''),v_action,v_screen,v_status,v_error,coalesce(p_is_replay,false));
  return jsonb_build_object('ok',true,'session_id',s.id,'action',v_action,'status',v_status,'replayed',coalesce(p_is_replay,false));
end;
$$;

-- Readiness expõe budgets/hardening, sem oferecer qualquer botão de ativação.
create or replace function public.get_whatsapp_flow_transport_readiness_v1()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'data_exchange_enabled',a.whatsapp_flow_data_exchange_enabled,
    'send_enabled',a.whatsapp_flow_send_enabled,
    'orchestrator_enabled',a.experience_orchestrator_enabled,
    'private_key_configured',coalesce(s.is_active,false),
    'public_key_configured',(coalesce(t.public_key_pem,'')<>''),
    'public_key_fingerprint',t.public_key_fingerprint,
    'key_version',t.key_version,
    'meta_signature_status',t.meta_signature_status,
    'meta_signature_checked_at',t.meta_signature_checked_at,
    'protocol_version',t.protocol_version,
    'max_exchanges_per_session',a.whatsapp_flow_max_exchanges_per_session,
    'replay_guard_enabled',true,
    'state_machine_enabled',true,
    'ready_flow_definitions',(select count(*) from public.experience_definitions d where d.experience_type='whatsapp_flow' and d.status in ('ready','active') and coalesce(d.provider_id,'')<>''),
    'active_flow_sessions',(select count(*) from public.experience_sessions es join public.experience_definitions d on d.id=es.definition_id where d.experience_type='whatsapp_flow' and es.status in ('offered','open') and es.expires_at>now()),
    'transport_ready',(
      a.experience_orchestrator_enabled
      and a.whatsapp_flow_data_exchange_enabled
      and coalesce(s.is_active,false)
      and coalesce(t.public_key_pem,'')<>''
      and t.meta_signature_status='valid'
    ),
    'send_ready',(
      a.experience_orchestrator_enabled
      and a.whatsapp_flow_send_enabled
      and a.whatsapp_flow_data_exchange_enabled
      and coalesce(s.is_active,false)
      and coalesce(t.public_key_pem,'')<>''
      and t.meta_signature_status='valid'
      and exists(select 1 from public.experience_definitions d where d.experience_type='whatsapp_flow' and d.status in ('ready','active') and coalesce(d.provider_id,'')<>'')
    )
  )
  from public.automation_config a
  cross join public.whatsapp_flow_transport_config t
  left join public.system_secrets s on s.key_name='whatsapp_flow_private_key_v1'
  where a.id=1 and t.id=1;
$$;

revoke all on function public.claim_whatsapp_flow_request_v1(text,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.issue_whatsapp_flow_token_v1(uuid) from public,anon,authenticated;
revoke all on function public.resolve_whatsapp_flow_token_v1(text) from public,anon,authenticated;
revoke all on function public.handle_whatsapp_flow_exchange_v1(text,text,text,jsonb,text,boolean) from public,anon,authenticated;
revoke all on function public.record_whatsapp_flow_exchange_v1(uuid,text,text,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.get_whatsapp_flow_transport_readiness_v1() from public,anon,authenticated;

grant execute on function public.claim_whatsapp_flow_request_v1(text,text,uuid,text,text) to service_role;
grant execute on function public.issue_whatsapp_flow_token_v1(uuid) to service_role;
grant execute on function public.resolve_whatsapp_flow_token_v1(text) to service_role;
grant execute on function public.handle_whatsapp_flow_exchange_v1(text,text,text,jsonb,text,boolean) to service_role;
grant execute on function public.record_whatsapp_flow_exchange_v1(uuid,text,text,text,text,text,boolean) to service_role;
grant execute on function public.get_whatsapp_flow_transport_readiness_v1() to service_role;

commit;
