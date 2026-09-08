begin;

create table if not exists public.ai_action_registry (
  action_key text primary key,
  version integer not null default 1 check (version > 0),
  display_name text not null,
  description text not null default '',
  category text not null default 'general',
  implementation_kind text not null default 'deterministic' check (implementation_kind in ('deterministic','edge_function','workflow','manual')),
  implementation_ref text,
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  preconditions jsonb not null default '[]'::jsonb,
  side_effects jsonb not null default '[]'::jsonb,
  compensation jsonb,
  confirmation_required boolean not null default false,
  autonomy_level text not null default 'D' check (autonomy_level in ('A','B','C','D')),
  max_amount_brl numeric(14,2),
  allowed_channels text[] not null default '{}'::text[],
  allowed_roles text[] not null default array['owner']::text[],
  idempotency_strategy text not null default 'required' check (idempotency_strategy in ('required','derived','none')),
  cost_class text not null default 'none' check (cost_class in ('none','low','medium','high')),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','draft','homologation','canary','live')),
  requires_human_handoff_clear boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_action_registry_amount_nonnegative check (max_amount_brl is null or max_amount_brl >= 0),
  constraint ai_action_registry_enabled_mode_guard check ((not enabled) or execution_mode <> 'off')
);

create table if not exists public.ai_action_policy_versions (
  id uuid primary key default gen_random_uuid(),
  action_key text not null references public.ai_action_registry(action_key) on delete cascade,
  version integer not null check (version > 0),
  policy jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  created_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique(action_key, version)
);

create table if not exists public.ai_action_executions (
  id uuid primary key default gen_random_uuid(),
  action_key text not null references public.ai_action_registry(action_key),
  registry_version integer not null,
  requested_by_type text not null default 'system' check (requested_by_type in ('system','admin','ai','workflow','customer')),
  requested_by_id text,
  channel text,
  conversation_id uuid,
  customer_id uuid,
  order_id uuid,
  idempotency_key text,
  input jsonb not null default '{}'::jsonb,
  decision jsonb not null default '{}'::jsonb,
  output jsonb,
  status text not null default 'simulated' check (status in ('simulated','blocked','awaiting_confirmation','awaiting_human','approved','executing','succeeded','failed','compensated','review_required')),
  side_effect_performed boolean not null default false,
  estimated_cost_brl numeric(14,4),
  actual_cost_brl numeric(14,4),
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique(action_key, idempotency_key)
);

create index if not exists ai_action_executions_status_created_idx on public.ai_action_executions(status, created_at desc);
create index if not exists ai_action_executions_conversation_idx on public.ai_action_executions(conversation_id, created_at desc) where conversation_id is not null;
create index if not exists ai_action_policy_versions_action_status_idx on public.ai_action_policy_versions(action_key, status, version desc);

alter table public.ai_action_registry enable row level security;
alter table public.ai_action_policy_versions enable row level security;
alter table public.ai_action_executions enable row level security;

revoke all on public.ai_action_registry from anon, authenticated;
revoke all on public.ai_action_policy_versions from anon, authenticated;
revoke all on public.ai_action_executions from anon, authenticated;
grant select, insert, update, delete on public.ai_action_registry to service_role;
grant select, insert, update, delete on public.ai_action_policy_versions to service_role;
grant select, insert, update on public.ai_action_executions to service_role;

create or replace function public.touch_ai_action_registry_updated_at_v1()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_ai_action_registry_updated_at_v1 on public.ai_action_registry;
create trigger trg_touch_ai_action_registry_updated_at_v1
before update on public.ai_action_registry
for each row execute function public.touch_ai_action_registry_updated_at_v1();

revoke all on function public.touch_ai_action_registry_updated_at_v1() from public, anon, authenticated;
grant execute on function public.touch_ai_action_registry_updated_at_v1() to service_role;

