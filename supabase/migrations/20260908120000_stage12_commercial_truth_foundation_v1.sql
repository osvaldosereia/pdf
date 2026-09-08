begin;

create table if not exists public.commercial_runtime_config (
  id smallint primary key default 1 check (id=1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  lot_truth_enabled boolean not null default false,
  lot_reservations_enabled boolean not null default false,
  fefo_enabled boolean not null default false,
  expiry_discount_enabled boolean not null default false,
  promotion_engine_enabled boolean not null default false,
  benefit_engine_enabled boolean not null default false,
  margin_guard_enforced boolean not null default false,
  recommendation_guard_enabled boolean not null default false,
  legacy_offer_engine_allowed boolean not null default false,
  canary_percent smallint not null default 0 check (canary_percent between 0 and 100),
  default_min_margin_percent numeric(7,4) not null default 0 check (default_min_margin_percent between 0 and 100),
  default_min_margin_brl numeric(12,2) not null default 0 check (default_min_margin_brl >= 0),
  default_max_discount_percent numeric(7,4) not null default 0 check (default_max_discount_percent between 0 and 100),
  promotion_budget_brl numeric(14,2) not null default 0 check (promotion_budget_brl >= 0),
  promotion_budget_spent_brl numeric(14,2) not null default 0 check (promotion_budget_spent_brl >= 0),
  minimum_delivery_shelf_life_days integer not null default 1 check (minimum_delivery_shelf_life_days between 0 and 3650),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.commercial_runtime_config(id) values(1) on conflict(id) do nothing;

create table if not exists public.inventory_lots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  lot_code text not null,
  status text not null default 'draft' check (status in ('draft','available','quarantine','expired','depleted','blocked')),
  quantity_on_hand numeric(14,3) not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved numeric(14,3) not null default 0 check (quantity_reserved >= 0 and quantity_reserved <= quantity_on_hand),
  unit_cost numeric(14,4) check (unit_cost is null or unit_cost >= 0),
  manufactured_at date,
  expires_at date,
  received_at timestamptz,
  warehouse_location text,
  source_system text not null default 'manual_draft',
  source_ref text,
  physically_verified boolean not null default false,
  physically_verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id,lot_code),
  check (expires_at is null or manufactured_at is null or expires_at >= manufactured_at)
);

create table if not exists public.inventory_lot_movements (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in ('receive','reserve','release','consume','adjustment_in','adjustment_out','writeoff','return')),
  quantity numeric(14,3) not null check (quantity > 0),
  idempotency_key text not null unique,
  reference_type text,
  reference_id uuid,
  before_quantity numeric(14,3),
  after_quantity numeric(14,3),
  actor_type text not null default 'system' check (actor_type in ('system','admin','driver','order','inventory')),
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_lot_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  lot_id uuid not null references public.inventory_lots(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  status text not null default 'reserved' check (status in ('reserved','consumed','released','expired','cancelled')),
  reservation_key text not null,
  idempotency_key text not null unique,
  delivery_date date,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists inventory_lot_reservations_order_idx on public.inventory_lot_reservations(order_id,status);
create index if not exists inventory_lots_fefo_idx on public.inventory_lots(product_id,status,expires_at,id);

create table if not exists public.commercial_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft','approved','active','retired','cancelled')),
  policy jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid,
  approved_by uuid,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  activated_at timestamptz,
  retired_at timestamptz,
  unique(policy_key,version)
);

create table if not exists public.commercial_margin_policies (
  id uuid primary key default gen_random_uuid(),
  version integer not null default 1 check (version > 0),
  scope text not null default 'global' check (scope in ('global','category','product')),
  product_id uuid references public.products(id) on delete cascade,
  category text,
  priority integer not null default 0,
  min_margin_percent numeric(7,4) not null default 0 check (min_margin_percent between 0 and 100),
  min_margin_brl numeric(12,2) not null default 0 check (min_margin_brl >= 0),
  max_discount_percent numeric(7,4) not null default 0 check (max_discount_percent between 0 and 100),
  status text not null default 'draft' check (status in ('draft','active','retired','cancelled')),
  effective_from timestamptz,
  effective_until timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope='global' and product_id is null and category is null) or (scope='category' and product_id is null and category is not null) or (scope='product' and product_id is not null)),
  check (effective_until is null or effective_from is null or effective_until >= effective_from)
);
create index if not exists commercial_margin_policies_lookup_idx on public.commercial_margin_policies(status,scope,product_id,category,priority desc);

create table if not exists public.expiry_discount_rules (
  id uuid primary key default gen_random_uuid(),
  version integer not null default 1 check (version > 0),
  min_days_remaining integer not null check (min_days_remaining >= 0),
  max_days_remaining integer not null check (max_days_remaining >= min_days_remaining),
  discount_percent numeric(7,4) not null check (discount_percent > 0 and discount_percent <= 90),
  status text not null default 'draft' check (status in ('draft','active','retired','cancelled')),
  source text not null default 'manual',
  created_by uuid,
  created_at timestamptz not null default now(),
  unique(version,min_days_remaining,max_days_remaining)
);

insert into public.expiry_discount_rules(version,min_days_remaining,max_days_remaining,discount_percent,status,source)
values
 (1,3,7,50,'draft','legacy_firebase_reference'),
 (1,8,15,40,'draft','legacy_firebase_reference'),
 (1,16,31,35,'draft','legacy_firebase_reference'),
 (1,32,46,30,'draft','legacy_firebase_reference'),
 (1,47,65,25,'draft','legacy_firebase_reference'),
 (1,66,76,20,'draft','legacy_firebase_reference'),
 (1,77,91,10,'draft','legacy_firebase_reference'),
 (1,92,105,5,'draft','legacy_firebase_reference')
