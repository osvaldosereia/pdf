-- Dona Antônia — Orquestrador de Experiências V1
-- Fundação dormente para conversa, carrossel, WhatsApp Flow, Sala e humano.
-- IMPORTANTE: não altera o canary WhatsApp atual. O kill switch global nasce desligado.

alter table public.automation_config
  add column if not exists experience_orchestrator_enabled boolean not null default false;

create table if not exists public.experience_feature_flags (
  key text primary key,
  experience_type text not null,
  enabled boolean not null default false,
  rollout_percent smallint not null default 0,
  channel text not null default 'any',
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint experience_feature_type_check check (experience_type in ('conversation','deterministic','carousel','whatsapp_flow','shopping_room','human')),
  constraint experience_feature_rollout_check check (rollout_percent between 0 and 100),
  constraint experience_feature_channel_check check (channel in ('any','whatsapp','shopping_room','hybrid')),
  constraint experience_feature_key_check check (key ~ '^[a-z0-9_]{3,80}$')
);

create table if not exists public.experience_definitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  feature_key text not null references public.experience_feature_flags(key) on update cascade,
  experience_type text not null,
  purpose text not null,
  status text not null default 'draft',
  provider text,
  provider_id text,
  provider_version text,
  schema_version integer not null default 1,
  config jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint experience_definition_type_check check (experience_type in ('conversation','deterministic','carousel','whatsapp_flow','shopping_room','human')),
  constraint experience_definition_status_check check (status in ('draft','ready','active','paused','retired')),
  constraint experience_definition_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{2,100}$'),
  constraint experience_definition_schema_version_check check (schema_version between 1 and 1000)
);

create table if not exists public.experience_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  definition_id uuid not null references public.experience_definitions(id),
  source_message_id uuid references public.messages(id) on delete set null,
  cart_id uuid references public.carts(id) on delete set null,
  status text not null default 'offered',
  idempotency_key text not null unique,
  provider_session_id text,
  context jsonb not null default '{}'::jsonb,
  result jsonb,
  offered_at timestamptz not null default now(),
  opened_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null default (now()+interval '30 minutes'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint experience_session_status_check check (status in ('offered','open','completed','abandoned','expired','error')),
  constraint experience_session_idempotency_check check (length(idempotency_key) between 8 and 200)
);

create table if not exists public.experience_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  session_id uuid references public.experience_sessions(id) on delete cascade,
  definition_id uuid references public.experience_definitions(id) on delete set null,
  event_type text not null,
  interface_type text not null,
  cohort text,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint experience_event_type_check check (event_type ~ '^[a-z0-9_]{3,80}$'),
  constraint experience_event_interface_check check (interface_type in ('conversation','deterministic','carousel','whatsapp_flow','shopping_room','human'))
);

create index if not exists idx_experience_sessions_conversation on public.experience_sessions(conversation_id,created_at desc);
create index if not exists idx_experience_sessions_status on public.experience_sessions(status,expires_at);
create index if not exists idx_experience_events_conversation on public.experience_events(conversation_id,created_at desc);
create index if not exists idx_experience_events_type on public.experience_events(event_type,created_at desc);

insert into public.experience_feature_flags(key,experience_type,enabled,rollout_percent,channel,config)
values
  ('flow_personalize_basket','whatsapp_flow',false,0,'whatsapp',jsonb_build_object('mission','basket_customize','max_screens',6,'component_prices_visible',false)),
  ('flow_build_purchase','whatsapp_flow',false,0,'whatsapp',jsonb_build_object('mission','build_purchase','max_screens',8)),
  ('flow_upsell','whatsapp_flow',false,0,'whatsapp',jsonb_build_object('mission','upsell','optional',true,'max_screens',4)),
  ('carousel_recommendations','carousel',false,0,'whatsapp',jsonb_build_object('max_candidates',8)),
  ('shopping_room_personalized','shopping_room',false,0,'any',jsonb_build_object('mission','visual_discovery'))
on conflict(key) do nothing;

