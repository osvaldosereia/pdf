begin;

-- Fecha uma lacuna do MVP: quando o checkout está aguardando endereço,
-- a mensagem seguinte com o endereço deve completar o estado e voltar ao
-- resumo final, preservando uma única confirmação explícita do pedido.

insert into public.service_guidance_rules(
  rule_key,title,instruction,intent_scope,stage_scope,channel_scope,behavior_tags,status,priority,version_no
) values(
  'checkout_resume_after_address',
  'Retomar fechamento depois do endereço',
  'Se sales_state.awaiting for delivery_address e a mensagem atual trouxer o endereço solicitado, extraia somente os dados fornecidos, preserve os dados de endereço já existentes e trate o turno como checkout. Depois do endereço suficiente, mostre o resumo final do carrinho e peça uma única confirmação explícita. O envio do endereço não confirma o pedido por si só.',
  '{}','{}',array['whatsapp'],array['checkout','address','minimal_interactions','safety'],'published',100,1
)
on conflict(rule_key,version_no) do update
set title=excluded.title,
    instruction=excluded.instruction,
    intent_scope=excluded.intent_scope,
    stage_scope=excluded.stage_scope,
    channel_scope=excluded.channel_scope,
    behavior_tags=excluded.behavior_tags,
    status='published',
    priority=100,
    updated_at=now();

insert into public.service_regression_cases(
  case_key,title,customer_message,setup,expected_intent,expected_action,expected_assertions,status,priority
) values(
  'address_reply_resumes_checkout',
  'Endereço solicitado retoma checkout sem confirmar sozinho',
  'Rua das Flores, 123, Cuiabá',
  jsonb_build_object('sales_state',jsonb_build_object('awaiting','delivery_address'),'cart_has_items',true),
  'checkout',
  'checkout_preview',
  jsonb_build_object('address_is_not_confirmation',true,'single_final_confirmation',true,'ask_no_redundant_question',true),
  'active',100
)
on conflict(case_key) do update
set title=excluded.title,
    customer_message=excluded.customer_message,
    setup=excluded.setup,
    expected_intent=excluded.expected_intent,
    expected_action=excluded.expected_action,
    expected_assertions=excluded.expected_assertions,
    status='active',
    priority=100,
    updated_at=now();

commit;
