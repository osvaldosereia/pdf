# Decisão oficial — Marketing omnicanal a cada 10 dias

Atualizado em 08/09/2026.

Este documento registra uma decisão do proprietário e **substitui, onde houver conflito, a cadência inicial de 15 dias descrita em `EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`**.

## Objetivo

Criar um relacionamento pós-compra profissional, personalizado e mensurável, usando WhatsApp e e-mail sem transformar a operação em disparo indiscriminado.

A lógica deve conhecer o histórico de compras do cliente, priorizar itens de afinidade, ampliar gradualmente o leque de compra com complementos relevantes e respeitar consentimento, opt-out, estoque, preço, validade e atendimento humano.

## Regra de cadência oficial

A cadência inicial passa a ser **10 dias**.

Para cada cliente e canal elegível:

```text
nova compra válida
→ reinicia relógio de marketing
→ próxima elegibilidade = compra válida + 10 dias
→ nova compra antes do vencimento reinicia novamente o relógio
```

Não criar cron individual por cliente. Um avaliador periódico barato deve selecionar apenas clientes elegíveis.

Compra cancelada/devolvida não deve sustentar a cadência como compra válida. A implementação deve definir um evento transacional `purchase_effective_at` baseado no status final considerado compra válida pelo negócio e recalcular corretamente em cancelamento/devolução.

## WhatsApp marketing

### Canal

Usar exclusivamente a **WhatsApp Business Platform / Cloud API da Meta** para mensagens iniciadas pela empresa.

### Formato preferencial

Template aprovado pela Meta na categoria **MARKETING**, preferencialmente no formato **carrossel** para campanhas de produtos.

O carrossel será usado para apresentar uma seleção pequena e relevante ao perfil do cliente, com mídia oficial do produto e chamada para ação. Não usar a capacidade máxima de cartões apenas porque existe; selecionar a quantidade que mantenha clareza e relevância.

Possíveis cartões:

- produtos recorrentes do cliente;
- reposição provável;
- ofertas reais em categorias de afinidade;
- no máximo poucos itens de descoberta/complemento por campanha;
- cesta ou solução completa quando isso for mais útil que itens separados.

Para cestas básicas, não expor o preço individual dos componentes.

### Elegibilidade mínima

Antes de cada envio revalidar:

1. consentimento atual para receber ofertas no WhatsApp;
2. cliente ativo e canal válido;
3. 10 dias desde a compra válida mais recente ou desde o marco de contato definido pela política de pressão comercial;
4. ausência de opt-out/bloqueio;
5. ausência de atendimento humano aberto, reclamação pendente ou situação que torne marketing inadequado;
6. template aprovado e disponível;
7. qualidade/saúde da conta Meta dentro do limite definido;
8. produto ativo, com estoque e preço válidos;
9. validade compatível com a data prevista de entrega;
10. deduplicação/idempotência da campanha;
11. orçamento/cap diário de segurança.

A compra anterior **não substitui consentimento de marketing**.

A política oficial do WhatsApp exige consentimento para contatos posteriores e, para conversas iniciadas pela empresa, uso de template aprovado. Opt-outs devem ser respeitados imediatamente.

## E-mail marketing

Clientes que possuírem e-mail válido e consentimento aplicável devem entrar em uma cadência própria de **10 dias**, também reiniciada por nova compra válida.

### Conteúdo

E-mails devem seguir padrão profissional:

- assunto e preheader claros;
- identidade visual Dona Antônia;
- produtos relacionados ao perfil e histórico do cliente;
- itens recorrentes e reposição provável;
- ofertas reais e vigentes;
- poucos complementos de descoberta;
- imagens oficiais e links rastreáveis;
- CTA para Sala de Compra/WhatsApp conforme estratégia;
- versão mobile responsiva;
- link de descadastro visível;
- identificação da empresa e política de privacidade.

### Infraestrutura necessária

A base atual de `customers` não possui e-mail estruturado. Implementar antes do envio:

- contatos de e-mail normalizados, preferencialmente em `customer_emails`;
- e-mail principal, origem, verificação e status;
- consentimento por canal/finalidade;
- lista de supressão;
- bounce/complaint/unsubscribe;
- autenticação de domínio SPF, DKIM e DMARC;
- provedor transacional/marketing definido e encapsulado por adapter;
- webhook de entrega/bounce/complaint;
- rate limit e orçamento;
- rastreio sem guardar dados sensíveis em logs públicos.

## Coordenação entre canais

WhatsApp e e-mail possuem cadência própria de 10 dias, mas a central de marketing deve conhecer ambos os canais para evitar excesso de contato.

O administrador poderá definir horário, prioridade e eventual espaçamento entre canais sem alterar a regra-base de elegibilidade de 10 dias.

Aniversário, recompra e outras campanhas competem pela atenção do cliente. Não enviar várias iniciativas promocionais no mesmo momento sem uma regra explícita.

## Personalização

A personalização deve usar dados observáveis e comerciais:

- produtos, marcas e categorias compradas;
- frequência e recência;
- quantidade normalmente comprada;
- complementos aceitos/recusados;
- itens removidos da cesta;
- ofertas respondidas;
- canal e formato preferidos;
- preferências declaradas.

Não inferir atributos sensíveis a partir das compras.

O motor já existente de recomendações e `customer_product_stats` deve ser reaproveitado e evoluído, não duplicado.

## Dados e tabelas a implementar

Estrutura alvo sugerida:

```text
customer_emails
marketing_consents / consent_events por canal
marketing_contact_state
marketing_campaigns
marketing_campaign_versions
marketing_candidates
marketing_deliveries
marketing_suppressions
marketing_template_registry
marketing_attribution
email_delivery_events
```

`marketing_contact_state` deve controlar pelo menos:

```text
customer_id
channel
last_effective_purchase_at
last_marketing_at
next_eligible_at
no_response_streak
suppressed_until
opt_out_at
updated_at
```

## Auditoria e métricas

Medir por canal e campanha:

- elegíveis;
- excluídos e motivo;
- enviados;
- entregues;
- falhas;
- respostas;
- cliques quando disponíveis;
- opt-outs;
- pedidos atribuídos;
- receita e margem conhecida;
- custo Meta/e-mail/Make/IA;
- recompra;
- grupo de controle/piloto quando aplicável.

Não atribuir causalidade automaticamente apenas porque o cliente comprou após uma campanha.

## Segurança operacional

Toda campanha nasce `draft/paused`.

Nenhuma criação de regra, template ou IA deve habilitar envio automaticamente.

Antes do primeiro piloto real:

- lista allowlisted;
- templates aprovados;
- e-mail autenticado;
- consentimentos testados;
- opt-out testado ponta a ponta;
- dedupe testado;
- caps pequenos;
- rollback/kill switch;
- relatórios de entrega;
- atribuição e custo.

## Situação em 08/09/2026

Já existe no projeto:

- `birthday_day` / `birthday_month`;
- `marketing_opt_in` e trilha de consentimento inicial;
- `customer_product_stats`;
- perfil de compra e recomendações;
- histórico/comportamento comercial;
- WhatsApp Cloud API em uso para atendimento;
- infraestrutura de outbound event-driven.

Ainda não existe o motor de campanhas de marketing desta decisão, não existe cenário de marketing no Make e a base `customers` ainda não possui e-mail estruturado.

Portanto esta decisão é **requisito oficial de implementação**, não funcionalidade ativa.