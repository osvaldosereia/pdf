begin;

create table if not exists public.automation_workflows (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null unique,
  display_name text not null,
  description text not null default '',
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','draft','homologation','canary','live')),
  execution_strategy text not null default 'manual_review' check (execution_strategy in ('github_action','supabase_realtime','supabase_cron','edge_function','make','manual_review')),
  trigger_type text not null check (trigger_type in ('order','customer','inventory','expiry','delivery','payment','conversation','campaign','supplier','schedule','anomaly','manual')),
  trigger_config jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '[]'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  budget_config jsonb not null default '{"max_runs_per_hour":0,"max_external_cost_brl_day":0}'::jsonb,
  cooldown_seconds integer not null default 0 check (cooldown_seconds >= 0),
  canary_percent smallint not null default 0 check (canary_percent between 0 and 100),
  kill_switch boolean not null default true,
  requires_handoff_clear boolean not null default true,
  source_kind text not null default 'admin' check (source_kind in ('admin','template','natural_language','system')),
  natural_language_source text,
  metadata jsonb not null default '{}'::jsonb,
  current_version integer not null default 1 check (current_version > 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_workflows_enabled_mode_guard check ((not enabled) or execution_mode <> 'off'),
  constraint automation_workflows_live_kill_guard check (not (enabled and execution_mode='live' and kill_switch))
);

create table if not exists public.automation_workflow_versions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  status text not null default 'draft' check (status in ('draft','approved','retired')),
  change_reason text,
  created_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique(workflow_id, version)
);

create table if not exists public.automation_workflow_executions (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.automation_workflows(id),
  workflow_version integer not null,
  trigger_type text not null,
  trigger_ref text,
  idempotency_key text,
  mode text not null,
  strategy text not null,
  status text not null default 'simulated' check (status in ('simulated','blocked','queued','running','succeeded','failed','review_required','cancelled')),
  decision jsonb not null default '{}'::jsonb,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  estimated_cost_brl numeric(14,4),
  actual_cost_brl numeric(14,4),
  external_side_effect boolean not null default false,
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique(workflow_id, idempotency_key)
);

