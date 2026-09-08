begin;

-- Transversal P0 — Cost Policy + Safe Action + Confidence foundation.
-- Dormant/off by default. No live Meta prices are seeded.

alter table public.ai_action_registry
  add column if not exists risk_class text not null default 'unknown' check(risk_class in ('unknown','read_only','reversible_write','commitment','irreversible')),
  add column if not exists confidence_autorun_allowed boolean not null default false;

update public.ai_action_registry set risk_class='read_only',confidence_autorun_allowed=true where action_key in ('get_customer','get_order','search_products');
update public.ai_action_registry set risk_class='reversible_write',confidence_autorun_allowed=true,confirmation_required=false,autonomy_level='A' where action_key='create_cart';
update public.ai_action_registry set risk_class='commitment',confidence_autorun_allowed=false where action_key in ('change_delivery_address','reschedule_delivery','create_return');
update public.ai_action_registry set risk_class='irreversible',confidence_autorun_allowed=false where action_key='cancel_order';
update public.ai_action_registry set risk_class='reversible_write',confidence_autorun_allowed=false where action_key='create_purchase_draft';

insert into public.ai_action_registry(action_key,display_name,description,category,implementation_kind,input_schema,output_schema,preconditions,side_effects,confirmation_required,autonomy_level,allowed_channels,allowed_roles,idempotency_strategy,cost_class,enabled,execution_mode,risk_class,confidence_autorun_allowed,metadata)
values
('get_stock','Consultar estoque','Consulta determinística de estoque disponível/verificado.','inventory','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,'A',array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'derived','none',false,'off','read_only',true,'{"commercial_ai":true}'::jsonb),
('get_price','Consultar preço','Consulta determinística de preço comercial vigente.','pricing','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,'A',array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'derived','none',false,'off','read_only',true,'{"commercial_ai":true}'::jsonb),
('get_history','Consultar histórico','Consulta histórico comercial permitido do cliente.','crm','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,'A',array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'derived','none',false,'off','read_only',true,'{"commercial_ai":true}'::jsonb),
('simulate_basket','Simular cesta/orçamento','Monta simulação sem compromisso usando preço/estoque/margem determinísticos.','commerce','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,'A',array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'derived','none',false,'off','read_only',true,'{"commercial_ai":true}'::jsonb),
('compare_alternatives','Comparar alternativas','Compara opções sem efetivar troca.','commerce','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,'A',array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'derived','none',false,'off','read_only',true,'{"commercial_ai":true}'::jsonb),
('calculate_savings','Calcular economia','Calcula economia por regras determinísticas.','pricing','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,'A',array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'derived','none',false,'off','read_only',true,'{"commercial_ai":true}'::jsonb),
('locate_product','Localizar produto','Consulta localização operacional do produto.','inventory','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,'A',array['admin'],array['owner','manager','agent','system'],'derived','none',false,'off','read_only',true,'{"commercial_ai":true}'::jsonb),
('suggest_substitution','Sugerir substituição','Consulta o Substitution Engine sem aplicar alteração.','commerce','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,'A',array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'derived','none',false,'off','read_only',true,'{"commercial_ai":true}'::jsonb),
('finalize_order','Finalizar venda','Transforma rascunho em pedido confirmado; sempre exige confirmação.','orders','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'["order_valid"]'::jsonb,'["order_commitment"]'::jsonb,true,'B',array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'required','none',false,'off','commitment',false,'{"commercial_ai":true}'::jsonb),
('send_order_to_bling','Enviar pedido ao Bling','Enfileira pedido confirmado para integração; sempre exige confirmação/estado elegível.','orders','workflow','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'["order_confirmed"]'::jsonb,'["external_order_sync"]'::jsonb,true,'B',array['whatsapp','instagram','messenger','admin'],array['owner','manager','agent','system'],'required','low',false,'off','commitment',false,'{"commercial_ai":true,"transport_dormant":true}'::jsonb),
('confirm_delivery','Confirmar entrega','Confirma fato logístico de entrega; nunca por inferência da IA.','logistics','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'["driver_at_stop"]'::jsonb,'["delivery_fact"]'::jsonb,true,'D',array['admin'],array['owner','manager','system'],'required','none',false,'off','irreversible',false,'{"commercial_ai":true,"ai_must_not_infer":true}'::jsonb),
('apply_exceptional_discount','Aplicar desconto excepcional','Aplica desconto fora de regra automática; sempre exige autorização.','pricing','deterministic','{"type":"object"}'::jsonb,'{"type":"object"}'::jsonb,'["margin_known"]'::jsonb,'["order_price_change"]'::jsonb,true,'D',array['whatsapp','instagram','messenger','admin'],array['owner','manager','system'],'required','none',false,'off','commitment',false,'{"commercial_ai":true}'::jsonb)
on conflict(action_key) do nothing;

create table if not exists public.commercial_decision_runtime_config (
  id smallint primary key default 1 check(id=1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check(execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  cost_policy_preview_enabled boolean not null default false,
  action_safety_preview_enabled boolean not null default false,
  confidence_policy_preview_enabled boolean not null default false,
  decision_recording_enabled boolean not null default false,
  require_cost_policy_expiry boolean not null default true,
  objective_order text[] not null default array['resolve_correctly','make_purchase_easy','close_sale','increase_ticket_when_relevant']::text[],
  canary_percent smallint not null default 0 check(canary_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid null
);
insert into public.commercial_decision_runtime_config(id) values(1) on conflict(id) do nothing;
alter table public.commercial_decision_runtime_config enable row level security;

create table if not exists public.commercial_tool_registry (
  tool_key text primary key,
  channel text not null,
  category text not null,
  provider text not null,
  ai_action_key text null references public.ai_action_registry(action_key) on delete restrict,
  risk_class text not null check(risk_class in ('read_only','reversible_write','commitment','irreversible')),
  reversible boolean not null,
  confirmation_required boolean not null,
  confidence_autorun_allowed boolean not null,
  cost_policy_required boolean not null default true,
  priority integer not null default 100,
  enabled boolean not null default false,
  execution_mode text not null default 'off' check(execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((not enabled) or execution_mode<>'off')
);
alter table public.commercial_tool_registry enable row level security;

create table if not exists public.channel_cost_policy_versions (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  category text not null,
  provider text not null,
  version integer not null check(version>0),
  currency char(3) not null default 'BRL',
  cost_model text not null default 'per_interaction',
  unit_cost_brl numeric(14,6) null check(unit_cost_brl is null or unit_cost_brl>=0),
  max_allowed_unit_cost_brl numeric(14,6) null check(max_allowed_unit_cost_brl is null or max_allowed_unit_cost_brl>=0),
  cost_status text not null default 'unknown' check(cost_status in ('unknown','current','expired')),
  status text not null default 'draft' check(status in ('draft','approved','retired')),
  effective_from timestamptz null,
  effective_to timestamptz null,
  verified_at timestamptz null,
  source_ref text null,
  created_by uuid null,
  approved_by uuid null,
  created_at timestamptz not null default now(),
  approved_at timestamptz null,
  unique(channel,category,provider,version),
  check(effective_to is null or effective_from is null or effective_to>effective_from)
);
alter table public.channel_cost_policy_versions enable row level security;
create index if not exists channel_cost_policy_lookup_idx on public.channel_cost_policy_versions(channel,category,provider,status,version desc);

create table if not exists public.decision_confidence_policy_versions (
  id uuid primary key default gen_random_uuid(),
  scope_key text not null,
  version integer not null check(version>0),
  low_threshold numeric(5,4) not null check(low_threshold>=0 and low_threshold<=1),
  high_threshold numeric(5,4) not null check(high_threshold>=0 and high_threshold<=1 and high_threshold>low_threshold),
  status text not null default 'draft' check(status in ('draft','approved','retired')),
  effective_from timestamptz null,
  effective_to timestamptz null,
  created_by uuid null,
  approved_by uuid null,
  created_at timestamptz not null default now(),
  approved_at timestamptz null,
  unique(scope_key,version)
);
alter table public.decision_confidence_policy_versions enable row level security;
create index if not exists decision_confidence_policy_lookup_idx on public.decision_confidence_policy_versions(scope_key,status,version desc);

insert into public.decision_confidence_policy_versions(scope_key,version,low_threshold,high_threshold,status)
values('default',1,0.6000,0.9000,'draft')
on conflict(scope_key,version) do nothing;

create table if not exists public.commercial_decision_evaluations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  tool_key text not null references public.commercial_tool_registry(tool_key) on delete restrict,
  confidence numeric(5,4) null check(confidence is null or (confidence>=0 and confidence<=1)),
  confidence_scope text not null default 'default',
  cost_decision jsonb not null default '{}'::jsonb,
  action_decision jsonb not null default '{}'::jsonb,
  final_decision text not null,
  objective_order text[] not null,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.commercial_decision_evaluations enable row level security;

insert into public.commercial_tool_registry(tool_key,channel,category,provider,ai_action_key,risk_class,reversible,confirmation_required,confidence_autorun_allowed,cost_policy_required,priority,enabled,execution_mode,metadata)
values
('WHATSAPP_STANDARD_TEXT','whatsapp','service','meta',null,'reversible_write',true,false,true,true,10,false,'off','{"presentation":"text"}'::jsonb),
('WHATSAPP_STANDARD_IMAGE','whatsapp','service','meta',null,'reversible_write',true,false,true,true,20,false,'off','{"presentation":"image"}'::jsonb),
('WHATSAPP_STANDARD_AUDIO','whatsapp','service','meta',null,'reversible_write',true,false,true,true,30,false,'off','{"presentation":"audio"}'::jsonb),
('WHATSAPP_STANDARD_DOCUMENT','whatsapp','service','meta',null,'reversible_write',true,false,true,true,40,false,'off','{"presentation":"document"}'::jsonb),
('WHATSAPP_STANDARD_BUTTONS','whatsapp','service','meta',null,'reversible_write',true,false,true,true,15,false,'off','{"presentation":"buttons"}'::jsonb),
('WHATSAPP_STANDARD_LIST','whatsapp','service','meta',null,'reversible_write',true,false,true,true,15,false,'off','{"presentation":"list"}'::jsonb),
('WHATSAPP_STANDARD_PRODUCT_PRESENTATION','whatsapp','service','meta',null,'reversible_write',true,false,true,true,15,false,'off','{"presentation":"product"}'::jsonb),
('SALA_DE_COMPRA','internal','commerce','dona_antonia',null,'reversible_write',true,false,true,false,20,false,'off','{}'::jsonb),
('CATALOGO','internal','catalog','dona_antonia','search_products','read_only',true,false,true,false,5,false,'off','{}'::jsonb),
('CRM','internal','crm','dona_antonia','get_customer','read_only',true,false,true,false,5,false,'off','{}'::jsonb),
('CARRINHO','internal','commerce','dona_antonia','create_cart','reversible_write',true,false,true,false,10,false,'off','{}'::jsonb),
('ESTOQUE','internal','inventory','dona_antonia','get_stock','read_only',true,false,true,false,5,false,'off','{}'::jsonb),
('ENTREGA','internal','logistics','dona_antonia',null,'read_only',true,false,true,false,5,false,'off','{}'::jsonb),
('BLING_INTERNO','internal','erp','bling',null,'commitment',false,true,false,false,100,false,'off','{"transport_dormant":true}'::jsonb),
('IA_INTERNA','internal','ai','openai',null,'read_only',true,false,true,true,50,false,'off','{"cost_policy_required":true}'::jsonb),
('HUMAN_HANDOFF','internal','handoff','dona_antonia',null,'commitment',false,false,false,false,1,false,'off','{}'::jsonb)
on conflict(tool_key) do nothing;

create or replace function public.commercial_decision_readiness_v1()
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'enabled',c.enabled,'execution_mode',c.execution_mode,'canary_percent',c.canary_percent,
    'cost_policy_preview_enabled',c.cost_policy_preview_enabled,
    'action_safety_preview_enabled',c.action_safety_preview_enabled,
    'confidence_policy_preview_enabled',c.confidence_policy_preview_enabled,
    'decision_recording_enabled',c.decision_recording_enabled,
    'require_cost_policy_expiry',c.require_cost_policy_expiry,
    'objective_order',to_jsonb(c.objective_order),
    'tools',(select count(*) from public.commercial_tool_registry),
    'enabled_tools',(select count(*) from public.commercial_tool_registry where enabled and execution_mode<>'off'),
    'approved_cost_policies',(select count(*) from public.channel_cost_policy_versions where status='approved'),
    'approved_confidence_policies',(select count(*) from public.decision_confidence_policy_versions where status='approved'),
    'evaluations',(select count(*) from public.commercial_decision_evaluations),
    'external_side_effect',false
  ) from public.commercial_decision_runtime_config c where c.id=1;
$$;

create or replace function public.preview_tool_cost_policy_v1(p_tool_key text,p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.commercial_decision_runtime_config%rowtype; t public.commercial_tool_registry%rowtype; p public.channel_cost_policy_versions%rowtype; ref_at timestamptz:=coalesce(p_at,now());
begin
  select * into cfg from public.commercial_decision_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.cost_policy_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then return jsonb_build_object('ok',false,'allowed',false,'error','cost_policy_preview_disabled','external_side_effect',false); end if;
  select * into t from public.commercial_tool_registry where tool_key=p_tool_key;
  if not found then return jsonb_build_object('ok',false,'allowed',false,'error','unknown_tool','external_side_effect',false); end if;
  if not t.enabled or t.execution_mode='off' then return jsonb_build_object('ok',true,'allowed',false,'reason','tool_disabled','tool_key',t.tool_key,'external_side_effect',false); end if;
  if not t.cost_policy_required then return jsonb_build_object('ok',true,'allowed',true,'reason','cost_policy_not_required','tool_key',t.tool_key,'unit_cost_brl',0,'external_side_effect',false); end if;

  select * into p from public.channel_cost_policy_versions
  where channel=t.channel and category=t.category and provider=t.provider and status='approved'
    and (effective_from is null or effective_from<=ref_at)
    and (effective_to is null or effective_to>ref_at)
  order by version desc limit 1;
  if not found then return jsonb_build_object('ok',true,'allowed',false,'reason','approved_cost_policy_missing','tool_key',t.tool_key,'external_side_effect',false); end if;
  if cfg.require_cost_policy_expiry and p.effective_to is null then return jsonb_build_object('ok',true,'allowed',false,'reason','cost_policy_expiry_missing','policy_id',p.id,'external_side_effect',false); end if;
  if p.cost_status<>'current' or p.unit_cost_brl is null or p.max_allowed_unit_cost_brl is null or p.verified_at is null then return jsonb_build_object('ok',true,'allowed',false,'reason','cost_unknown_or_stale','policy_id',p.id,'external_side_effect',false); end if;
  if p.unit_cost_brl>p.max_allowed_unit_cost_brl then return jsonb_build_object('ok',true,'allowed',false,'reason','cost_limit_exceeded','policy_id',p.id,'unit_cost_brl',p.unit_cost_brl,'max_allowed_unit_cost_brl',p.max_allowed_unit_cost_brl,'external_side_effect',false); end if;
  return jsonb_build_object('ok',true,'allowed',true,'reason','within_cost_policy','tool_key',t.tool_key,'policy_id',p.id,'unit_cost_brl',p.unit_cost_brl,'max_allowed_unit_cost_brl',p.max_allowed_unit_cost_brl,'currency',p.currency,'external_side_effect',false);
end; $$;

create or replace function public.preview_safe_commercial_action_v1(
  p_tool_key text,
  p_confidence numeric,
  p_has_confirmation boolean default false,
  p_has_open_handoff boolean default false,
  p_confidence_scope text default 'default',
  p_role text default 'system'
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.commercial_decision_runtime_config%rowtype; t public.commercial_tool_registry%rowtype; cp public.decision_confidence_policy_versions%rowtype; cost jsonb; ai jsonb:='{}'::jsonb; decision text:='blocked'; reason text:=null; ref_at timestamptz:=now();
begin
  select * into cfg from public.commercial_decision_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.action_safety_preview_enabled or not cfg.confidence_policy_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then return jsonb_build_object('ok',false,'allowed',false,'decision','blocked','error','commercial_action_preview_disabled','external_side_effect',false); end if;
  select * into t from public.commercial_tool_registry where tool_key=p_tool_key;
  if not found then return jsonb_build_object('ok',false,'allowed',false,'decision','blocked','error','unknown_tool','external_side_effect',false); end if;
  if not t.enabled or t.execution_mode='off' then return jsonb_build_object('ok',true,'allowed',false,'decision','blocked','reason','tool_disabled','tool_key',t.tool_key,'external_side_effect',false); end if;
  if p_has_open_handoff and t.tool_key<>'HUMAN_HANDOFF' then return jsonb_build_object('ok',true,'allowed',false,'decision','awaiting_human','reason','human_handoff_open','external_side_effect',false); end if;
  if p_confidence is null or p_confidence<0 or p_confidence>1 then return jsonb_build_object('ok',true,'allowed',false,'decision','review_required','reason','invalid_or_missing_confidence','external_side_effect',false); end if;

  select * into cp from public.decision_confidence_policy_versions
  where scope_key=coalesce(nullif(trim(p_confidence_scope),''),'default') and status='approved'
    and (effective_from is null or effective_from<=ref_at) and (effective_to is null or effective_to>ref_at)
  order by version desc limit 1;
  if not found then return jsonb_build_object('ok',true,'allowed',false,'decision','review_required','reason','approved_confidence_policy_missing','external_side_effect',false); end if;

  if p_confidence<cp.low_threshold then decision:='ask_clarification';reason:='confidence_below_low_threshold';
  elsif (t.confirmation_required or t.risk_class in ('commitment','irreversible')) and not coalesce(p_has_confirmation,false) then decision:='awaiting_confirmation';reason:='confirmation_required';
  elsif p_confidence<cp.high_threshold then
    if t.reversible and t.confidence_autorun_allowed then decision:='execute_with_disclosure';reason:='medium_confidence_reversible'; else decision:='awaiting_confirmation';reason:='medium_confidence_requires_confirmation'; end if;
  elsif t.confidence_autorun_allowed or coalesce(p_has_confirmation,false) or t.risk_class='read_only' then decision:='approved';reason:='confidence_and_risk_allow';
  else decision:='awaiting_confirmation';reason:='autorun_not_allowed'; end if;

  if decision in ('approved','execute_with_disclosure') then
    cost:=public.preview_tool_cost_policy_v1(t.tool_key,ref_at);
    if not coalesce((cost->>'allowed')::boolean,false) then decision:='blocked';reason:=coalesce(cost->>'reason',cost->>'error','cost_policy_block'); end if;
  else cost:=jsonb_build_object('ok',true,'allowed',false,'reason','not_evaluated_before_action_clear'); end if;

  if decision in ('approved','execute_with_disclosure') and t.ai_action_key is not null then
    ai:=public.simulate_ai_action_v1(t.ai_action_key,'{}'::jsonb,t.channel,p_role,null,p_has_open_handoff);
    if not coalesce((ai->>'allowed')::boolean,false) then decision:='blocked';reason:='ai_action_registry_block';
    elsif ai->>'decision' in ('awaiting_confirmation','awaiting_human') then decision:=ai->>'decision';reason:='ai_action_registry_requires_guard'; end if;
  end if;

  return jsonb_build_object(
    'ok',true,'allowed',decision in ('approved','execute_with_disclosure'),'decision',decision,'reason',reason,
    'tool_key',t.tool_key,'risk_class',t.risk_class,'reversible',t.reversible,'confirmation_required',t.confirmation_required,
    'confidence',p_confidence,'confidence_scope',cp.scope_key,'low_threshold',cp.low_threshold,'high_threshold',cp.high_threshold,
    'cost_policy',cost,'ai_action_policy',ai,'objective_order',to_jsonb(cfg.objective_order),
    'side_effect_performed',false,'external_side_effect',false
  );
end; $$;

create or replace function public.record_commercial_decision_evaluation_v1(
  p_tool_key text,p_confidence numeric,p_has_confirmation boolean,p_has_open_handoff boolean,p_confidence_scope text,p_role text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg public.commercial_decision_runtime_config%rowtype; prior public.commercial_decision_evaluations%rowtype; preview jsonb; new_id uuid;
begin
  select * into cfg from public.commercial_decision_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.decision_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','commercial_decision_recording_disabled','external_side_effect',false); end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','external_side_effect',false); end if;
  select * into prior from public.commercial_decision_evaluations where idempotency_key=trim(p_idempotency_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'evaluation_id',prior.id,'final_decision',prior.final_decision,'external_side_effect',false); end if;
  preview:=public.preview_safe_commercial_action_v1(p_tool_key,p_confidence,p_has_confirmation,p_has_open_handoff,p_confidence_scope,p_role);
  if not coalesce((preview->>'ok')::boolean,false) then return preview; end if;
  insert into public.commercial_decision_evaluations(idempotency_key,tool_key,confidence,confidence_scope,cost_decision,action_decision,final_decision,objective_order)
  values(trim(p_idempotency_key),p_tool_key,p_confidence,coalesce(nullif(trim(p_confidence_scope),''),'default'),coalesce(preview->'cost_policy','{}'::jsonb),preview,preview->>'decision',cfg.objective_order)
  returning id into new_id;
  return jsonb_build_object('ok',true,'replay',false,'evaluation_id',new_id,'final_decision',preview->>'decision','side_effect_performed',true,'external_side_effect',false);
end; $$;

revoke all on table public.commercial_decision_runtime_config,public.commercial_tool_registry,public.channel_cost_policy_versions,public.decision_confidence_policy_versions,public.commercial_decision_evaluations from public,anon,authenticated;
grant select on table public.commercial_decision_runtime_config,public.commercial_tool_registry,public.channel_cost_policy_versions,public.decision_confidence_policy_versions,public.commercial_decision_evaluations to service_role;

do $$ begin
  execute 'revoke all on function public.commercial_decision_readiness_v1() from public,anon,authenticated';
  execute 'revoke all on function public.preview_tool_cost_policy_v1(text,timestamptz) from public,anon,authenticated';
  execute 'revoke all on function public.preview_safe_commercial_action_v1(text,numeric,boolean,boolean,text,text) from public,anon,authenticated';
  execute 'revoke all on function public.record_commercial_decision_evaluation_v1(text,numeric,boolean,boolean,text,text,text) from public,anon,authenticated';
  execute 'grant execute on function public.commercial_decision_readiness_v1() to service_role';
  execute 'grant execute on function public.preview_tool_cost_policy_v1(text,timestamptz) to service_role';
  execute 'grant execute on function public.preview_safe_commercial_action_v1(text,numeric,boolean,boolean,text,text) to service_role';
  execute 'grant execute on function public.record_commercial_decision_evaluation_v1(text,numeric,boolean,boolean,text,text,text) to service_role';
end $$;

comment on table public.channel_cost_policy_versions is 'Configuração versionada de custo. Nenhum preço atual da Meta é hardcoded nesta migration.';
comment on table public.commercial_tool_registry is 'Whitelist dormente de ferramentas comerciais; toda ferramenta nasce disabled/off.';

commit;
