-- Motor comercial das cestas.
-- O total comercial não é a soma dos itens. A diferença positiva vira Outras despesas no Bling;
-- diferença negativa vira desconto. Alterações da composição exigem deltas configurados por item.

alter table public.basket_template_items
  add column if not exists remove_unit_delta numeric,
  add column if not exists add_unit_delta numeric;

alter table public.cart_items
  add column if not exists base_quantity numeric,
  add column if not exists commercial_delta numeric not null default 0,
  add column if not exists commercial_unit_price numeric;

alter table public.carts
  add column if not exists base_commercial_price numeric not null default 0,
  add column if not exists fiscal_subtotal numeric not null default 0,
  add column if not exists other_expenses numeric not null default 0,
  add column if not exists discount numeric not null default 0,
  add column if not exists pricing_status text not null default 'ready' check (pricing_status in ('ready','needs_review')),
  add column if not exists pricing_issues jsonb not null default '[]'::jsonb;

alter table public.orders
  add column if not exists cart_id uuid references public.carts(id) on delete set null,
  add column if not exists basket_id uuid references public.basket_templates(id) on delete set null,
  add column if not exists fiscal_subtotal numeric not null default 0,
  add column if not exists other_expenses numeric not null default 0,
  add column if not exists discount numeric not null default 0;

create unique index if not exists carts_one_draft_per_conversation_uidx
  on public.carts(conversation_id) where status='draft';
create index if not exists orders_cart_idx on public.orders(cart_id) where cart_id is not null;
create index if not exists orders_basket_idx on public.orders(basket_id) where basket_id is not null;

