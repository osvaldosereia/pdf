begin;

create or replace function public.driver_start_route_v1(p_auth_user_id uuid,p_route_id uuid,p_client_event_id text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.logistics_runtime_config%rowtype;
  d public.drivers%rowtype;
  r public.delivery_routes%rowtype;
  existing uuid;
begin
  select * into cfg from public.logistics_runtime_config where id=1;
  if not cfg.enabled or not cfg.driver_app_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','driver_runtime_disabled','side_effect_performed',false); end if;
  select id into existing from public.delivery_events where client_event_id=p_client_event_id;
  if found then return jsonb_build_object('ok',true,'replay',true,'event_id',existing,'side_effect_performed',false); end if;
  select * into d from public.drivers where auth_user_id=p_auth_user_id and status<>'suspended';
  if not found then return jsonb_build_object('ok',false,'error','driver_not_authorized','side_effect_performed',false); end if;
  select * into r from public.delivery_routes where id=p_route_id for update;
  if not found or r.driver_id is distinct from d.id then return jsonb_build_object('ok',false,'error','route_not_assigned_to_driver','side_effect_performed',false); end if;
  if r.status='active' then return jsonb_build_object('ok',true,'replay',true,'route_id',r.id,'side_effect_performed',false); end if;
  if r.status<>'published' then return jsonb_build_object('ok',false,'error','route_not_published','route_status',r.status,'side_effect_performed',false); end if;
  update public.delivery_routes set status='active',started_at=coalesce(started_at,now()),updated_at=now() where id=r.id;
  update public.drivers set status='on_route',updated_at=now() where id=d.id;
  update public.delivery_jobs j set status='out_for_delivery',updated_at=now()
    where j.id in (select s.delivery_job_id from public.delivery_stops s where s.route_id=r.id) and j.status in ('assigned','planned');
  update public.orders o set status='out_for_delivery',external_status_updated_at=now(),updated_at=now()
    where o.id in (select j.order_id from public.delivery_jobs j join public.delivery_stops s on s.delivery_job_id=j.id where s.route_id=r.id) and o.status='ready';
  insert into public.delivery_events(route_id,event_type,actor_type,actor_id,client_event_id,payload)
    values(r.id,'ROUTE_STARTED','driver',d.id,p_client_event_id,jsonb_build_object('auth_user_id',p_auth_user_id)) returning id into existing;
  return jsonb_build_object('ok',true,'replay',false,'route_id',r.id,'event_id',existing,'side_effect_performed',true);
end;
$$;

create or replace function public.driver_arrive_stop_v1(p_auth_user_id uuid,p_stop_id uuid,p_client_event_id text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.logistics_runtime_config%rowtype;
  d public.drivers%rowtype;
  s public.delivery_stops%rowtype;
  r public.delivery_routes%rowtype;
  existing uuid;
begin
  select * into cfg from public.logistics_runtime_config where id=1;
  if not cfg.enabled or not cfg.driver_app_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','driver_runtime_disabled','side_effect_performed',false); end if;
  select id into existing from public.delivery_events where client_event_id=p_client_event_id;
  if found then return jsonb_build_object('ok',true,'replay',true,'event_id',existing,'side_effect_performed',false); end if;
  select * into d from public.drivers where auth_user_id=p_auth_user_id and status='on_route';
  if not found then return jsonb_build_object('ok',false,'error','driver_not_on_route','side_effect_performed',false); end if;
  select * into s from public.delivery_stops where id=p_stop_id for update;
  if not found then return jsonb_build_object('ok',false,'error','stop_not_found','side_effect_performed',false); end if;
  select * into r from public.delivery_routes where id=s.route_id;
  if r.status<>'active' or r.driver_id is distinct from d.id then return jsonb_build_object('ok',false,'error','stop_not_owned_by_driver','side_effect_performed',false); end if;
  if s.status='arrived' then return jsonb_build_object('ok',true,'replay',true,'stop_id',s.id,'side_effect_performed',false); end if;
  if s.status not in ('active','locked_next','planned') then return jsonb_build_object('ok',false,'error','stop_not_arrivable','stop_status',s.status,'side_effect_performed',false); end if;
  update public.delivery_stops set status='arrived',arrived_at=coalesce(arrived_at,now()),activated_at=coalesce(activated_at,now()),updated_at=now() where id=s.id;
  insert into public.delivery_events(delivery_job_id,route_id,stop_id,event_type,actor_type,actor_id,client_event_id,payload)
    values(s.delivery_job_id,s.route_id,s.id,'STOP_ARRIVED','driver',d.id,p_client_event_id,'{}'::jsonb) returning id into existing;
  return jsonb_build_object('ok',true,'replay',false,'stop_id',s.id,'event_id',existing,'side_effect_performed',true);
end;
$$;

create or replace function public.driver_deliver_stop_v1(p_auth_user_id uuid,p_stop_id uuid,p_client_event_id text,p_proof jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.logistics_runtime_config%rowtype;
  d public.drivers%rowtype;
  s public.delivery_stops%rowtype;
  r public.delivery_routes%rowtype;
  j public.delivery_jobs%rowtype;
  existing uuid;
  remaining integer;
begin
  select * into cfg from public.logistics_runtime_config where id=1;
  if not cfg.enabled or not cfg.driver_app_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','driver_runtime_disabled','side_effect_performed',false); end if;
  select id into existing from public.delivery_events where client_event_id=p_client_event_id;
  if found then return jsonb_build_object('ok',true,'replay',true,'event_id',existing,'side_effect_performed',false); end if;
  select * into d from public.drivers where auth_user_id=p_auth_user_id and status='on_route';
  if not found then return jsonb_build_object('ok',false,'error','driver_not_on_route','side_effect_performed',false); end if;
  select * into s from public.delivery_stops where id=p_stop_id for update;
  if not found then return jsonb_build_object('ok',false,'error','stop_not_found','side_effect_performed',false); end if;
  select * into r from public.delivery_routes where id=s.route_id for update;
  if r.status<>'active' or r.driver_id is distinct from d.id then return jsonb_build_object('ok',false,'error','stop_not_owned_by_driver','side_effect_performed',false); end if;
  if s.status='delivered' then return jsonb_build_object('ok',true,'replay',true,'stop_id',s.id,'side_effect_performed',false); end if;
  if s.status<>'arrived' then return jsonb_build_object('ok',false,'error','arrival_confirmation_required','stop_status',s.status,'side_effect_performed',false); end if;
  select * into j from public.delivery_jobs where id=s.delivery_job_id for update;
  update public.delivery_stops set status='delivered',locked=false,delivered_at=coalesce(delivered_at,now()),updated_at=now() where id=s.id;
  update public.delivery_jobs set status='delivered',delivered_at=coalesce(delivered_at,now()),updated_at=now() where id=j.id;
  update public.orders set status='delivered',delivered_at=coalesce(delivered_at,now()),external_status_updated_at=now(),updated_at=now() where id=j.order_id and status in ('ready','out_for_delivery');
  insert into public.delivery_events(delivery_job_id,route_id,stop_id,event_type,actor_type,actor_id,client_event_id,payload)
    values(j.id,s.route_id,s.id,'STOP_DELIVERED','driver',d.id,p_client_event_id,jsonb_build_object('proof',coalesce(p_proof,'{}'::jsonb))) returning id into existing;
  select count(*) into remaining from public.delivery_stops where route_id=r.id and status not in ('delivered','skipped','rescheduled');
  if remaining=0 then
    update public.delivery_routes set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=r.id;
    update public.drivers set status='available',updated_at=now() where id=d.id;
    insert into public.delivery_events(route_id,event_type,actor_type,actor_id,payload) values(r.id,'ROUTE_FINISHED','driver',d.id,'{}'::jsonb);
  end if;
  return jsonb_build_object('ok',true,'replay',false,'stop_id',s.id,'delivery_job_id',j.id,'order_id',j.order_id,'route_completed',remaining=0,'event_id',existing,'side_effect_performed',true);
end;
$$;

create or replace function public.driver_fail_stop_v1(p_auth_user_id uuid,p_stop_id uuid,p_client_event_id text,p_incident_type text,p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.logistics_runtime_config%rowtype;
  d public.drivers%rowtype;
  s public.delivery_stops%rowtype;
  r public.delivery_routes%rowtype;
  existing uuid;
  incident_id uuid;
  kind text:=coalesce(nullif(trim(p_incident_type),''),'other');
begin
  select * into cfg from public.logistics_runtime_config where id=1;
  if not cfg.enabled or not cfg.driver_app_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','driver_runtime_disabled','side_effect_performed',false); end if;
  select id into existing from public.delivery_events where client_event_id=p_client_event_id;
  if found then return jsonb_build_object('ok',true,'replay',true,'event_id',existing,'side_effect_performed',false); end if;
  select * into d from public.drivers where auth_user_id=p_auth_user_id and status='on_route';
  if not found then return jsonb_build_object('ok',false,'error','driver_not_on_route','side_effect_performed',false); end if;
  select * into s from public.delivery_stops where id=p_stop_id for update;
  if not found then return jsonb_build_object('ok',false,'error','stop_not_found','side_effect_performed',false); end if;
  select * into r from public.delivery_routes where id=s.route_id;
  if r.status<>'active' or r.driver_id is distinct from d.id then return jsonb_build_object('ok',false,'error','stop_not_owned_by_driver','side_effect_performed',false); end if;
  if kind not in ('customer_absent','address_issue','payment_issue','vehicle_issue','delay','damage','safety','other') then kind:='other'; end if;
  update public.delivery_stops set status='failed',locked=false,failed_at=coalesce(failed_at,now()),updated_at=now() where id=s.id;
  update public.delivery_jobs set status='failed',failed_at=coalesce(failed_at,now()),updated_at=now() where id=s.delivery_job_id;
  insert into public.delivery_incidents(delivery_job_id,route_id,stop_id,incident_type,status,notes,created_by_type,created_by)
    values(s.delivery_job_id,s.route_id,s.id,kind,case when kind in ('safety','payment_issue','damage') then 'review_required' else 'open' end,nullif(trim(coalesce(p_notes,'')),''),'driver',d.id) returning id into incident_id;
  insert into public.delivery_events(delivery_job_id,route_id,stop_id,event_type,actor_type,actor_id,client_event_id,payload)
    values(s.delivery_job_id,s.route_id,s.id,'STOP_FAILED','driver',d.id,p_client_event_id,jsonb_build_object('incident_id',incident_id,'incident_type',kind)) returning id into existing;
  return jsonb_build_object('ok',true,'replay',false,'stop_id',s.id,'incident_id',incident_id,'event_id',existing,'side_effect_performed',true);
end;
$$;

revoke all on function public.driver_start_route_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.driver_arrive_stop_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.driver_deliver_stop_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.driver_fail_stop_v1(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.driver_start_route_v1(uuid,uuid,text) to service_role;
grant execute on function public.driver_arrive_stop_v1(uuid,uuid,text) to service_role;
grant execute on function public.driver_deliver_stop_v1(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.driver_fail_stop_v1(uuid,uuid,text,text,text) to service_role;

commit;
