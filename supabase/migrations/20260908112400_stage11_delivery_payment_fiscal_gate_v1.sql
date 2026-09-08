begin;

-- Stage 11 extension: delivery/payment confirmation gates NF-e preparation.
-- No Bling/SEFAZ transport is implemented or activated here.

create table if not exists public.fiscal_runtime_config (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  bling_invoice_prepare_enabled boolean not null default false,
  bling_invoice_send_enabled boolean not null default false,
  require_delivery_confirmation boolean not null default true,
  require_payment_confirmation boolean not null default true,
  canary_percent smallint not null default 0 check (canary_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

insert into public.fiscal_runtime_config(id)
values (1)
on conflict (id) do nothing;

alter table public.fiscal_runtime_config enable row level security;

create table if not exists public.order_fiscal_controls (
  order_id uuid primary key references public.orders(id) on delete cascade,
  delivery_status text not null default 'pending' check (delivery_status in ('pending','delivered','failed','cancelled','returned')),
  delivery_confirmed_at timestamptz null,
  delivery_event_id uuid null references public.delivery_events(id) on delete set null,
  payment_status text not null default 'pending' check (payment_status in ('pending','confirmed','review_required','cancelled')),
  payment_method text null,
  payment_source text null,
  settled_amount numeric(14,2) null check (settled_amount is null or settled_amount >= 0),
  payment_confirmed_at timestamptz null,
  fiscal_status text not null default 'blocked' check (fiscal_status in ('blocked','ready','queued','issued','review_required','cancelled')),
  fiscal_block_reason text null,
  fiscal_ready_at timestamptz null,
  fiscal_version integer not null default 1 check (fiscal_version > 0),
  bling_invoice_id bigint null,
  bling_invoice_number text null,
  sefaz_status text null,
  issued_at timestamptz null,
  updated_at timestamptz not null default now()
);

alter table public.order_fiscal_controls enable row level security;

create table if not exists public.fiscal_issue_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  fiscal_version integer not null,
  idempotency_key text not null unique,
  status text not null default 'held' check (status in ('held','ready','processing','issued','review_required','error','cancelled')),
  external_side_effect boolean not null default false,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 1 check (max_attempts = 1),
  bling_invoice_id bigint null,
  provider_request_id text null,
  error_code text null,
  error_detail text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz null,
  unique(order_id, fiscal_version)
);

alter table public.fiscal_issue_jobs enable row level security;

create or replace function public.refresh_order_fiscal_readiness_v1(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.orders%rowtype;
  c public.order_fiscal_controls%rowtype;
  next_status text := 'blocked';
  reason text := null;
  ready_at timestamptz := null;
begin
  select * into o from public.orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found','side_effect_performed',false); end if;

  insert into public.order_fiscal_controls(order_id,delivery_status,delivery_confirmed_at)
  values(o.id,case when o.status='delivered' then 'delivered' when o.status='cancelled' then 'cancelled' when o.status='returned' then 'returned' else 'pending' end,o.delivered_at)
  on conflict(order_id) do nothing;

  select * into c from public.order_fiscal_controls where order_id=o.id for update;

  if o.status='cancelled' or c.delivery_status='cancelled' then
    next_status := 'cancelled'; reason := 'order_cancelled';
  elsif o.status='returned' or c.delivery_status='returned' then
    next_status := 'blocked'; reason := 'order_returned';
  elsif o.status<>'delivered' or c.delivery_status<>'delivered' or c.delivery_confirmed_at is null then
    next_status := 'blocked'; reason := 'delivery_not_confirmed';
  elsif c.payment_status<>'confirmed' or c.payment_confirmed_at is null then
    next_status := case when c.payment_status='review_required' then 'review_required' else 'blocked' end;
    reason := case when c.payment_status='review_required' then 'payment_review_required' else 'payment_not_confirmed' end;
  elsif c.settled_amount is null then
    next_status := 'review_required'; reason := 'settled_amount_missing';
  elsif abs(c.settled_amount - o.total) > 0.01 then
    next_status := 'review_required'; reason := 'settled_amount_mismatch';
  else
    next_status := 'ready'; reason := null; ready_at := coalesce(c.fiscal_ready_at,now());
  end if;

  update public.order_fiscal_controls
     set fiscal_status=next_status,
         fiscal_block_reason=reason,
         fiscal_ready_at=case when next_status='ready' then ready_at else null end,
         updated_at=now()
   where order_id=o.id;

  return jsonb_build_object('ok',true,'order_id',o.id,'fiscal_status',next_status,'block_reason',reason,'fiscal_ready_at',case when next_status='ready' then ready_at else null end,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.confirm_order_payment_v1(
  p_order_id uuid,
  p_payment_method text,
  p_payment_source text,
  p_settled_amount numeric,
  p_confirmed_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.orders%rowtype;
  method text := lower(trim(coalesce(p_payment_method,'')));
  source text := lower(trim(coalesce(p_payment_source,'')));
begin
  select * into o from public.orders where id=p_order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','order_not_found','side_effect_performed',false); end if;
  if method not in ('cash','pix','card','payment_link','prepaid_pix','prepaid_link','other') then
    return jsonb_build_object('ok',false,'error','invalid_payment_method','side_effect_performed',false);
  end if;
  if p_settled_amount is null or p_settled_amount < 0 then
    return jsonb_build_object('ok',false,'error','invalid_settled_amount','side_effect_performed',false);
  end if;

  insert into public.order_fiscal_controls(order_id,payment_status,payment_method,payment_source,settled_amount,payment_confirmed_at)
  values(o.id,'confirmed',method,nullif(source,''),p_settled_amount,coalesce(p_confirmed_at,now()))
  on conflict(order_id) do update
    set payment_status='confirmed',payment_method=excluded.payment_method,payment_source=excluded.payment_source,
        settled_amount=excluded.settled_amount,payment_confirmed_at=excluded.payment_confirmed_at,updated_at=now();

  return public.refresh_order_fiscal_readiness_v1(o.id);
end;
$$;

create or replace function public.preview_bling_invoice_eligibility_v1(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  o public.orders%rowtype;
  c public.order_fiscal_controls%rowtype;
begin
  select * into o from public.orders where id=p_order_id;
  if not found then return jsonb_build_object('ok',false,'eligible',false,'error','order_not_found','external_side_effect',false); end if;
  select * into c from public.order_fiscal_controls where order_id=o.id;
  if not found then return jsonb_build_object('ok',true,'eligible',false,'reason','fiscal_control_missing','order_status',o.status,'external_side_effect',false); end if;
  return jsonb_build_object(
    'ok',true,
    'eligible',(o.status='delivered' and c.delivery_status='delivered' and c.payment_status='confirmed' and c.fiscal_status='ready'),
    'reason',c.fiscal_block_reason,
    'order_status',o.status,
    'delivery_status',c.delivery_status,
    'payment_status',c.payment_status,
    'fiscal_status',c.fiscal_status,
    'fiscal_version',c.fiscal_version,
    'external_side_effect',false
  );
end;
$$;

create or replace function public.prepare_bling_invoice_issue_job_v1(p_order_id uuid,p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.fiscal_runtime_config%rowtype;
  c public.order_fiscal_controls%rowtype;
  existing public.fiscal_issue_jobs%rowtype;
  new_id uuid;
begin
  select * into cfg from public.fiscal_runtime_config where id=1;
  if not cfg.enabled or not cfg.bling_invoice_prepare_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','fiscal_runtime_disabled','side_effect_performed',false,'external_side_effect',false);
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 12 then
    return jsonb_build_object('ok',false,'error','invalid_idempotency_key','side_effect_performed',false,'external_side_effect',false);
  end if;
  select * into c from public.order_fiscal_controls where order_id=p_order_id for update;
  if not found or c.fiscal_status<>'ready' then
    return jsonb_build_object('ok',false,'error','order_not_fiscal_ready','side_effect_performed',false,'external_side_effect',false);
  end if;
  select * into existing from public.fiscal_issue_jobs where order_id=p_order_id and fiscal_version=c.fiscal_version;
  if found then
    return jsonb_build_object('ok',true,'replay',true,'job_id',existing.id,'status',existing.status,'side_effect_performed',false,'external_side_effect',false);
  end if;
  insert into public.fiscal_issue_jobs(order_id,fiscal_version,idempotency_key,status)
  values(p_order_id,c.fiscal_version,trim(p_idempotency_key),'held') returning id into new_id;
  update public.order_fiscal_controls set fiscal_status='queued',updated_at=now() where order_id=p_order_id;
  return jsonb_build_object('ok',true,'replay',false,'job_id',new_id,'status','held','dispatcher_implemented',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

-- Extend driver confirmation without creating a fiscal transport.
create or replace function public.driver_deliver_stop_v2(
  p_auth_user_id uuid,
  p_stop_id uuid,
  p_client_event_id text,
  p_proof jsonb default '{}'::jsonb,
  p_payment_status text default 'pending',
  p_payment_method text default null,
  p_settled_amount numeric default null,
  p_payment_source text default 'driver_app'
)
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
  fiscal_result jsonb;
  pay_status text := lower(trim(coalesce(p_payment_status,'pending')));
begin
  select * into cfg from public.logistics_runtime_config where id=1;
  if not cfg.enabled or not cfg.driver_app_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','driver_runtime_disabled','side_effect_performed',false); end if;
  if pay_status not in ('pending','confirmed') then return jsonb_build_object('ok',false,'error','invalid_payment_status','side_effect_performed',false); end if;
  if pay_status='confirmed' and (p_payment_method is null or p_settled_amount is null) then return jsonb_build_object('ok',false,'error','confirmed_payment_requires_method_and_amount','side_effect_performed',false); end if;
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
    values(j.id,s.route_id,s.id,'STOP_DELIVERED','driver',d.id,p_client_event_id,jsonb_build_object('proof',coalesce(p_proof,'{}'::jsonb),'payment_status',pay_status)) returning id into existing;

  insert into public.order_fiscal_controls(order_id,delivery_status,delivery_confirmed_at,delivery_event_id)
  values(j.order_id,'delivered',now(),existing)
  on conflict(order_id) do update set delivery_status='delivered',delivery_confirmed_at=coalesce(public.order_fiscal_controls.delivery_confirmed_at,excluded.delivery_confirmed_at),delivery_event_id=excluded.delivery_event_id,updated_at=now();

  if pay_status='confirmed' then
    fiscal_result := public.confirm_order_payment_v1(j.order_id,p_payment_method,p_payment_source,p_settled_amount,now());
  else
    fiscal_result := public.refresh_order_fiscal_readiness_v1(j.order_id);
  end if;

  select count(*) into remaining from public.delivery_stops where route_id=r.id and status not in ('delivered','skipped','rescheduled');
  if remaining=0 then
    update public.delivery_routes set status='completed',completed_at=coalesce(completed_at,now()),updated_at=now() where id=r.id;
    update public.drivers set status='available',updated_at=now() where id=d.id;
    insert into public.delivery_events(route_id,event_type,actor_type,actor_id,payload) values(r.id,'ROUTE_FINISHED','driver',d.id,'{}'::jsonb);
  end if;

  return jsonb_build_object('ok',true,'replay',false,'stop_id',s.id,'delivery_job_id',j.id,'order_id',j.order_id,'route_completed',remaining=0,'event_id',existing,'fiscal',fiscal_result,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

revoke all on table public.fiscal_runtime_config from public,anon,authenticated;
revoke all on table public.order_fiscal_controls from public,anon,authenticated;
revoke all on table public.fiscal_issue_jobs from public,anon,authenticated;
grant all on table public.fiscal_runtime_config to service_role;
grant all on table public.order_fiscal_controls to service_role;
grant all on table public.fiscal_issue_jobs to service_role;

revoke all on function public.refresh_order_fiscal_readiness_v1(uuid) from public,anon,authenticated;
revoke all on function public.confirm_order_payment_v1(uuid,text,text,numeric,timestamptz) from public,anon,authenticated;
revoke all on function public.preview_bling_invoice_eligibility_v1(uuid) from public,anon,authenticated;
revoke all on function public.prepare_bling_invoice_issue_job_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.driver_deliver_stop_v2(uuid,uuid,text,jsonb,text,text,numeric,text) from public,anon,authenticated;

grant execute on function public.refresh_order_fiscal_readiness_v1(uuid) to service_role;
grant execute on function public.confirm_order_payment_v1(uuid,text,text,numeric,timestamptz) to service_role;
grant execute on function public.preview_bling_invoice_eligibility_v1(uuid) to service_role;
grant execute on function public.prepare_bling_invoice_issue_job_v1(uuid,text) to service_role;
grant execute on function public.driver_deliver_stop_v2(uuid,uuid,text,jsonb,text,text,numeric,text) to service_role;

commit;
