# WhatsApp — atendente: estratégia, cadastro, resumo e vitrines — 09/09/2026

## Objetivo desta rodada

Ajustar o atendimento da Dona Antônia para usar de forma mais efetiva as novas regras publicadas no Admin, reduzir respostas ruins/genéricas e melhorar três pontos de UX:

1. reconhecer cliente cadastrado desde o primeiro contato e usar nome de pessoa somente quando for confiável;
2. retirar botões do resumo final do pedido e apresentar lista organizada em texto, dados de entrega e confirmação do localizador em uma segunda mensagem;
3. transformar buscas de produtos (ex.: shampoo, sabonete) em vitrines filtradas que permitem adicionar produtos ao pedido.

## Estado de segurança preservado

Não houve ampliação de rollout nesta rodada.

```text
whatsapp_release_mode=live
whatsapp_live_canary_percent=1
whatsapp_inbound_enabled=true
whatsapp_auto_reply_enabled=true
whatsapp_sales_mvp_enabled=true
whatsapp_sales_interactive_enabled=true
experience_orchestrator_enabled=false
whatsapp_flow_data_exchange_enabled=false
whatsapp_flow_send_enabled=false
bling_order_sync_enabled=false
whatsapp_sales_bling_submit_enabled=false
```

## 1. Regras e orientações do Admin realmente entram no contexto

Foi auditado o runtime de `service_knowledge_items` e `service_guidance_rules`.

Problema encontrado: o bundle anterior carregava poucas regras (`max_guidance_items=8`) e, como o contexto era montado antes da classificação de intenção, regras importantes recém-publicadas podiam ficar fora do prompt por ordenação.

Correção aplicada:

- `max_knowledge_items=16`;
- `max_guidance_items=16`;
- `max_procedure_items=8`;
- novo `get_service_intelligence_bundle_v2(...)` com ranking por mensagem, etapa, intenção quando disponível e regras centrais de nome, personalização, tom, cordialidade, esforço do cliente, confiança e próxima melhor ação;
- `build_whatsapp_sales_context_v1(...)` passou a usar o bundle v2 e incluir identidade/endereço do cliente.

Validação com a mensagem `Vc tem sabonete?`: o bundle retornou 16 orientações, incluindo explicitamente:

- `Usar o nome do cliente desde o primeiro contato`;
- `Hierarquia segura para escolher o nome`;
- `Tom Dona Antônia: natural, simples e vendedor`;
- `Resposta primeiro, detalhe depois`;
- `Cordialidade sem criar interações desnecessárias`;
- `Confiança vale mais que parecer humano`.

## 2. Cliente consultado desde o primeiro contato

Foram criados:

- `customer_person_first_name_v1(...)`;
- `link_whatsapp_customer_from_phone_v1(...)`.

A resolução usa o cadastro por telefone e suas variantes brasileiras. A conversa é ligada ao cliente quando houver correspondência confiável.

O fast-path de saudação foi alterado para consultar o cadastro antes de responder. Se houver nome de pessoa confiável, a atendente pode dizer, por exemplo, `Oi, Maria! ...` desde a primeira mensagem.

Há proteção para não tratar nomes de empresa como nome de pessoa. Na validação, `Super Cestas Dona Antônia` foi corretamente rejeitado como nome pessoal; `Maria Silva` retornou `Maria`.

## 3. Resumo do pedido sem botões

Foram criadas funções de resumo em texto:

- `format_whatsapp_cart_checkout_summary_v1(...)`;
- `format_whatsapp_basket_checkout_summary_v1(...)`;
- `get_whatsapp_checkout_contact_v1(...)`;
- `whatsapp_address_line_v1(...)`;
- `format_phone_br_v1(...)`.

Formato esperado:

```text
*RESUMO DO PEDIDO*

• 2x Produto A
• 1x Produto B
• 3x Produto C

*Total:* R$ 123,45

*DADOS DE ENTREGA*
Nome: Cliente
Telefone: (65) 99999-9999
Endereço: Rua..., número... - Bairro - Cidade
```

