begin;

-- Stage 12C/12D — Substitution Engine + Cycle Counting foundation v1.
-- Deterministic, server-only and dormant. No order mutation, stock adjustment, Bling call or external side effect.

alter table public.commercial_truth_runtime_config
  add column if not exists substitution_preview_enabled boolean not null default false,
  add column if not exists substitution_recording_enabled boolean not null default false,
  add column if not exists substitution_apply_enabled boolean not null default false,
  add column if not exists cycle_count_planning_enabled boolean not null default false,
  add column if not exists cycle_count_recording_enabled boolean not null default false,
  add column if not exists cycle_count_adjustment_enabled boolean not null default false;

create table if not exists public.substitution_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  status text not null default 'draft' check(status in ('draft','active','retired')),
  version_no integer not null default 1 check(version_no>0),
  policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.substitution_groups enable row level security;

create table if not exists public.substitution_group_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.substitution_groups(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  status text not null default 'draft' check(status in ('draft','active','retired')),
  priority integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(group_id,product_id)
);
alter table public.substitution_group_items enable row level security;
create index if not exists substitution_group_items_product_idx on public.substitution_group_items(product_id,status,priority);

create table if not exists public.customer_substitution_preferences (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  product_id uuid null references public.products(id) on delete cascade,
  substitution_group_id uuid null references public.substitution_groups(id) on delete cascade,
  basket_id uuid null references public.basket_templates(id) on delete cascade,
  preference text not null default 'ask' check(preference in ('no_substitute','ask','allow_rule')),
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(((product_id is not null)::integer + (substitution_group_id is not null)::integer + (basket_id is not null)::integer)=1)
);
alter table public.customer_substitution_preferences enable row level security;
create unique index if not exists customer_substitution_pref_product_uidx on public.customer_substitution_preferences(customer_id,product_id) where product_id is not null;
create unique index if not exists customer_substitution_pref_group_uidx on public.customer_substitution_preferences(customer_id,substitution_group_id) where substitution_group_id is not null;
create unique index if not exists customer_substitution_pref_basket_uidx on public.customer_substitution_preferences(customer_id,basket_id) where basket_id is not null;

