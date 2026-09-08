begin;

-- Stage 12 — commercial truth foundation. Everything is dormant by default.
-- No Bling, Make, OpenAI, payment, marketing or external API side effect is performed here.

create table if not exists public.commercial_truth_runtime_config (
  id smallint primary key default 1 check (id=1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  lot_tracking_enabled boolean not null default false,
  fefo_enforcement_enabled boolean not null default false,
  expiry_block_enabled boolean not null default false,
  promotions_enabled boolean not null default false,
  benefits_enabled boolean not null default false,
  margin_guard_enabled boolean not null default false,
  reports_enabled boolean not null default false,
  canary_percent smallint not null default 0 check (canary_percent between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid null
);
insert into public.commercial_truth_runtime_config(id) values(1) on conflict(id) do nothing;
alter table public.commercial_truth_runtime_config enable row level security;
revoke all on table public.commercial_truth_runtime_config from public,anon,authenticated;
grant select,insert,update,delete on table public.commercial_truth_runtime_config to service_role;

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  lot_code text not null,
  supplier_lot_code text null,
  received_at timestamptz null,
  manufactured_at date null,
  expires_at date null,
  quantity_received numeric(14,3) not null default 0 check(quantity_received>=0),
  quantity_available numeric(14,3) not null default 0 check(quantity_available>=0),
  quantity_reserved numeric(14,3) not null default 0 check(quantity_reserved>=0),
  unit_cost numeric(14,4) null check(unit_cost is null or unit_cost>=0),
  status text not null default 'draft' check(status in ('draft','available','quarantined','depleted','expired','blocked')),
  physically_verified boolean not null default false,
  notes text null,
  source_system text not null default 'internal',
  source_ref text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id,lot_code),
  check(quantity_reserved <= quantity_available)
);
create index if not exists inventory_lots_fefo_idx on public.inventory_lots(product_id,expires_at nulls last,received_at,id) where status='available' and physically_verified=true and quantity_available>quantity_reserved;
create index if not exists inventory_lots_expiry_idx on public.inventory_lots(expires_at,product_id) where status in ('available','quarantined');
alter table public.inventory_lots enable row level security;
revoke all on table public.inventory_lots from public,anon,authenticated;
grant select,insert,update,delete on table public.inventory_lots to service_role;

create table if not exists public.inventory_lot_movements (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check(movement_type in ('receive','reserve','release','consume','adjust','quarantine','unquarantine','expire','writeoff')),
  quantity numeric(14,3) not null check(quantity>0),
  reference_type text null,
  reference_id text null,
  idempotency_key text not null unique,
  actor_type text not null default 'system',
  actor_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists inventory_lot_movements_lot_idx on public.inventory_lot_movements(lot_id,created_at desc);
create index if not exists inventory_lot_movements_product_idx on public.inventory_lot_movements(product_id,created_at desc);
alter table public.inventory_lot_movements enable row level security;
revoke all on table public.inventory_lot_movements from public,anon,authenticated;
grant select,insert on table public.inventory_lot_movements to service_role;

create table if not exists public.commercial_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  version integer not null check(version>0),
  status text not null default 'draft' check(status in ('draft','approved','active','retired')),
  policy jsonb not null default '{}'::jsonb,
  effective_from timestamptz null,
  effective_to timestamptz null,
  created_by uuid null,
  approved_by uuid null,
  created_at timestamptz not null default now(),
  unique(policy_key,version)
);
create unique index if not exists commercial_policy_one_active_idx on public.commercial_policy_versions(policy_key) where status='active';
alter table public.commercial_policy_versions enable row level security;
revoke all on table public.commercial_policy_versions from public,anon,authenticated;
grant select,insert,update,delete on table public.commercial_policy_versions to service_role;

