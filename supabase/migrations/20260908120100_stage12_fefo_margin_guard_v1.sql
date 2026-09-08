begin;

create unique index if not exists inventory_lot_reservations_batch_lot_uidx
  on public.inventory_lot_reservations(reservation_key,lot_id);

create or replace function public.commercial_product_eligibility_v1(p_product_id uuid,p_delivery_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  p public.products%rowtype;
  ls public.product_lot_stock_v1%rowtype;
  available_qty numeric(14,3);
  effective_expiry date;
  source text;
  required_expiry date;
  reason text:=null;
begin
  select * into cfg from public.commercial_runtime_config where id=1;
  select * into p from public.products where id=p_product_id;
  if not found then return jsonb_build_object('ok',false,'eligible',false,'reason','product_not_found','side_effect_performed',false); end if;
  select * into ls from public.product_lot_stock_v1 where product_id=p.id;
  required_expiry:=coalesce(p_delivery_date,current_date)+coalesce(cfg.minimum_delivery_shelf_life_days,1);
  if cfg.lot_truth_enabled and coalesce(ls.lot_count,0)>0 then
    available_qty:=coalesce(ls.sellable_lot_quantity,0);
    effective_expiry:=ls.earliest_sellable_expiry;
    source:='inventory_lots';
  else
    available_qty:=greatest(coalesce(p.stock,0),0);
    effective_expiry:=p.validity_date;
    source:='products_legacy';
  end if;

  if not p.is_active then reason:='product_inactive';
  elsif not p.physically_verified then reason:='product_not_physically_verified';
  elsif available_qty<=0 then reason:='out_of_stock';
  elsif effective_expiry is not null and effective_expiry<required_expiry then reason:='expiry_incompatible_with_delivery';
  end if;

  return jsonb_build_object(
    'ok',true,'eligible',reason is null,'reason',reason,'product_id',p.id,'source',source,
    'available_quantity',available_qty,'effective_expiry',effective_expiry,'delivery_date',coalesce(p_delivery_date,current_date),
    'minimum_delivery_shelf_life_days',cfg.minimum_delivery_shelf_life_days,'required_expiry_on_or_after',required_expiry,
    'lot_truth_enabled',cfg.lot_truth_enabled,'side_effect_performed',false
  );
end;
$$;

create or replace function public.preview_fefo_allocation_v1(p_product_id uuid,p_quantity numeric,p_delivery_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  requested numeric(14,3):=coalesce(p_quantity,0);
  remaining numeric(14,3);
  alloc numeric(14,3);
  total_available numeric(14,3):=0;
  required_expiry date;
  l record;
  allocations jsonb:='[]'::jsonb;
begin
  if requested<=0 then return jsonb_build_object('ok',false,'reason','invalid_quantity','side_effect_performed',false); end if;
  if not exists(select 1 from public.products where id=p_product_id) then return jsonb_build_object('ok',false,'reason','product_not_found','side_effect_performed',false); end if;
  select * into cfg from public.commercial_runtime_config where id=1;
  required_expiry:=coalesce(p_delivery_date,current_date)+coalesce(cfg.minimum_delivery_shelf_life_days,1);
  remaining:=requested;

  select coalesce(sum(greatest(quantity_on_hand-quantity_reserved,0)),0)::numeric(14,3)
    into total_available
  from public.inventory_lots
  where product_id=p_product_id and status='available' and physically_verified=true
    and quantity_on_hand>quantity_reserved and (expires_at is null or expires_at>=required_expiry);

  for l in
    select id,lot_code,expires_at,unit_cost,greatest(quantity_on_hand-quantity_reserved,0)::numeric(14,3) available
    from public.inventory_lots
    where product_id=p_product_id and status='available' and physically_verified=true
      and quantity_on_hand>quantity_reserved and (expires_at is null or expires_at>=required_expiry)
    order by expires_at asc nulls last,received_at asc nulls last,id
  loop
    exit when remaining<=0;
    alloc:=least(remaining,l.available);
    if alloc>0 then
      allocations:=allocations||jsonb_build_array(jsonb_build_object(
        'lot_id',l.id,'lot_code',l.lot_code,'expires_at',l.expires_at,'quantity',alloc,'unit_cost',l.unit_cost
      ));
      remaining:=remaining-alloc;
    end if;
  end loop;

  return jsonb_build_object(
    'ok',true,'product_id',p_product_id,'requested_quantity',requested,'available_quantity',total_available,
    'allocated_quantity',requested-greatest(remaining,0),'remaining_quantity',greatest(remaining,0),
    'sufficient',remaining<=0,'allocations',allocations,'delivery_date',coalesce(p_delivery_date,current_date),
    'required_expiry_on_or_after',required_expiry,'strategy','FEFO','side_effect_performed',false
  );
end;
$$;

create or replace function public.reserve_inventory_lots_fefo_v1(
  p_order_id uuid,p_product_id uuid,p_quantity numeric,p_reservation_key text,p_delivery_date date default current_date,p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  key text:=nullif(trim(coalesce(p_reservation_key,'')),'');
  preview jsonb;
  item jsonb;
  lot public.inventory_lots%rowtype;
  qty numeric(14,3);
  r_id uuid;
  reservations jsonb:='[]'::jsonb;
  existing_count integer;
begin
  if key is null or length(key)>160 then return jsonb_build_object('ok',false,'reason','invalid_reservation_key','side_effect_performed',false); end if;
  select count(*) into existing_count from public.inventory_lot_reservations where reservation_key=key;
  if existing_count>0 then
    return jsonb_build_object('ok',true,'replay',true,'reservation_key',key,'reservation_count',existing_count,'side_effect_performed',false);
  end if;
  select * into cfg from public.commercial_runtime_config where id=1;
  if not cfg.enabled or not cfg.lot_reservations_enabled or not cfg.fefo_enabled or cfg.execution_mode not in ('homologation','canary','live') then
    return jsonb_build_object('ok',false,'reason','fefo_reservations_disabled','side_effect_performed',false);
  end if;
  if p_order_id is not null and not exists(select 1 from public.orders where id=p_order_id) then return jsonb_build_object('ok',false,'reason','order_not_found','side_effect_performed',false); end if;
  preview:=public.preview_fefo_allocation_v1(p_product_id,p_quantity,p_delivery_date);
  if not coalesce((preview->>'sufficient')::boolean,false) then return preview||jsonb_build_object('ok',false,'reason','insufficient_fefo_stock'); end if;

  for item in select value from jsonb_array_elements(preview->'allocations')
  loop
    qty:=(item->>'quantity')::numeric;
    select * into lot from public.inventory_lots where id=(item->>'lot_id')::uuid for update;
    if not found or lot.status<>'available' or not lot.physically_verified or lot.quantity_on_hand-lot.quantity_reserved<qty then
      raise exception 'fefo_allocation_race';
    end if;
    update public.inventory_lots set quantity_reserved=quantity_reserved+qty,updated_at=now() where id=lot.id;
    insert into public.inventory_lot_reservations(order_id,product_id,lot_id,quantity,status,reservation_key,idempotency_key,delivery_date,metadata)
    values(p_order_id,p_product_id,lot.id,qty,'reserved',key,key||':'||lot.id::text,p_delivery_date,jsonb_build_object('strategy','FEFO')) returning id into r_id;
    insert into public.inventory_lot_movements(lot_id,product_id,movement_type,quantity,idempotency_key,reference_type,reference_id,before_quantity,after_quantity,actor_type,actor_id,metadata)
    values(lot.id,p_product_id,'reserve',qty,'reserve:'||r_id::text,'lot_reservation',r_id,lot.quantity_reserved,lot.quantity_reserved+qty,'order',p_actor_id,jsonb_build_object('reservation_key',key));
    reservations:=reservations||jsonb_build_array(jsonb_build_object('reservation_id',r_id,'lot_id',lot.id,'quantity',qty));
  end loop;
  return jsonb_build_object('ok',true,'replay',false,'reservation_key',key,'reservations',reservations,'side_effect_performed',true);
end;
$$;

create or replace function public.release_inventory_lot_reservation_v1(p_reservation_id uuid,p_reason text default 'release',p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare r public.inventory_lot_reservations%rowtype; l public.inventory_lots%rowtype;
begin
  select * into r from public.inventory_lot_reservations where id=p_reservation_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','reservation_not_found','side_effect_performed',false); end if;
  if r.status in ('released','cancelled','expired') then return jsonb_build_object('ok',true,'replay',true,'status',r.status,'side_effect_performed',false); end if;
  if r.status='consumed' then return jsonb_build_object('ok',false,'reason','reservation_already_consumed','side_effect_performed',false); end if;
  select * into l from public.inventory_lots where id=r.lot_id for update;
  update public.inventory_lots set quantity_reserved=greatest(quantity_reserved-r.quantity,0),updated_at=now() where id=l.id;
  update public.inventory_lot_reservations set status='released',updated_at=now(),metadata=metadata||jsonb_build_object('release_reason',coalesce(nullif(trim(p_reason),''),'release')) where id=r.id;
  insert into public.inventory_lot_movements(lot_id,product_id,movement_type,quantity,idempotency_key,reference_type,reference_id,before_quantity,after_quantity,actor_type,actor_id,metadata)
  values(l.id,r.product_id,'release',r.quantity,'release:'||r.id::text,'lot_reservation',r.id,l.quantity_reserved,greatest(l.quantity_reserved-r.quantity,0),'system',p_actor_id,jsonb_build_object('reason',p_reason))
  on conflict(idempotency_key) do nothing;
  return jsonb_build_object('ok',true,'reservation_id',r.id,'status','released','side_effect_performed',true);
end;
$$;

create or replace function public.consume_inventory_lot_reservation_v1(p_reservation_id uuid,p_actor_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare cfg public.commercial_runtime_config%rowtype; r public.inventory_lot_reservations%rowtype; l public.inventory_lots%rowtype;
begin
  select * into cfg from public.commercial_runtime_config where id=1;
  if not cfg.enabled or not cfg.lot_truth_enabled or cfg.execution_mode not in ('homologation','canary','live') then return jsonb_build_object('ok',false,'reason','lot_consumption_disabled','side_effect_performed',false); end if;
  select * into r from public.inventory_lot_reservations where id=p_reservation_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','reservation_not_found','side_effect_performed',false); end if;
  if r.status='consumed' then return jsonb_build_object('ok',true,'replay',true,'side_effect_performed',false); end if;
  if r.status<>'reserved' then return jsonb_build_object('ok',false,'reason','reservation_not_consumable','status',r.status,'side_effect_performed',false); end if;
  select * into l from public.inventory_lots where id=r.lot_id for update;
  if l.quantity_on_hand<r.quantity or l.quantity_reserved<r.quantity then raise exception 'lot_balance_inconsistent'; end if;
  update public.inventory_lots set quantity_on_hand=quantity_on_hand-r.quantity,quantity_reserved=quantity_reserved-r.quantity,status=case when quantity_on_hand-r.quantity<=0 then 'depleted' else status end,updated_at=now() where id=l.id;
  update public.inventory_lot_reservations set status='consumed',updated_at=now() where id=r.id;
  insert into public.inventory_lot_movements(lot_id,product_id,movement_type,quantity,idempotency_key,reference_type,reference_id,before_quantity,after_quantity,actor_type,actor_id)
  values(l.id,r.product_id,'consume',r.quantity,'consume:'||r.id::text,'lot_reservation',r.id,l.quantity_on_hand,l.quantity_on_hand-r.quantity,'order',p_actor_id)
  on conflict(idempotency_key) do nothing;
  return jsonb_build_object('ok',true,'reservation_id',r.id,'status','consumed','side_effect_performed',true);
end;
$$;

create or replace function public.margin_guard_v1(
  p_product_id uuid,p_sale_price numeric,p_quantity numeric default 1,p_context text default 'sale'
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  p public.products%rowtype;
  pol public.commercial_margin_policies%rowtype;
  qty numeric:=coalesce(p_quantity,0);
  sale numeric:=coalesce(p_sale_price,0);
  regular numeric;
  effective_cost numeric;
  margin_brl numeric;
  margin_percent numeric;
  discount_percent numeric;
  min_margin_percent numeric;
  min_margin_brl numeric;
  max_discount_percent numeric;
  budget_available numeric;
  markdown_cost numeric;
  promo_context boolean;
  allowed boolean;
  reason text:=null;
begin
  if qty<=0 or sale<=0 then return jsonb_build_object('ok',false,'allowed',false,'reason','invalid_sale_input','side_effect_performed',false); end if;
  select * into cfg from public.commercial_runtime_config where id=1;
  select * into p from public.products where id=p_product_id;
  if not found then return jsonb_build_object('ok',false,'allowed',false,'reason','product_not_found','side_effect_performed',false); end if;
  regular:=coalesce(p.price,sale);
  select greatest(coalesce(p.cost,0),coalesce(max(l.unit_cost),0)) into effective_cost
  from public.inventory_lots l
  where l.product_id=p.id and l.status='available' and l.quantity_on_hand>l.quantity_reserved and (l.expires_at is null or l.expires_at>=current_date);
  if effective_cost=0 then effective_cost:=p.cost; end if;

  select * into pol
  from public.commercial_margin_policies x
  where x.status='active'
    and (x.effective_from is null or x.effective_from<=now()) and (x.effective_until is null or x.effective_until>=now())
    and ((x.scope='product' and x.product_id=p.id) or (x.scope='category' and x.category=p.category) or x.scope='global')
  order by case x.scope when 'product' then 3 when 'category' then 2 else 1 end desc,x.priority desc,x.version desc
  limit 1;

  min_margin_percent:=coalesce(pol.min_margin_percent,cfg.default_min_margin_percent);
  min_margin_brl:=coalesce(pol.min_margin_brl,cfg.default_min_margin_brl);
  max_discount_percent:=coalesce(pol.max_discount_percent,cfg.default_max_discount_percent);
  margin_brl:=(sale-coalesce(effective_cost,0))*qty;
  margin_percent:=case when sale>0 and effective_cost is not null then round(((sale-effective_cost)/sale)*100,4) else null end;
  discount_percent:=case when regular>0 and sale<regular then round(((regular-sale)/regular)*100,4) else 0 end;
  markdown_cost:=greatest(regular-sale,0)*qty;
  budget_available:=greatest(cfg.promotion_budget_brl-cfg.promotion_budget_spent_brl,0);
  promo_context:=lower(coalesce(p_context,'sale')) in ('promotion','expiry','coupon','benefit','birthday','recompra','gift','ads');

  if effective_cost is null then reason:='cost_unknown';
  elsif sale<effective_cost then reason:='below_cost';
  elsif margin_brl<min_margin_brl*qty then reason:='min_margin_brl_not_met';
  elsif margin_percent<min_margin_percent then reason:='min_margin_percent_not_met';
  elsif discount_percent>max_discount_percent then reason:='max_discount_exceeded';
  elsif promo_context and markdown_cost>budget_available then reason:='promotion_budget_exhausted';
  end if;
  allowed:=reason is null;
  return jsonb_build_object(
    'ok',true,'allowed',allowed,'reason',reason,'product_id',p.id,'context',lower(coalesce(p_context,'sale')),
    'regular_price',regular,'sale_price',sale,'quantity',qty,'effective_unit_cost',effective_cost,
    'margin_brl',round(coalesce(margin_brl,0),2),'margin_percent',margin_percent,'discount_percent',discount_percent,
    'min_margin_brl',min_margin_brl,'min_margin_percent',min_margin_percent,'max_discount_percent',max_discount_percent,
    'promotion_budget_available_brl',budget_available,'estimated_markdown_brl',round(markdown_cost,2),
    'policy_id',pol.id,'margin_guard_enforced',cfg.margin_guard_enforced,'side_effect_performed',false
  );
end;
$$;

create or replace function public.preview_expiry_offer_v2(p_product_id uuid,p_delivery_date date default current_date,p_today date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  cfg public.commercial_runtime_config%rowtype;
  p public.products%rowtype;
  ls public.product_lot_stock_v1%rowtype;
  exp date;
  days integer;
  rule public.expiry_discount_rules%rowtype;
  proposed numeric;
  guard jsonb;
  eligibility jsonb;
begin
  select * into cfg from public.commercial_runtime_config where id=1;
  select * into p from public.products where id=p_product_id;
  if not found then return jsonb_build_object('ok',false,'eligible',false,'reason','product_not_found','side_effect_performed',false); end if;
  eligibility:=public.commercial_product_eligibility_v1(p_product_id,p_delivery_date);
  if not coalesce((eligibility->>'eligible')::boolean,false) then return eligibility||jsonb_build_object('offer_candidate',false); end if;
  if not cfg.expiry_discount_enabled then return jsonb_build_object('ok',true,'offer_candidate',false,'reason','expiry_discount_disabled','product_id',p.id,'side_effect_performed',false); end if;
  select * into ls from public.product_lot_stock_v1 where product_id=p.id;
  exp:=case when cfg.lot_truth_enabled and coalesce(ls.lot_count,0)>0 then ls.earliest_sellable_expiry else p.validity_date end;
  if exp is null then return jsonb_build_object('ok',true,'offer_candidate',false,'reason','expiry_unknown','product_id',p.id,'side_effect_performed',false); end if;
  days:=exp-coalesce(p_today,current_date);
  if days<0 then return jsonb_build_object('ok',true,'offer_candidate',false,'reason','expired','product_id',p.id,'days_remaining',days,'side_effect_performed',false); end if;
  select * into rule from public.expiry_discount_rules
  where status='active' and days between min_days_remaining and max_days_remaining
  order by version desc,min_days_remaining asc limit 1;
  if not found then return jsonb_build_object('ok',true,'offer_candidate',false,'reason','no_active_expiry_rule','product_id',p.id,'days_remaining',days,'side_effect_performed',false); end if;
  if p.price is null or p.price<=0 then return jsonb_build_object('ok',true,'offer_candidate',false,'reason','price_unavailable','product_id',p.id,'side_effect_performed',false); end if;
  proposed:=round(p.price*(1-rule.discount_percent/100),2);
  guard:=public.margin_guard_v1(p.id,proposed,1,'expiry');
  return jsonb_build_object(
    'ok',true,'offer_candidate',coalesce((guard->>'allowed')::boolean,false),'product_id',p.id,'expires_at',exp,'days_remaining',days,
    'discount_percent',rule.discount_percent,'regular_price',p.price,'proposed_price',proposed,'rule_id',rule.id,'rule_version',rule.version,
    'margin_guard',guard,'reason',case when coalesce((guard->>'allowed')::boolean,false) then null else guard->>'reason' end,
    'side_effect_performed',false
  );
end;
$$;

revoke all on function public.commercial_product_eligibility_v1(uuid,date) from public,anon,authenticated;
revoke all on function public.preview_fefo_allocation_v1(uuid,numeric,date) from public,anon,authenticated;
revoke all on function public.reserve_inventory_lots_fefo_v1(uuid,uuid,numeric,text,date,uuid) from public,anon,authenticated;
revoke all on function public.release_inventory_lot_reservation_v1(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.consume_inventory_lot_reservation_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.margin_guard_v1(uuid,numeric,numeric,text) from public,anon,authenticated;
revoke all on function public.preview_expiry_offer_v2(uuid,date,date) from public,anon,authenticated;
grant execute on function public.commercial_product_eligibility_v1(uuid,date) to service_role;
grant execute on function public.preview_fefo_allocation_v1(uuid,numeric,date) to service_role;
grant execute on function public.reserve_inventory_lots_fefo_v1(uuid,uuid,numeric,text,date,uuid) to service_role;
grant execute on function public.release_inventory_lot_reservation_v1(uuid,text,uuid) to service_role;
grant execute on function public.consume_inventory_lot_reservation_v1(uuid,uuid) to service_role;
grant execute on function public.margin_guard_v1(uuid,numeric,numeric,text) to service_role;
grant execute on function public.preview_expiry_offer_v2(uuid,date,date) to service_role;

commit;
