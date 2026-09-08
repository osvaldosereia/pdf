begin;

-- Homologação do cérebro comercial: o proprietário pode configurar conhecimento,
-- orientações, procedimentos, mídia e regressões pelo Admin sem colocar a inteligência em live.
update public.service_intelligence_runtime_config
   set enabled=true,
       execution_mode='homologation',
       knowledge_enabled=true,
       guidance_enabled=true,
       procedures_enabled=true,
       media_enabled=true,
       regression_suite_enabled=true,
       updated_at=now()
 where id=1;

-- Regras fortes de UX comercial: rápido, objetivo e sem perguntas desnecessárias.
insert into public.service_guidance_rules(
  rule_key,title,instruction,intent_scope,stage_scope,channel_scope,behavior_tags,status,priority,version_no
)
values
(
  'fast_objective_service',
  'Atendimento rápido e objetivo',
  'Responda de forma curta, direta e comercial. Avance a necessidade do cliente na mesma resposta sempre que houver dados suficientes. Não faça perguntas de cortesia, confirmação intermediária ou perguntas que o sistema já consegue responder pelo catálogo, carrinho, histórico comercial confiável ou estado atual. Não repita informações que o cliente já informou. Evite introduções longas e explicações internas. Em geral use uma resposta curta; listas só quando realmente ajudam a escolher.',
  '{}','{}',array['whatsapp'],array['ux','concise','sales','speed'],'published',100,1
),
(
  'ask_only_missing_information',
  'Perguntar somente o que falta',
  'Faça pergunta somente quando faltar informação necessária para executar a próxima ação com segurança ou quando houver ambiguidade real. Quando precisar perguntar, peça de uma vez apenas os dados mínimos que faltam, evitando uma sequência de perguntas que poderia ser consolidada. Se a identificação do produto estiver clara, consulte/adicionar/alterar diretamente e informe o resultado.',
  '{}','{}',array['whatsapp'],array['ux','minimal_interactions','sales'],'published',100,1
),
(
  'current_message_precedence',
  'Mensagem atual tem prioridade absoluta',
  'A mensagem atual define a intenção deste turno. Use o histórico somente para resolver referências úteis como “o mesmo de sempre”, “esse”, “aquele” ou para preservar um carrinho em andamento. Nunca deixe uma intenção antiga substituir a mensagem atual. Uma saudação simples é saudação; uma nova busca substitui a busca antiga; não ressuscite pedidos antigos sem indicação explícita do cliente.',
  '{}','{}',array['whatsapp'],array['context','safety','sales'],'published',100,2
),
(
  'no_unnecessary_confirmation',
  'Sem confirmação para ações reversíveis claras',
  'Não peça “quer que eu procure?”, “quer que eu adicione?” ou equivalentes quando o cliente já pediu claramente uma ação reversível. Pesquise, monte a simulação ou altere o carrinho e informe o que fez. Confirmação explícita continua obrigatória somente para finalizar o pedido e demais ações comprometedoras configuradas.',
  '{}','{}',array['whatsapp'],array['autonomy','sales','speed'],'published',100,1
)
on conflict(rule_key,version_no) do update
  set title=excluded.title,
      instruction=excluded.instruction,
      channel_scope=excluded.channel_scope,
      behavior_tags=excluded.behavior_tags,
      status='published',
      priority=100,
      updated_at=now();

-- Casos permanentes para impedir regressão para atendimento prolixo ou perguntas inúteis.
insert into public.service_regression_cases(
  case_key,title,customer_message,expected_intent,expected_action,expected_assertions,status,priority
)
values
(
  'greeting_current_turn',
  'Saudação não ressuscita intenção antiga',
  'Olá',
  'greeting',
  'greeting',
  '{"current_message_wins":true,"must_not_search_history_intent":true,"max_questions":1,"short_reply":true}'::jsonb,
  'active',100
),
(
  'direct_product_request_no_permission_question',
  'Pedido claro avança sem pedir autorização intermediária',
  'Coloca 2 arroz Urbano 5kg',
  'add',
  'add_product',
  '{"must_not_ask_to_search":true,"must_not_ask_to_add":true,"quantity":2,"source":"counter_verified"}'::jsonb,
  'active',100
),
(
  'direct_price_search',
  'Pergunta de preço mostra resultado diretamente',
  'Quanto está o óleo?',
  'search',
  'search_product',
  '{"must_show_available_options":true,"must_not_ask_permission_to_search":true,"concise":true}'::jsonb,
  'active',100
),
(
  'missing_info_single_question',
  'Informação realmente ausente gera somente pergunta necessária',
  'Pode fechar o pedido',
  'checkout',
  'request_missing_checkout_data',
  '{"ask_only_missing_fields":true,"no_repeated_questions":true}'::jsonb,
  'active',100
)
on conflict(case_key) do update
  set title=excluded.title,
      customer_message=excluded.customer_message,
      expected_intent=excluded.expected_intent,
      expected_action=excluded.expected_action,
      expected_assertions=excluded.expected_assertions,
      status='active',
      priority=100,
      updated_at=now();

commit;