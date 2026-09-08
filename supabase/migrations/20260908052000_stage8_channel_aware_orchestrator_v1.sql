-- Dona Antônia — Etapa 8: orquestrador channel-aware, budgets e fallbacks.
-- Fundação server-only e dormente. Não ativa Flow, Sala, canais ou outbound.

create table if not exists public.experience_channel_capabilities (
  channel text not null,
  experience_type text not null,
  supported boolean not null default false,
  enabled boolean not null default false,
  max_per_session smallint,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key(channel,experience_type),
  constraint experience_channel_cap_channel_check check (channel in ('whatsapp','web','instagram','messenger')),
  constraint experience_channel_cap_type_check check (experience_type in ('conversation','deterministic','carousel','whatsapp_flow','shopping_room','human')),
  constraint experience_channel_cap_max_check check (max_per_session is null or max_per_session between 1 and 100)
);

alter table public.experience_channel_capabilities enable row level security;
revoke all on public.experience_channel_capabilities from public, anon, authenticated;
grant select,insert,update,delete on public.experience_channel_capabilities to service_role;

insert into public.experience_channel_capabilities(channel,experience_type,supported,enabled,max_per_session,config) values
('whatsapp','conversation',true,false,6,'{}'),('whatsapp','deterministic',true,false,6,'{}'),('whatsapp','carousel',true,false,4,'{}'),('whatsapp','whatsapp_flow',true,false,2,jsonb_build_object('max_exchanges',40)),('whatsapp','shopping_room',true,false,2,'{}'),('whatsapp','human',true,false,null,'{}'),
('web','conversation',true,false,6,'{}'),('web','deterministic',true,false,6,'{}'),('web','carousel',true,false,4,'{}'),('web','whatsapp_flow',false,false,null,'{}'),('web','shopping_room',true,false,2,'{}'),('web','human',true,false,null,'{}'),
('instagram','conversation',true,false,6,'{}'),('instagram','deterministic',true,false,6,'{}'),('instagram','carousel',true,false,4,'{}'),('instagram','whatsapp_flow',false,false,null,'{}'),('instagram','shopping_room',true,false,2,'{}'),('instagram','human',true,false,null,'{}'),
('messenger','conversation',true,false,6,'{}'),('messenger','deterministic',true,false,6,'{}'),('messenger','carousel',true,false,4,'{}'),('messenger','whatsapp_flow',false,false,null,'{}'),('messenger','shopping_room',true,false,2,'{}'),('messenger','human',true,false,null,'{}')
on conflict(channel,experience_type) do nothing;

create table if not exists public.experience_orchestrator_policy (
  id smallint primary key default 1 check (id=1),
  max_experiences_per_session smallint not null default 6 check (max_experiences_per_session between 1 and 50),
  max_flow_exchanges_per_session smallint not null default 40 check (max_flow_exchanges_per_session between 1 and 100),
  max_carousels_per_session smallint not null default 4 check (max_carousels_per_session between 1 and 20),
  max_room_handoffs_per_session smallint not null default 2 check (max_room_handoffs_per_session between 1 and 10),
  fallback_order jsonb not null default '["conversation","human"]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.experience_orchestrator_policy enable row level security;
revoke all on public.experience_orchestrator_policy from public, anon, authenticated;
grant select,insert,update,delete on public.experience_orchestrator_policy to service_role;
insert into public.experience_orchestrator_policy(id) values(1) on conflict(id) do nothing;

create or replace function public.get_channel_experience_readiness_v1()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'orchestrator_enabled',coalesce(a.experience_orchestrator_enabled,false),
    'flow_data_exchange_enabled',coalesce(a.whatsapp_flow_data_exchange_enabled,false),
    'flow_send_enabled',coalesce(a.whatsapp_flow_send_enabled,false),
    'channels',coalesce((select jsonb_agg(jsonb_build_object('channel',c.channel,'experience_type',c.experience_type,'supported',c.supported,'enabled',c.enabled,'max_per_session',c.max_per_session) order by c.channel,c.experience_type) from public.experience_channel_capabilities c),'[]'::jsonb),
    'policy',jsonb_build_object('max_experiences_per_session',p.max_experiences_per_session,'max_flow_exchanges_per_session',p.max_flow_exchanges_per_session,'max_carousels_per_session',p.max_carousels_per_session,'max_room_handoffs_per_session',p.max_room_handoffs_per_session,'fallback_order',p.fallback_order)
  ) from public.automation_config a cross join public.experience_orchestrator_policy p where a.id=1 and p.id=1;
$$;
revoke all on function public.get_channel_experience_readiness_v1() from public, anon, authenticated;
grant execute on function public.get_channel_experience_readiness_v1() to service_role;

create or replace function public.plan_channel_experience_v2(
  p_conversation_id uuid,
  p_task text,
  p_candidate_count integer default 0,
  p_structured_choice_count integer default 0,
  p_visual_required boolean default false,
  p_context jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  c public.conversations%rowtype;
  cfg public.automation_config%rowtype;
  base jsonb;
  requested text;
  cap public.experience_channel_capabilities%rowtype;
  v_channel text;
  v_open_handoff boolean;
begin
  select * into c from public.conversations where id=p_conversation_id;
  if not found then return jsonb_build_object('ok',false,'action','human','reason','conversation_not_found','side_effects',false); end if;
  v_channel:=case when c.channel in ('whatsapp','web','instagram','messenger') then c.channel else 'web' end;
  select exists(select 1 from public.human_handoffs h where h.conversation_id=p_conversation_id and h.status='open') into v_open_handoff;
  if c.human_required or c.mode='human' or v_open_handoff then
    return jsonb_build_object('ok',true,'action','human','reason','human_precedence','channel',v_channel,'side_effects',false);
  end if;
  select * into cfg from public.automation_config where id=1;
  if coalesce(cfg.experience_orchestrator_enabled,false)=false then
    return jsonb_build_object('ok',true,'action','conversation','reason','orchestrator_disabled','channel',v_channel,'side_effects',false);
  end if;
  base:=public.plan_next_experience_v1(p_conversation_id,p_task,p_candidate_count,p_structured_choice_count,p_visual_required,p_context);
  requested:=coalesce(base->>'action','conversation');
  select * into cap from public.experience_channel_capabilities where channel=v_channel and experience_type=requested;
  if found and cap.supported and cap.enabled then
    return base||jsonb_build_object('channel',v_channel,'capability_checked',true);
  end if;
  select * into cap from public.experience_channel_capabilities where channel=v_channel and experience_type='conversation';
  if found and cap.supported and cap.enabled then
    return jsonb_build_object('ok',true,'action','conversation','reason','channel_capability_fallback','requested_action',requested,'channel',v_channel,'side_effects',false);
  end if;
  return jsonb_build_object('ok',true,'action','human','reason','no_enabled_safe_capability','requested_action',requested,'channel',v_channel,'side_effects',false);
end;
$$;
revoke all on function public.plan_channel_experience_v2(uuid,text,integer,integer,boolean,jsonb) from public, anon, authenticated;
grant execute on function public.plan_channel_experience_v2(uuid,text,integer,integer,boolean,jsonb) to service_role;
