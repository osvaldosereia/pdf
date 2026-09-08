begin;

create or replace function public.create_delivery_route_draft_v1(
  p_job_ids uuid[],
  p_driver_id uuid default null,
  p_vehicle_id uuid default null,
  p_route_date date default current_date,
  p_actor_id uuid default null,
  p_reason text default 'admin_draft'
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  requested integer;
  routable integer;
  missing_coords integer;
  capacity integer;
  route_id uuid;
  route_code text;
  version_snapshot jsonb;
begin
  requested:=coalesce(array_length(p_job_ids,1),0);
  if requested=0 then return jsonb_build_object('ok',false,'error','route_jobs_required','side_effect_performed',false); end if;
  if requested>200 then return jsonb_build_object('ok',false,'error','route_too_large','max_jobs',200,'side_effect_performed',false); end if;

  select count(*) into routable from public.delivery_jobs where id=any(p_job_ids) and status in ('waiting_route','planned');
  if routable<>requested then return jsonb_build_object('ok',false,'error','job_not_routable_or_missing','requested',requested,'routable',routable,'side_effect_performed',false); end if;
  select count(*) into missing_coords from public.delivery_jobs where id=any(p_job_ids) and (latitude is null or longitude is null or geocode_status in ('required','blocked'));
  if missing_coords>0 then return jsonb_build_object('ok',false,'error','coordinates_required','count',missing_coords,'side_effect_performed',false); end if;

  if p_driver_id is not null and not exists(select 1 from public.drivers where id=p_driver_id) then return jsonb_build_object('ok',false,'error','driver_not_found','side_effect_performed',false); end if;
  if p_vehicle_id is not null then
    select max_stops into capacity from public.vehicles where id=p_vehicle_id;
    if not found then return jsonb_build_object('ok',false,'error','vehicle_not_found','side_effect_performed',false); end if;
    if capacity is not null and requested>capacity then return jsonb_build_object('ok',false,'error','vehicle_capacity_exceeded','capacity',capacity,'requested',requested,'side_effect_performed',false); end if;
  end if;

  route_code:='DRAFT-'||to_char(coalesce(p_route_date,current_date),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));
  insert into public.delivery_routes(route_code,route_date,status,driver_id,vehicle_id,provider_name,optimization_status,version_no,metadata)
    values(route_code,coalesce(p_route_date,current_date),'draft',p_driver_id,p_vehicle_id,'none','drafted',1,jsonb_build_object('geographically_optimized',false,'draft_reason',p_reason)) returning id into route_id;

  insert into public.delivery_stops(route_id,delivery_job_id,sequence_no,status,locked)
  select route_id,j.id,row_number() over(order by j.priority desc,j.delivery_window_start nulls last,j.ready_at,j.id),'planned',false
    from public.delivery_jobs j where j.id=any(p_job_ids);

  update public.delivery_jobs set status='planned',updated_at=now() where id=any(p_job_ids) and status='waiting_route';
  select jsonb_build_object('route_id',r.id,'route_code',r.route_code,'route_date',r.route_date,'status',r.status,'driver_id',r.driver_id,'vehicle_id',r.vehicle_id,'stops',(select jsonb_agg(jsonb_build_object('id',s.id,'delivery_job_id',s.delivery_job_id,'sequence_no',s.sequence_no,'status',s.status) order by s.sequence_no) from public.delivery_stops s where s.route_id=r.id)) into version_snapshot from public.delivery_routes r where r.id=route_id;
  insert into public.delivery_route_versions(route_id,version_no,snapshot,reason,actor_type,actor_id) values(route_id,1,version_snapshot,coalesce(nullif(trim(p_reason),''),'admin_draft'),'admin',p_actor_id);
  insert into public.delivery_events(route_id,event_type,actor_type,actor_id,payload) values(route_id,'ROUTE_DRAFT_CREATED','admin',p_actor_id,jsonb_build_object('jobs',requested,'geographically_optimized',false));
  insert into public.logistics_audit_events(event_type,actor_type,actor_id,entity_type,entity_id,after_state,reason) values('ROUTE_DRAFT_CREATED','admin',p_actor_id,'delivery_route',route_id,version_snapshot,p_reason);
  return jsonb_build_object('ok',true,'route_id',route_id,'route_code',route_code,'jobs',requested,'geographically_optimized',false,'requires_provider_optimization',true,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.publish_delivery_route_v1(p_route_id uuid,p_actor_id uuid default null,p_reason text default 'route_publish')
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.logistics_runtime_config%rowtype;
  r public.delivery_routes%rowtype;
  stop_count integer;
  version_snapshot jsonb;
begin
  select * into cfg from public.logistics_runtime_config where id=1;
  if not cfg.enabled or not cfg.routing_enabled or not cfg.driver_app_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','route_publish_disabled','side_effect_performed',false); end if;
  select * into r from public.delivery_routes where id=p_route_id for update;
  if not found then return jsonb_build_object('ok',false,'error','route_not_found','side_effect_performed',false); end if;
  if r.status='published' then return jsonb_build_object('ok',true,'replay',true,'route_id',r.id,'side_effect_performed',false); end if;
  if r.status not in ('draft','optimized') then return jsonb_build_object('ok',false,'error','route_not_publishable','route_status',r.status,'side_effect_performed',false); end if;
  if r.driver_id is null or r.vehicle_id is null then return jsonb_build_object('ok',false,'error','driver_and_vehicle_required','side_effect_performed',false); end if;
  if not exists(select 1 from public.drivers where id=r.driver_id and status='available') then return jsonb_build_object('ok',false,'error','driver_not_available','side_effect_performed',false); end if;
  if not exists(select 1 from public.vehicles where id=r.vehicle_id and status='available') then return jsonb_build_object('ok',false,'error','vehicle_not_available','side_effect_performed',false); end if;
  select count(*) into stop_count from public.delivery_stops where route_id=r.id;
  if stop_count=0 then return jsonb_build_object('ok',false,'error','route_has_no_stops','side_effect_performed',false); end if;
  if exists(select 1 from public.delivery_stops s join public.delivery_jobs j on j.id=s.delivery_job_id where s.route_id=r.id and (j.latitude is null or j.longitude is null or j.geocode_status in ('required','blocked'))) then return jsonb_build_object('ok',false,'error','route_has_unconfirmed_coordinates','side_effect_performed',false); end if;

  update public.delivery_routes set status='published',published_at=coalesce(published_at,now()),version_no=version_no+1,updated_at=now() where id=r.id returning * into r;
  update public.drivers set status='assigned',updated_at=now() where id=r.driver_id;
  update public.vehicles set status='assigned',updated_at=now() where id=r.vehicle_id;
  update public.delivery_jobs j set status='assigned',updated_at=now() where j.id in (select s.delivery_job_id from public.delivery_stops s where s.route_id=r.id) and j.status='planned';
  select jsonb_build_object('route_id',r.id,'route_code',r.route_code,'route_date',r.route_date,'status',r.status,'driver_id',r.driver_id,'vehicle_id',r.vehicle_id,'stops',(select jsonb_agg(jsonb_build_object('id',s.id,'delivery_job_id',s.delivery_job_id,'sequence_no',s.sequence_no,'status',s.status,'locked',s.locked) order by s.sequence_no) from public.delivery_stops s where s.route_id=r.id)) into version_snapshot;
  insert into public.delivery_route_versions(route_id,version_no,snapshot,reason,actor_type,actor_id) values(r.id,r.version_no,version_snapshot,coalesce(nullif(trim(p_reason),''),'route_publish'),'admin',p_actor_id);
  insert into public.delivery_events(route_id,event_type,actor_type,actor_id,payload) values(r.id,'ROUTE_PUBLISHED','admin',p_actor_id,jsonb_build_object('stops',stop_count));
  return jsonb_build_object('ok',true,'replay',false,'route_id',r.id,'version_no',r.version_no,'stops',stop_count,'external_side_effect',false,'side_effect_performed',true);
end;
$$;

create or replace function public.prepare_delivery_notification_v1(p_stop_id uuid,p_notification_type text,p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  s public.delivery_stops%rowtype;
  j public.delivery_jobs%rowtype;
  cfg public.logistics_runtime_config%rowtype;
  n public.delivery_notifications%rowtype;
  latest_gps timestamptz;
  key text:=nullif(trim(coalesce(p_idempotency_key,'')),'');
  kind text:=lower(trim(coalesce(p_notification_type,'')));
begin
  if key is null or length(key)>180 then return jsonb_build_object('ok',false,'error','invalid_idempotency_key','side_effect_performed',false); end if;
  if kind not in ('ready_for_route','next_stop','approaching','delivered','exception') then return jsonb_build_object('ok',false,'error','invalid_notification_type','side_effect_performed',false); end if;
  select * into n from public.delivery_notifications where idempotency_key=key;
  if found then return jsonb_build_object('ok',true,'replay',true,'notification_id',n.id,'status',n.status,'side_effect_performed',false); end if;
  select * into cfg from public.logistics_runtime_config where id=1;
  select * into s from public.delivery_stops where id=p_stop_id;
  if not found then return jsonb_build_object('ok',false,'error','stop_not_found','side_effect_performed',false); end if;
  select * into j from public.delivery_jobs where id=s.delivery_job_id;
  if kind='approaching' then
    if s.eta_seconds is null or s.eta_confidence is null or s.eta_computed_at is null then return jsonb_build_object('ok',false,'error','eta_required','side_effect_performed',false); end if;
    if s.eta_seconds > cfg.approaching_eta_threshold_seconds then return jsonb_build_object('ok',false,'error','outside_eta_threshold','side_effect_performed',false); end if;
    if s.eta_confidence < cfg.minimum_eta_confidence then return jsonb_build_object('ok',false,'error','eta_low_confidence','side_effect_performed',false); end if;
    select max(captured_at) into latest_gps from public.driver_locations where route_id=s.route_id;
    if latest_gps is null or latest_gps < now()-make_interval(secs=>cfg.minimum_gps_freshness_seconds) then return jsonb_build_object('ok',false,'error','gps_stale','side_effect_performed',false); end if;
  end if;
  insert into public.delivery_notifications(delivery_job_id,route_id,stop_id,notification_type,channel,status,idempotency_key,payload)
    values(j.id,s.route_id,s.id,kind,'whatsapp','held',key,jsonb_build_object('template_kind',kind,'deterministic',true)) returning * into n;
  return jsonb_build_object('ok',true,'replay',false,'notification_id',n.id,'status','held','send_allowed',cfg.enabled and cfg.notifications_enabled and cfg.execution_mode in ('homologation','canary','live'),'dispatcher_implemented',false,'external_side_effect',false,'side_effect_performed',true);
end;
$$;

create or replace function public.mark_delivery_notification_receipt_v1(p_notification_id uuid,p_status text,p_provider_message_id text default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare n public.delivery_notifications%rowtype; next_status text:=lower(trim(coalesce(p_status,'')));
begin
  if next_status not in ('sent','delivered','failed','review_required') then return jsonb_build_object('ok',false,'error','invalid_notification_receipt_status','side_effect_performed',false); end if;
  select * into n from public.delivery_notifications where id=p_notification_id for update;
  if not found then return jsonb_build_object('ok',false,'error','notification_not_found','side_effect_performed',false); end if;
  if n.status=next_status and (p_provider_message_id is null or n.provider_message_id=p_provider_message_id) then return jsonb_build_object('ok',true,'replay',true,'status',n.status,'side_effect_performed',false); end if;
  update public.delivery_notifications set status=next_status,provider_message_id=coalesce(nullif(trim(coalesce(p_provider_message_id,'')),''),provider_message_id),sent_at=case when next_status in ('sent','delivered') then coalesce(sent_at,now()) else sent_at end,delivered_at=case when next_status='delivered' then coalesce(delivered_at,now()) else delivered_at end,failed_at=case when next_status='failed' then coalesce(failed_at,now()) else failed_at end,updated_at=now() where id=n.id;
  if n.notification_type='next_stop' and next_status in ('sent','delivered') and n.stop_id is not null then
    update public.delivery_stops set status=case when status='planned' then 'locked_next' else status end,locked=true,locked_reason='next_stop_notification_sent',updated_at=now() where id=n.stop_id and status in ('planned','locked_next');
  end if;
  return jsonb_build_object('ok',true,'replay',false,'status',next_status,'next_stop_locked',n.notification_type='next_stop' and next_status in ('sent','delivered'),'side_effect_performed',true);
end;
$$;

create or replace function public.release_delivery_route_resources_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if new.status in ('completed','cancelled') and old.status is distinct from new.status then
    if new.driver_id is not null then update public.drivers set status=case when status in ('assigned','on_route') then 'available' else status end,updated_at=now() where id=new.driver_id; end if;
    if new.vehicle_id is not null then update public.vehicles set status=case when status='assigned' then 'available' else status end,updated_at=now() where id=new.vehicle_id; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.release_delivery_route_resources_v1() from public,anon,authenticated;
grant execute on function public.release_delivery_route_resources_v1() to service_role;
drop trigger if exists delivery_route_release_resources_v1 on public.delivery_routes;
create trigger delivery_route_release_resources_v1 after update of status on public.delivery_routes for each row execute function public.release_delivery_route_resources_v1();

revoke all on function public.create_delivery_route_draft_v1(uuid[],uuid,uuid,date,uuid,text) from public,anon,authenticated;
revoke all on function public.publish_delivery_route_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.prepare_delivery_notification_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function public.mark_delivery_notification_receipt_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.create_delivery_route_draft_v1(uuid[],uuid,uuid,date,uuid,text) to service_role;
grant execute on function public.publish_delivery_route_v1(uuid,uuid,text) to service_role;
grant execute on function public.prepare_delivery_notification_v1(uuid,text,text) to service_role;
grant execute on function public.mark_delivery_notification_receipt_v1(uuid,text,text) to service_role;

commit;