on conflict(version,min_days_remaining,max_days_remaining) do nothing;

create table if not exists public.commercial_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  actor_type text not null default 'system' check (actor_type in ('system','admin','customer','order','workflow')),
  actor_id uuid,
  entity_type text,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.commercial_runtime_config enable row level security;
alter table public.inventory_lots enable row level security;
alter table public.inventory_lot_movements enable row level security;
alter table public.inventory_lot_reservations enable row level security;
alter table public.commercial_policy_versions enable row level security;
alter table public.commercial_margin_policies enable row level security;
alter table public.expiry_discount_rules enable row level security;
alter table public.commercial_audit_events enable row level security;

revoke all on public.commercial_runtime_config,public.inventory_lots,public.inventory_lot_movements,public.inventory_lot_reservations,public.commercial_policy_versions,public.commercial_margin_policies,public.expiry_discount_rules,public.commercial_audit_events from public,anon,authenticated;
grant select,insert,update,delete on public.commercial_runtime_config,public.inventory_lots,public.inventory_lot_movements,public.inventory_lot_reservations,public.commercial_policy_versions,public.commercial_margin_policies,public.expiry_discount_rules,public.commercial_audit_events to service_role;

create or replace view public.product_lot_stock_v1 as
select
  p.id product_id,
  p.name,
  p.stock legacy_product_stock,
  count(l.id)::integer lot_count,
  coalesce(sum(l.quantity_on_hand),0)::numeric(14,3) lot_quantity_on_hand,
  coalesce(sum(l.quantity_reserved),0)::numeric(14,3) lot_quantity_reserved,
  coalesce(sum(case when l.status='available' and (l.expires_at is null or l.expires_at>=current_date) then greatest(l.quantity_on_hand-l.quantity_reserved,0) else 0 end),0)::numeric(14,3) sellable_lot_quantity,
  coalesce(sum(case when l.expires_at<current_date and l.quantity_on_hand>0 then l.quantity_on_hand else 0 end),0)::numeric(14,3) expired_quantity,
  min(l.expires_at) filter(where l.status='available' and l.quantity_on_hand>l.quantity_reserved and (l.expires_at is null or l.expires_at>=current_date)) earliest_sellable_expiry,
  max(l.updated_at) last_lot_update
from public.products p
left join public.inventory_lots l on l.product_id=p.id
group by p.id,p.name,p.stock;
revoke all on public.product_lot_stock_v1 from public,anon,authenticated;
grant select on public.product_lot_stock_v1 to service_role;

create or replace function public.commercial_readiness_v1()
returns jsonb
language sql
security definer
set search_path=public,pg_temp
as $$
 select jsonb_build_object(
   'enabled',c.enabled,
   'execution_mode',c.execution_mode,
   'lot_truth_enabled',c.lot_truth_enabled,
   'lot_reservations_enabled',c.lot_reservations_enabled,
   'fefo_enabled',c.fefo_enabled,
   'expiry_discount_enabled',c.expiry_discount_enabled,
   'promotion_engine_enabled',c.promotion_engine_enabled,
   'benefit_engine_enabled',c.benefit_engine_enabled,
   'margin_guard_enforced',c.margin_guard_enforced,
   'recommendation_guard_enabled',c.recommendation_guard_enabled,
   'legacy_offer_engine_allowed',c.legacy_offer_engine_allowed,
   'canary_percent',c.canary_percent,
   'runtime_released',c.enabled and c.execution_mode in ('homologation','canary','live'),
   'lots',(select count(*) from public.inventory_lots),
   'available_lots',(select count(*) from public.inventory_lots where status='available'),
   'active_margin_policies',(select count(*) from public.commercial_margin_policies where status='active'),
   'active_expiry_rules',(select count(*) from public.expiry_discount_rules where status='active'),
   'draft_expiry_rules',(select count(*) from public.expiry_discount_rules where status='draft'),
   'lot_reservations',(select count(*) from public.inventory_lot_reservations where status='reserved')
 ) from public.commercial_runtime_config c where c.id=1;
$$;

create or replace function public.kill_commercial_runtime_v1(p_reason text default 'commercial_kill_switch',p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare before_state jsonb; after_state jsonb;
begin
  select to_jsonb(c) into before_state from public.commercial_runtime_config c where id=1 for update;
  update public.commercial_runtime_config set
    enabled=false,execution_mode='off',lot_truth_enabled=false,lot_reservations_enabled=false,fefo_enabled=false,
    expiry_discount_enabled=false,promotion_engine_enabled=false,benefit_engine_enabled=false,margin_guard_enforced=false,
    recommendation_guard_enabled=false,legacy_offer_engine_allowed=false,canary_percent=0,updated_at=now(),updated_by=p_actor_id
  where id=1;
  select to_jsonb(c) into after_state from public.commercial_runtime_config c where id=1;
  insert into public.commercial_audit_events(event_type,actor_type,actor_id,entity_type,before_state,after_state,reason)
  values('COMMERCIAL_KILL_SWITCH','admin',p_actor_id,'commercial_runtime_config',before_state,after_state,coalesce(nullif(trim(p_reason),''),'commercial_kill_switch'));
  return jsonb_build_object('ok',true,'runtime_enabled',false,'execution_mode','off','external_side_effect',false);
end;
$$;

revoke all on function public.commercial_readiness_v1() from public,anon,authenticated;
revoke all on function public.kill_commercial_runtime_v1(text,uuid) from public,anon,authenticated;
grant execute on function public.commercial_readiness_v1() to service_role;
grant execute on function public.kill_commercial_runtime_v1(text,uuid) to service_role;

commit;
