begin;

alter table public.automation_config
  add column if not exists bling_order_sync_enabled boolean not null default false,
  add column if not exists bling_order_homologation_only boolean not null default true,
  add column if not exists bling_order_max_per_run smallint not null default 1;

alter table public.automation_config drop constraint if exists automation_config_bling_order_max_per_run_check;
alter table public.automation_config add constraint automation_config_bling_order_max_per_run_check check (bling_order_max_per_run between 1 and 10);

alter table public.orders
  add column if not exists idempotency_key text,
  add column if not exists delivered_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists returned_at timestamptz,
  add column if not exists external_status_updated_at timestamptz;

create unique index if not exists orders_idempotency_key_uq on public.orders(idempotency_key) where idempotency_key is not null;
create unique index if not exists orders_cart_id_uq on public.orders(cart_id) where cart_id is not null;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status = any(array['confirmed','sent_to_bling','processing','ready','out_for_delivery','delivered','cancelled','returned']::text[]));

create table if not exists public.bling_order_homologation_allowlist (
  order_id uuid primary key references public.orders(id) on delete cascade,
  enabled boolean not null default true,
  expires_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.bling_order_homologation_allowlist enable row level security;
revoke all on table public.bling_order_homologation_allowlist from public, anon, authenticated;
grant select,insert,update,delete on table public.bling_order_homologation_allowlist to service_role;

create table if not exists public.order_status_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  source text not null,
  external_status text,
  event_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists order_status_events_event_key_uq on public.order_status_events(event_key) where event_key is not null;
create index if not exists order_status_events_order_created_idx on public.order_status_events(order_id, created_at desc);
alter table public.order_status_events enable row level security;
revoke all on table public.order_status_events from public, anon, authenticated;
grant select,insert on table public.order_status_events to service_role;

create or replace function public.confirm_cart_order_v2(
  p_cart_id uuid,
  p_delivery_address jsonb default '{}'::jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_cart public.carts%rowtype;
  v_conv public.conversations%rowtype;
  v_customer public.customers%rowtype;
  v_order public.orders%rowtype;
  v_key text;
begin
  if p_cart_id is null then raise exception 'cart_id_required'; end if;
  v_key := nullif(left(btrim(coalesce(p_idempotency_key,'')),160),'');

  select * into v_order from public.orders where cart_id=p_cart_id limit 1;
  if found then
    if v_key is not null and v_order.idempotency_key is not null and v_order.idempotency_key<>v_key then raise exception 'idempotency_key_conflict'; end if;
    return jsonb_build_object('order_id',v_order.id,'cart_id',v_order.cart_id,'total',v_order.total,'fiscal_subtotal',v_order.fiscal_subtotal,'other_expenses',v_order.other_expenses,'discount',v_order.discount,'status',v_order.status,'idempotent_replay',true);
  end if;

  if v_key is not null then
    select * into v_order from public.orders where idempotency_key=v_key limit 1;
    if found then
      if v_order.cart_id is distinct from p_cart_id then raise exception 'idempotency_key_conflict'; end if;
      return jsonb_build_object('order_id',v_order.id,'cart_id',v_order.cart_id,'total',v_order.total,'fiscal_subtotal',v_order.fiscal_subtotal,'other_expenses',v_order.other_expenses,'discount',v_order.discount,'status',v_order.status,'idempotent_replay',true);
    end if;
  end if;

  perform public.recalculate_cart(p_cart_id);
  select * into v_cart from public.carts where id=p_cart_id for update;
  if not found or v_cart.status<>'draft' then raise exception 'cart_not_confirmable'; end if;
  if v_cart.pricing_status<>'ready' then raise exception 'pricing_not_ready'; end if;
  select * into v_conv from public.conversations where id=v_cart.conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  if v_cart.customer_id is not null then select * into v_customer from public.customers where id=v_cart.customer_id; end if;

  insert into public.orders(customer_id,conversation_id,whatsapp_account_id,cart_id,basket_id,status,total,fiscal_subtotal,other_expenses,discount,delivery_address,customer_snapshot,confirmed_at,idempotency_key)
  values(v_cart.customer_id,v_cart.conversation_id,v_conv.whatsapp_account_id,v_cart.id,v_cart.basket_id,'confirmed',v_cart.total,v_cart.fiscal_subtotal,v_cart.other_expenses,v_cart.discount,coalesce(p_delivery_address,'{}'::jsonb),case when v_cart.customer_id is null then '{}'::jsonb else jsonb_build_object('id',v_customer.id,'name',v_customer.name,'phone',v_customer.primary_whatsapp_e164,'cpf_cnpj',v_customer.cpf_cnpj,'bling_contact_id',v_customer.bling_contact_id) end,now(),v_key)
  returning * into v_order;

  insert into public.order_items(order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price,line_total,metadata)
  select v_order.id,p.id,p.sku,p.name,ci.quantity,coalesce(p.price,ci.unit_price,0),ci.quantity*coalesce(p.price,ci.unit_price,0),ci.metadata || jsonb_build_object('source',ci.source,'commercial_delta',ci.commercial_delta)
  from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=p_cart_id and ci.quantity>0;

  update public.carts set status='converted',updated_at=now() where id=p_cart_id;
  update public.conversations set stage='confirmation',status='waiting_customer',updated_at=now() where id=v_cart.conversation_id;
  insert into public.order_status_events(order_id,from_status,to_status,source,event_key,metadata) values(v_order.id,null,'confirmed','checkout','order-confirmed:'||v_order.id,jsonb_build_object('cart_id',p_cart_id));

  return jsonb_build_object('order_id',v_order.id,'cart_id',p_cart_id,'total',v_order.total,'fiscal_subtotal',v_order.fiscal_subtotal,'other_expenses',v_order.other_expenses,'discount',v_order.discount,'status','confirmed','idempotent_replay',false);
exception when unique_violation then
  select * into v_order from public.orders where cart_id=p_cart_id or (v_key is not null and idempotency_key=v_key) order by created_at limit 1;
  if found then return jsonb_build_object('order_id',v_order.id,'cart_id',v_order.cart_id,'total',v_order.total,'fiscal_subtotal',v_order.fiscal_subtotal,'other_expenses',v_order.other_expenses,'discount',v_order.discount,'status',v_order.status,'idempotent_replay',true); end if;
  raise;
end;
$$;

revoke all on function public.confirm_cart_order_v2(uuid,jsonb,text) from public, anon, authenticated;
grant execute on function public.confirm_cart_order_v2(uuid,jsonb,text) to service_role;

create or replace function public.queue_bling_order_homologation_v1(p_order_id uuid,p_external_key text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare c public.automation_config%rowtype; o public.orders%rowtype; j public.order_sync_jobs%rowtype; k text;
begin
  select * into c from public.automation_config where id=1;
  if not found or not c.bling_order_sync_enabled then raise exception 'bling_order_sync_disabled'; end if;
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.status<>'confirmed' or o.bling_order_id is not null then raise exception 'order_not_eligible_for_bling'; end if;
  if c.bling_order_homologation_only and not exists(select 1 from public.bling_order_homologation_allowlist a where a.order_id=o.id and a.enabled and (a.expires_at is null or a.expires_at>now())) then raise exception 'order_not_allowlisted_for_bling'; end if;
  k:=coalesce(nullif(btrim(p_external_key),''),'DA-'||replace(o.id::text,'-',''));
  select * into j from public.order_sync_jobs where order_id=o.id;
  if found then return jsonb_build_object('job_id',j.id,'order_id',o.id,'status',j.status,'external_key',j.external_key,'idempotent_replay',true); end if;
  insert into public.order_sync_jobs(order_id,status,attempts,max_attempts,next_attempt_at,external_key) values(o.id,'pending',0,3,now(),left(k,180)) returning * into j;
  update public.orders set sync_status='pending_bling',sync_error=null,updated_at=now() where id=o.id;
  return jsonb_build_object('job_id',j.id,'order_id',o.id,'status',j.status,'external_key',j.external_key,'idempotent_replay',false);
end;
$$;
revoke all on function public.queue_bling_order_homologation_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.queue_bling_order_homologation_v1(uuid,text) to service_role;

create or replace function public.claim_order_sync_jobs(p_worker text,p_limit integer default 10)
returns setof public.order_sync_jobs language plpgsql security definer set search_path=''
as $$
declare c public.automation_config%rowtype; lim integer;
begin
  select * into c from public.automation_config where id=1;
  if not found or not c.bling_order_sync_enabled then return; end if;
  lim:=greatest(1,least(coalesce(p_limit,10),coalesce(c.bling_order_max_per_run,1),10));
  return query
  with picked as (
    select j.id from public.order_sync_jobs j join public.orders o on o.id=j.order_id
    where j.status in ('pending','error') and j.next_attempt_at<=now() and j.attempts<j.max_attempts
      and (not c.bling_order_homologation_only or exists(select 1 from public.bling_order_homologation_allowlist a where a.order_id=o.id and a.enabled and (a.expires_at is null or a.expires_at>now())))
    order by j.created_at for update of j skip locked limit lim
  ), upd as (
    update public.order_sync_jobs j set status='processing',worker_id=left(coalesce(p_worker,'unknown'),120),locked_at=now(),attempts=j.attempts+1,updated_at=now() from picked where j.id=picked.id returning j.*
  ) select * from upd;
end;
$$;
revoke all on function public.claim_order_sync_jobs(text,integer) from public, anon, authenticated;
grant execute on function public.claim_order_sync_jobs(text,integer) to service_role;

create or replace function public.update_order_status_v1(p_order_id uuid,p_to_status text,p_source text,p_external_status text default null,p_event_key text default null,p_metadata jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare o public.orders%rowtype; f text; t text:=lower(btrim(coalesce(p_to_status,'')));
begin
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  f:=o.status;
  if t=f then return jsonb_build_object('order_id',o.id,'status',o.status,'idempotent_replay',true); end if;
  if not ((f='confirmed' and t in ('sent_to_bling','cancelled')) or (f='sent_to_bling' and t in ('processing','ready','cancelled')) or (f='processing' and t in ('ready','cancelled')) or (f='ready' and t in ('out_for_delivery','cancelled')) or (f='out_for_delivery' and t in ('delivered','cancelled')) or (f='delivered' and t='returned')) then raise exception 'invalid_order_status_transition:%->%',f,t; end if;
  if p_event_key is not null and exists(select 1 from public.order_status_events where event_key=p_event_key) then return jsonb_build_object('order_id',o.id,'status',o.status,'idempotent_replay',true); end if;
  update public.orders set status=t,delivered_at=case when t='delivered' then coalesce(delivered_at,now()) else delivered_at end,cancelled_at=case when t='cancelled' then coalesce(cancelled_at,now()) else cancelled_at end,returned_at=case when t='returned' then coalesce(returned_at,now()) else returned_at end,external_status_updated_at=case when p_external_status is not null then now() else external_status_updated_at end,updated_at=now() where id=o.id;
  insert into public.order_status_events(order_id,from_status,to_status,source,external_status,event_key,metadata) values(o.id,f,t,left(coalesce(nullif(btrim(p_source),''),'backend'),80),left(p_external_status,160),nullif(left(btrim(coalesce(p_event_key,'')),180),''),coalesce(p_metadata,'{}'::jsonb));
  return jsonb_build_object('order_id',o.id,'from_status',f,'status',t,'idempotent_replay',false);
end;
$$;
revoke all on function public.update_order_status_v1(uuid,text,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.update_order_status_v1(uuid,text,text,text,text,jsonb) to service_role;

commit;