Os fluxos `checkout_preview`, `request_confirmation` e `cart_summary` foram interceptados no outbound para remover botões. `cart_summary` vira texto puro; checkout/finalização vira texto puro e segue para confirmação do localizador.

## 4. Localizador em segunda mensagem

Depois do resumo, o sistema envia outra mensagem separada:

```text
Só para confirmar a entrega, envie o localizador/ponto de referência.
```

Se já houver localizador cadastrado, a mensagem mostra o valor atual e permite responder `pode finalizar` para mantê-lo, ou enviar um novo.

Estados novos:

- `basket_customer_base_data`;
- `basket_locator_confirmation`;
- `order_customer_base_data`;
- `order_locator_confirmation`.

Se nome/endereço ainda não estiverem completos, o sistema pede os dados base em uma única mensagem, sem pedir localizador junto:

```text
Nome | Rua | Quadra | Casa | Bairro | Cidade
```

Só depois do resumo é solicitado o localizador. A resposta com um novo localizador ou a confirmação explícita permite seguir para conclusão.

Para cesta básica personalizada, o texto final usa `Encomenda recebida para conferência`, preservando a distinção entre recebimento da encomenda e pedido operacionalmente confirmado.

## 5. Busca de produto abre vitrine filtrada

Foi criada `create_whatsapp_search_catalog_session_v1(...)`.

A função:

- usa o termo extraído pela IA;
- pesquisa somente produtos vendáveis e fisicamente conferidos;
- cria uma `catalog_session` ligada à conversa e ao carrinho;
- disponibiliza até 20 resultados;
- abre em `https://donaantonia.com.br/catalogo/?t=<token>`;
- permite alterar quantidade e adicionar ao pedido na própria vitrine.

O transporter foi adaptado para que respostas `search_product`, que antes viravam uma lista estreita de produtos no WhatsApp, sejam convertidas em `cta_url`.

Exemplo:

```text
Cliente: Vc tem sabonete?
IA extrai: sabonete
Sistema encontra produtos reais
WhatsApp: [Ver Sabonete]
```

Teste técnico com `sabonete` criou uma vitrine com 10 produtos reais e carrinho vinculado.

## 6. Mais de uma busca na mesma pergunta

Foi criado o pós-processador `whatsapp_sales_multi_search_cta_v1`.

Quando o plano estruturado da OpenAI retorna mais de um termo de busca, o primeiro termo segue pelo CTA normal e até dois termos adicionais recebem vitrines próprias. Isso usa os termos que a IA efetivamente extraiu, em vez de tentar adivinhar por regex no transporte.

Como `cta_url` suporta um destino URL por mensagem interativa, múltiplas buscas são enviadas como mensagens CTA compactas em sequência, uma por vitrine. Isso evita um reply-button intermediário que aumentaria uma interação.

## 7. Migrações aplicadas em produção controlada

```text
20260909041114 whatsapp_ai_admin_rules_identity_search_showcase_v1
20260909041143 whatsapp_product_search_cta_transport_v1
20260909041348 whatsapp_checkout_text_locator_flow_v1
20260909041440 whatsapp_checkout_outbound_plaintext_followup_v1
20260909041501 fix_whatsapp_address_line_precedence_v1
20260909041535 fix_whatsapp_search_catalog_cart_ambiguity_v1
```

## Próxima validação prática

No número de homologação já autorizado, testar sequencialmente:

1. saudação de cliente com cadastro pessoal;
2. `Vocês têm sabonete?`;
3. `Quero ver shampoo e sabonete`;
4. adicionar itens pela vitrine;
5. pedir `finalizar`;
6. conferir resumo em texto, sem botões;
7. conferir segunda mensagem de localizador;
8. responder com localizador ou `pode finalizar`.

Não elevar canary acima de 1% antes de essa sequência estar homologada.