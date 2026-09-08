begin;

-- Central Humana / Copiloto IA v1
-- Fundação server-only e fail-closed. Não envia mensagens e não chama provider IA.

alter table public.conversations drop constraint if exists conversations_mode_check;
alter table public.conversations add constraint conversations_mode_check
  check (mode in ('ai','human','human_copilot','paused'));

create table if not exists public.human_copilot_runtime_config (
  id smallint primary key default 1 check (id=1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  mode_switch_enabled boolean not null default false,
  context_preview_enabled boolean not null default false,
  deterministic_nba_enabled boolean not null default false,
  provider_generation_enabled boolean not null default false,
  suggestion_recording_enabled boolean not null default false,
  max_context_messages integer not null default 24 check (max_context_messages between 4 and 80),
  max_suggestion_chars integer not null default 1200 check (max_suggestion_chars between 200 and 4096),
  max_provider_cost_brl numeric(12,6),
  canary_percent smallint not null default 0 check (canary_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.human_copilot_runtime_config(id) values(1) on conflict(id) do nothing;
alter table public.human_copilot_runtime_config enable row level security;
revoke all on public.human_copilot_runtime_config from public,anon,authenticated;
grant select,insert,update on public.human_copilot_runtime_config to service_role;

create table if not exists public.human_copilot_suggestions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  handoff_id uuid not null references public.human_handoffs(id) on delete restrict,
  admin_user_id uuid not null references public.admin_users(user_id) on delete restrict,
  idempotency_key text not null unique,
  intent text,
  summary text,
  nba_code text not null,
  nba_reason text not null,
  suggestion_text text,
  confidence numeric(6,5) check (confidence is null or (confidence>=0 and confidence<=1)),
  provider text not null default 'deterministic',
  model text,
  provider_response_id text,
  input_tokens integer not null default 0 check (input_tokens>=0),
  output_tokens integer not null default 0 check (output_tokens>=0),
  estimated_cost_brl numeric(12,6) not null default 0 check (estimated_cost_brl>=0),
  policy_snapshot jsonb not null default '{}'::jsonb,
  context_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','inserted_to_composer','discarded','sent_by_operator')),
  external_side_effect boolean not null default false check (external_side_effect=false),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists human_copilot_suggestions_conversation_idx on public.human_copilot_suggestions(conversation_id,created_at desc);
create index if not exists human_copilot_suggestions_admin_idx on public.human_copilot_suggestions(admin_user_id,created_at desc);
alter table public.human_copilot_suggestions enable row level security;
revoke all on public.human_copilot_suggestions from public,anon,authenticated;
grant select,insert,update on public.human_copilot_suggestions to service_role;

insert into public.commercial_tool_registry(
  tool_key,channel,category,provider,risk_class,reversible,confirmation_required,
  confidence_autorun_allowed,cost_policy_required,priority,enabled,execution_mode,metadata
)
values(
  'HUMAN_COPILOT_GENERATE','internal','ai_copilot','openai','read_only',true,false,
  true,true,25,false,'off',jsonb_build_object('allowed_during_handoff',true,'operator_only',true,'auto_send',false)
)
on conflict(tool_key) do update set
  channel=excluded.channel,category=excluded.category,provider=excluded.provider,
  risk_class=excluded.risk_class,reversible=excluded.reversible,
  confirmation_required=excluded.confirmation_required,
  confidence_autorun_allowed=excluded.confidence_autorun_allowed,
  cost_policy_required=excluded.cost_policy_required,
  metadata=public.commercial_tool_registry.metadata||excluded.metadata,
  updated_at=now();

create or replace function public.human_copilot_readiness_v1()
returns jsonb
language sql
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'enabled',c.enabled,
    'execution_mode',c.execution_mode,
    'mode_switch_enabled',c.mode_switch_enabled,
    'context_preview_enabled',c.context_preview_enabled,
    'deterministic_nba_enabled',c.deterministic_nba_enabled,
    'provider_generation_enabled',c.provider_generation_enabled,
    'suggestion_recording_enabled',c.suggestion_recording_enabled,
    'canary_percent',c.canary_percent,
    'suggestions',(select count(*) from public.human_copilot_suggestions),
    'external_side_effect',false
  ) from public.human_copilot_runtime_config c where c.id=1;
$$;

create or replace function public.set_human_copilot_mode_v1(
  p_conversation_id uuid,
  p_admin_user_id uuid,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.human_copilot_runtime_config%rowtype;
  conv public.conversations%rowtype;
  handoff public.human_handoffs%rowtype;
begin
  if not exists(select 1 from public.admin_users a where a.user_id=p_admin_user_id and a.is_active=true and a.role in ('owner','operator')) then
    raise exception 'admin_not_authorized';
  end if;
  select * into conv from public.conversations where id=p_conversation_id for update;
  if not found then raise exception 'conversation_not_found'; end if;
  select * into handoff from public.human_handoffs
   where conversation_id=p_conversation_id and status='claimed'
   order by claimed_at desc nulls last,created_at desc limit 1 for update;
  if not found then raise exception 'claimed_handoff_required'; end if;
  if handoff.claimed_by is distinct from p_admin_user_id then raise exception 'handoff_claimed_by_other'; end if;
  if not conv.human_required or conv.mode not in ('human','human_copilot') then raise exception 'conversation_not_in_human_control'; end if;

  if coalesce(p_enabled,false) then
    select * into cfg from public.human_copilot_runtime_config where id=1;
    if not found or not cfg.enabled or not cfg.mode_switch_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
      return jsonb_build_object('ok',false,'mode',conv.mode,'error','human_copilot_mode_disabled','external_side_effect',false);
    end if;
    update public.conversations set mode='human_copilot',updated_at=now() where id=p_conversation_id;
    return jsonb_build_object('ok',true,'mode','human_copilot','conversation_id',p_conversation_id,'external_side_effect',false);
  end if;

  -- Saída segura do copiloto é permitida mesmo se o kill switch for desligado.
  update public.conversations set mode='human',updated_at=now() where id=p_conversation_id;
  return jsonb_build_object('ok',true,'mode','human','conversation_id',p_conversation_id,'external_side_effect',false);
end;
$$;

create or replace function public.preview_human_copilot_context_v1(
  p_conversation_id uuid,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.human_copilot_runtime_config%rowtype;
  conv public.conversations%rowtype;
  handoff public.human_handoffs%rowtype;
  customer_json jsonb:='{}'::jsonb;
  timeline_json jsonb:='[]'::jsonb;
  cart_json jsonb:='{}'::jsonb;
  order_json jsonb:='{}'::jsonb;
  risk_json jsonb:='[]'::jsonb;
  latest_order_id uuid;
  msg_limit integer;
begin
  select * into cfg from public.human_copilot_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.context_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','human_copilot_context_disabled','external_side_effect',false);
  end if;
  if not exists(select 1 from public.admin_users a where a.user_id=p_admin_user_id and a.is_active=true and a.role in ('owner','operator')) then
    raise exception 'admin_not_authorized';
  end if;
  select * into conv from public.conversations where id=p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  if not conv.human_required or conv.mode not in ('human','human_copilot') then raise exception 'conversation_not_in_human_control'; end if;
  select * into handoff from public.human_handoffs
   where conversation_id=p_conversation_id and status='claimed'
   order by claimed_at desc nulls last,created_at desc limit 1;
  if not found or handoff.claimed_by is distinct from p_admin_user_id then raise exception 'claimed_handoff_owned_by_admin_required'; end if;

  msg_limit:=greatest(4,least(80,cfg.max_context_messages));

  if conv.customer_id is not null then
    select jsonb_build_object(
      'id',c.id,'name',c.name,'preferred_reply',c.preferred_reply,'shopping_mode',c.shopping_mode,
      'order_count',c.order_count,'last_order_at',c.last_order_at,
      'last_inbound_message_type',c.last_inbound_message_type
    ) into customer_json from public.customers c where c.id=conv.customer_id;
  end if;

  select coalesce(jsonb_agg(x.obj order by x.created_at),'[]'::jsonb) into timeline_json
  from (
    select m.created_at,
      jsonb_build_object(
        'id',m.id,'direction',m.direction,'message_type',m.message_type,
        'text',left(coalesce(nullif(m.body_text,''),nullif(m.transcript,''),''),1200),
        'delivery_status',m.delivery_status,'created_at',m.created_at
      ) obj
    from public.messages m where m.conversation_id=p_conversation_id
    order by m.created_at desc limit msg_limit
  ) x;

  select jsonb_build_object(
    'id',ca.id,'status',ca.status,'version',ca.version,'total',ca.total,'currency',ca.currency,
    'pricing_status',ca.pricing_status,'pricing_issues',ca.pricing_issues,
    'item_count',(select count(*) from public.cart_items ci where ci.cart_id=ca.id),
    'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',ci.product_id,'name',p.name,'quantity',ci.quantity,'unit_price',ci.unit_price,'line_total',ci.line_total) order by ci.created_at)
      from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=ca.id),'[]'::jsonb)
  ) into cart_json
  from public.carts ca where ca.conversation_id=p_conversation_id order by ca.updated_at desc limit 1;

  select o.id into latest_order_id
  from public.orders o
  where o.conversation_id=p_conversation_id or (conv.customer_id is not null and o.customer_id=conv.customer_id)
  order by coalesce(o.confirmed_at,o.created_at) desc limit 1;

  if latest_order_id is not null then
    select jsonb_build_object(
      'id',o.id,'status',o.status,'total',o.total,'currency',o.currency,
      'confirmed_at',o.confirmed_at,'delivered_at',o.delivered_at,'cancelled_at',o.cancelled_at,
      'payment_status',fc.payment_status,'payment_method',fc.payment_method,
      'fiscal_status',fc.fiscal_status,'fiscal_block_reason',fc.fiscal_block_reason,
      'ledger_operational_cents',coalesce((select sum(case when le.event_type='payment_received' and le.recognition_status in ('operational_confirmed','reconciled') then le.amount_cents when le.event_type='payment_reversed' and le.recognition_status in ('operational_confirmed','reconciled') then -le.amount_cents else 0 end) from public.financial_ledger_entries le where le.order_id=o.id),0),
      'ledger_reconciled_cents',coalesce((select sum(case when le.event_type='payment_received' and le.recognition_status='reconciled' then le.amount_cents when le.event_type='payment_reversed' and le.recognition_status='reconciled' then -le.amount_cents else 0 end) from public.financial_ledger_entries le where le.order_id=o.id),0)
    ) into order_json
    from public.orders o left join public.order_fiscal_controls fc on fc.order_id=o.id where o.id=latest_order_id;
  end if;

  risk_json:=jsonb_build_array();
  if conv.service_window_expires_at is not null and conv.service_window_expires_at<=now() then risk_json:=risk_json||jsonb_build_array('service_window_closed'); end if;
  if conv.customer_id is null then risk_json:=risk_json||jsonb_build_array('customer_identity_missing'); end if;
  if latest_order_id is not null and coalesce(order_json->>'payment_status','pending') not in ('confirmed') then risk_json:=risk_json||jsonb_build_array('payment_not_confirmed'); end if;
  if latest_order_id is not null and coalesce(order_json->>'fiscal_status','blocked')='review_required' then risk_json:=risk_json||jsonb_build_array('fiscal_review_required'); end if;

  return jsonb_build_object(
    'ok',true,
    'conversation',jsonb_build_object('id',conv.id,'channel',conv.channel,'stage',conv.stage,'mode',conv.mode,'status',conv.status,'service_window_expires_at',conv.service_window_expires_at,'human_required',conv.human_required),
    'handoff',jsonb_build_object('id',handoff.id,'reason',handoff.reason,'priority',handoff.priority,'claimed_by',handoff.claimed_by,'sla_due_at',handoff.sla_due_at),
    'customer',coalesce(customer_json,'{}'::jsonb),
    'timeline',timeline_json,
    'cart',coalesce(cart_json,'{}'::jsonb),
    'last_order',coalesce(order_json,'{}'::jsonb),
    'risks',risk_json,
    'external_side_effect',false
  );
