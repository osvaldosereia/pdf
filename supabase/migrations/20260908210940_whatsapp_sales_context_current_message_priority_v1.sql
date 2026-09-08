begin;

-- A mensagem atual é a fonte primária da intenção. Histórico existe apenas como apoio
-- e não pode ressuscitar um pedido antigo em uma nova saudação/intenção.
create or replace function public.build_whatsapp_sales_context_v1(p_conversation_id uuid,p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  c public.conversations%rowtype;
  m public.messages%rowtype;
  customer jsonb;
  history jsonb;
  products jsonb;
  cart jsonb;
  intelligence jsonb;
  q text;
  st jsonb;
begin
  select * into c from public.conversations where id=p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;

  select * into m from public.messages where id=p_message_id and conversation_id=c.id;
  if not found then raise exception 'message_not_found'; end if;

  q:=left(coalesce(m.body_text,m.transcript,''),120);

  select case when u.id is null then null else jsonb_build_object(
    'id',u.id,'name',u.name,'phone',u.primary_whatsapp_e164,'preferred_reply',u.preferred_reply,
    'order_count',u.order_count,'last_order_at',u.last_order_at
  ) end
  into customer
  from public.customers u
  where u.id=c.customer_id;

  -- Histórico recente e secundário: exclui a mensagem atual e não carrega conversas antigas
  -- para dentro de uma nova intenção. Estado comercial persistente fica em whatsapp_sales_state/cart.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'direction',x.direction,
      'type',x.message_type,
      'text',left(coalesce(x.body_text,x.transcript,''),500),
      'at',x.created_at
    ) order by x.created_at
  ),'[]'::jsonb)
  into history
  from (
    select direction,message_type,body_text,transcript,created_at
      from public.messages
     where conversation_id=c.id
       and id<>m.id
       and created_at<=m.created_at
       and created_at>=m.created_at-interval '2 hours'
     order by created_at desc
     limit 8
  ) x;

  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb)
    into products
    from public.search_whatsapp_sellable_products_v1(q,8) s;

  cart:=public.get_whatsapp_sales_cart_v1(c.id);
  intelligence:=public.get_service_intelligence_bundle_v1('whatsapp',null,c.stage);
  select to_jsonb(x) into st from public.whatsapp_sales_state x where x.conversation_id=c.id;

  return jsonb_build_object(
    'current_message_priority','authoritative',
    'history_role','context_only',
    'conversation',jsonb_build_object(
      'id',c.id,'stage',c.stage,'mode',c.mode,'service_window_expires_at',c.service_window_expires_at,
      'fast_checkout',c.fast_checkout,'upsell_declined',c.upsell_declined
    ),
    'message',jsonb_build_object(
      'id',m.id,'type',m.message_type,'text',coalesce(m.body_text,m.transcript,''),
      'interactive',coalesce(m.ai_interpretation,'{}'::jsonb),'raw_event',m.raw_event
    ),
    'customer',customer,
    'cart',cart,
    'sales_state',coalesce(st,'{}'::jsonb),
    'product_candidates',products,
    'history',history,
    'intelligence',intelligence,
    'catalog_source','counter_verified'
  );
end
$$;

revoke all on function public.build_whatsapp_sales_context_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.build_whatsapp_sales_context_v1(uuid,uuid) to service_role;

commit;