create table if not exists public.automation_workflow_events (
  id bigint generated always as identity primary key,
  execution_id uuid references public.automation_workflow_executions(id) on delete cascade,
  workflow_id uuid not null references public.automation_workflows(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists automation_workflows_trigger_idx on public.automation_workflows(trigger_type, enabled, execution_mode);
create index if not exists automation_workflow_versions_idx on public.automation_workflow_versions(workflow_id, version desc);
create index if not exists automation_workflow_executions_status_idx on public.automation_workflow_executions(status, created_at desc);
create index if not exists automation_workflow_events_execution_idx on public.automation_workflow_events(execution_id, created_at);

alter table public.automation_workflows enable row level security;
alter table public.automation_workflow_versions enable row level security;
alter table public.automation_workflow_executions enable row level security;
alter table public.automation_workflow_events enable row level security;

revoke all on public.automation_workflows from anon, authenticated;
revoke all on public.automation_workflow_versions from anon, authenticated;
revoke all on public.automation_workflow_executions from anon, authenticated;
revoke all on public.automation_workflow_events from anon, authenticated;
grant select,insert,update,delete on public.automation_workflows to service_role;
grant select,insert,update,delete on public.automation_workflow_versions to service_role;
grant select,insert,update on public.automation_workflow_executions to service_role;
grant select,insert on public.automation_workflow_events to service_role;

create or replace function public.touch_automation_workflow_updated_at_v1()
returns trigger language plpgsql security invoker set search_path=public as $$
begin new.updated_at=now(); return new; end; $$;

drop trigger if exists trg_touch_automation_workflow_updated_at_v1 on public.automation_workflows;
create trigger trg_touch_automation_workflow_updated_at_v1 before update on public.automation_workflows
for each row execute function public.touch_automation_workflow_updated_at_v1();
revoke all on function public.touch_automation_workflow_updated_at_v1() from public,anon,authenticated;
grant execute on function public.touch_automation_workflow_updated_at_v1() to service_role;

create or replace function public.recommend_automation_execution_strategy_v1(
  p_trigger_type text,
  p_requires_realtime boolean default false,
  p_external_connector boolean default false,
  p_deterministic boolean default true
) returns jsonb language sql immutable security invoker set search_path=public as $$
select jsonb_build_object(
  'strategy', case
    when coalesce(p_requires_realtime,false) and not coalesce(p_external_connector,false) then 'supabase_realtime'
    when coalesce(p_requires_realtime,false) and coalesce(p_external_connector,false) then 'make'
    when p_trigger_type='schedule' and coalesce(p_deterministic,true) then 'github_action'
    when p_trigger_type in ('anomaly','inventory','expiry','campaign','supplier') and coalesce(p_deterministic,true) then 'github_action'
    else 'manual_review' end,
  'reason', case
    when coalesce(p_requires_realtime,false) and not coalesce(p_external_connector,false) then 'realtime_backend'
    when coalesce(p_requires_realtime,false) and coalesce(p_external_connector,false) then 'realtime_external_connector'
    when p_trigger_type='schedule' and coalesce(p_deterministic,true) then 'batch_deterministic_github_first'
    when p_trigger_type in ('anomaly','inventory','expiry','campaign','supplier') and coalesce(p_deterministic,true) then 'non_urgent_batch_github_first'
    else 'manual_review_until_classified' end
); $$;
revoke all on function public.recommend_automation_execution_strategy_v1(text,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.recommend_automation_execution_strategy_v1(text,boolean,boolean,boolean) to service_role;

create or replace function public.validate_automation_workflow_v1(p_workflow_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare w public.automation_workflows%rowtype; a jsonb; k text; reasons text[]='{}'; action_row public.ai_action_registry%rowtype;
begin
  select * into w from public.automation_workflows where id=p_workflow_id;
  if not found then return jsonb_build_object('valid',false,'reasons',jsonb_build_array('workflow_not_found')); end if;
  if jsonb_typeof(w.conditions)<>'array' then reasons:=array_append(reasons,'conditions_must_be_array'); end if;
  if jsonb_typeof(w.actions)<>'array' then reasons:=array_append(reasons,'actions_must_be_array');
  else
    for a in select value from jsonb_array_elements(w.actions) loop
      k:=a->>'action_key';
      if k is null or k='' then reasons:=array_append(reasons,'missing_action_key');
      else
        select * into action_row from public.ai_action_registry where action_key=k;
        if not found then reasons:=array_append(reasons,'unknown_action:'||k);
        elsif action_row.enabled=false or action_row.execution_mode='off' then reasons:=array_append(reasons,'action_dormant:'||k);
        end if;
      end if;
    end loop;
  end if;
  if w.execution_strategy='make' and coalesce((w.metadata->>'make_justification')::text,'')='' then reasons:=array_append(reasons,'make_requires_justification'); end if;
  return jsonb_build_object('valid',cardinality(reasons)=0,'reasons',to_jsonb(reasons),'workflow_key',w.workflow_key,'mode',w.execution_mode,'enabled',w.enabled,'kill_switch',w.kill_switch);
end; $$;
revoke all on function public.validate_automation_workflow_v1(uuid) from public,anon,authenticated;
grant execute on function public.validate_automation_workflow_v1(uuid) to service_role;

create or replace function public.simulate_automation_workflow_v1(
  p_workflow_id uuid,
  p_input jsonb default '{}'::jsonb,
  p_has_open_handoff boolean default false,
  p_idempotency_key text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare w public.automation_workflows%rowtype; reasons text[]='{}'; validation jsonb; decision text='blocked'; a jsonb; action_decisions jsonb='[]'::jsonb; action_sim jsonb;
begin
  select * into w from public.automation_workflows where id=p_workflow_id;
  if not found then return jsonb_build_object('allowed',false,'decision','blocked','reasons',jsonb_build_array('workflow_not_found')); end if;
  validation:=public.validate_automation_workflow_v1(w.id);
  if not w.enabled or w.execution_mode='off' then reasons:=array_append(reasons,'workflow_disabled'); end if;
  if w.kill_switch then reasons:=array_append(reasons,'kill_switch_on'); end if;
  if p_has_open_handoff and w.requires_handoff_clear then reasons:=array_append(reasons,'human_handoff_open'); end if;
  if coalesce((validation->>'valid')::boolean,false)=false then reasons:=reasons || array(select jsonb_array_elements_text(validation->'reasons')); end if;
  if cardinality(reasons)=0 then decision:=case when w.execution_mode in ('observe','dry_run','draft') then 'simulated' else 'approved' end; end if;
  if jsonb_typeof(w.actions)='array' then
    for a in select value from jsonb_array_elements(w.actions) loop
      action_sim:=public.simulate_ai_action_v1(a->>'action_key',coalesce(a->'input',p_input),coalesce(a->>'channel','admin'),coalesce(a->>'role','system'),null,p_has_open_handoff);
      action_decisions:=action_decisions || jsonb_build_array(action_sim);
    end loop;
  end if;
  return jsonb_build_object('allowed',cardinality(reasons)=0,'decision',decision,'reasons',to_jsonb(reasons),'workflow_key',w.workflow_key,'workflow_version',w.current_version,'execution_mode',w.execution_mode,'execution_strategy',w.execution_strategy,'idempotency_key',p_idempotency_key,'actions',action_decisions,'side_effects_performed',false);
end; $$;
revoke all on function public.simulate_automation_workflow_v1(uuid,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.simulate_automation_workflow_v1(uuid,jsonb,boolean,text) to service_role;

insert into public.automation_workflows(workflow_key,display_name,description,trigger_type,trigger_config,conditions,actions,execution_strategy,enabled,execution_mode,kill_switch,source_kind,metadata)
values
('template_order_created_review','Pedido criado · revisão segura','Template dormente para demonstrar trigger→conditions→actions sem side effect.','order','{"event":"order.created"}'::jsonb,'[]'::jsonb,'[{"action_key":"get_order","role":"system"}]'::jsonb,'supabase_realtime',false,'off',true,'template','{"stage":10,"template":true}'::jsonb),
('template_inventory_snapshot','Snapshot de estoque · batch','Template dormente que documenta preferência GitHub Actions para batch determinístico.','inventory','{"schedule":"manual_until_approved"}'::jsonb,'[]'::jsonb,'[{"action_key":"search_products","role":"system"}]'::jsonb,'github_action',false,'off',true,'template','{"stage":10,"template":true,"github_first":true}'::jsonb)
on conflict (workflow_key) do nothing;

comment on table public.automation_workflows is 'Etapa 10: motor TRIGGER→CONDITIONS→ACTIONS; server-only, disabled/off e kill_switch=true por padrão.';
comment on function public.simulate_automation_workflow_v1(uuid,jsonb,boolean,text) is 'Simulador fail-closed: nunca executa side effects; valida actions pelo AI Action Registry.';

commit;
