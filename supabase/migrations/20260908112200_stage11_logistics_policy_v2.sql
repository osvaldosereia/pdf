begin;

alter table public.logistics_runtime_config
  add column if not exists proof_of_delivery_mode text not null default 'driver_confirmation'
    check (proof_of_delivery_mode in ('driver_confirmation','photo_optional','photo_required','signature_optional','signature_required'));

create or replace function public.logistics_readiness_v1()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'enabled',c.enabled,
    'execution_mode',c.execution_mode,
    'job_creation_enabled',c.job_creation_enabled,
    'routing_enabled',c.routing_enabled,
    'driver_app_enabled',c.driver_app_enabled,
    'gps_tracking_enabled',c.gps_tracking_enabled,
    'notifications_enabled',c.notifications_enabled,
    'external_provider_enabled',c.external_provider_enabled,
    'provider_name',c.provider_name,
    'canary_percent',c.canary_percent,
    'approaching_eta_threshold_seconds',c.approaching_eta_threshold_seconds,
    'minimum_gps_freshness_seconds',c.minimum_gps_freshness_seconds,
    'minimum_eta_confidence',c.minimum_eta_confidence,
    'notification_cooldown_seconds',c.notification_cooldown_seconds,
    'routing_batch_window_minutes',c.routing_batch_window_minutes,
    'max_provider_calls_per_route',c.max_provider_calls_per_route,
    'max_provider_cost_brl_per_route',c.max_provider_cost_brl_per_route,
    'location_retention_days',c.location_retention_days,
    'proof_of_delivery_mode',c.proof_of_delivery_mode,
    'runtime_released',c.enabled and c.execution_mode in ('homologation','canary','live'),
    'external_provider_released',c.enabled and c.external_provider_enabled and c.provider_name <> 'none',
    'jobs',(select count(*) from public.delivery_jobs),
    'routes',(select count(*) from public.delivery_routes),
    'active_routes',(select count(*) from public.delivery_routes where status='active'),
    'drivers',(select count(*) from public.drivers),
    'vehicles',(select count(*) from public.vehicles),
    'provider_calls_performed',(select count(*) from public.routing_provider_calls where external_call_performed),
    'notifications_sent',(select count(*) from public.delivery_notifications where status in ('sent','delivered')),
    'driver_locations',(select count(*) from public.driver_locations)
  ) from public.logistics_runtime_config c where c.id=1;
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
  end if;
  insert into public.delivery_notifications(delivery_job_id,route_id,stop_id,notification_type,channel,status,idempotency_key,payload)
    values(j.id,s.route_id,s.id,kind,'whatsapp','held',key,jsonb_build_object('template_kind',kind,'deterministic',true)) returning * into n;
  if kind='next_stop' then
    update public.delivery_stops set status=case when status='planned' then 'locked_next' else status end,locked=true,locked_reason='next_stop_notification_prepared',updated_at=now() where id=s.id;
  end if;
  return jsonb_build_object('ok',true,'replay',false,'notification_id',n.id,'status','held','send_allowed',cfg.enabled and cfg.notifications_enabled and cfg.execution_mode in ('homologation','canary','live'),'dispatcher_implemented',false,'external_side_effect',false,'side_effect_performed',true);
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
  has_photo boolean:=coalesce(nullif(trim(coalesce(p_proof->>'photo_ref','')),'') is not null,false);
  has_signature boolean:=coalesce(nullif(trim(coalesce(p_proof->>'signature_ref','')),'') is not null,false);
begin
  select * into cfg from public.logistics_runtime_config where id=1;
  if not cfg.enabled or not cfg.driver_app_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','driver_runtime_disabled','side_effect_performed',false); end if;
  if cfg.proof_of_delivery_mode='photo_required' and not has_photo then return jsonb_build_object('ok',false,'error','delivery_photo_required','side_effect_performed',false); end if;
  if cfg.proof_of_delivery_mode='signature_required' and not has_signature then return jsonb_build_object('ok',false,'error','delivery_signature_required','side_effect_performed',false); end if;
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
    values(j.id,s.route_id,s.id,'STOP_DELIVERED','driver',d.id,p_client_event_id,jsonb_build_object('proof_mode',cfg.proof_of_delivery_mode,'proof',coalesce(p_proof,'{}'::jsonb))) returning id into existing;
  select count(*) into remaining from public.delivery_stops where route_id=r.id and status not in ('delivered','skipped','rescheduled');
  if remaining=0 then
    update public.delivery_routes set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=r.id;
    update public.drivers set status='available',updated_at=now() where id=d.id;
    insert into public.delivery_events(route_id,event_type,actor_type,actor_id,payload) values(r.id,'ROUTE_FINISHED','driver',d.id,'{}'::jsonb);
  end if;
  return jsonb_build_object('ok',true,'replay',false,'stop_id',s.id,'delivery_job_id',j.id,'order_id',j.order_id,'route_completed',remaining=0,'proof_mode',cfg.proof_of_delivery_mode,'event_id',existing,'side_effect_performed',true);
end;
$$;

create or replace function public.purge_driver_locations_v1(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare days integer; removed bigint;
begin
  select location_retention_days into days from public.logistics_runtime_config where id=1;
  delete from public.driver_locations where captured_at < p_now - make_interval(days=>coalesce(days,30));
  get diagnostics removed=row_count;
  return jsonb_build_object('ok',true,'removed',removed,'retention_days',coalesce(days,30),'external_side_effect',false);
end;
$$;

create or replace function public.logistics_metrics_v1(p_since timestamptz default now()-interval '30 days')
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'ready_jobs',(select count(*) from public.delivery_jobs where ready_at>=p_since),
    'delivered_jobs',(select count(*) from public.delivery_jobs where delivered_at>=p_since),
    'failed_jobs',(select count(*) from public.delivery_jobs where failed_at>=p_since),
    'routes_completed',(select count(*) from public.delivery_routes where completed_at>=p_since),
    'incidents',(select count(*) from public.delivery_incidents where created_at>=p_since),
    'manual_or_driver_events',(select count(*) from public.delivery_events where created_at>=p_since and actor_type in ('admin','driver')),
    'provider_calls',(select count(*) from public.routing_provider_calls where created_at>=p_since and external_call_performed),
    'provider_cost_brl',(select coalesce(sum(coalesce(actual_cost_brl,estimated_cost_brl)),0) from public.routing_provider_calls where created_at>=p_since and external_call_performed),
    'notifications_sent',(select count(*) from public.delivery_notifications where created_at>=p_since and status in ('sent','delivered')),
    'duplicate_notifications_prevented',0
  );
$$;

revoke all on function public.logistics_readiness_v1() from public,anon,authenticated;
revoke all on function public.prepare_delivery_notification_v1(uuid,text,text) from public,anon,authenticated;
revoke all on function public.driver_deliver_stop_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.purge_driver_locations_v1(timestamptz) from public,anon,authenticated;
revoke all on function public.logistics_metrics_v1(timestamptz) from public,anon,authenticated;
grant execute on function public.logistics_readiness_v1() to service_role;
grant execute on function public.prepare_delivery_notification_v1(uuid,text,text) to service_role;
grant execute on function public.driver_deliver_stop_v1(uuid,uuid,text,jsonb) to service_role;
grant execute on function public.purge_driver_locations_v1(timestamptz) to service_role;
grant execute on function public.logistics_metrics_v1(timestamptz) to service_role;

commit;