create or replace function public.simulate_ai_action_v1(
  p_action_key text,
  p_input jsonb default '{}'::jsonb,
  p_channel text default null,
  p_role text default 'system',
  p_amount_brl numeric default null,
  p_has_open_handoff boolean default false
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  a public.ai_action_registry%rowtype;
  reasons text[] := '{}'::text[];
  decision text := 'blocked';
begin
  select * into a from public.ai_action_registry where action_key = p_action_key;
  if not found then
    return jsonb_build_object('allowed', false, 'decision', 'blocked', 'reasons', jsonb_build_array('unknown_action'));
  end if;

  if not a.enabled or a.execution_mode = 'off' then reasons := array_append(reasons, 'action_disabled'); end if;
  if p_channel is not null and cardinality(a.allowed_channels) > 0 and not (p_channel = any(a.allowed_channels)) then reasons := array_append(reasons, 'channel_not_allowed'); end if;
  if p_role is not null and cardinality(a.allowed_roles) > 0 and not (p_role = any(a.allowed_roles)) then reasons := array_append(reasons, 'role_not_allowed'); end if;
  if p_amount_brl is not null and a.max_amount_brl is not null and p_amount_brl > a.max_amount_brl then reasons := array_append(reasons, 'financial_limit_exceeded'); end if;
  if p_has_open_handoff and a.requires_human_handoff_clear then reasons := array_append(reasons, 'human_handoff_open'); end if;

  if cardinality(reasons) = 0 then
    decision := case
      when a.autonomy_level = 'D' then 'awaiting_human'
      when a.confirmation_required or a.autonomy_level = 'B' then 'awaiting_confirmation'
      when a.execution_mode in ('observe','draft') then 'simulated'
      else 'approved'
    end;
  end if;

  return jsonb_build_object(
    'allowed', cardinality(reasons) = 0,
    'decision', decision,
    'reasons', to_jsonb(reasons),
    'action_key', a.action_key,
    'registry_version', a.version,
    'autonomy_level', a.autonomy_level,
    'execution_mode', a.execution_mode,
    'side_effects', a.side_effects,
    'confirmation_required', a.confirmation_required,
    'max_amount_brl', a.max_amount_brl,
    'cost_class', a.cost_class,
    'input_echo', coalesce(p_input, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.simulate_ai_action_v1(text,jsonb,text,text,numeric,boolean) from public, anon, authenticated;
grant execute on function public.simulate_ai_action_v1(text,jsonb,text,text,numeric,boolean) to service_role;

insert into public.ai_action_registry(action_key,display_name,description,category,implementation_kind,input_schema,output_schema,preconditions,side_effects,confirmation_required,autonomy_level,max_amount_brl,allowed_channels,allowed_roles,idempotency_strategy,cost_class,enabled,execution_mode,metadata)
values
('get_customer','Consultar cliente','Consulta determinística de cliente por identificador permitido.','crm','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,'A',null,array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'derived','none',false,'off','{"stage":9,"read_only":true}'::jsonb),
('get_order','Consultar pedido','Consulta determinística de pedido sem modificar estado.','orders','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,'A',null,array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'derived','none',false,'off','{"stage":9,"read_only":true}'::jsonb),
('search_products','Buscar produtos','Busca produtos usando verdade comercial determinística.','catalog','deterministic','{"type":"object"}'::jsonb,'{"type":"array"}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,'A',null,array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'derived','none',false,'off','{"stage":9,"read_only":true}'::jsonb),
('create_cart','Criar carrinho','Prepara carrinho idempotente sem fechar pedido.','commerce','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'["validated_catalog"]'::jsonb,'["cart_write"]'::jsonb,true,'B',null,array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'required','none',false,'off','{"stage":9}'::jsonb),
('change_delivery_address','Alterar endereço de entrega','Altera endereço somente quando política e estado do pedido permitirem.','orders','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'["order_mutable","address_validated"]'::jsonb,'["order_update","delivery_snapshot_update"]'::jsonb,true,'B',null,array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'required','none',false,'off','{"stage":9}'::jsonb),
('cancel_order','Cancelar pedido','Solicita cancelamento governado por estado, política e eventual financeiro.','orders','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'["order_cancellable"]'::jsonb,'["order_status_change"]'::jsonb,true,'D',null,array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'required','none',false,'off','{"stage":9,"human_required":true}'::jsonb),
('reschedule_delivery','Reagendar entrega','Prepara reagendamento sujeito à capacidade logística.','logistics','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'["delivery_reschedulable"]'::jsonb,'["delivery_schedule_change"]'::jsonb,true,'B',null,array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'required','none',false,'off','{"stage":9}'::jsonb),
('create_return','Criar devolução','Abre caso de devolução sem executar crédito/reembolso automaticamente.','post_sale','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'["return_eligible"]'::jsonb,'["return_case_create"]'::jsonb,true,'D',null,array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'required','none',false,'off','{"stage":9,"human_required":true}'::jsonb),
('create_purchase_draft','Criar rascunho de compra','Cria somente draft de compra; nunca aprova ou envia nesta etapa.','procurement','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'["supplier_known"]'::jsonb,'["purchase_draft_create"]'::jsonb,false,'D',null,array['admin'],array['owner','manager','system'],'required','none',false,'off','{"stage":9,"draft_only":true}'::jsonb)
on conflict (action_key) do nothing;

comment on table public.ai_action_registry is 'Etapa 9: catálogo server-only de ações governadas; tudo nasce disabled/off.';
comment on table public.ai_action_executions is 'Auditoria imutável por append em runtime; side effects permanecem bloqueados enquanto action estiver off.';

commit;
