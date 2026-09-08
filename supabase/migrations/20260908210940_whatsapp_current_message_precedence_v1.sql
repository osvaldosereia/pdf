begin;

-- A intenção da mensagem atual é autoritativa. O histórico serve apenas como apoio
-- e fica limitado à sessão recente para não ressuscitar pedidos antigos.
create or replace function public.build_whatsapp_sales_context_v1(p_conversation_id uuid,p_message_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
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
    'id',u.id,'name',u.name,'phone',u.primary_whatsapp_e164,
    'preferred_reply',u.preferred_reply,'order_count',u.order_count,'last_order_at',u.last_order_at
  ) end
  into customer
  from public.customers u where u.id=c.customer_id;

  -- Somente mensagens ANTERIORES à atual e dentro da sessão recente.
  -- A mensagem atual aparece exclusivamente em current_message/message e nunca é duplicada no histórico.
  select coalesce(jsonb_agg(jsonb_build_object(
    'direction',x.direction,'type',x.message_type,
    'text',left(coalesce(x.body_text,x.transcript,''),500),'at',x.created_at
  ) order by x.created_at),'[]'::jsonb)
  into history
  from (
    select direction,message_type,body_text,transcript,created_at
    from public.messages
    where conversation_id=c.id
      and id<>m.id
      and created_at<m.created_at
      and created_at>=m.created_at-interval '2 hours'
    order by created_at desc
    limit 10
  ) x;

  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb)
  into products
  from public.search_whatsapp_sellable_products_v1(q,8) s;

  cart:=public.get_whatsapp_sales_cart_v1(c.id);
  intelligence:=public.get_service_intelligence_bundle_v1('whatsapp',null,c.stage);
  select to_jsonb(x) into st from public.whatsapp_sales_state x where x.conversation_id=c.id;

  return jsonb_build_object(
    'decision_policy',jsonb_build_object(
      'current_message_is_authoritative',true,
      'history_role','support_only_never_overrides_current_message',
      'stale_intent_must_not_continue',true
    ),
    'conversation',jsonb_build_object(
      'id',c.id,'stage',c.stage,'mode',c.mode,
      'service_window_expires_at',c.service_window_expires_at,
      'fast_checkout',c.fast_checkout,'upsell_declined',c.upsell_declined
    ),
    'current_message',jsonb_build_object(
      'id',m.id,'type',m.message_type,'text',coalesce(m.body_text,m.transcript,''),
      'interactive',coalesce(m.ai_interpretation,'{}'::jsonb),'raw_event',m.raw_event
    ),
    -- Mantém alias message por compatibilidade com o worker v3 atual.
    'message',jsonb_build_object(
      'id',m.id,'type',m.message_type,'text',coalesce(m.body_text,m.transcript,''),
      'interactive',coalesce(m.ai_interpretation,'{}'::jsonb),'raw_event',m.raw_event
    ),
    'customer',customer,
    'cart',cart,
    'sales_state',coalesce(st,'{}'::jsonb),
    'product_candidates',products,
    'recent_session_history',history,
    'history',history,
    'intelligence',intelligence,
    'catalog_source','counter_verified'
  );
end $$;

-- Regra publicada, administrável no mesmo Admin de Inteligência.
insert into public.service_guidance_rules(
  rule_key,title,instruction,intent_scope,stage_scope,behavior_tags,status,priority,version_no
)
values(
  'current_message_precedence',
  'Mensagem atual tem prioridade absoluta',
  'Determine a intenção principalmente pela mensagem atual. O histórico serve somente para resolver referências ou contexto realmente necessário e nunca pode substituir a intenção atual. Se a mensagem atual for uma saudação, responda à saudação; não continue automaticamente uma intenção antiga. Não ressuscite buscas, carrinhos ou pedidos antigos sem indicação explícita do cliente.',
  '{}','{}',array['context','safety','sales'],'published',200,1
)
on conflict(rule_key,version_no) do update
  set instruction=excluded.instruction,status='published',priority=200,updated_at=now();

revoke all on function public.build_whatsapp_sales_context_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.build_whatsapp_sales_context_v1(uuid,uuid) to service_role;

commit;
