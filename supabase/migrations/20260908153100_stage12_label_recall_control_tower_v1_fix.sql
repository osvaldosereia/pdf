begin;

-- Fix V1: disambiguate PL/pgSQL variable from operational_sla_policies.stage.
create or replace function public.preview_order_aging_v1(p_order_id uuid,p_reference_at timestamptz default now())
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  cfg public.operational_control_runtime_config%rowtype;
  snap jsonb;
  current_stage text;
  anchor timestamptz;
  pol public.operational_sla_policies%rowtype;
  age_min integer;
begin
  select * into cfg from public.operational_control_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.control_tower_enabled or not cfg.sla_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','sla_preview_disabled','side_effect_performed',false,'external_side_effect',false);
  end if;
  snap:=public.control_tower_order_snapshot_v1(p_order_id);
  if coalesce((snap->>'ok')::boolean,false)=false then return snap;end if;
  current_stage:=snap->>'current_stage';
  anchor:=(snap->>'stage_anchor')::timestamptz;
  if current_stage='closed' then
    return jsonb_build_object('ok',true,'order_id',p_order_id,'stage','closed','breach',false,'result','closed','age_minutes',0,'side_effect_performed',false,'external_side_effect',false);
  end if;
  age_min:=greatest(floor(extract(epoch from (p_reference_at-anchor))/60)::integer,0);
  select p.* into pol
    from public.operational_sla_policies p
    where p.stage=current_stage and p.status='active'
    order by p.version_no desc
    limit 1;
  if not found or pol.threshold_minutes is null then
    return jsonb_build_object('ok',true,'order_id',p_order_id,'stage',current_stage,'result','review','breach',false,'reason','sla_policy_missing','age_minutes',age_min,'threshold_minutes',null,'snapshot',snap,'side_effect_performed',false,'external_side_effect',false);
  end if;
  return jsonb_build_object('ok',true,'order_id',p_order_id,'stage',current_stage,'result',case when age_min>pol.threshold_minutes then 'breach' else 'within_sla' end,'breach',age_min>pol.threshold_minutes,'age_minutes',age_min,'threshold_minutes',pol.threshold_minutes,'severity',pol.severity,'policy_version',pol.version_no,'snapshot',snap,'side_effect_performed',false,'external_side_effect',false);
end;
$$;

revoke all on function public.preview_order_aging_v1(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.preview_order_aging_v1(uuid,timestamptz) to service_role;

commit;
