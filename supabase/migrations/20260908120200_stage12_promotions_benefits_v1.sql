begin;

create table if not exists public.promotion_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null unique,
  display_name text not null,
  campaign_type text not null check (campaign_type in ('expiry','manual','birthday','recompra','coupon','gift','clearance')),
  status text not null default 'draft' check (status in ('draft','review_required','approved','active','paused','ended','cancelled')),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  canary_percent smallint not null default 0 check (canary_percent between 0 and 100),
  budget_brl numeric(14,2) not null default 0 check (budget_brl >= 0),
  spent_brl numeric(14,2) not null default 0 check (spent_brl >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid,
  approved_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at>=starts_at)
);

create table if not exists public.promotion_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.promotion_campaigns(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  regular_price numeric(12,2),
  proposed_price numeric(12,2) not null check (proposed_price > 0),
  proposed_discount_percent numeric(7,4) not null default 0 check (proposed_discount_percent between 0 and 100),
  status text not null default 'draft' check (status in ('draft','eligible','blocked','review_required','approved','active','ended','cancelled')),
  guard_snapshot jsonb not null default '{}'::jsonb,
  source_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,product_id)
);

create table if not exists public.promotion_budget_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.promotion_campaigns(id) on delete cascade,
  event_type text not null check (event_type in ('planned','reserved','spent','released','adjusted')),
  amount_brl numeric(14,2) not null check (amount_brl >= 0),
  idempotency_key text not null unique,
  reference_type text,
  reference_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.commercial_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  status text not null default 'draft' check (status in ('draft','active','paused','expired','cancelled')),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_value numeric(12,4) not null check (discount_value > 0),
  max_discount_brl numeric(12,2) check (max_discount_brl is null or max_discount_brl >= 0),
  minimum_order_brl numeric(12,2) not null default 0 check (minimum_order_brl >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  max_total_uses integer check (max_total_uses is null or max_total_uses > 0),
  max_uses_per_customer integer check (max_uses_per_customer is null or max_uses_per_customer > 0),
  created_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at>=starts_at)
);

create table if not exists public.commercial_benefit_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique,
  benefit_kind text not null check (benefit_kind in ('birthday','recompra','gift','manual','service_recovery')),
  benefit_type text not null check (benefit_type in ('percent','fixed','gift_product')),
  benefit_value numeric(12,4),
  gift_product_id uuid references public.products(id) on delete set null,
  minimum_order_brl numeric(12,2) not null default 0 check (minimum_order_brl >= 0),
  status text not null default 'draft' check (status in ('draft','active','retired','cancelled')),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','observe','dry_run','homologation','canary','live')),
  version integer not null default 1 check (version > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((benefit_type='gift_product' and gift_product_id is not null) or (benefit_type<>'gift_product' and benefit_value is not null and benefit_value>0)),
  check (ends_at is null or starts_at is null or ends_at>=starts_at)
);

create table if not exists public.customer_benefit_grants (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  policy_id uuid not null references public.commercial_benefit_policies(id) on delete restrict,
  period_key text not null,
  status text not null default 'held' check (status in ('held','eligible','redeemed','expired','cancelled','review_required')),
  value_snapshot jsonb not null default '{}'::jsonb,
  granted_at timestamptz,
  redeemed_at timestamptz,
  expires_at timestamptz,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id,policy_id,period_key)
);

alter table public.promotion_campaigns enable row level security;
alter table public.promotion_items enable row level security;
alter table public.promotion_budget_events enable row level security;
alter table public.commercial_coupons enable row level security;
alter table public.commercial_benefit_policies enable row level security;
alter table public.customer_benefit_grants enable row level security;
revoke all on public.promotion_campaigns,public.promotion_items,public.promotion_budget_events,public.commercial_coupons,public.commercial_benefit_policies,public.customer_benefit_grants from public,anon,authenticated;
grant select,insert,update,delete on public.promotion_campaigns,public.promotion_items,public.promotion_budget_events,public.commercial_coupons,public.commercial_benefit_policies,public.customer_benefit_grants to service_role;