create table if not exists public.promotion_rules (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  rule_type text not null check(rule_type in ('expiry_discount','coupon','gift','birthday','benefit','bundle')),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check(execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  priority integer not null default 100,
  conditions jsonb not null default '{}'::jsonb,
  benefit jsonb not null default '{}'::jsonb,
  budget_cents bigint null check(budget_cents is null or budget_cents>=0),
  spent_cents bigint not null default 0 check(spent_cents>=0),
  starts_at timestamptz null,
  ends_at timestamptz null,
  policy_version_id uuid null references public.commercial_policy_versions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists promotion_rules_active_window_idx on public.promotion_rules(enabled,starts_at,ends_at,priority);
alter table public.promotion_rules enable row level security;
revoke all on table public.promotion_rules from public,anon,authenticated;
grant select,insert,update,delete on table public.promotion_rules to service_role;

create table if not exists public.margin_guard_events (
  id uuid primary key default gen_random_uuid(),
  context_type text not null,
  context_id text null,
  product_id uuid null references public.products(id) on delete set null,
  gross_revenue numeric(14,2) not null default 0,
  estimated_cost numeric(14,2) not null default 0,
  proposed_discount numeric(14,2) not null default 0,
  resulting_margin_amount numeric(14,2) not null default 0,
  resulting_margin_percent numeric(8,4) null,
  minimum_margin_percent numeric(8,4) null,
  decision text not null check(decision in ('allow','block','review_required','observe_only')),
  reason text null,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists margin_guard_events_context_idx on public.margin_guard_events(context_type,created_at desc);
alter table public.margin_guard_events enable row level security;
revoke all on table public.margin_guard_events from public,anon,authenticated;
grant select,insert on table public.margin_guard_events to service_role;

create or replace function public.preview_fefo_allocation_v1(
  p_product_id uuid,
  p_quantity numeric,
  p_delivery_date date default (now() at time zone 'America/Cuiaba')::date,
  p_min_shelf_life_days integer default 0
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_truth_runtime_config%rowtype;
  needed numeric:=coalesce(p_quantity,0);
  allocated numeric:=0;
  rec record;
  lines jsonb:='[]'::jsonb;
  take_qty numeric;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if needed<=0 then return jsonb_build_object('ok',false,'error','invalid_quantity','external_side_effect',false); end if;
  if p_min_shelf_life_days<0 then return jsonb_build_object('ok',false,'error','invalid_min_shelf_life_days','external_side_effect',false); end if;

  for rec in
    select l.id,l.lot_code,l.expires_at,(l.quantity_available-l.quantity_reserved) free_qty,l.unit_cost
    from public.inventory_lots l
    where l.product_id=p_product_id
      and l.status='available'
      and l.physically_verified=true
      and (l.quantity_available-l.quantity_reserved)>0
      and (l.expires_at is null or l.expires_at >= p_delivery_date + p_min_shelf_life_days)
    order by l.expires_at nulls last,l.received_at nulls last,l.id
  loop
    exit when allocated>=needed;
    take_qty:=least(rec.free_qty,needed-allocated);
    allocated:=allocated+take_qty;
    lines:=lines||jsonb_build_array(jsonb_build_object('lot_id',rec.id,'lot_code',rec.lot_code,'expires_at',rec.expires_at,'quantity',take_qty,'unit_cost',rec.unit_cost));
  end loop;

  return jsonb_build_object(
    'ok',true,
    'product_id',p_product_id,
    'requested_quantity',needed,
    'allocated_quantity',allocated,
    'sufficient',allocated>=needed,
    'shortage',greatest(needed-allocated,0),
    'delivery_date',p_delivery_date,
    'min_shelf_life_days',p_min_shelf_life_days,
    'fefo_ordered',true,
    'enforcement_enabled',cfg.fefo_enforcement_enabled,
    'lines',lines,
    'external_side_effect',false
  );
end;
$$;

create or replace function public.evaluate_margin_guard_v1(
  p_gross_revenue numeric,
  p_estimated_cost numeric,
  p_proposed_discount numeric default 0,
  p_minimum_margin_percent numeric default 0
) returns jsonb
language plpgsql immutable security invoker set search_path=''
as $$
declare
  gross numeric:=coalesce(p_gross_revenue,0);
  costv numeric:=coalesce(p_estimated_cost,0);
  disc numeric:=coalesce(p_proposed_discount,0);
  net numeric;
  margin_amount numeric;
  margin_pct numeric;
  decision text;
  reason text;
begin
  if gross<0 or costv<0 or disc<0 or disc>gross then return jsonb_build_object('ok',false,'error','invalid_margin_input','external_side_effect',false); end if;
  if p_minimum_margin_percent<0 or p_minimum_margin_percent>100 then return jsonb_build_object('ok',false,'error','invalid_minimum_margin_percent','external_side_effect',false); end if;
  net:=gross-disc;
  margin_amount:=net-costv;
  margin_pct:=case when net=0 then null else round((margin_amount/net)*100,4) end;
  if net=0 then decision:='block'; reason:='zero_net_revenue';
  elsif margin_amount<0 then decision:='block'; reason:='negative_margin';
  elsif margin_pct<p_minimum_margin_percent then decision:='block'; reason:='below_minimum_margin';
  else decision:='allow'; reason:=null; end if;
  return jsonb_build_object('ok',true,'net_revenue',net,'margin_amount',margin_amount,'margin_percent',margin_pct,'minimum_margin_percent',p_minimum_margin_percent,'decision',decision,'reason',reason,'external_side_effect',false);
end;
$$;

create or replace function public.preview_expiry_offer_v2(
  p_product_id uuid,
  p_lot_id uuid,
  p_today date default (now() at time zone 'America/Cuiaba')::date
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  p public.products%rowtype;
  l public.inventory_lots%rowtype;
  pol public.commercial_policy_versions%rowtype;
  days_remaining integer;
  discount_pct numeric:=0;
  min_margin_pct numeric:=0;
  proposed_discount numeric:=0;
  guard jsonb;
  band jsonb;
begin
  select * into p from public.products where id=p_product_id;
  if not found then return jsonb_build_object('ok',false,'error','product_not_found','external_side_effect',false); end if;
  select * into l from public.inventory_lots where id=p_lot_id and product_id=p_product_id;
  if not found then return jsonb_build_object('ok',false,'error','lot_not_found','external_side_effect',false); end if;
  if l.expires_at is null then return jsonb_build_object('ok',true,'eligible',false,'reason','lot_without_expiry','external_side_effect',false); end if;
  days_remaining:=l.expires_at-p_today;
  if days_remaining<0 or l.status in ('expired','blocked','quarantined') then return jsonb_build_object('ok',true,'eligible',false,'reason','lot_not_sellable','days_remaining',days_remaining,'external_side_effect',false); end if;

  select * into pol from public.commercial_policy_versions where policy_key='expiry_discount' and status='active' and (effective_from is null or effective_from<=now()) and (effective_to is null or effective_to>now()) limit 1;
  if not found then return jsonb_build_object('ok',true,'eligible',false,'reason','no_active_expiry_policy','days_remaining',days_remaining,'external_side_effect',false); end if;
  min_margin_pct:=coalesce((pol.policy->>'minimum_margin_percent')::numeric,0);
  for band in select value from jsonb_array_elements(coalesce(pol.policy->'bands','[]'::jsonb)) loop
    if days_remaining<=coalesce((band->>'max_days')::integer,-1) and days_remaining>=coalesce((band->>'min_days')::integer,0) then
      discount_pct:=greatest(discount_pct,coalesce((band->>'discount_percent')::numeric,0));
    end if;
  end loop;
  proposed_discount:=round(coalesce(p.price,0)*(discount_pct/100),2);
  guard:=public.evaluate_margin_guard_v1(coalesce(p.price,0),coalesce(p.cost,0),proposed_discount,min_margin_pct);
  return jsonb_build_object('ok',true,'eligible',(discount_pct>0 and guard->>'decision'='allow'),'days_remaining',days_remaining,'discount_percent',discount_pct,'proposed_discount',proposed_discount,'suggested_price',round(coalesce(p.price,0)-proposed_discount,2),'margin_guard',guard,'policy_version',pol.version,'applied',false,'external_side_effect',false);
end;
$$;

create or replace function public.stage12_readiness_v1() returns jsonb
language sql security definer set search_path=public,pg_temp
as $$
 select jsonb_build_object(
   'enabled',c.enabled,
   'execution_mode',c.execution_mode,
   'lot_tracking_enabled',c.lot_tracking_enabled,
   'fefo_enforcement_enabled',c.fefo_enforcement_enabled,
   'expiry_block_enabled',c.expiry_block_enabled,
   'promotions_enabled',c.promotions_enabled,
   'benefits_enabled',c.benefits_enabled,
   'margin_guard_enabled',c.margin_guard_enabled,
   'reports_enabled',c.reports_enabled,
   'canary_percent',c.canary_percent,
   'lots',(select count(*) from public.inventory_lots),
   'available_lots',(select count(*) from public.inventory_lots where status='available'),
   'active_policies',(select count(*) from public.commercial_policy_versions where status='active'),
   'enabled_promotions',(select count(*) from public.promotion_rules where enabled),
   'external_side_effect',false
 ) from public.commercial_truth_runtime_config c where c.id=1
$$;

revoke all on function public.preview_fefo_allocation_v1(uuid,numeric,date,integer) from public,anon,authenticated;
revoke all on function public.evaluate_margin_guard_v1(numeric,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.preview_expiry_offer_v2(uuid,uuid,date) from public,anon,authenticated;
revoke all on function public.stage12_readiness_v1() from public,anon,authenticated;
grant execute on function public.preview_fefo_allocation_v1(uuid,numeric,date,integer) to service_role;
grant execute on function public.evaluate_margin_guard_v1(numeric,numeric,numeric,numeric) to service_role;
grant execute on function public.preview_expiry_offer_v2(uuid,uuid,date) to service_role;
grant execute on function public.stage12_readiness_v1() to service_role;

commit;
