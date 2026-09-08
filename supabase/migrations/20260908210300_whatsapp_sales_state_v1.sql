begin;

create table if not exists public.whatsapp_sales_state (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  pending_delivery_address jsonb not null default '{}'::jsonb,
  last_candidates jsonb not null default '[]'::jsonb,
  last_action text,
  last_product_id uuid references public.products(id) on delete set null,
  awaiting text,
  updated_at timestamptz not null default now()
);
alter table public.whatsapp_sales_state enable row level security;
revoke all on public.whatsapp_sales_state from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_sales_state to service_role;

create or replace function public.update_whatsapp_sales_state_v1(
  p_conversation_id uuid,
  p_delivery_address jsonb default null,
  p_candidates jsonb default null,
  p_last_action text default null,
  p_last_product_id uuid default null,
  p_awaiting text default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare s public.whatsapp_sales_state%rowtype; merged jsonb;
begin
  if not exists(select 1 from public.conversations where id=p_conversation_id) then raise exception 'conversation_not_found'; end if;
  insert into public.whatsapp_sales_state(conversation_id) values(p_conversation_id) on conflict(conversation_id) do nothing;
  select * into s from public.whatsapp_sales_state where conversation_id=p_conversation_id for update;
  merged:=s.pending_delivery_address;
  if p_delivery_address is not null and jsonb_typeof(p_delivery_address)='object' then
    merged:=coalesce(merged,'{}'::jsonb)||jsonb_strip_nulls(p_delivery_address);
  end if;
  update public.whatsapp_sales_state set
    pending_delivery_address=merged,
    last_candidates=case when p_candidates is null then last_candidates else coalesce(p_candidates,'[]'::jsonb) end,
    last_action=coalesce(nullif(p_last_action,''),last_action),
    last_product_id=coalesce(p_last_product_id,last_product_id),
    awaiting=case when p_awaiting is null then awaiting when p_awaiting='' then null else p_awaiting end,
    updated_at=now()
  where conversation_id=p_conversation_id returning * into s;
  return to_jsonb(s);
end $$;

create or replace function public.clear_whatsapp_sales_state_v1(p_conversation_id uuid)
returns void language sql security definer set search_path='' as $$
  delete from public.whatsapp_sales_state where conversation_id=p_conversation_id
$$;

create or replace function public.build_whatsapp_sales_context_v1(p_conversation_id uuid,p_message_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare c public.conversations%rowtype; m public.messages%rowtype; customer jsonb; history jsonb; products jsonb; cart jsonb; intelligence jsonb; q text; st jsonb;
begin
  select * into c from public.conversations where id=p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  select * into m from public.messages where id=p_message_id and conversation_id=c.id;
  if not found then raise exception 'message_not_found'; end if;
  q:=left(coalesce(m.body_text,m.transcript,''),120);
  select case when u.id is null then null else jsonb_build_object('id',u.id,'name',u.name,'phone',u.primary_whatsapp_e164,'preferred_reply',u.preferred_reply,'order_count',u.order_count,'last_order_at',u.last_order_at) end into customer from public.customers u where u.id=c.customer_id;
  select coalesce(jsonb_agg(jsonb_build_object('direction',x.direction,'type',x.message_type,'text',left(coalesce(x.body_text,x.transcript,''),500),'at',x.created_at) order by x.created_at),'[]'::jsonb) into history
  from (select direction,message_type,body_text,transcript,created_at from public.messages where conversation_id=c.id order by created_at desc limit 12) x;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into products from public.search_whatsapp_sellable_products_v1(q,8) s;
  cart:=public.get_whatsapp_sales_cart_v1(c.id);
  intelligence:=public.get_service_intelligence_bundle_v1('whatsapp',null,c.stage);
  select to_jsonb(x) into st from public.whatsapp_sales_state x where x.conversation_id=c.id;
  return jsonb_build_object(
    'conversation',jsonb_build_object('id',c.id,'stage',c.stage,'mode',c.mode,'service_window_expires_at',c.service_window_expires_at,'fast_checkout',c.fast_checkout,'upsell_declined',c.upsell_declined),
    'message',jsonb_build_object('id',m.id,'type',m.message_type,'text',coalesce(m.body_text,m.transcript,''),'interactive',coalesce(m.ai_interpretation,'{}'::jsonb),'raw_event',m.raw_event),
    'customer',customer,'cart',cart,'sales_state',coalesce(st,'{}'::jsonb),'product_candidates',products,'history',history,'intelligence',intelligence,'catalog_source','counter_verified'
  );
end $$;

revoke all on function public.update_whatsapp_sales_state_v1(uuid,jsonb,jsonb,text,uuid,text) from public,anon,authenticated;
revoke all on function public.clear_whatsapp_sales_state_v1(uuid) from public,anon,authenticated;
revoke all on function public.build_whatsapp_sales_context_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.update_whatsapp_sales_state_v1(uuid,jsonb,jsonb,text,uuid,text) to service_role;
grant execute on function public.clear_whatsapp_sales_state_v1(uuid) to service_role;
grant execute on function public.build_whatsapp_sales_context_v1(uuid,uuid) to service_role;

commit;