create or replace function public.commercial_budget_remaining_v1(p_campaign_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare cfg public.commercial_runtime_config%rowtype; c public.promotion_campaigns%rowtype; total numeric; spent numeric;
begin
  select * into cfg from public.commercial_runtime_config where id=1;
  if p_campaign_id is null then
    total:=cfg.promotion_budget_brl; spent:=cfg.promotion_budget_spent_brl;
  else
    select * into c from public.promotion_campaigns where id=p_campaign_id;
    if not found then return jsonb_build_object('ok',false,'reason','campaign_not_found','side_effect_performed',false); end if;
    total:=c.budget_brl; spent:=c.spent_brl;
  end if;
  return jsonb_build_object('ok',true,'budget_brl',coalesce(total,0),'spent_brl',coalesce(spent,0),'remaining_brl',greatest(coalesce(total,0)-coalesce(spent,0),0),'side_effect_performed',false);
end;
$$;

create or replace function public.create_promotion_item_draft_v1(
  p_campaign_id uuid,p_product_id uuid,p_proposed_price numeric,p_reason text default null,p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare c public.promotion_campaigns%rowtype; p public.products%rowtype; guard jsonb; item_id uuid; item_status text; discount numeric;
begin
  select * into c from public.promotion_campaigns where id=p_campaign_id;
  if not found then return jsonb_build_object('ok',false,'reason','campaign_not_found','side_effect_performed',false); end if;
  if c.status not in ('draft','review_required') or c.enabled then return jsonb_build_object('ok',false,'reason','campaign_not_draft_safe','side_effect_performed',false); end if;
  select * into p from public.products where id=p_product_id;
  if not found then return jsonb_build_object('ok',false,'reason','product_not_found','side_effect_performed',false); end if;
  guard:=public.margin_guard_v1(p.id,p_proposed_price,1,'promotion');
  item_status:=case when coalesce((guard->>'allowed')::boolean,false) then 'eligible' else 'blocked' end;
  discount:=case when coalesce(p.price,0)>0 and p_proposed_price<p.price then round(((p.price-p_proposed_price)/p.price)*100,4) else 0 end;
  insert into public.promotion_items(campaign_id,product_id,regular_price,proposed_price,proposed_discount_percent,status,guard_snapshot,source_reason,created_by)
  values(c.id,p.id,p.price,p_proposed_price,discount,item_status,guard,p_reason,p_actor_id)
  on conflict(campaign_id,product_id) do update set regular_price=excluded.regular_price,proposed_price=excluded.proposed_price,
    proposed_discount_percent=excluded.proposed_discount_percent,status=excluded.status,guard_snapshot=excluded.guard_snapshot,
    source_reason=excluded.source_reason,created_by=excluded.created_by,updated_at=now()
  returning id into item_id;
  return jsonb_build_object('ok',true,'promotion_item_id',item_id,'status',item_status,'guard',guard,'campaign_enabled',c.enabled,'campaign_execution_mode',c.execution_mode,'external_side_effect',false,'side_effect_performed',true);
end;
$$;

create or replace function public.preview_coupon_v1(p_code text,p_order_subtotal numeric,p_customer_id uuid default null,p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare cfg public.commercial_runtime_config%rowtype; c public.commercial_coupons%rowtype; subtotal numeric:=coalesce(p_order_subtotal,0); discount numeric;
begin
  select * into cfg from public.commercial_runtime_config where id=1;
  select * into c from public.commercial_coupons where upper(code)=upper(trim(coalesce(p_code,'')));
  if not found then return jsonb_build_object('ok',true,'eligible',false,'reason','coupon_not_found','side_effect_performed',false); end if;
  if not cfg.promotion_engine_enabled or not c.enabled or c.status<>'active' or c.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',true,'eligible',false,'reason','coupon_runtime_disabled','coupon_id',c.id,'side_effect_performed',false);
  end if;
  if (c.starts_at is not null and p_at<c.starts_at) or (c.ends_at is not null and p_at>c.ends_at) then return jsonb_build_object('ok',true,'eligible',false,'reason','coupon_outside_window','side_effect_performed',false); end if;
  if subtotal<c.minimum_order_brl then return jsonb_build_object('ok',true,'eligible',false,'reason','minimum_order_not_met','minimum_order_brl',c.minimum_order_brl,'side_effect_performed',false); end if;
  discount:=case when c.discount_type='percent' then subtotal*c.discount_value/100 else c.discount_value end;
  if c.max_discount_brl is not null then discount:=least(discount,c.max_discount_brl); end if;
  discount:=least(discount,subtotal);
  return jsonb_build_object('ok',true,'eligible',true,'coupon_id',c.id,'discount_brl',round(discount,2),'final_subtotal_brl',round(subtotal-discount,2),'requires_item_margin_validation',true,'side_effect_performed',false);
end;
$$;

create or replace function public.preview_birthday_benefit_v1(p_customer_id uuid,p_reference_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare cfg public.commercial_runtime_config%rowtype; c public.customers%rowtype; pol public.commercial_benefit_policies%rowtype; period text;
begin
  select * into cfg from public.commercial_runtime_config where id=1;
  select * into c from public.customers where id=p_customer_id;
  if not found then return jsonb_build_object('ok',false,'eligible',false,'reason','customer_not_found','side_effect_performed',false); end if;
  if c.birthday_month is null then return jsonb_build_object('ok',true,'eligible',false,'reason','birthday_not_registered','side_effect_performed',false); end if;
  if c.birthday_month<>extract(month from p_reference_date)::integer then return jsonb_build_object('ok',true,'eligible',false,'reason','outside_birthday_month','side_effect_performed',false); end if;
  select * into pol from public.commercial_benefit_policies
  where benefit_kind='birthday' and status='active' and enabled=true and execution_mode in ('homologation','canary','live')
    and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now())
  order by version desc limit 1;
  if not cfg.benefit_engine_enabled or not found then return jsonb_build_object('ok',true,'eligible',false,'reason','birthday_benefit_runtime_disabled','side_effect_performed',false); end if;
  period:=to_char(p_reference_date,'YYYY-MM');
  return jsonb_build_object('ok',true,'eligible',true,'policy_id',pol.id,'period_key',period,'benefit_type',pol.benefit_type,'benefit_value',pol.benefit_value,'gift_product_id',pol.gift_product_id,'minimum_order_brl',pol.minimum_order_brl,'requires_margin_guard',pol.benefit_type in ('percent','fixed','gift_product'),'side_effect_performed',false);
end;
$$;

create or replace function public.grant_birthday_benefit_v1(p_customer_id uuid,p_reference_date date default current_date,p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare preview jsonb; pol uuid; period text; gid uuid; key text;
begin
  preview:=public.preview_birthday_benefit_v1(p_customer_id,p_reference_date);
  if not coalesce((preview->>'eligible')::boolean,false) then return preview; end if;
  pol:=(preview->>'policy_id')::uuid; period:=preview->>'period_key'; key:='birthday:'||p_customer_id::text||':'||period||':'||pol::text;
  select id into gid from public.customer_benefit_grants where idempotency_key=key;
  if found then return jsonb_build_object('ok',true,'replay',true,'grant_id',gid,'side_effect_performed',false); end if;
  insert into public.customer_benefit_grants(customer_id,policy_id,period_key,status,value_snapshot,granted_at,idempotency_key,metadata)
  values(p_customer_id,pol,period,'eligible',preview,now(),key,jsonb_build_object('actor_id',p_actor_id)) returning id into gid;
  return jsonb_build_object('ok',true,'replay',false,'grant_id',gid,'status','eligible','external_side_effect',false,'side_effect_performed',true);
end;
$$;

revoke all on function public.commercial_budget_remaining_v1(uuid) from public,anon,authenticated;
revoke all on function public.create_promotion_item_draft_v1(uuid,uuid,numeric,text,uuid) from public,anon,authenticated;
revoke all on function public.preview_coupon_v1(text,numeric,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.preview_birthday_benefit_v1(uuid,date) from public,anon,authenticated;
revoke all on function public.grant_birthday_benefit_v1(uuid,date,uuid) from public,anon,authenticated;
grant execute on function public.commercial_budget_remaining_v1(uuid) to service_role;
grant execute on function public.create_promotion_item_draft_v1(uuid,uuid,numeric,text,uuid) to service_role;
grant execute on function public.preview_coupon_v1(text,numeric,uuid,timestamptz) to service_role;
grant execute on function public.preview_birthday_benefit_v1(uuid,date) to service_role;
grant execute on function public.grant_birthday_benefit_v1(uuid,date,uuid) to service_role;

commit;
