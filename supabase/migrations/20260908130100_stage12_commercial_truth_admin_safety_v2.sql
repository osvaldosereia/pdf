begin;

-- Stage 12 administrative safety layer. Draft-only writes; no activation path.

create or replace function public.kill_commercial_truth_runtime_v1(p_reason text default null,p_actor uuid default null)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
begin
  update public.commercial_truth_runtime_config set
    enabled=false,
    execution_mode='off',
    lot_tracking_enabled=false,
    fefo_enforcement_enabled=false,
    expiry_block_enabled=false,
    promotions_enabled=false,
    benefits_enabled=false,
    margin_guard_enabled=false,
    reports_enabled=false,
    canary_percent=0,
    updated_at=now(),
    updated_by=p_actor
  where id=1;
  update public.promotion_rules set enabled=false,execution_mode='off',updated_at=now()
  where enabled=true or execution_mode<>'off';
  return jsonb_build_object('ok',true,'reason',nullif(trim(coalesce(p_reason,'')),''),'enabled',false,'execution_mode','off','external_side_effect',false);
end;
$$;

create or replace function public.create_inventory_lot_draft_v1(
  p_product_id uuid,
  p_lot_code text,
  p_expires_at date default null,
  p_quantity_received numeric default 0,
  p_unit_cost numeric default null,
  p_source_ref text default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_id uuid;
  code text:=trim(coalesce(p_lot_code,''));
begin
  if not exists(select 1 from public.products where id=p_product_id) then return jsonb_build_object('ok',false,'error','product_not_found','external_side_effect',false); end if;
  if length(code)<1 or length(code)>120 then return jsonb_build_object('ok',false,'error','invalid_lot_code','external_side_effect',false); end if;
  if p_quantity_received is null or p_quantity_received<0 then return jsonb_build_object('ok',false,'error','invalid_quantity','external_side_effect',false); end if;
  if p_unit_cost is not null and p_unit_cost<0 then return jsonb_build_object('ok',false,'error','invalid_unit_cost','external_side_effect',false); end if;
  insert into public.inventory_lots(product_id,lot_code,expires_at,quantity_received,quantity_available,quantity_reserved,unit_cost,status,physically_verified,source_system,source_ref,notes)
  values(p_product_id,code,p_expires_at,p_quantity_received,0,0,p_unit_cost,'draft',false,'admin_draft',nullif(trim(coalesce(p_source_ref,'')),''),nullif(trim(coalesce(p_notes,'')),''))
  returning id into v_id;
  return jsonb_build_object('ok',true,'lot_id',v_id,'status','draft','physically_verified',false,'quantity_available',0,'external_side_effect',false);
exception when unique_violation then
  return jsonb_build_object('ok',false,'error','lot_code_already_exists','external_side_effect',false);
end;
$$;

create or replace function public.create_commercial_policy_draft_v1(
  p_policy_key text,
  p_policy jsonb,
  p_created_by uuid default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  keyv text:=lower(trim(coalesce(p_policy_key,'')));
  next_version integer;
  v_id uuid;
begin
  if keyv not in ('expiry_discount','minimum_margin','coupon','gift','birthday','benefit','bundle','shelf_life') then return jsonb_build_object('ok',false,'error','unsupported_policy_key','external_side_effect',false); end if;
  if p_policy is null or jsonb_typeof(p_policy)<>'object' then return jsonb_build_object('ok',false,'error','policy_object_required','external_side_effect',false); end if;
  select coalesce(max(version),0)+1 into next_version from public.commercial_policy_versions where policy_key=keyv;
  insert into public.commercial_policy_versions(policy_key,version,status,policy,created_by)
  values(keyv,next_version,'draft',p_policy,p_created_by) returning id into v_id;
  return jsonb_build_object('ok',true,'policy_id',v_id,'policy_key',keyv,'version',next_version,'status','draft','external_side_effect',false);
end;
$$;

create or replace function public.create_promotion_rule_draft_v1(
  p_code text,
  p_name text,
  p_rule_type text,
  p_conditions jsonb default '{}'::jsonb,
  p_benefit jsonb default '{}'::jsonb,
  p_budget_cents bigint default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  codev text:=upper(trim(coalesce(p_code,'')));
  typev text:=lower(trim(coalesce(p_rule_type,'')));
  v_id uuid;
begin
  if length(codev)<2 or length(codev)>80 then return jsonb_build_object('ok',false,'error','invalid_promotion_code','external_side_effect',false); end if;
  if length(trim(coalesce(p_name,'')))<2 then return jsonb_build_object('ok',false,'error','promotion_name_required','external_side_effect',false); end if;
  if typev not in ('expiry_discount','coupon','gift','birthday','benefit','bundle') then return jsonb_build_object('ok',false,'error','invalid_rule_type','external_side_effect',false); end if;
  if p_budget_cents is not null and p_budget_cents<0 then return jsonb_build_object('ok',false,'error','invalid_budget','external_side_effect',false); end if;
  insert into public.promotion_rules(code,name,rule_type,enabled,execution_mode,conditions,benefit,budget_cents)
  values(codev,trim(p_name),typev,false,'off',coalesce(p_conditions,'{}'::jsonb),coalesce(p_benefit,'{}'::jsonb),p_budget_cents)
  returning id into v_id;
  return jsonb_build_object('ok',true,'promotion_id',v_id,'enabled',false,'execution_mode','off','external_side_effect',false);
exception when unique_violation then
  return jsonb_build_object('ok',false,'error','promotion_code_already_exists','external_side_effect',false);
end;
$$;

create or replace function public.stage12_admin_snapshot_v1() returns jsonb
language sql security definer set search_path=public,pg_temp
as $$
 select jsonb_build_object(
   'readiness',public.stage12_readiness_v1(),
   'expiry_risk',coalesce((select jsonb_agg(x order by x.days_remaining,x.product_name) from (
     select l.id lot_id,l.product_id,p.name product_name,l.lot_code,l.expires_at,(l.expires_at-(now() at time zone 'America/Cuiaba')::date) days_remaining,l.quantity_available,l.quantity_reserved,l.status,l.physically_verified
     from public.inventory_lots l join public.products p on p.id=l.product_id
     where l.expires_at is not null and l.status in ('draft','available','quarantined')
     order by l.expires_at,p.name limit 100
   ) x),'[]'::jsonb),
   'policies',coalesce((select jsonb_agg(x order by x.policy_key,x.version desc) from (select id,policy_key,version,status,effective_from,effective_to,created_at from public.commercial_policy_versions order by policy_key,version desc limit 100) x),'[]'::jsonb),
   'promotions',coalesce((select jsonb_agg(x order by x.priority,x.code) from (select id,code,name,rule_type,enabled,execution_mode,priority,budget_cents,spent_cents,starts_at,ends_at from public.promotion_rules order by priority,code limit 100) x),'[]'::jsonb),
   'external_side_effect',false
 )
$$;

revoke all on function public.kill_commercial_truth_runtime_v1(text,uuid) from public,anon,authenticated;
revoke all on function public.create_inventory_lot_draft_v1(uuid,text,date,numeric,numeric,text,text) from public,anon,authenticated;
revoke all on function public.create_commercial_policy_draft_v1(text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.create_promotion_rule_draft_v1(text,text,text,jsonb,jsonb,bigint) from public,anon,authenticated;
revoke all on function public.stage12_admin_snapshot_v1() from public,anon,authenticated;
grant execute on function public.kill_commercial_truth_runtime_v1(text,uuid) to service_role;
grant execute on function public.create_inventory_lot_draft_v1(uuid,text,date,numeric,numeric,text,text) to service_role;
grant execute on function public.create_commercial_policy_draft_v1(text,jsonb,uuid) to service_role;
grant execute on function public.create_promotion_rule_draft_v1(text,text,text,jsonb,jsonb,bigint) to service_role;
grant execute on function public.stage12_admin_snapshot_v1() to service_role;

commit;