insert into public.experience_definitions(slug,feature_key,experience_type,purpose,status,provider,schema_version,config)
values
  ('flow-personalizar-cesta-v1','flow_personalize_basket','whatsapp_flow','Editar quantidades e itens permitidos de uma cesta básica sem expor preço individual dos componentes.','draft','meta_whatsapp_flow',1,jsonb_build_object('commercial_price_source','basket_template','component_prices_visible',false,'requires_backend_validation',true)),
  ('flow-montar-compra-v1','flow_build_purchase','whatsapp_flow','Transformar uma necessidade ampla em lista estruturada de produtos genéricos e quantidades.','draft','meta_whatsapp_flow',1,jsonb_build_object('brand_choice_deferred',true,'requires_backend_validation',true)),
  ('flow-upsell-v1','flow_upsell','whatsapp_flow','Apresentar poucos complementos relevantes somente quando o cliente aceitar a oferta.','draft','meta_whatsapp_flow',1,jsonb_build_object('optional',true,'never_block_checkout',true,'requires_backend_validation',true))
on conflict(slug) do nothing;

create or replace function public.experience_feature_state_v1(
  p_feature_key text,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  f public.experience_feature_flags%rowtype;
  v_bucket smallint:=0;
  v_enabled boolean:=false;
begin
  select * into cfg from public.automation_config where id=1;
  select * into f from public.experience_feature_flags where key=p_feature_key;
  if not found then
    return jsonb_build_object('enabled',false,'reason','feature_unknown','feature_key',p_feature_key,'bucket',0,'rollout_percent',0);
  end if;

  if p_conversation_id is not null then
    select coalesce(c.automation_bucket,
      mod(abs(pg_catalog.hashtext(p_conversation_id::text||':'||p_feature_key)::bigint),100)::smallint)
      into v_bucket
      from public.conversations c where c.id=p_conversation_id;
    if not found then v_bucket:=0; end if;
  end if;

  if coalesce(cfg.experience_orchestrator_enabled,false)=false then
    return jsonb_build_object('enabled',false,'reason','orchestrator_disabled','feature_key',f.key,'experience_type',f.experience_type,'bucket',v_bucket,'rollout_percent',f.rollout_percent);
  end if;
  if not f.enabled then
    return jsonb_build_object('enabled',false,'reason','feature_disabled','feature_key',f.key,'experience_type',f.experience_type,'bucket',v_bucket,'rollout_percent',f.rollout_percent);
  end if;
  if f.rollout_percent<=0 then
    return jsonb_build_object('enabled',false,'reason','rollout_zero','feature_key',f.key,'experience_type',f.experience_type,'bucket',v_bucket,'rollout_percent',f.rollout_percent);
  end if;
  v_enabled:=f.rollout_percent>=100 or v_bucket<f.rollout_percent;
  return jsonb_build_object(
    'enabled',v_enabled,
    'reason',case when v_enabled then 'feature_rollout_match' else 'feature_rollout_control' end,
    'feature_key',f.key,'experience_type',f.experience_type,'bucket',v_bucket,'rollout_percent',f.rollout_percent,'config',f.config
  );
end;
$$;

create or replace function public.plan_next_experience_v1(
  p_conversation_id uuid,
  p_task text,
  p_candidate_count integer default 0,
  p_structured_choice_count integer default 0,
  p_visual_required boolean default false,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  c public.conversations%rowtype;
  v_task text:=lower(trim(coalesce(p_task,'conversation')));
  v_candidates integer:=greatest(0,coalesce(p_candidate_count,0));
  v_choices integer:=greatest(0,coalesce(p_structured_choice_count,0));
  v_force_human boolean:=lower(coalesce(p_context->>'force_human','false')) in ('true','1','yes','sim');
  v_skip_upsell boolean:=lower(coalesce(p_context->>'skip_upsell','false')) in ('true','1','yes','sim');
  v_flow jsonb;
  v_room jsonb;
  v_carousel jsonb;
  v_slug text;
begin
  select * into c from public.conversations where id=p_conversation_id;
  if not found then
    return jsonb_build_object('ok',false,'action','human','reason','conversation_not_found','side_effects',false);
  end if;

  if v_force_human or c.human_required or c.mode='human' then
    return jsonb_build_object('ok',true,'action','human','reason','human_required','side_effects',false,'requires_backend_validation',false);
  end if;

  if v_task in ('payment','delivery','hours','faq','order_status','checkout','confirm_order') then
    return jsonb_build_object('ok',true,'action','deterministic','reason','critical_or_structured_fact','side_effects',false,'requires_backend_validation',v_task in ('checkout','confirm_order','order_status'));
  end if;

  if v_task='basket_customize' then
    v_flow:=public.experience_feature_state_v1('flow_personalize_basket',p_conversation_id);
    if coalesce((v_flow->>'enabled')::boolean,false) then
      select slug into v_slug from public.experience_definitions where feature_key='flow_personalize_basket' and status in ('ready','active') order by schema_version desc limit 1;
      if v_slug is not null then
        return jsonb_build_object('ok',true,'action','whatsapp_flow','definition_slug',v_slug,'feature',v_flow,'reason','structured_basket_edit','side_effects',false,'requires_backend_validation',true);
      end if;
    end if;
    v_room:=public.experience_feature_state_v1('shopping_room_personalized',p_conversation_id);
    if coalesce((v_room->>'enabled')::boolean,false) then
      return jsonb_build_object('ok',true,'action','shopping_room','feature',v_room,'reason','flow_unavailable_room_fallback','side_effects',false,'requires_backend_validation',true);
    end if;
    return jsonb_build_object('ok',true,'action','conversation','reason','basket_interfaces_disabled','side_effects',false,'requires_backend_validation',true);
  end if;

  if v_task='build_purchase' then
    v_flow:=public.experience_feature_state_v1('flow_build_purchase',p_conversation_id);
    if v_choices>=4 and coalesce((v_flow->>'enabled')::boolean,false) then
      select slug into v_slug from public.experience_definitions where feature_key='flow_build_purchase' and status in ('ready','active') order by schema_version desc limit 1;
      if v_slug is not null then
        return jsonb_build_object('ok',true,'action','whatsapp_flow','definition_slug',v_slug,'feature',v_flow,'reason','many_structured_choices','side_effects',false,'requires_backend_validation',true);
      end if;
    end if;
    return jsonb_build_object('ok',true,'action','conversation','reason','short_or_flow_disabled','side_effects',false,'requires_backend_validation',true);
  end if;

  if v_task in ('recommendations','product_search','browse') then
    if p_visual_required or v_candidates>8 then
      v_room:=public.experience_feature_state_v1('shopping_room_personalized',p_conversation_id);
      if coalesce((v_room->>'enabled')::boolean,false) then
        return jsonb_build_object('ok',true,'action','shopping_room','feature',v_room,'reason','visual_or_many_candidates','side_effects',false,'requires_backend_validation',true);
      end if;
    end if;
    v_carousel:=public.experience_feature_state_v1('carousel_recommendations',p_conversation_id);
    if v_candidates between 1 and 8 and coalesce((v_carousel->>'enabled')::boolean,false) then
      return jsonb_build_object('ok',true,'action','carousel','feature',v_carousel,'reason','small_curated_set','side_effects',false,'requires_backend_validation',true);
    end if;
    return jsonb_build_object('ok',true,'action','conversation','reason','recommendation_interfaces_disabled','side_effects',false,'requires_backend_validation',true);
  end if;

  if v_task='upsell' then
    if c.fast_checkout or c.upsell_declined or v_skip_upsell then
      return jsonb_build_object('ok',true,'action','conversation','reason','upsell_suppressed','offer_suppressed',true,'side_effects',false,'requires_backend_validation',false);
    end if;
    v_flow:=public.experience_feature_state_v1('flow_upsell',p_conversation_id);
    if v_choices>=3 and coalesce((v_flow->>'enabled')::boolean,false) then
      select slug into v_slug from public.experience_definitions where feature_key='flow_upsell' and status in ('ready','active') order by schema_version desc limit 1;
      if v_slug is not null then
        return jsonb_build_object('ok',true,'action','whatsapp_flow','definition_slug',v_slug,'feature',v_flow,'reason','accepted_structured_upsell','side_effects',false,'requires_backend_validation',true);
      end if;
    end if;
    v_carousel:=public.experience_feature_state_v1('carousel_recommendations',p_conversation_id);
    if v_candidates between 1 and 5 and coalesce((v_carousel->>'enabled')::boolean,false) then
      return jsonb_build_object('ok',true,'action','carousel','feature',v_carousel,'reason','small_upsell_set','side_effects',false,'requires_backend_validation',true);
    end if;
    return jsonb_build_object('ok',true,'action','conversation','reason','upsell_interface_disabled','side_effects',false,'requires_backend_validation',true);
  end if;

  return jsonb_build_object('ok',true,'action','conversation','reason','default_conversation','side_effects',false,'requires_backend_validation',false);
end;
$$;

create or replace function public.create_experience_session_v1(
  p_conversation_id uuid,
  p_definition_slug text,
  p_idempotency_key text,
  p_source_message_id uuid default null,
  p_cart_id uuid default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  d public.experience_definitions%rowtype;
  c public.conversations%rowtype;
  s public.experience_sessions%rowtype;
  v_feature jsonb;
  v_key text:=trim(coalesce(p_idempotency_key,''));
begin
  if length(v_key)<8 or length(v_key)>200 then raise exception 'invalid_idempotency_key'; end if;
  select * into s from public.experience_sessions where idempotency_key=v_key;
  if found then
    return jsonb_build_object('ok',true,'duplicate',true,'session_id',s.id,'status',s.status,'expires_at',s.expires_at);
  end if;
  select * into c from public.conversations where id=p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  if c.human_required or c.mode='human' then raise exception 'conversation_requires_human'; end if;
  select * into d from public.experience_definitions where slug=p_definition_slug and status in ('ready','active');
  if not found then raise exception 'experience_definition_not_ready'; end if;
  v_feature:=public.experience_feature_state_v1(d.feature_key,p_conversation_id);
  if not coalesce((v_feature->>'enabled')::boolean,false) then raise exception 'experience_feature_disabled'; end if;
  insert into public.experience_sessions(conversation_id,customer_id,definition_id,source_message_id,cart_id,idempotency_key,context)
  values(p_conversation_id,c.customer_id,d.id,p_source_message_id,p_cart_id,v_key,coalesce(p_context,'{}'::jsonb)) returning * into s;
  insert into public.experience_events(conversation_id,session_id,definition_id,event_type,interface_type,cohort,event_data)
  values(c.id,s.id,d.id,'session_created',d.experience_type,c.automation_cohort,jsonb_build_object('feature_key',d.feature_key,'definition_slug',d.slug));
  return jsonb_build_object('ok',true,'duplicate',false,'session_id',s.id,'status',s.status,'definition_slug',d.slug,'experience_type',d.experience_type,'expires_at',s.expires_at);
end;
$$;

create or replace function public.complete_experience_session_v1(
  p_session_id uuid,
  p_result jsonb default '{}'::jsonb,
  p_provider_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.experience_sessions%rowtype;
  d public.experience_definitions%rowtype;
begin
  select * into s from public.experience_sessions where id=p_session_id for update;
  if not found then raise exception 'experience_session_not_found'; end if;
  select * into d from public.experience_definitions where id=s.definition_id;
  if s.status='completed' then return jsonb_build_object('ok',true,'duplicate',true,'session_id',s.id,'result',s.result); end if;
  if s.status not in ('offered','open') then raise exception 'experience_session_not_completable'; end if;
  if s.expires_at<=now() then
    update public.experience_sessions set status='expired',updated_at=now() where id=s.id;
    raise exception 'experience_session_expired';
  end if;
  update public.experience_sessions set status='completed',result=coalesce(p_result,'{}'::jsonb),provider_session_id=coalesce(nullif(trim(p_provider_session_id),''),provider_session_id),completed_at=now(),updated_at=now() where id=s.id returning * into s;
  insert into public.experience_events(conversation_id,session_id,definition_id,event_type,interface_type,cohort,event_data)
  select s.conversation_id,s.id,s.definition_id,'session_completed',d.experience_type,c.automation_cohort,jsonb_build_object('result_keys',coalesce((select jsonb_agg(k) from jsonb_object_keys(coalesce(s.result,'{}'::jsonb)) k),'[]'::jsonb))
  from public.conversations c where c.id=s.conversation_id;
  return jsonb_build_object('ok',true,'duplicate',false,'session_id',s.id,'status',s.status,'result',s.result);
end;
$$;

create or replace function public.get_experience_orchestrator_dashboard_v1()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'config',jsonb_build_object(
      'orchestrator_enabled',coalesce(a.experience_orchestrator_enabled,false),
      'whatsapp_release_mode',a.whatsapp_release_mode,
      'whatsapp_canary_percent',a.whatsapp_live_canary_percent
    ),
    'features',coalesce((select jsonb_agg(jsonb_build_object('key',f.key,'experience_type',f.experience_type,'enabled',f.enabled,'rollout_percent',f.rollout_percent,'channel',f.channel,'config',f.config,'updated_at',f.updated_at) order by f.key) from public.experience_feature_flags f),'[]'::jsonb),
    'definitions',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'slug',d.slug,'feature_key',d.feature_key,'experience_type',d.experience_type,'purpose',d.purpose,'status',d.status,'provider',d.provider,'provider_id',d.provider_id,'provider_version',d.provider_version,'schema_version',d.schema_version,'config',d.config,'updated_at',d.updated_at) order by d.slug) from public.experience_definitions d),'[]'::jsonb),
    'metrics_24h',jsonb_build_object(
      'sessions',(select count(*) from public.experience_sessions s where s.created_at>=now()-interval '24 hours'),
      'completed',(select count(*) from public.experience_sessions s where s.status='completed' and s.completed_at>=now()-interval '24 hours'),
      'abandoned',(select count(*) from public.experience_sessions s where s.status='abandoned' and s.updated_at>=now()-interval '24 hours'),
      'events',(select count(*) from public.experience_events e where e.created_at>=now()-interval '24 hours')
    ),
    'active_sessions',(select count(*) from public.experience_sessions s where s.status in ('offered','open') and s.expires_at>now()),
    'recent_events',coalesce((select jsonb_agg(x.obj order by x.created_at desc) from (select e.created_at,jsonb_build_object('event_type',e.event_type,'interface_type',e.interface_type,'cohort',e.cohort,'created_at',e.created_at) obj from public.experience_events e order by e.created_at desc limit 30) x),'[]'::jsonb)
  ) from public.automation_config a where a.id=1;
