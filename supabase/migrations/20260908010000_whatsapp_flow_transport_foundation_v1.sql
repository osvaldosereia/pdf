begin;

-- Dona Antônia — WhatsApp Flow Transport Foundation V1
-- Fundação criptográfica e de sessão para Data Exchange.
-- IMPORTANTE: tudo nasce desligado; não publica Flow, não envia WhatsApp e não toca no Bling.

alter table public.automation_config
  add column if not exists whatsapp_flow_data_exchange_enabled boolean not null default false,
  add column if not exists whatsapp_flow_send_enabled boolean not null default false;

alter table public.experience_sessions
  add column if not exists flow_token_hash text,
  add column if not exists flow_token_issued_at timestamptz,
  add column if not exists flow_last_exchange_at timestamptz,
  add column if not exists flow_exchange_count integer not null default 0;

create unique index if not exists idx_experience_sessions_flow_token_hash
  on public.experience_sessions(flow_token_hash)
  where flow_token_hash is not null;

create table if not exists public.whatsapp_flow_transport_config (
  id smallint primary key default 1,
  key_version integer not null default 0,
  public_key_pem text,
  public_key_fingerprint text,
  meta_signature_status text not null default 'unknown',
  meta_signature_checked_at timestamptz,
  protocol_version text not null default '3',
  updated_at timestamptz not null default now(),
  constraint whatsapp_flow_transport_singleton check (id=1),
  constraint whatsapp_flow_signature_status_check check (meta_signature_status in ('unknown','pending','valid','invalid')),
  constraint whatsapp_flow_protocol_version_check check (protocol_version ~ '^[0-9]+$')
);

insert into public.whatsapp_flow_transport_config(id)
values(1)
on conflict(id) do nothing;

create table if not exists public.whatsapp_flow_exchange_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.experience_sessions(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  definition_id uuid references public.experience_definitions(id) on delete set null,
  request_id text,
  action text not null,
  screen text,
  status text not null,
  error_code text,
  created_at timestamptz not null default now(),
  constraint whatsapp_flow_exchange_action_check check (action ~ '^[A-Za-z0-9_:-]{1,80}$'),
  constraint whatsapp_flow_exchange_status_check check (status in ('accepted','rejected','error','acknowledged'))
);

create index if not exists idx_whatsapp_flow_exchange_events_session
  on public.whatsapp_flow_exchange_events(session_id,created_at desc);
create index if not exists idx_whatsapp_flow_exchange_events_created
  on public.whatsapp_flow_exchange_events(created_at desc);

alter table public.whatsapp_flow_transport_config enable row level security;
alter table public.whatsapp_flow_exchange_events enable row level security;
revoke all on table public.whatsapp_flow_transport_config from public,anon,authenticated;
revoke all on table public.whatsapp_flow_exchange_events from public,anon,authenticated;
grant select,insert,update,delete on table public.whatsapp_flow_transport_config to service_role;
grant select,insert,update,delete on table public.whatsapp_flow_exchange_events to service_role;