create table if not exists public.substitution_evaluations (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'manual' check(source_type in ('manual','cart','order','fulfillment')),
  source_id uuid null,
  customer_id uuid null references public.customers(id) on delete set null,
  basket_id uuid null references public.basket_templates(id) on delete set null,
  substitution_group_id uuid null references public.substitution_groups(id) on delete set null,
  original_product_id uuid not null references public.products(id) on delete restrict,
  candidate_product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(14,3) not null check(quantity>0),
  delivery_date date not null,
  decision text not null check(decision in ('allow','ask','review','block')),
  reason text null,
  inventory_snapshot jsonb not null default '{}'::jsonb,
  pricing_snapshot jsonb not null default '{}'::jsonb,
  preference_snapshot jsonb not null default '{}'::jsonb,
  evaluation_key text null unique,
  applied boolean not null default false,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.substitution_evaluations enable row level security;
create index if not exists substitution_evaluations_source_idx on public.substitution_evaluations(source_type,source_id,created_at desc);

create table if not exists public.cycle_count_tasks (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  lot_id uuid null references public.inventory_lots(id) on delete restrict,
  location_id uuid null references public.warehouse_locations(id) on delete set null,
  trigger_reason text not null check(trigger_reason in ('manual','scheduled','picking_divergence','low_stock','lot_risk','expiry_risk','inventory_divergence')),
  status text not null default 'draft' check(status in ('draft','ready','counting','submitted','within_tolerance','review_required','approved','rejected','cancelled')),
  blind_count boolean not null default true,
  priority_score numeric(12,4) null,
  expected_quantity_snapshot numeric(14,3) null,
  expected_source text not null default 'unknown' check(expected_source in ('unknown','product_stock','lot_free_stock')),
  expected_snapshot jsonb not null default '{}'::jsonb,
  candidate_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  assigned_to uuid null references public.warehouse_staff(id) on delete set null,
  started_at timestamptz null,
  submitted_at timestamptz null,
  resolved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.cycle_count_tasks enable row level security;
create index if not exists cycle_count_tasks_queue_idx on public.cycle_count_tasks(status,priority_score desc,created_at);
create index if not exists cycle_count_tasks_product_idx on public.cycle_count_tasks(product_id,created_at desc);

create table if not exists public.cycle_count_observations (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.cycle_count_tasks(id) on delete cascade,
  counted_quantity numeric(14,3) not null check(counted_quantity>=0),
  expected_quantity_snapshot numeric(14,3) null,
  difference_quantity numeric(14,3) null,
  difference_percent numeric(12,4) null,
  decision text not null check(decision in ('within_tolerance','review_required')),
  counter_id uuid null references public.warehouse_staff(id) on delete set null,
  client_event_id text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  stock_adjusted boolean not null default false,
  external_side_effect boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.cycle_count_observations enable row level security;
create index if not exists cycle_count_observations_task_idx on public.cycle_count_observations(task_id,created_at desc);

create table if not exists public.cycle_count_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.cycle_count_tasks(id) on delete cascade,
  event_type text not null,
  actor_id uuid null references public.warehouse_staff(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.cycle_count_events enable row level security;
create index if not exists cycle_count_events_task_idx on public.cycle_count_events(task_id,created_at);

create or replace function public.preview_substitution_v1(
  p_original_product_id uuid,
  p_candidate_product_id uuid,
  p_quantity numeric,
  p_delivery_date date,
  p_customer_id uuid default null,
  p_basket_id uuid default null,
  p_source_type text default 'manual',
  p_source_id uuid default null
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_truth_runtime_config%rowtype;
  original_p public.products%rowtype;
  candidate_p public.products%rowtype;
  grp public.substitution_groups%rowtype;
  pref text:='ask';
  pref_scope text:='default';
  inv jsonb;
  guard jsonb:=null;
  pricing jsonb:='{}'::jsonb;
  decision text:='allow';
  reason text:=null;
  min_margin numeric;
  standalone_strategy text;
  max_price_increase numeric;
  gross numeric;
  estimated_cost numeric;
  basket_price numeric;
  basket_cost_before numeric;
  basket_cost_after numeric;
  original_component_qty numeric;
  missing_costs integer:=0;
  price_increase_pct numeric;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.substitution_preview_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then
    return jsonb_build_object('ok',false,'error','substitution_preview_disabled','side_effect_performed',false,'external_side_effect',false);
  end if;
  if p_original_product_id is null or p_candidate_product_id is null or p_original_product_id=p_candidate_product_id or p_quantity is null or p_quantity<=0 or p_delivery_date is null or lower(trim(coalesce(p_source_type,''))) not in ('manual','cart','order','fulfillment') then
    return jsonb_build_object('ok',false,'error','invalid_substitution_input','side_effect_performed',false,'external_side_effect',false);
  end if;
  select * into original_p from public.products where id=p_original_product_id and is_active=true;
  if not found then return jsonb_build_object('ok',false,'error','original_product_not_available','side_effect_performed',false,'external_side_effect',false);end if;
  select * into candidate_p from public.products where id=p_candidate_product_id and is_active=true;
  if not found then return jsonb_build_object('ok',false,'error','candidate_product_not_available','side_effect_performed',false,'external_side_effect',false);end if;

  select g.* into grp
  from public.substitution_groups g
  join public.substitution_group_items oi on oi.group_id=g.id and oi.product_id=original_p.id and oi.status='active'
  join public.substitution_group_items ci on ci.group_id=g.id and ci.product_id=candidate_p.id and ci.status='active'
  where g.status='active'
  order by g.version_no desc,g.id
  limit 1;
  if not found then
    return jsonb_build_object('ok',true,'decision','block','reason','products_not_in_active_equivalence_group','applied',false,'side_effect_performed',false,'external_side_effect',false);
  end if;

  if p_customer_id is not null then
    select x.preference,x.scope into pref,pref_scope
    from (
      select csp.preference,'product'::text scope,1 precedence from public.customer_substitution_preferences csp where csp.customer_id=p_customer_id and csp.product_id=original_p.id
      union all
      select csp.preference,'basket'::text scope,2 precedence from public.customer_substitution_preferences csp where csp.customer_id=p_customer_id and p_basket_id is not null and csp.basket_id=p_basket_id
      union all
      select csp.preference,'group'::text scope,3 precedence from public.customer_substitution_preferences csp where csp.customer_id=p_customer_id and csp.substitution_group_id=grp.id
    ) x order by x.precedence limit 1;
    if not found then pref:='ask';pref_scope:='default';end if;
  end if;

  inv:=public.preview_fefo_allocation_v1(candidate_p.id,p_quantity,p_delivery_date,0);
  if coalesce((inv->>'sufficient')::boolean,false)=false then decision:='block';reason:='candidate_inventory_or_validity_insufficient';end if;
  if pref='no_substitute' then decision:='block';reason:='customer_no_substitute';end if;

  min_margin:=case when grp.policy ? 'minimum_margin_percent' then (grp.policy->>'minimum_margin_percent')::numeric else null end;
  if p_basket_id is not null then
    select bt.base_price into basket_price from public.basket_templates bt where bt.id=p_basket_id and bt.is_active=true;
    select bti.quantity into original_component_qty from public.basket_template_items bti where bti.basket_id=p_basket_id and bti.product_id=original_p.id order by bti.sort_order,bti.created_at limit 1;
    select coalesce(sum(p.cost*bti.quantity),0),count(*) filter(where p.cost is null)
      into basket_cost_before,missing_costs
      from public.basket_template_items bti join public.products p on p.id=bti.product_id where bti.basket_id=p_basket_id;
    if basket_price is null or original_component_qty is null then
      if decision<>'block' then decision:='review';reason:='basket_context_incomplete';end if;
    elsif missing_costs>0 or original_p.cost is null or candidate_p.cost is null or min_margin is null then
      if decision<>'block' then decision:='review';reason:='basket_margin_input_incomplete';end if;
    else
      basket_cost_after:=basket_cost_before-(original_p.cost*p_quantity)+(candidate_p.cost*p_quantity);
      guard:=public.evaluate_margin_guard_v1(basket_price,basket_cost_after,0,min_margin);
      if guard->>'decision'='block' then decision:='block';reason:='basket_margin_guard_block';end if;
    end if;
    pricing:=jsonb_build_object('strategy','preserve_basket_price','basket_id',p_basket_id,'basket_price',basket_price,'estimated_cost_before',basket_cost_before,'estimated_cost_after',basket_cost_after,'margin_guard',guard,'component_promotion_does_not_reprice_basket',true);
  else
    standalone_strategy:=coalesce(nullif(grp.policy->>'standalone_price_strategy',''),'ask');
    max_price_increase:=case when grp.policy ? 'max_customer_price_increase_percent' then (grp.policy->>'max_customer_price_increase_percent')::numeric else null end;
    if standalone_strategy='preserve_original_price' then gross:=original_p.price;
    elsif standalone_strategy='candidate_price' then gross:=candidate_p.price;
    else if decision<>'block' then decision:='review';reason:='standalone_price_strategy_requires_review';end if;end if;
    estimated_cost:=candidate_p.cost;
    if standalone_strategy in ('preserve_original_price','candidate_price') then
      if gross is null or estimated_cost is null or min_margin is null then
        if decision<>'block' then decision:='review';reason:='standalone_margin_input_incomplete';end if;
      else
        guard:=public.evaluate_margin_guard_v1(gross*p_quantity,estimated_cost*p_quantity,0,min_margin);
        if guard->>'decision'='block' then decision:='block';reason:='standalone_margin_guard_block';end if;
      end if;
    end if;
    if standalone_strategy='candidate_price' and original_p.price is not null and original_p.price>0 and candidate_p.price is not null then
      price_increase_pct:=round(((candidate_p.price-original_p.price)/original_p.price)*100,4);
      if max_price_increase is null and decision not in ('block','review') then decision:='review';reason:='price_increase_limit_not_configured';
      elsif max_price_increase is not null and price_increase_pct>max_price_increase then decision:='block';reason:='candidate_price_increase_exceeds_policy';end if;
    end if;
    pricing:=jsonb_build_object('strategy',standalone_strategy,'original_price',original_p.price,'candidate_price',candidate_p.price,'effective_unit_revenue',gross,'candidate_unit_cost',candidate_p.cost,'price_increase_percent',price_increase_pct,'max_price_increase_percent',max_price_increase,'margin_guard',guard);
  end if;

  if decision='allow' and pref='ask' then decision:='ask';reason:='customer_confirmation_required';end if;
  return jsonb_build_object('ok',true,'decision',decision,'reason',reason,'group_id',grp.id,'group_code',grp.code,'preference',pref,'preference_scope',pref_scope,'inventory',inv,'pricing',pricing,'applied',false,'side_effect_performed',false,'external_side_effect',false);
end;
$$;

create or replace function public.record_substitution_evaluation_v1(
  p_original_product_id uuid,
  p_candidate_product_id uuid,
  p_quantity numeric,
  p_delivery_date date,
  p_customer_id uuid,
  p_basket_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_evaluation_key text
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare cfg public.commercial_truth_runtime_config%rowtype; prior uuid; preview jsonb; eid uuid;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if not cfg.enabled or not cfg.substitution_preview_enabled or not cfg.substitution_recording_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then return jsonb_build_object('ok',false,'error','substitution_recording_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  if length(trim(coalesce(p_evaluation_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_evaluation_key','side_effect_performed',false,'external_side_effect',false);end if;
  select id into prior from public.substitution_evaluations where evaluation_key=trim(p_evaluation_key);if found then return jsonb_build_object('ok',true,'replay',true,'evaluation_id',prior,'side_effect_performed',false,'external_side_effect',false);end if;
  preview:=public.preview_substitution_v1(p_original_product_id,p_candidate_product_id,p_quantity,p_delivery_date,p_customer_id,p_basket_id,p_source_type,p_source_id);
  if coalesce((preview->>'ok')::boolean,false)=false then return preview;end if;
  insert into public.substitution_evaluations(source_type,source_id,customer_id,basket_id,substitution_group_id,original_product_id,candidate_product_id,quantity,delivery_date,decision,reason,inventory_snapshot,pricing_snapshot,preference_snapshot,evaluation_key)
  values(lower(trim(p_source_type)),p_source_id,p_customer_id,p_basket_id,(preview->>'group_id')::uuid,p_original_product_id,p_candidate_product_id,p_quantity,p_delivery_date,preview->>'decision',preview->>'reason',coalesce(preview->'inventory','{}'::jsonb),coalesce(preview->'pricing','{}'::jsonb),jsonb_build_object('preference',preview->>'preference','scope',preview->>'preference_scope'),trim(p_evaluation_key)) returning id into eid;
  return jsonb_build_object('ok',true,'replay',false,'evaluation_id',eid,'decision',preview->>'decision','applied',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.preview_cycle_count_candidate_v1(p_product_id uuid,p_lot_id uuid default null)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_truth_runtime_config%rowtype;
  p public.products%rowtype;
  l public.inventory_lots%rowtype;
  pol public.commercial_policy_versions%rowtype;
  reasons jsonb:='[]'::jsonb;
  score numeric:=0;
  w jsonb:='{}'::jsonb;
  expiry_window integer:=0;
  min_score numeric;
  recent_divergence boolean:=false;
  open_shortage boolean:=false;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if not found or not cfg.enabled or not cfg.cycle_count_planning_enabled or cfg.execution_mode not in ('observe','dry_run','homologation','canary','live') then return jsonb_build_object('ok',false,'error','cycle_count_planning_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  select * into p from public.products where id=p_product_id;if not found then return jsonb_build_object('ok',false,'error','product_not_found','side_effect_performed',false,'external_side_effect',false);end if;
  if p_lot_id is not null then select * into l from public.inventory_lots where id=p_lot_id and product_id=p.id;if not found then return jsonb_build_object('ok',false,'error','lot_not_found','side_effect_performed',false,'external_side_effect',false);end if;end if;
  select * into pol from public.commercial_policy_versions where policy_key='cycle_count' and status='active' and (effective_from is null or effective_from<=now()) and (effective_to is null or effective_to>now()) order by version desc limit 1;
  if not found then return jsonb_build_object('ok',true,'result','review','eligible_for_task',false,'reason','no_active_cycle_count_policy','signals','[]'::jsonb,'external_side_effect',false);end if;
  w:=coalesce(pol.policy->'weights','{}'::jsonb);
  expiry_window:=coalesce((pol.policy->>'expiry_window_days')::integer,0);
  min_score:=case when pol.policy ? 'minimum_priority_score' then (pol.policy->>'minimum_priority_score')::numeric else null end;

  if not p.physically_verified then score:=score+coalesce((w->>'physically_unverified')::numeric,0);reasons:=reasons||jsonb_build_array(jsonb_build_object('code','physically_unverified'));end if;
  if p.last_counted_at is null then score:=score+coalesce((w->>'never_counted')::numeric,0);reasons:=reasons||jsonb_build_array(jsonb_build_object('code','never_counted'));end if;
  if p.stock is not null and p.min_stock is not null and p.stock<=p.min_stock then score:=score+coalesce((w->>'low_stock')::numeric,0);reasons:=reasons||jsonb_build_array(jsonb_build_object('code','low_stock','stock',p.stock,'min_stock',p.min_stock));end if;
  select exists(select 1 from public.inventory_count_items ici where ici.product_id=p.id and ici.previous_stock is not null and ici.counted_stock<>ici.previous_stock order by ici.counted_at desc limit 1) into recent_divergence;
  if recent_divergence then score:=score+coalesce((w->>'inventory_divergence')::numeric,0);reasons:=reasons||jsonb_build_array(jsonb_build_object('code','recent_inventory_divergence'));end if;
  select exists(select 1 from public.fulfillment_exceptions fe join public.fulfillment_items fi on fi.id=fe.fulfillment_item_id where fi.product_id=p.id and fe.status='open' and fe.type in ('shortage','lot_shortage','lot_expired')) into open_shortage;
  if open_shortage then score:=score+coalesce((w->>'picking_exception')::numeric,0);reasons:=reasons||jsonb_build_array(jsonb_build_object('code','open_picking_exception'));end if;
  if p_lot_id is not null and l.expires_at is not null and expiry_window>0 and l.expires_at<=((now() at time zone 'America/Cuiaba')::date+expiry_window) then score:=score+coalesce((w->>'expiry_risk')::numeric,0);reasons:=reasons||jsonb_build_array(jsonb_build_object('code','expiry_risk','expires_at',l.expires_at,'window_days',expiry_window));end if;
  return jsonb_build_object('ok',true,'result',case when min_score is null then 'review' when score>=min_score then 'eligible' else 'not_due' end,'eligible_for_task',(min_score is not null and score>=min_score),'priority_score',score,'minimum_priority_score',min_score,'policy_version',pol.version,'signals',reasons,'external_side_effect',false);
end;
$$;

create or replace function public.create_cycle_count_task_v1(p_product_id uuid,p_lot_id uuid,p_location_id uuid,p_trigger_reason text,p_blind_count boolean,p_idempotency_key text)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare cfg public.commercial_truth_runtime_config%rowtype; prior uuid; p public.products%rowtype; l public.inventory_lots%rowtype; preview jsonb; expected_qty numeric; expected_source text:='unknown'; tid uuid;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if not cfg.enabled or not cfg.cycle_count_planning_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','cycle_count_task_creation_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  if p_product_id is null or lower(trim(coalesce(p_trigger_reason,''))) not in ('manual','scheduled','picking_divergence','low_stock','lot_risk','expiry_risk','inventory_divergence') or length(trim(coalesce(p_idempotency_key,'')))<12 then return jsonb_build_object('ok',false,'error','invalid_cycle_count_task','side_effect_performed',false,'external_side_effect',false);end if;
  select id into prior from public.cycle_count_tasks where idempotency_key=trim(p_idempotency_key);if found then return jsonb_build_object('ok',true,'replay',true,'task_id',prior,'side_effect_performed',false,'external_side_effect',false);end if;
  select * into p from public.products where id=p_product_id;if not found then return jsonb_build_object('ok',false,'error','product_not_found','side_effect_performed',false,'external_side_effect',false);end if;
  preview:=public.preview_cycle_count_candidate_v1(p_product_id,p_lot_id);if coalesce((preview->>'ok')::boolean,false)=false then return preview;end if;
  if p_lot_id is not null then select * into l from public.inventory_lots where id=p_lot_id and product_id=p.id;if not found then return jsonb_build_object('ok',false,'error','lot_not_found','side_effect_performed',false,'external_side_effect',false);end if;expected_qty:=l.quantity_available-l.quantity_reserved;expected_source:='lot_free_stock';
  else expected_qty:=p.stock;expected_source:='product_stock';end if;
  insert into public.cycle_count_tasks(product_id,lot_id,location_id,trigger_reason,status,blind_count,priority_score,expected_quantity_snapshot,expected_source,expected_snapshot,candidate_snapshot,idempotency_key)
  values(p.id,p_lot_id,p_location_id,lower(trim(p_trigger_reason)),'draft',coalesce(p_blind_count,true),case when preview ? 'priority_score' then (preview->>'priority_score')::numeric else null end,expected_qty,expected_source,jsonb_build_object('expected_quantity',expected_qty,'source',expected_source,'captured_at',now()),preview,trim(p_idempotency_key)) returning id into tid;
  insert into public.cycle_count_events(task_id,event_type,payload) values(tid,'TASK_CREATED',jsonb_build_object('status','draft','trigger_reason',lower(trim(p_trigger_reason)),'auto_activated',false));
  return jsonb_build_object('ok',true,'replay',false,'task_id',tid,'status','draft','priority_score',preview->'priority_score','stock_adjusted',false,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.record_cycle_count_observation_v1(p_task_id uuid,p_counted_quantity numeric,p_counter_id uuid,p_client_event_id text,p_metadata jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $$
declare cfg public.commercial_truth_runtime_config%rowtype; t public.cycle_count_tasks%rowtype; pol public.commercial_policy_versions%rowtype; prior uuid; diff numeric; pct numeric; abs_threshold numeric; pct_threshold numeric; decision text:='review_required'; oid uuid;
begin
  select * into cfg from public.commercial_truth_runtime_config where id=1;
  if not cfg.enabled or not cfg.cycle_count_recording_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'error','cycle_count_recording_disabled','side_effect_performed',false,'external_side_effect',false);end if;
  if p_task_id is null or p_counted_quantity is null or p_counted_quantity<0 or length(trim(coalesce(p_client_event_id,'')))<8 then return jsonb_build_object('ok',false,'error','invalid_cycle_count_observation','side_effect_performed',false,'external_side_effect',false);end if;
  select id into prior from public.cycle_count_observations where client_event_id=trim(p_client_event_id);if found then return jsonb_build_object('ok',true,'replay',true,'observation_id',prior,'side_effect_performed',false,'external_side_effect',false);end if;
  select * into t from public.cycle_count_tasks where id=p_task_id for update;if not found then return jsonb_build_object('ok',false,'error','cycle_count_task_not_found','side_effect_performed',false,'external_side_effect',false);end if;
  if t.status in ('approved','rejected','cancelled') then return jsonb_build_object('ok',false,'error','cycle_count_task_closed','status',t.status,'side_effect_performed',false,'external_side_effect',false);end if;
  select * into pol from public.commercial_policy_versions where policy_key='cycle_count' and status='active' and (effective_from is null or effective_from<=now()) and (effective_to is null or effective_to>now()) order by version desc limit 1;
  if t.expected_quantity_snapshot is not null then diff:=p_counted_quantity-t.expected_quantity_snapshot;pct:=case when t.expected_quantity_snapshot=0 then case when p_counted_quantity=0 then 0 else null end else round((abs(diff)/abs(t.expected_quantity_snapshot))*100,4) end;end if;
  if found then abs_threshold:=case when pol.policy ? 'absolute_quantity_threshold' then (pol.policy->>'absolute_quantity_threshold')::numeric else null end;pct_threshold:=case when pol.policy ? 'difference_percent_threshold' then (pol.policy->>'difference_percent_threshold')::numeric else null end;end if;
  if t.expected_quantity_snapshot is not null and abs_threshold is not null and abs(diff)<=abs_threshold and (pct_threshold is null or (pct is not null and pct<=pct_threshold)) then decision:='within_tolerance';end if;
  insert into public.cycle_count_observations(task_id,counted_quantity,expected_quantity_snapshot,difference_quantity,difference_percent,decision,counter_id,client_event_id,metadata)
  values(t.id,p_counted_quantity,t.expected_quantity_snapshot,diff,pct,decision,p_counter_id,trim(p_client_event_id),coalesce(p_metadata,'{}'::jsonb)) returning id into oid;
  update public.cycle_count_tasks set status=decision,submitted_at=coalesce(submitted_at,now()),updated_at=now() where id=t.id;
  insert into public.cycle_count_events(task_id,event_type,actor_id,payload) values(t.id,'COUNT_SUBMITTED',p_counter_id,jsonb_build_object('observation_id',oid,'decision',decision,'difference_quantity',diff,'difference_percent',pct,'stock_adjusted',false));
  return jsonb_build_object('ok',true,'replay',false,'observation_id',oid,'decision',decision,'difference_quantity',diff,'difference_percent',pct,'stock_adjusted',false,'adjustment_gate_enabled',cfg.cycle_count_adjustment_enabled,'side_effect_performed',true,'external_side_effect',false);
end;
$$;

create or replace function public.cycle_count_kpis_v1(p_from timestamptz default null,p_to timestamptz default null)
returns jsonb
language sql security definer set search_path=public,pg_temp
as $$
  select jsonb_build_object(
    'observations',count(*),
    'within_tolerance',count(*) filter(where decision='within_tolerance'),
    'review_required',count(*) filter(where decision='review_required'),
    'inventory_accuracy_percent',case when count(*)=0 then null else round((count(*) filter(where decision='within_tolerance')::numeric/count(*)::numeric)*100,2) end,
    'metric_definition','count_lines_within_configured_tolerance_over_evaluated_count_lines',
    'stock_adjustments',count(*) filter(where stock_adjusted=true),
    'external_side_effect',false
  )
  from public.cycle_count_observations
  where (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to);
$$;

-- Server-only access. No browser/anon/authenticated access to data or RPCs.
revoke all on table public.substitution_groups,public.substitution_group_items,public.customer_substitution_preferences,public.substitution_evaluations,public.cycle_count_tasks,public.cycle_count_observations,public.cycle_count_events from public,anon,authenticated;
grant select,insert,update,delete on table public.substitution_groups,public.substitution_group_items,public.customer_substitution_preferences,public.substitution_evaluations,public.cycle_count_tasks,public.cycle_count_observations,public.cycle_count_events to service_role;

revoke all on function public.preview_substitution_v1(uuid,uuid,numeric,date,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.record_substitution_evaluation_v1(uuid,uuid,numeric,date,uuid,uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.preview_cycle_count_candidate_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_cycle_count_task_v1(uuid,uuid,uuid,text,boolean,text) from public,anon,authenticated;
revoke all on function public.record_cycle_count_observation_v1(uuid,numeric,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.cycle_count_kpis_v1(timestamptz,timestamptz) from public,anon,authenticated;

grant execute on function public.preview_substitution_v1(uuid,uuid,numeric,date,uuid,uuid,text,uuid),public.record_substitution_evaluation_v1(uuid,uuid,numeric,date,uuid,uuid,text,uuid,text),public.preview_cycle_count_candidate_v1(uuid,uuid),public.create_cycle_count_task_v1(uuid,uuid,uuid,text,boolean,text),public.record_cycle_count_observation_v1(uuid,numeric,uuid,text,jsonb),public.cycle_count_kpis_v1(timestamptz,timestamptz) to service_role;

commit;
