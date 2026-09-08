begin;

-- P0 hardening: distinguish the tool transport/channel from the customer's conversation context.
-- Example: CATALOGO is an internal tool while it can be invoked from a WhatsApp conversation.

alter table public.commercial_decision_evaluations
  add column if not exists context_channel text null;

create or replace function public.preview_safe_commercial_action_v2(
  p_tool_key text,
  p_confidence numeric,
  p_has_confirmation boolean default false,
  p_has_open_handoff boolean default false,
  p_confidence_scope text default 'default',
  p_role text default 'system',
  p_context_channel text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  cfg public.commercial_decision_runtime_config%rowtype;
  t public.commercial_tool_registry%rowtype;
  cp public.decision_confidence_policy_versions%rowtype;
  cost jsonb;
  ai jsonb:='{}'::jsonb;
  decision text:='blocked';
  reason text:=null;
  ref_at timestamptz:=now();
  context_channel text:=nullif(lower(trim(coalesce(p_context_channel,''))), '');
begin
  select * into cfg from public.commercial_decision_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.action_safety_preview_enabled or not cfg.confidence_policy_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'allowed',false,'decision','blocked','error','commercial_action_preview_disabled','external_side_effect',false);
  end if;

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
  else
    cost:=jsonb_build_object('ok',true,'allowed',false,'reason','not_evaluated_before_action_clear');
  end if;

  if decision in ('approved','execute_with_disclosure') and t.ai_action_key is not null then
    if context_channel is null then
      decision:='review_required';reason:='context_channel_required';
    else
      ai:=public.simulate_ai_action_v1(t.ai_action_key,'{}'::jsonb,context_channel,p_role,null,p_has_open_handoff);
      if not coalesce((ai->>'allowed')::boolean,false) then decision:='blocked';reason:='ai_action_registry_block';
      elsif ai->>'decision' in ('awaiting_confirmation','awaiting_human') then decision:=ai->>'decision';reason:='ai_action_registry_requires_guard'; end if;
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'allowed',decision in ('approved','execute_with_disclosure'),
    'decision',decision,
    'reason',reason,
    'tool_key',t.tool_key,
    'tool_channel',t.channel,
    'context_channel',context_channel,
    'risk_class',t.risk_class,
    'reversible',t.reversible,
    'confirmation_required',t.confirmation_required,
    'confidence',p_confidence,
    'confidence_scope',cp.scope_key,
    'low_threshold',cp.low_threshold,
    'high_threshold',cp.high_threshold,
    'cost_policy',cost,
    'ai_action_policy',ai,
    'objective_order',to_jsonb(cfg.objective_order),
    'side_effect_performed',false,
    'external_side_effect',false
  );
end; $$;

create or replace function public.record_commercial_decision_evaluation_v2(
  p_tool_key text,
  p_confidence numeric,
  p_has_confirmation boolean,
  p_has_open_handoff boolean,
  p_confidence_scope text,
  p_role text,
  p_context_channel text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  cfg public.commercial_decision_runtime_config%rowtype;
  prior public.commercial_decision_evaluations%rowtype;
  preview jsonb;
  new_id uuid;
begin
  select * into cfg from public.commercial_decision_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.decision_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','commercial_decision_recording_disabled','external_side_effect',false);
  end if;
  if length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','external_side_effect',false); end if;

  select * into prior from public.commercial_decision_evaluations where idempotency_key=trim(p_idempotency_key);
  if found then return jsonb_build_object('ok',true,'replay',true,'evaluation_id',prior.id,'final_decision',prior.final_decision,'external_side_effect',false); end if;

  preview:=public.preview_safe_commercial_action_v2(p_tool_key,p_confidence,p_has_confirmation,p_has_open_handoff,p_confidence_scope,p_role,p_context_channel);
  if not coalesce((preview->>'ok')::boolean,false) then return preview; end if;

  insert into public.commercial_decision_evaluations(
    idempotency_key,tool_key,confidence,confidence_scope,context_channel,cost_decision,action_decision,final_decision,objective_order
  ) values(
    trim(p_idempotency_key),p_tool_key,p_confidence,coalesce(nullif(trim(p_confidence_scope),''),'default'),
    nullif(lower(trim(coalesce(p_context_channel,''))),''),coalesce(preview->'cost_policy','{}'::jsonb),preview,preview->>'decision',cfg.objective_order
  ) returning id into new_id;

  return jsonb_build_object('ok',true,'replay',false,'evaluation_id',new_id,'final_decision',preview->>'decision','context_channel',preview->>'context_channel','side_effect_performed',true,'external_side_effect',false);
end; $$;

revoke all on function public.preview_safe_commercial_action_v2(text,numeric,boolean,boolean,text,text,text) from public,anon,authenticated;
revoke all on function public.record_commercial_decision_evaluation_v2(text,numeric,boolean,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.preview_safe_commercial_action_v2(text,numeric,boolean,boolean,text,text,text) to service_role;
grant execute on function public.record_commercial_decision_evaluation_v2(text,numeric,boolean,boolean,text,text,text,text) to service_role;

comment on function public.preview_safe_commercial_action_v2(text,numeric,boolean,boolean,text,text,text) is 'Separates internal tool channel from customer context channel before AI Action Registry evaluation.';

commit;