$$;

alter table public.experience_feature_flags enable row level security;
alter table public.experience_definitions enable row level security;
alter table public.experience_sessions enable row level security;
alter table public.experience_events enable row level security;

revoke all on table public.experience_feature_flags from public,anon,authenticated;
revoke all on table public.experience_definitions from public,anon,authenticated;
revoke all on table public.experience_sessions from public,anon,authenticated;
revoke all on table public.experience_events from public,anon,authenticated;
grant select,insert,update,delete on table public.experience_feature_flags to service_role;
grant select,insert,update,delete on table public.experience_definitions to service_role;
grant select,insert,update,delete on table public.experience_sessions to service_role;
grant select,insert,update,delete on table public.experience_events to service_role;

revoke execute on function public.experience_feature_state_v1(text,uuid) from public,anon,authenticated;
revoke execute on function public.plan_next_experience_v1(uuid,text,integer,integer,boolean,jsonb) from public,anon,authenticated;
revoke execute on function public.create_experience_session_v1(uuid,text,text,uuid,uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.complete_experience_session_v1(uuid,jsonb,text) from public,anon,authenticated;
revoke execute on function public.get_experience_orchestrator_dashboard_v1() from public,anon,authenticated;
grant execute on function public.experience_feature_state_v1(text,uuid) to service_role;
grant execute on function public.plan_next_experience_v1(uuid,text,integer,integer,boolean,jsonb) to service_role;
grant execute on function public.create_experience_session_v1(uuid,text,text,uuid,uuid,jsonb) to service_role;
grant execute on function public.complete_experience_session_v1(uuid,jsonb,text) to service_role;
grant execute on function public.get_experience_orchestrator_dashboard_v1() to service_role;
