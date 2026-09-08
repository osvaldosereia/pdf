begin;

insert into public.service_knowledge_items(
  knowledge_key,category,title,content,keywords,channel_scope,status,priority,version_no,source_note
)
values
(
  'how_to_buy',
  'atendimento',
  'Como comprar',
  'O cliente pode fazer o pedido diretamente pelo WhatsApp. O atendimento consulta o catálogo disponível, monta e ajusta o pedido e apresenta o resumo. O pedido só é finalizado depois da confirmação explícita do cliente.',
  array['comprar','pedido','whatsapp','finalizar','confirmar'],array['whatsapp'],'published',100,1,
  'Baseline comercial validado pelo proprietário para o MVP WhatsApp.'
),
(
  'delivery_area',
  'entrega',
  'Área de atendimento',
  'A Dona Antônia realiza entregas próprias em Cuiabá e Várzea Grande. Não prometa horário ou prazo de entrega sem informação operacional confiável disponível no contexto atual.',
  array['entrega','cuiabá','cuiaba','várzea grande','varzea grande'],array['whatsapp'],'published',100,1,
  'Baseline comercial validado pelo proprietário para o MVP WhatsApp.'
),
(
  'payment_baseline',
  'pagamento',
  'Forma de pagamento',
  'O pagamento é normalmente realizado na entrega. Em casos específicos pode existir pagamento antecipado por Pix ou link quando essa opção estiver efetivamente disponível. Nunca invente disponibilidade de meio de pagamento; se o sistema não informar, peça somente a confirmação necessária ou encaminhe para a equipe.',
  array['pagamento','pix','cartão','cartao','dinheiro','entrega'],array['whatsapp'],'published',100,1,
  'Baseline comercial validado pelo proprietário para o MVP WhatsApp.'
),
(
  'basket_commercial_price',
  'cestas',
  'Preço e composição das cestas básicas',
  'As cestas básicas têm preço comercial próprio e predefinido. O valor da cesta não deve ser explicado como soma dos preços individuais dos componentes, e o atendimento não deve expor ao cliente a diferença operacional entre o preço da cesta e os produtos que a compõem.',
  array['cesta','cesta básica','cesta basica','preço','preco','composição','composicao'],array['whatsapp'],'published',100,1,
  'Regra comercial do proprietário.'
),
(
  'basket_customization',
  'cestas',
  'Personalização da cesta',
  'O cliente pode pedir para aumentar, diminuir, retirar ou trocar itens da cesta quando a regra comercial correspondente estiver cadastrada e o produto substituto estiver disponível. Se uma troca de cesta não tiver regra configurada, não improvise: ofereça alternativa válida ou encaminhe para a equipe.',
  array['personalizar','trocar','retirar','aumentar','diminuir','cesta'],array['whatsapp'],'published',100,1,
  'Regra comercial do proprietário.'
),
(
  'catalog_truth',
  'produtos',
  'Fonte oficial dos produtos do atendimento',
  'Nome, preço, estoque, disponibilidade e foto usados no atendimento vêm somente do banco próprio de produtos fisicamente conferidos pelo contador. O cadastro de produtos do Bling não é fonte de verdade do atendimento.',
  array['produto','preço','preco','estoque','foto','catálogo','catalogo'],array['whatsapp'],'published',100,1,
  'Arquitetura comercial oficial do MVP.'
),
(
  'substitution_behavior',
  'produtos',
  'Produto indisponível e substituição',
  'Quando o produto pedido não estiver disponível, não pare apenas em “não temos”. Procure alternativas reais no catálogo conferido e apresente poucas opções relevantes. Nunca substitua produto ambíguo ou comprometedor sem a confirmação exigida pela regra aplicável.',
  array['substituição','substituicao','troca','indisponível','indisponivel','alternativa'],array['whatsapp'],'published',100,1,
  'Diretriz comercial do proprietário.'
),
(
  'order_confirmation_customer_view',
  'pedido',
  'Confirmação final da venda',
  'Depois que o cliente confirmar explicitamente o pedido e os dados obrigatórios estiverem completos, confirme a venda no WhatsApp de forma curta e clara. A sincronização com sistemas de retaguarda não deve atrasar a confirmação ao cliente nem ser exposta como etapa da experiência de compra.',
  array['confirmar','pedido confirmado','finalizar','fechar pedido'],array['whatsapp'],'published',100,1,
  'Arquitetura confirm-first do MVP.'
)
on conflict(knowledge_key,version_no) do update
set category=excluded.category,
    title=excluded.title,
    content=excluded.content,
    keywords=excluded.keywords,
    channel_scope=excluded.channel_scope,
    status='published',
    priority=100,
    source_note=excluded.source_note,
    updated_at=now();

commit;