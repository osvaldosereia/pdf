begin;

-- Orçamento de contexto conservador. Só afeta o bundle v2, que permanece atrás
-- de dynamic_selection_enabled=false por padrão.
alter table public.service_intelligence_runtime_config
  alter column max_core_guidance_items set default 7,
  alter column max_dynamic_guidance_items set default 5,
  alter column max_dynamic_knowledge_items set default 5,
  alter column max_dynamic_procedure_items set default 3;
update public.service_intelligence_runtime_config
set max_core_guidance_items=least(max_core_guidance_items,7),
    max_dynamic_guidance_items=least(max_dynamic_guidance_items,5),
    max_dynamic_knowledge_items=least(max_dynamic_knowledge_items,5),
    max_dynamic_procedure_items=least(max_dynamic_procedure_items,3),
    updated_at=now()
where id=1;

-- Mantém o contrato do worker v3. Com o gate OFF, preserva o contexto atual.
-- Com o gate ON, elimina raw_event do prompt, reduz histórico/candidatos e
-- seleciona inteligência por intenção/tópico antes de chamar o modelo.
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
  normalized text;
  intent_hint text:=null;
  topic_hint text:=null;
  st jsonb;
  runtime public.service_intelligence_runtime_config%rowtype;
  dynamic_enabled boolean:=false;
begin
  select * into c from public.conversations where id=p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  select * into m from public.messages where id=p_message_id and conversation_id=c.id;
  if not found then raise exception 'message_not_found'; end if;
  select * into runtime from public.service_intelligence_runtime_config where id=1;
  dynamic_enabled:=coalesce(runtime.dynamic_selection_enabled,false);

  q:=left(coalesce(m.body_text,m.transcript,''),240);
  normalized:=public.normalize_service_text_v1(q);

  if normalized in ('oi','oii','oiii','ola','bom dia','boa tarde','boa noite','menu','inicio','iniciar','comecar') then
    intent_hint:='greeting';
  elsif normalized ~ '(^| )(cesta|cestas)( |$)' then
    intent_hint:='baskets'; topic_hint:='cestas';
  elsif normalized in ('carrinho','meu carrinho','ver carrinho','resumo do pedido','ver pedido') then
    intent_hint:='cart';
  elsif normalized ~ '(^| )(pagamento|pagar|pix|boleto|cartao|credito|debito|30 dias)( |$)' then
    intent_hint:='answer'; topic_hint:='pagamento';
  elsif normalized ~ '(^| )(frete|entrega|entregar|taxa|pedido minimo|horario)( |$)' then
    intent_hint:='answer'; topic_hint:='entrega';
  elsif normalized ~ '(^| )(confirmo|pode fechar|pode finalizar|finaliza o pedido|fechar o pedido|confirmar o pedido)( |$)' then
    intent_hint:='confirm_order';
  elsif normalized ~ '(^| )(quero|coloca|coloque|adiciona|adicione|bota|manda|poe)( |$)' then
    intent_hint:='add';
  elsif normalized ~ '(^| )(tem|preco|quanto|procura|procurar|mostra|mostrar|vende|disponivel)( |$)' then
    intent_hint:='search';
  end if;

  select case when u.id is null then null else jsonb_build_object(
    'id',u.id,'name',u.name,'phone',u.primary_whatsapp_e164,'preferred_reply',u.preferred_reply,
    'order_count',u.order_count,'last_order_at',u.last_order_at
  ) end
  into customer
  from public.customers u
  where u.id=c.customer_id;

  if dynamic_enabled then
    select coalesce(jsonb_agg(
      jsonb_build_object('direction',x.direction,'type',x.message_type,'text',left(coalesce(x.body_text,x.transcript,''),360),'at',x.created_at)
      order by x.created_at
    ),'[]'::jsonb)
    into history
    from (
      select direction,message_type,body_text,transcript,created_at
      from public.messages
      where conversation_id=c.id and id<>m.id and created_at<=m.created_at
        and created_at>=m.created_at-interval '90 minutes'
      order by created_at desc limit 6
    ) x;
  else
    select coalesce(jsonb_agg(
      jsonb_build_object('direction',x.direction,'type',x.message_type,'text',left(coalesce(x.body_text,x.transcript,''),500),'at',x.created_at)
      order by x.created_at
    ),'[]'::jsonb)
    into history
    from (
      select direction,message_type,body_text,transcript,created_at
      from public.messages
      where conversation_id=c.id and id<>m.id and created_at<=m.created_at
        and created_at>=m.created_at-interval '2 hours'
      order by created_at desc limit 8
    ) x;
  end if;

  if intent_hint='greeting' or topic_hint in ('pagamento','entrega') then
    products:='[]'::jsonb;
  elsif dynamic_enabled then
    select coalesce(jsonb_agg(to_jsonb(s) order by s.score desc,s.name),'[]'::jsonb)
    into products
    from public.resolve_whatsapp_product_candidates_v2(q,6) s;
  else
    select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb)
    into products
    from public.search_whatsapp_sellable_products_v1(left(q,120),8) s;
  end if;

  cart:=public.get_whatsapp_sales_cart_v1(c.id);
  if dynamic_enabled then
    intelligence:=public.get_service_intelligence_bundle_v2('whatsapp',intent_hint,c.stage,topic_hint);
  else
    intelligence:=public.get_service_intelligence_bundle_v1('whatsapp',null,c.stage);
  end if;
  select to_jsonb(x) into st from public.whatsapp_sales_state x where x.conversation_id=c.id;

  return jsonb_build_object(
    'context_mode',case when dynamic_enabled then 'compact_dynamic_v2' else 'legacy_v1' end,
    'current_message_priority','authoritative',
    'current_intent_hint',intent_hint,
    'current_topic_hint',topic_hint,
    'history_role','context_only',
    'address_policy','Only accept address data explicitly evidenced by the current customer message or previously saved deterministic state.',
    'conversation',jsonb_build_object('id',c.id,'stage',c.stage,'mode',c.mode,'service_window_expires_at',c.service_window_expires_at,'fast_checkout',c.fast_checkout,'upsell_declined',c.upsell_declined),
    'message',jsonb_build_object(
      'id',m.id,'type',m.message_type,'text',coalesce(m.body_text,m.transcript,''),
      'interactive',coalesce(m.ai_interpretation,'{}'::jsonb),
      'raw_event',case when dynamic_enabled then null else m.raw_event end
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
