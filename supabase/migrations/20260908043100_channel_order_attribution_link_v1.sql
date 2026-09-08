begin;

-- Complemento da ETAPA 6: atribuição conversa -> pedido sem inferência por nome/telefone.
-- Apenas a própria conversation_id do pedido pode fornecer o last-touch.

create table if not exists public.order_channel_attribution_links (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  attribution_event_id uuid not null references public.channel_attribution_events(id) on delete restrict,
  attribution_model text not null default 'last_touch' check (attribution_model in ('last_touch')),
  channel text not null check (channel in ('whatsapp','web','instagram','messenger','email')),
  conversation_id uuid references public.conversations(id) on delete set null,
  touchpoint_type text not null,
  occurred_at timestamptz not null,
  linked_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(order_id,attribution_model)
);
create index if not exists order_channel_attribution_event_idx
  on public.order_channel_attribution_links(attribution_event_id,linked_at desc);
alter table public.order_channel_attribution_links enable row level security;
revoke all on public.order_channel_attribution_links from public,anon,authenticated;
grant select,insert,update on public.order_channel_attribution_links to service_role;

create or replace function public.link_order_channel_attribution_v1(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.orders%rowtype;
  v_attr public.channel_attribution_events%rowtype;
  v_link uuid;
begin
  select * into v_order from public.orders where id=p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.conversation_id is null then
    return jsonb_build_object('ok',true,'linked',false,'reason','order_without_conversation');
  end if;

  -- Somente touchpoint da mesma conversa, anterior ao pedido e dentro de uma janela
  -- conservadora. Nunca cai para nome, telefone, e-mail ou customer_id isolado.
  select * into v_attr
    from public.channel_attribution_events
   where conversation_id=v_order.conversation_id
     and occurred_at<=v_order.created_at
     and occurred_at>=v_order.created_at-interval '30 days'
   order by occurred_at desc,id desc
   limit 1;

  if not found then
    return jsonb_build_object('ok',true,'linked',false,'reason','no_conversation_touchpoint');
  end if;

  insert into public.order_channel_attribution_links(
    order_id,attribution_event_id,attribution_model,channel,conversation_id,touchpoint_type,occurred_at,metadata
  ) values(
    v_order.id,v_attr.id,'last_touch',v_attr.channel,v_order.conversation_id,v_attr.touchpoint_type,v_attr.occurred_at,
    jsonb_build_object('source','channel_attribution_events')
  )
  on conflict(order_id,attribution_model) do update set
    attribution_event_id=excluded.attribution_event_id,
    channel=excluded.channel,
    conversation_id=excluded.conversation_id,
    touchpoint_type=excluded.touchpoint_type,
    occurred_at=excluded.occurred_at,
    linked_at=now(),
    metadata=public.order_channel_attribution_links.metadata||excluded.metadata
  returning id into v_link;

  return jsonb_build_object('ok',true,'linked',true,'link_id',v_link,'attribution_event_id',v_attr.id,'channel',v_attr.channel,'touchpoint_type',v_attr.touchpoint_type);
end;
$$;
revoke all on function public.link_order_channel_attribution_v1(uuid) from public,anon,authenticated;
grant execute on function public.link_order_channel_attribution_v1(uuid) to service_role;

-- Pedido novo/associado a conversa ganha last-touch automaticamente, sem rede ou gasto externo.
create or replace function public.sync_order_channel_attribution_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.link_order_channel_attribution_v1(new.id);
  return new;
end;
$$;
revoke all on function public.sync_order_channel_attribution_v1() from public,anon,authenticated;
grant execute on function public.sync_order_channel_attribution_v1() to service_role;

drop trigger if exists orders_channel_attribution_v1 on public.orders;
create trigger orders_channel_attribution_v1
after insert or update of conversation_id on public.orders
for each row execute function public.sync_order_channel_attribution_v1();

-- Se o touchpoint chegar depois do registro do pedido (webhook/replay fora de ordem),
-- recalcula somente pedidos da MESMA conversa e cuja data comporte esse touchpoint.
create or replace function public.refresh_orders_from_channel_attribution_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order_id uuid;
begin
  if new.conversation_id is null then return new; end if;
  for v_order_id in
    select o.id
      from public.orders o
     where o.conversation_id=new.conversation_id
       and new.occurred_at<=o.created_at
       and new.occurred_at>=o.created_at-interval '30 days'
  loop
    perform public.link_order_channel_attribution_v1(v_order_id);
  end loop;
  return new;
end;
$$;
revoke all on function public.refresh_orders_from_channel_attribution_v1() from public,anon,authenticated;
grant execute on function public.refresh_orders_from_channel_attribution_v1() to service_role;

drop trigger if exists channel_attribution_refresh_orders_v1 on public.channel_attribution_events;
create trigger channel_attribution_refresh_orders_v1
after insert or update of conversation_id,occurred_at on public.channel_attribution_events
for each row execute function public.refresh_orders_from_channel_attribution_v1();

commit;