create or replace function public.recalculate_cart(p_cart_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart public.carts%rowtype;
  v_fiscal numeric := 0;
  v_template_delta numeric := 0;
  v_addons numeric := 0;
  v_total numeric := 0;
  v_adjustment numeric := 0;
  v_other numeric := 0;
  v_discount numeric := 0;
begin
  select * into v_cart from public.carts where id=p_cart_id for update;
  if not found then raise exception 'cart_not_found'; end if;

  select coalesce(sum(ci.quantity * coalesce(p.price,ci.unit_price,0)),0),
         coalesce(sum(case when ci.source in ('basket','substitution') then ci.commercial_delta else 0 end),0),
         coalesce(sum(case when ci.source='addon' then ci.quantity * coalesce(ci.commercial_unit_price,p.price,ci.unit_price,0) else 0 end),0)
    into v_fiscal,v_template_delta,v_addons
  from public.cart_items ci
  join public.products p on p.id=ci.product_id
  where ci.cart_id=p_cart_id;

  update public.cart_items ci
     set unit_price=coalesce(p.price,ci.unit_price,0),
         line_total=ci.quantity*coalesce(p.price,ci.unit_price,0),
         updated_at=now()
    from public.products p
   where ci.cart_id=p_cart_id and p.id=ci.product_id;

  v_total := greatest(0,coalesce(v_cart.base_commercial_price,0)+v_template_delta+v_addons);
  v_adjustment := v_total-v_fiscal;
  v_other := greatest(v_adjustment,0);
  v_discount := greatest(-v_adjustment,0);

  update public.carts
     set subtotal=v_fiscal,
         fiscal_subtotal=v_fiscal,
         adjustments=v_adjustment,
         total=v_total,
         other_expenses=v_other,
         discount=v_discount,
         pricing_status='ready',
         pricing_issues='[]'::jsonb,
         version=version+1,
         updated_at=now()
   where id=p_cart_id;

  return jsonb_build_object('cart_id',p_cart_id,'fiscal_subtotal',v_fiscal,'commercial_total',v_total,'adjustment',v_adjustment,'other_expenses',v_other,'discount',v_discount,'pricing_status','ready');
end;
$$;

create or replace function public.start_basket_cart(p_conversation_id uuid,p_basket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_id uuid;
  v_price numeric;
  v_cart_id uuid;
  v_result jsonb;
begin
  select customer_id into v_customer_id from public.conversations where id=p_conversation_id and status<>'closed';
  if not found then raise exception 'conversation_not_found'; end if;
  select base_price into v_price from public.basket_templates where id=p_basket_id and is_active=true and is_whatsapp_active=true;
  if not found then raise exception 'basket_not_available'; end if;
  if exists(select 1 from public.basket_template_items bi join public.products p on p.id=bi.product_id where bi.basket_id=p_basket_id and (p.physically_verified=false or p.is_active=false)) then raise exception 'basket_has_unavailable_product'; end if;

  update public.carts set status='cancelled',updated_at=now() where conversation_id=p_conversation_id and status='draft';
  insert into public.carts(conversation_id,customer_id,basket_id,status,base_commercial_price,total,expires_at)
  values(p_conversation_id,v_customer_id,p_basket_id,'draft',v_price,v_price,now()+interval '24 hours') returning id into v_cart_id;

  insert into public.cart_items(cart_id,product_id,source,quantity,base_quantity,unit_price,line_total,commercial_delta,metadata)
  select v_cart_id,bi.product_id,'basket',bi.quantity,bi.quantity,coalesce(p.price,0),bi.quantity*coalesce(p.price,0),0,
         jsonb_build_object('basket_template_item_id',bi.id,'remove_unit_delta',bi.remove_unit_delta,'add_unit_delta',bi.add_unit_delta,'removable',bi.removable,'quantity_editable',bi.quantity_editable,'min_quantity',bi.min_quantity,'max_quantity',bi.max_quantity,'substitution_group',bi.substitution_group)
  from public.basket_template_items bi join public.products p on p.id=bi.product_id where bi.basket_id=p_basket_id order by bi.sort_order,bi.created_at;

  v_result:=public.recalculate_cart(v_cart_id);
  update public.conversations set stage='customizing',updated_at=now() where id=p_conversation_id;
  return v_result || jsonb_build_object('basket_id',p_basket_id);
end;
$$;

create or replace function public.set_basket_cart_item_quantity(p_cart_id uuid,p_product_id uuid,p_quantity numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.cart_items%rowtype;
  v_template public.basket_template_items%rowtype;
  v_diff numeric;
  v_delta numeric := 0;
begin
  if p_quantity is null or p_quantity<0 then raise exception 'invalid_quantity'; end if;
  select * into v_item from public.cart_items where cart_id=p_cart_id and product_id=p_product_id and source in ('basket','substitution') for update;
  if not found then raise exception 'basket_item_not_found'; end if;
  select * into v_template from public.basket_template_items where id=nullif(v_item.metadata->>'basket_template_item_id','')::uuid;
  if not found then raise exception 'basket_template_item_not_found'; end if;
  if p_quantity=0 and not v_template.removable then raise exception 'item_not_removable'; end if;
  if p_quantity<>v_template.quantity and not v_template.quantity_editable then raise exception 'quantity_not_editable'; end if;
  if p_quantity<v_template.min_quantity then raise exception 'below_min_quantity'; end if;
  if v_template.max_quantity is not null and p_quantity>v_template.max_quantity then raise exception 'above_max_quantity'; end if;

  v_diff:=p_quantity-v_template.quantity;
  if v_diff<0 then
    if v_template.remove_unit_delta is null then raise exception 'remove_pricing_not_configured'; end if;
    v_delta:=abs(v_diff)*v_template.remove_unit_delta;
  elsif v_diff>0 then
    if v_template.add_unit_delta is null then raise exception 'add_pricing_not_configured'; end if;
    v_delta:=v_diff*v_template.add_unit_delta;
  end if;

  update public.cart_items set quantity=p_quantity,commercial_delta=v_delta,updated_at=now() where id=v_item.id;
  return public.recalculate_cart(p_cart_id);
end;
$$;

create or replace function public.add_cart_addon(p_cart_id uuid,p_product_id uuid,p_quantity numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_price numeric;v_existing uuid;
begin
  if p_quantity is null or p_quantity<=0 then raise exception 'invalid_quantity'; end if;
  perform 1 from public.carts where id=p_cart_id and status='draft'; if not found then raise exception 'cart_not_editable'; end if;
  select price into v_price from public.products where id=p_product_id and physically_verified=true and is_active=true;
  if not found then raise exception 'product_not_available'; end if;
  select id into v_existing from public.cart_items where cart_id=p_cart_id and product_id=p_product_id and source='addon' limit 1;
  if v_existing is null then
    insert into public.cart_items(cart_id,product_id,source,quantity,unit_price,line_total,commercial_unit_price,metadata)
    values(p_cart_id,p_product_id,'addon',p_quantity,coalesce(v_price,0),p_quantity*coalesce(v_price,0),coalesce(v_price,0),jsonb_build_object('pricing_source','product_price'));
  else
    update public.cart_items set quantity=quantity+p_quantity,commercial_unit_price=coalesce(v_price,commercial_unit_price),updated_at=now() where id=v_existing;
  end if;
  return public.recalculate_cart(p_cart_id);
end;
$$;

create or replace function public.remove_cart_addon(p_cart_id uuid,p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.cart_items where cart_id=p_cart_id and product_id=p_product_id and source='addon';
  return public.recalculate_cart(p_cart_id);
end;
$$;

create or replace function public.confirm_cart_order(p_cart_id uuid,p_delivery_address jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart public.carts%rowtype;
  v_conv public.conversations%rowtype;
  v_customer public.customers%rowtype;
  v_order_id uuid;
begin
  perform public.recalculate_cart(p_cart_id);
  select * into v_cart from public.carts where id=p_cart_id for update;
  if not found or v_cart.status<>'draft' then raise exception 'cart_not_confirmable'; end if;
  if v_cart.pricing_status<>'ready' then raise exception 'pricing_not_ready'; end if;
  select * into v_conv from public.conversations where id=v_cart.conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  if v_cart.customer_id is not null then select * into v_customer from public.customers where id=v_cart.customer_id; end if;

  insert into public.orders(customer_id,conversation_id,whatsapp_account_id,cart_id,basket_id,status,total,fiscal_subtotal,other_expenses,discount,delivery_address,customer_snapshot,confirmed_at)
  values(v_cart.customer_id,v_cart.conversation_id,v_conv.whatsapp_account_id,v_cart.id,v_cart.basket_id,'confirmed',v_cart.total,v_cart.fiscal_subtotal,v_cart.other_expenses,v_cart.discount,coalesce(p_delivery_address,'{}'::jsonb),
         case when v_cart.customer_id is null then '{}'::jsonb else jsonb_build_object('id',v_customer.id,'name',v_customer.name,'phone',v_customer.primary_whatsapp_e164,'bling_contact_id',v_customer.bling_contact_id) end,now())
  returning id into v_order_id;

  insert into public.order_items(order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price,line_total,metadata)
  select v_order_id,p.id,p.sku,p.name,ci.quantity,coalesce(p.price,ci.unit_price,0),ci.quantity*coalesce(p.price,ci.unit_price,0),ci.metadata || jsonb_build_object('source',ci.source,'commercial_delta',ci.commercial_delta)
  from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=p_cart_id and ci.quantity>0;

  update public.carts set status='converted',updated_at=now() where id=p_cart_id;
  update public.conversations set stage='confirmation',status='waiting_customer',updated_at=now() where id=v_cart.conversation_id;
  return jsonb_build_object('order_id',v_order_id,'cart_id',p_cart_id,'total',v_cart.total,'fiscal_subtotal',v_cart.fiscal_subtotal,'other_expenses',v_cart.other_expenses,'discount',v_cart.discount,'status','confirmed');
end;
$$;

revoke all on function public.recalculate_cart(uuid) from public,anon,authenticated;
revoke all on function public.start_basket_cart(uuid,uuid) from public,anon,authenticated;
revoke all on function public.set_basket_cart_item_quantity(uuid,uuid,numeric) from public,anon,authenticated;
revoke all on function public.add_cart_addon(uuid,uuid,numeric) from public,anon,authenticated;
revoke all on function public.remove_cart_addon(uuid,uuid) from public,anon,authenticated;
revoke all on function public.confirm_cart_order(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.recalculate_cart(uuid) to service_role;
grant execute on function public.start_basket_cart(uuid,uuid) to service_role;
grant execute on function public.set_basket_cart_item_quantity(uuid,uuid,numeric) to service_role;
grant execute on function public.add_cart_addon(uuid,uuid,numeric) to service_role;
grant execute on function public.remove_cart_addon(uuid,uuid) to service_role;
grant execute on function public.confirm_cart_order(uuid,jsonb) to service_role;
