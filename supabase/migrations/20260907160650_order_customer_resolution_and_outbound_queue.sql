begin;

create table if not exists public.outbound_jobs(
  id uuid primary key default gen_random_uuid(),
  whatsapp_account_id uuid not null references public.whatsapp_accounts(id),
  customer_id uuid references public.customers(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  order_id uuid references public.orders(id) on delete cascade,
  job_type text not null check(job_type in ('order_confirmation','order_status','seller_message','template')),
  status text not null default 'pending' check(status in ('pending','processing','sent','error','cancelled')),
  recipient_e164 text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  provider_message_id text,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  not_before timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outbound_jobs_status_idx on public.outbound_jobs(status,not_before,created_at);
create index if not exists outbound_jobs_conversation_idx on public.outbound_jobs(conversation_id,created_at desc);
alter table public.outbound_jobs enable row level security;
revoke all on public.outbound_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.outbound_jobs to service_role;

create or replace function public.bind_bling_contact_id(p_customer_id uuid,p_bling_contact_id bigint)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if p_customer_id is null or p_bling_contact_id is null or p_bling_contact_id<=0 then raise exception 'invalid_bling_contact_binding'; end if;
  if exists(select 1 from public.customers where bling_contact_id=p_bling_contact_id and id<>p_customer_id) then raise exception 'bling_contact_already_bound'; end if;
  update public.customers set bling_contact_id=p_bling_contact_id,last_bling_sync_at=now(),updated_at=now() where id=p_customer_id;
  if not found then raise exception 'customer_not_found'; end if;
  return jsonb_build_object('customer_id',p_customer_id,'bling_contact_id',p_bling_contact_id);
end;
$$;

create or replace function public.confirm_cart_order(p_cart_id uuid,p_delivery_address jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_cart public.carts%rowtype;v_conv public.conversations%rowtype;v_customer public.customers%rowtype;v_order_id uuid;
begin
  perform public.recalculate_cart(p_cart_id);
  select * into v_cart from public.carts where id=p_cart_id for update;
  if not found or v_cart.status<>'draft' then raise exception 'cart_not_confirmable'; end if;
  if v_cart.pricing_status<>'ready' then raise exception 'pricing_not_ready'; end if;
  select * into v_conv from public.conversations where id=v_cart.conversation_id;if not found then raise exception 'conversation_not_found'; end if;
  if v_cart.customer_id is not null then select * into v_customer from public.customers where id=v_cart.customer_id; end if;
  insert into public.orders(customer_id,conversation_id,whatsapp_account_id,cart_id,basket_id,status,total,fiscal_subtotal,other_expenses,discount,delivery_address,customer_snapshot,confirmed_at)
  values(v_cart.customer_id,v_cart.conversation_id,v_conv.whatsapp_account_id,v_cart.id,v_cart.basket_id,'confirmed',v_cart.total,v_cart.fiscal_subtotal,v_cart.other_expenses,v_cart.discount,coalesce(p_delivery_address,'{}'::jsonb),case when v_cart.customer_id is null then '{}'::jsonb else jsonb_build_object('id',v_customer.id,'name',v_customer.name,'phone',v_customer.primary_whatsapp_e164,'cpf_cnpj',v_customer.cpf_cnpj,'bling_contact_id',v_customer.bling_contact_id) end,now()) returning id into v_order_id;
  insert into public.order_items(order_id,product_id,sku_snapshot,name_snapshot,quantity,unit_price,line_total,metadata)
  select v_order_id,p.id,p.sku,p.name,ci.quantity,coalesce(p.price,ci.unit_price,0),ci.quantity*coalesce(p.price,ci.unit_price,0),ci.metadata || jsonb_build_object('source',ci.source,'commercial_delta',ci.commercial_delta)
  from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=p_cart_id and ci.quantity>0;
  update public.carts set status='converted',updated_at=now() where id=p_cart_id;
  update public.conversations set stage='confirmation',status='waiting_customer',updated_at=now() where id=v_cart.conversation_id;
  return jsonb_build_object('order_id',v_order_id,'cart_id',p_cart_id,'total',v_cart.total,'fiscal_subtotal',v_cart.fiscal_subtotal,'other_expenses',v_cart.other_expenses,'discount',v_cart.discount,'status','confirmed');
end;
$$;

create or replace function public.build_bling_order_draft(p_order_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'order_id',o.id,'bling_order_id',o.bling_order_id,'status',o.status,
    'customer',o.customer_snapshot || jsonb_strip_nulls(jsonb_build_object('id',c.id,'name',c.name,'phone',c.primary_whatsapp_e164,'cpf_cnpj',c.cpf_cnpj,'bling_contact_id',c.bling_contact_id)),
    'delivery_address',o.delivery_address,
    'items',coalesce((select jsonb_agg(jsonb_build_object('product_id',oi.product_id,'bling_product_id',p.bling_product_id,'sku',oi.sku_snapshot,'name',oi.name_snapshot,'quantity',oi.quantity,'unit_price',oi.unit_price,'line_total',oi.line_total) order by oi.created_at) from public.order_items oi left join public.products p on p.id=oi.product_id where oi.order_id=o.id),'[]'::jsonb),
    'fiscal_subtotal',o.fiscal_subtotal,'other_expenses',o.other_expenses,'discount',o.discount,'total',o.total,'currency',o.currency)
  from public.orders o left join public.customers c on c.id=o.customer_id where o.id=p_order_id
$$;

create or replace function public.room_checkout_preview(p_public_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_session public.catalog_sessions%rowtype;v_cart public.carts%rowtype;v_customer public.customers%rowtype;v_items jsonb;v_addresses jsonb;v_basket jsonb;
begin
  select * into v_session from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now();if not found then raise exception 'room_unavailable'; end if;
  if v_session.cart_id is null then raise exception 'room_cart_unavailable'; end if;perform public.recalculate_cart(v_session.cart_id);
  select * into v_cart from public.carts where id=v_session.cart_id and status='draft';if not found then raise exception 'cart_not_editable'; end if;
  if v_session.customer_id is not null then select * into v_customer from public.customers where id=v_session.customer_id; end if;
  select coalesce(jsonb_agg(jsonb_build_object('product_id',p.id,'name',p.name,'image_url',p.image_url,'quantity',ci.quantity,'unit_price',case when ci.source='basket' then null else coalesce(p.price,ci.unit_price,0) end,'line_total',case when ci.source='basket' then null else ci.quantity*coalesce(p.price,ci.unit_price,0) end,'source',ci.source,'removable',coalesce((ci.metadata->>'removable')::boolean,true),'quantity_editable',coalesce((ci.metadata->>'quantity_editable')::boolean,true)) order by ci.created_at),'[]'::jsonb) into v_items from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=v_cart.id and ci.quantity>0;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'label',a.label,'street',a.street,'number',a.number,'complement',a.complement,'neighborhood',a.neighborhood,'city',a.city,'state',a.state,'postal_code',a.postal_code,'reference',a.reference,'is_default',a.is_default) order by a.is_default desc,a.updated_at desc),'[]'::jsonb) into v_addresses from public.customer_addresses a where a.customer_id=v_session.customer_id and a.is_active=true;
  select case when b.id is null then null else jsonb_build_object('id',b.id,'name',b.name,'image_url',b.image_url,'commercial_price',b.base_price) end into v_basket from public.basket_templates b where b.id=v_cart.basket_id;
  update public.catalog_sessions set checkout_started_at=coalesce(checkout_started_at,now()),last_activity_at=now(),current_view='checkout' where id=v_session.id;
  return jsonb_build_object('cart',jsonb_build_object('id',v_cart.id,'total',v_cart.total,'fiscal_subtotal',v_cart.fiscal_subtotal,'other_expenses',v_cart.other_expenses,'discount',v_cart.discount,'version',v_cart.version),'basket',v_basket,'items',v_items,'customer',case when v_session.customer_id is null then null else jsonb_build_object('id',v_customer.id,'name',v_customer.name,'phone',v_customer.primary_whatsapp_e164,'has_bling_contact',v_customer.bling_contact_id is not null,'has_document',nullif(regexp_replace(coalesce(v_customer.cpf_cnpj,''),'[^0-9]','','g'),'') is not null) end,'requires_identification',(v_session.customer_id is null or v_customer.name is null or v_customer.primary_whatsapp_e164 is null),'requires_document',(v_session.customer_id is null or (v_customer.bling_contact_id is null and nullif(regexp_replace(coalesce(v_customer.cpf_cnpj,''),'[^0-9]','','g'),'') is null)),'addresses',v_addresses);
end;
$$;

create or replace function public.room_confirm_order(p_public_token text,p_delivery_address jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_session public.catalog_sessions%rowtype;v_customer public.customers%rowtype;v_address jsonb;v_result jsonb;
begin
  select * into v_session from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now() for update;if not found then raise exception 'room_unavailable'; end if;
  if v_session.cart_id is null then raise exception 'room_cart_unavailable'; end if;if not exists(select 1 from public.cart_items where cart_id=v_session.cart_id and quantity>0) then raise exception 'empty_cart'; end if;if v_session.customer_id is null then raise exception 'customer_identification_required'; end if;
  select * into v_customer from public.customers where id=v_session.customer_id;if v_customer.name is null or v_customer.primary_whatsapp_e164 is null then raise exception 'customer_identification_required'; end if;
  if v_customer.bling_contact_id is null and nullif(regexp_replace(coalesce(v_customer.cpf_cnpj,''),'[^0-9]','','g'),'') is null then raise exception 'customer_document_required'; end if;
  v_address:=coalesce(p_delivery_address,'{}'::jsonb);if v_address='{}'::jsonb then select to_jsonb(a)-'customer_id'-'created_at'-'updated_at' into v_address from public.customer_addresses a where a.customer_id=v_session.customer_id and a.is_active=true order by a.is_default desc,a.updated_at desc limit 1;end if;
  if coalesce(v_address->>'street','')='' or coalesce(v_address->>'number','')='' or coalesce(v_address->>'city','')='' then raise exception 'delivery_address_required'; end if;
  v_result:=public.confirm_cart_order(v_session.cart_id,v_address);
  update public.catalog_sessions set status='closed',closed_at=now(),completed_at=now(),last_activity_at=now(),current_view='success' where id=v_session.id;
  insert into public.catalog_events(catalog_session_id,customer_id,event_type,event_data) values(v_session.id,v_session.customer_id,'catalog_checkout_return',jsonb_build_object('source','shopping_room','order_id',v_result->>'order_id'));
  insert into public.customer_behavior_events(customer_id,conversation_id,event_type,event_data) values(v_session.customer_id,v_session.conversation_id,'room_order_confirmed',jsonb_build_object('order_id',v_result->>'order_id'));
  update public.conversations set stage='order_confirmed',status='waiting_customer',updated_at=now() where id=v_session.conversation_id;
  return v_result||jsonb_build_object('delivery_address',v_address);
end;
$$;

create or replace function public.queue_order_outbound_job()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_phone text;v_name text;v_type text;v_key text;
begin
  if new.customer_id is null then return new; end if;select primary_whatsapp_e164,name into v_phone,v_name from public.customers where id=new.customer_id;if v_phone is null then return new; end if;
  if new.status='sent_to_bling' and new.bling_order_id is not null and (old.status is distinct from new.status or old.bling_order_id is distinct from new.bling_order_id) then
    v_type:='order_confirmation';v_key:='order_confirmation:'||new.id::text;
    insert into public.outbound_jobs(whatsapp_account_id,customer_id,conversation_id,order_id,job_type,recipient_e164,dedupe_key,payload) values(new.whatsapp_account_id,new.customer_id,new.conversation_id,new.id,v_type,v_phone,v_key,jsonb_build_object('customer_name',v_name,'order_id',new.id,'bling_order_id',new.bling_order_id,'total',new.total,'status',new.status,'delivery_address',new.delivery_address,'message_kind','order_confirmed')) on conflict(dedupe_key) do nothing;
  elsif new.status in ('ready','out_for_delivery','delivered') and old.status is distinct from new.status then
    v_type:='order_status';v_key:='order_status:'||new.id::text||':'||new.status;
    insert into public.outbound_jobs(whatsapp_account_id,customer_id,conversation_id,order_id,job_type,recipient_e164,dedupe_key,payload) values(new.whatsapp_account_id,new.customer_id,new.conversation_id,new.id,v_type,v_phone,v_key,jsonb_build_object('customer_name',v_name,'order_id',new.id,'bling_order_id',new.bling_order_id,'total',new.total,'status',new.status,'message_kind','order_status')) on conflict(dedupe_key) do nothing;
  end if;return new;
end;
$$;

drop trigger if exists trg_queue_order_outbound_job on public.orders;
create trigger trg_queue_order_outbound_job after update of status,bling_order_id on public.orders for each row execute function public.queue_order_outbound_job();

create or replace function public.claim_outbound_jobs(p_worker text,p_limit integer default 20)
returns setof public.outbound_jobs language plpgsql security definer set search_path=''
as $$
begin
  if not coalesce((select outbound_enabled from public.automation_config where id=1),false) then return; end if;
  return query with picked as (select id from public.outbound_jobs where status in ('pending','error') and not_before<=now() and attempts<max_attempts order by created_at for update skip locked limit greatest(1,least(coalesce(p_limit,20),100)))
  update public.outbound_jobs j set status='processing',locked_at=now(),locked_by=left(coalesce(p_worker,'worker'),120),attempts=attempts+1,updated_at=now() from picked where j.id=picked.id returning j.*;
end;
$$;

create or replace function public.finish_outbound_job(p_job_id uuid,p_success boolean,p_provider_message_id text default null,p_error text default null,p_retry_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v public.outbound_jobs%rowtype;
begin
  select * into v from public.outbound_jobs where id=p_job_id for update;if not found then raise exception 'outbound_job_not_found'; end if;
  if p_success then update public.outbound_jobs set status='sent',provider_message_id=nullif(trim(coalesce(p_provider_message_id,'')),''),last_error=null,sent_at=now(),locked_at=null,locked_by=null,updated_at=now() where id=p_job_id;
  else update public.outbound_jobs set status=case when attempts>=max_attempts then 'cancelled' else 'error' end,last_error=left(coalesce(p_error,'outbound_failed'),1800),not_before=now()+make_interval(secs=>greatest(30,least(coalesce(p_retry_seconds,120),3600))),locked_at=null,locked_by=null,updated_at=now() where id=p_job_id;end if;
  return jsonb_build_object('id',p_job_id,'success',p_success);
end;
$$;

revoke execute on function public.bind_bling_contact_id(uuid,bigint),public.claim_outbound_jobs(text,integer),public.finish_outbound_job(uuid,boolean,text,text,integer) from public,anon,authenticated;
grant execute on function public.bind_bling_contact_id(uuid,bigint),public.claim_outbound_jobs(text,integer),public.finish_outbound_job(uuid,boolean,text,text,integer) to service_role;
revoke execute on function public.queue_order_outbound_job() from public,anon,authenticated;

commit;