end;
$$;

create or replace function public.preview_human_copilot_nba_v1(
  p_conversation_id uuid,
  p_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.human_copilot_runtime_config%rowtype;
  ctx jsonb;
  code text;
  reason text;
  priority smallint:=50;
  draft text;
  order_status text;
  payment_status text;
  cart_total numeric:=0;
  stage text;
begin
  select * into cfg from public.human_copilot_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.deterministic_nba_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','human_copilot_nba_disabled','external_side_effect',false);
  end if;
  ctx:=public.preview_human_copilot_context_v1(p_conversation_id,p_admin_user_id);
  if not coalesce((ctx->>'ok')::boolean,false) then return ctx; end if;
  stage:=coalesce(ctx#>>'{conversation,stage}','new');
  order_status:=nullif(ctx#>>'{last_order,status}','');
  payment_status:=nullif(ctx#>>'{last_order,payment_status}','');
  cart_total:=coalesce(nullif(ctx#>>'{cart,total}','')::numeric,0);

  if (ctx->'risks') ? 'service_window_closed' then
    code:='review_channel_window';reason:='service_window_closed';priority:=100;draft:=null;
  elsif payment_status is not null and payment_status<>'confirmed' and order_status in ('ready','in_route','delivered') then
    code:='review_payment';reason:='order_requires_payment_review';priority:=95;draft:='Vou conferir o pagamento deste pedido antes de te orientar.';
  elsif (ctx->'risks') ? 'customer_identity_missing' then
    code:='verify_identity';reason:='customer_identity_missing';priority:=90;draft:='Vou confirmar seus dados para continuar com segurança.';
  elsif cart_total>0 and (order_status is null or order_status in ('cancelled','returned')) then
    code:='continue_cart';reason:='active_cart_with_value';priority:=75;draft:='Seu carrinho já está montado em parte. Posso continuar por ele.';
  elsif stage in ('checkout','confirming','order_review') then
    code:='review_checkout';reason:='conversation_in_checkout_stage';priority:=80;draft:='Vou revisar o pedido com você antes de finalizar.';
  else
    code:='understand_need';reason:='no_higher_priority_deterministic_action';priority:=50;draft:='Vou verificar isso para você.';
  end if;

  return jsonb_build_object(
    'ok',true,'recommended_action',code,'reason',reason,'priority',priority,
    'deterministic_draft',draft,'context',ctx,'provider_required_for_personalized_text',true,
    'external_side_effect',false
  );
end;
$$;

create or replace function public.record_human_copilot_suggestion_v1(
  p_conversation_id uuid,
  p_admin_user_id uuid,
  p_idempotency_key text,
  p_nba_code text,
  p_nba_reason text,
  p_suggestion_text text default null,
  p_summary text default null,
  p_intent text default null,
  p_confidence numeric default null,
  p_provider text default 'deterministic',
  p_model text default null,
  p_provider_response_id text default null,
  p_input_tokens integer default 0,
  p_output_tokens integer default 0,
  p_estimated_cost_brl numeric default 0,
  p_policy_snapshot jsonb default '{}'::jsonb,
  p_context_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.human_copilot_runtime_config%rowtype;
  handoff public.human_handoffs%rowtype;
  existing_id uuid;
  new_id uuid;
  key_text text:=left(btrim(coalesce(p_idempotency_key,'')),200);
begin
  select * into cfg from public.human_copilot_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.suggestion_recording_enabled or cfg.execution_mode not in ('dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','human_copilot_recording_disabled','external_side_effect',false);
  end if;
  if key_text='' then raise exception 'idempotency_key_required'; end if;
  if not exists(select 1 from public.admin_users a where a.user_id=p_admin_user_id and a.is_active=true and a.role in ('owner','operator')) then raise exception 'admin_not_authorized'; end if;
  select * into handoff from public.human_handoffs where conversation_id=p_conversation_id and status='claimed' order by claimed_at desc nulls last,created_at desc limit 1;
  if not found or handoff.claimed_by is distinct from p_admin_user_id then raise exception 'claimed_handoff_owned_by_admin_required'; end if;
  select id into existing_id from public.human_copilot_suggestions where idempotency_key=key_text;
  if existing_id is not null then return jsonb_build_object('ok',true,'id',existing_id,'idempotent',true,'external_side_effect',false); end if;
  insert into public.human_copilot_suggestions(
    conversation_id,handoff_id,admin_user_id,idempotency_key,intent,summary,nba_code,nba_reason,suggestion_text,confidence,
    provider,model,provider_response_id,input_tokens,output_tokens,estimated_cost_brl,policy_snapshot,context_snapshot
  ) values(
    p_conversation_id,handoff.id,p_admin_user_id,key_text,left(p_intent,160),left(p_summary,1200),left(p_nba_code,80),left(p_nba_reason,300),left(p_suggestion_text,cfg.max_suggestion_chars),p_confidence,
    left(coalesce(p_provider,'deterministic'),40),left(p_model,120),left(p_provider_response_id,160),greatest(coalesce(p_input_tokens,0),0),greatest(coalesce(p_output_tokens,0),0),greatest(coalesce(p_estimated_cost_brl,0),0),coalesce(p_policy_snapshot,'{}'::jsonb),coalesce(p_context_snapshot,'{}'::jsonb)
  ) returning id into new_id;
  return jsonb_build_object('ok',true,'id',new_id,'idempotent',false,'external_side_effect',false);
end;
$$;

-- Resposta humana continua sendo do operador também em HUMAN_COPILOT.
create or replace function public.queue_operator_reply_v1(p_conversation_id uuid,p_admin_user_id uuid,p_body_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_admin public.admin_users%rowtype;
  v_conv public.conversations%rowtype;
  v_handoff public.human_handoffs%rowtype;
  v_body text:=btrim(coalesce(p_body_text,''));
  v_job_id uuid;
  v_status text:='held';
  v_reason text;
  v_dispatch jsonb;
begin
  select * into v_admin from public.admin_users where user_id=p_admin_user_id and is_active=true;
  if not found or v_admin.role not in ('owner','operator') then raise exception 'admin_not_authorized'; end if;
  if length(v_body)<1 or length(v_body)>4096 then raise exception 'invalid_message_body'; end if;
  select * into v_conv from public.conversations where id=p_conversation_id for update;
  if not found then raise exception 'conversation_not_found'; end if;
  if v_conv.mode not in ('human','human_copilot') or not v_conv.human_required then raise exception 'conversation_not_in_human_control'; end if;
  select * into v_handoff from public.human_handoffs where conversation_id=p_conversation_id and status in ('open','claimed') order by created_at desc limit 1 for update;
  if not found then raise exception 'active_handoff_required'; end if;
  if v_handoff.status='open' then raise exception 'handoff_must_be_claimed'; end if;
  if v_handoff.claimed_by is distinct from p_admin_user_id then raise exception 'handoff_claimed_by_other'; end if;
  if v_conv.channel='whatsapp' then v_status:='pending'; else v_status:='held';v_reason:='channel_transport_not_enabled'; end if;
  insert into public.operator_reply_jobs(conversation_id,customer_id,handoff_id,channel,channel_account_id,admin_user_id,body_text,status,blocked_reason)
  values(v_conv.id,v_conv.customer_id,v_handoff.id,v_conv.channel,v_conv.channel_account_id,p_admin_user_id,v_body,v_status,v_reason) returning id into v_job_id;
  if v_status='pending' then v_dispatch:=public.dispatch_operator_reply_whatsapp_v1(v_job_id); else v_dispatch:=jsonb_build_object('ok',true,'skipped',v_reason); end if;
  return jsonb_build_object('ok',true,'job_id',v_job_id,'channel',v_conv.channel,'dispatch',v_dispatch);
end;$$;

-- Governança v3: ferramenta explicitamente read-only pode ser usada como copiloto durante handoff.
create or replace function public.preview_safe_commercial_action_v3(
  p_tool_key text,
  p_confidence numeric,
  p_has_confirmation boolean default false,
  p_has_open_handoff boolean default false,
  p_confidence_scope text default 'default',
  p_role text default 'system',
  p_context_channel text default null
)
returns jsonb
language plpgsql
security definer
set search_path='public','pg_temp'
as $$
declare
  tool public.commercial_tool_registry%rowtype;
  base jsonb;
begin
  select * into tool from public.commercial_tool_registry where tool_key=p_tool_key;
  if not found then return jsonb_build_object('ok',false,'allowed',false,'decision','blocked','error','unknown_tool','external_side_effect',false); end if;
  if p_has_open_handoff and not (
    tool.risk_class='read_only'
    and coalesce((tool.metadata->>'allowed_during_handoff')::boolean,false)
    and not tool.confirmation_required
  ) then
    return jsonb_build_object('ok',true,'allowed',false,'decision','awaiting_human','reason','human_handoff_open','tool_key',tool.tool_key,'external_side_effect',false);
  end if;
  base:=public.preview_safe_commercial_action_v2(
    p_tool_key,p_confidence,p_has_confirmation,false,p_confidence_scope,p_role,p_context_channel
  );
  return base||jsonb_build_object('handoff_context',coalesce(p_has_open_handoff,false),'allowed_during_handoff',coalesce((tool.metadata->>'allowed_during_handoff')::boolean,false));
end;
$$;

revoke all on function public.human_copilot_readiness_v1() from public,anon,authenticated;
revoke all on function public.set_human_copilot_mode_v1(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.preview_human_copilot_context_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.preview_human_copilot_nba_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.record_human_copilot_suggestion_v1(uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,integer,integer,numeric,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.queue_operator_reply_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.preview_safe_commercial_action_v3(text,numeric,boolean,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.human_copilot_readiness_v1() to service_role;
grant execute on function public.set_human_copilot_mode_v1(uuid,uuid,boolean) to service_role;
grant execute on function public.preview_human_copilot_context_v1(uuid,uuid) to service_role;
grant execute on function public.preview_human_copilot_nba_v1(uuid,uuid) to service_role;
grant execute on function public.record_human_copilot_suggestion_v1(uuid,uuid,text,text,text,text,text,text,numeric,text,text,text,integer,integer,numeric,jsonb,jsonb) to service_role;
grant execute on function public.queue_operator_reply_v1(uuid,uuid,text) to service_role;
grant execute on function public.preview_safe_commercial_action_v3(text,numeric,boolean,boolean,text,text,text) to service_role;

commit;