create or replace function public.install_whatsapp_flow_private_key_v1(
  p_private_key_pkcs8 text,
  p_public_key_pem text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_private text:=trim(coalesce(p_private_key_pkcs8,''));
  v_public text:=trim(coalesce(p_public_key_pem,''));
  v_secret_id uuid;
  v_private_hash text;
  v_public_fingerprint text;
  v_version integer;
begin
  if length(v_private)<500 or length(v_private)>12000
     or v_private not like '-----BEGIN PRIVATE KEY-----%'
     or v_private not like '%-----END PRIVATE KEY-----' then
    raise exception 'invalid_flow_private_key';
  end if;
  if length(v_public)<200 or length(v_public)>6000
     or v_public not like '-----BEGIN PUBLIC KEY-----%'
     or v_public not like '%-----END PUBLIC KEY-----' then
    raise exception 'invalid_flow_public_key';
  end if;

  select id into v_secret_id
    from vault.secrets
   where name='dona_antonia_whatsapp_flow_private_key_v1'
   order by created_at desc
   limit 1;

  if v_secret_id is null then
    v_secret_id:=vault.create_secret(
      v_private,
      'dona_antonia_whatsapp_flow_private_key_v1',
      'PKCS8 private key for Dona Antonia WhatsApp Flow Data Exchange'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      v_private,
      'dona_antonia_whatsapp_flow_private_key_v1',
      'PKCS8 private key for Dona Antonia WhatsApp Flow Data Exchange'
    );
  end if;

  v_private_hash:=encode(extensions.digest(v_private,'sha256'),'hex');
  v_public_fingerprint:=encode(extensions.digest(v_public,'sha256'),'hex');

  insert into public.system_secrets(key_name,key_hash,is_active,rotated_at)
  values('whatsapp_flow_private_key_v1',v_private_hash,true,now())
  on conflict(key_name) do update
    set key_hash=excluded.key_hash,is_active=true,rotated_at=now();

  update public.whatsapp_flow_transport_config
     set key_version=key_version+1,
         public_key_pem=v_public,
         public_key_fingerprint=v_public_fingerprint,
         meta_signature_status='pending',
         meta_signature_checked_at=null,
         updated_at=now()
   where id=1
   returning key_version into v_version;

  return jsonb_build_object(
    'ok',true,
    'configured',true,
    'key_version',v_version,
    'public_key_fingerprint',v_public_fingerprint,
    'meta_signature_status','pending'
  );
end;
$$;

create or replace function public.get_whatsapp_flow_private_key_v1()
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_private text;
  v_expected_hash text;
  v_active boolean;
begin
  select key_hash,is_active into v_expected_hash,v_active
    from public.system_secrets
   where key_name='whatsapp_flow_private_key_v1';

  if not coalesce(v_active,false) or v_expected_hash is null then return null; end if;

  select decrypted_secret into v_private
    from vault.decrypted_secrets
   where name='dona_antonia_whatsapp_flow_private_key_v1'
   order by created_at desc
   limit 1;

  if v_private is null
     or encode(extensions.digest(v_private,'sha256'),'hex') is distinct from v_expected_hash then
    return null;
  end if;
  return v_private;
end;
$$;

create or replace function public.set_whatsapp_flow_meta_key_status_v1(p_status text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_status text:=lower(trim(coalesce(p_status,'')));
begin
  if v_status not in ('unknown','pending','valid','invalid') then raise exception 'invalid_meta_key_status'; end if;
  update public.whatsapp_flow_transport_config
     set meta_signature_status=v_status,
         meta_signature_checked_at=case when v_status in ('valid','invalid') then now() else null end,
         updated_at=now()
   where id=1;
  return jsonb_build_object('ok',true,'meta_signature_status',v_status);
end;
$$;

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
  v_token text;
  v_hash text;
  v_protocol text;
begin
  select * into a from public.automation_config where id=1;
  if not a.experience_orchestrator_enabled then raise exception 'experience_orchestrator_disabled'; end if;
  if not a.whatsapp_flow_data_exchange_enabled then raise exception 'whatsapp_flow_data_exchange_disabled'; end if;
  if not a.whatsapp_flow_send_enabled then raise exception 'whatsapp_flow_send_disabled'; end if;

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
    'expires_at',s.expires_at
  );
end;
$$;

create or replace function public.record_whatsapp_flow_exchange_v1(
  p_session_id uuid,
  p_request_id text,
  p_action text,
  p_screen text,
  p_status text,
  p_error_code text default null
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
  insert into public.whatsapp_flow_exchange_events(session_id,conversation_id,definition_id,request_id,action,screen,status,error_code)
  values(s.id,s.conversation_id,s.definition_id,nullif(left(trim(coalesce(p_request_id,'')),120),''),v_action,v_screen,v_status,v_error);
  return jsonb_build_object('ok',true,'session_id',s.id,'action',v_action,'status',v_status);
end;
$$;

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

revoke all on function public.install_whatsapp_flow_private_key_v1(text,text) from public,anon,authenticated;
revoke all on function public.get_whatsapp_flow_private_key_v1() from public,anon,authenticated;
revoke all on function public.set_whatsapp_flow_meta_key_status_v1(text) from public,anon,authenticated;
revoke all on function public.get_whatsapp_flow_transport_readiness_v1() from public,anon,authenticated;
revoke all on function public.issue_whatsapp_flow_token_v1(uuid) from public,anon,authenticated;
revoke all on function public.resolve_whatsapp_flow_token_v1(text) from public,anon,authenticated;
revoke all on function public.record_whatsapp_flow_exchange_v1(uuid,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.handle_whatsapp_flow_exchange_v1(text,text,text,jsonb) from public,anon,authenticated;

grant execute on function public.install_whatsapp_flow_private_key_v1(text,text) to service_role;
grant execute on function public.get_whatsapp_flow_private_key_v1() to service_role;
grant execute on function public.set_whatsapp_flow_meta_key_status_v1(text) to service_role;
grant execute on function public.get_whatsapp_flow_transport_readiness_v1() to service_role;
grant execute on function public.issue_whatsapp_flow_token_v1(uuid) to service_role;
grant execute on function public.resolve_whatsapp_flow_token_v1(text) to service_role;
grant execute on function public.record_whatsapp_flow_exchange_v1(uuid,text,text,text,text,text) to service_role;
grant execute on function public.handle_whatsapp_flow_exchange_v1(text,text,text,jsonb) to service_role;

-- Fail closed: esta migration nunca liga o transporte.
update public.automation_config
   set whatsapp_flow_data_exchange_enabled=false,
       whatsapp_flow_send_enabled=false
 where id=1;

commit;
