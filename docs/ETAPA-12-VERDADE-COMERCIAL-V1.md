# Etapa 12 — Verdade Comercial V1

Atualizado em 08/09/2026.

Status: **FUNDAÇÃO PROGRAMÁVEL SEGURA — DORMENTE POR PADRÃO**.

Esta etapa consolida lotes, validade, FEFO, ofertas, benefícios e margem no Supabase sem reativar o motor antigo de ofertas e sem alterar o atendimento ou o catálogo comercial atual.

## Princípio

A verdade comercial passa a obedecer a esta ordem:

```text
produto
→ lote / quantidade / validade / custo
→ elegibilidade de venda
→ FEFO
→ guardião de margem
→ promoção/benefício/cupom
→ recomendação
→ execução futura controlada
```

OpenAI não calcula estoque, validade, custo, desconto permitido ou margem. Esses fatos são determinísticos no backend.

## Estado anterior encontrado

Antes da Etapa 12:

- `products` possui estoque, custo, preço e uma única `validity_date` por produto;
- 318 produtos estavam no Supabase, todos com custo e estoque, 239 com validade;
- havia 1 produto com preço menor ou igual ao custo;
- a rotina legada de validade trabalhava no Firebase e aplicava faixas automáticas sem guardião de margem;
- o workflow GitHub `Processar ofertas automáticas` já havia sido desativado na consolidação do projeto;
- `customer_product_stats` usa pedidos não cancelados, então não serve sozinho como verdade de compras efetivamente entregues.

A Etapa 12 não apaga essa história. Ela cria uma verdade nova e mantém a antiga desligada até migração/homologação explícita.

## Lotes e estoque

Novas estruturas:

- `inventory_lots`;
- `inventory_lot_movements`;
- `inventory_lot_reservations`;
- `product_lot_stock_v1`.

Lotes registram quantidade física, quantidade reservada, custo unitário, validade, origem, localização e estado de conferência.

`products.stock` continua sendo a verdade usada pelo runtime atual enquanto `lot_truth_enabled=false`. Um lote em `draft` não altera estoque oficial e não participa do FEFO.

Somente lotes `available` + `physically_verified=true` podem participar de uma alocação FEFO futura.

## FEFO

`preview_fefo_allocation_v1` é read-only e ordena por:

1. validade mais próxima;
2. recebimento mais antigo;
3. ID estável.

Também exige validade compatível com a data prevista de entrega e a política `minimum_delivery_shelf_life_days`.

`reserve_inventory_lots_fefo_v1` existe para homologação futura, porém retorna `fefo_reservations_disabled` enquanto os gates estiverem OFF.

Liberação de reserva é permitida como caminho seguro de recuperação mesmo após kill switch; consumo continua gated.

## Guardião de Margem

`margin_guard_v1` recebe produto, preço proposto, quantidade e contexto.

Ele calcula deterministicamente:

- preço normal;
- preço proposto;
- custo unitário efetivo;
- margem em R$;
- margem percentual;
- desconto percentual;
- markdown estimado;
- orçamento promocional restante;
- política aplicada.

A política mais específica prevalece:

```text
produto > categoria > global > defaults do runtime
```

Motivos de bloqueio incluem:

- `cost_unknown`;
- `below_cost`;
- `min_margin_brl_not_met`;
- `min_margin_percent_not_met`;
- `max_discount_exceeded`;
- `promotion_budget_exhausted`.

Defaults deliberadamente conservadores:

```text
default_min_margin_percent = 0
default_min_margin_brl = 0
default_max_discount_percent = 0
promotion_budget_brl = 0
```

Isso permite venda normal acima do custo, mas impede qualquer desconto automático até configuração/revisão explícita.

## Validade e descontos

As 8 faixas antigas de validade foram preservadas somente como `draft` com origem `legacy_firebase_reference`:

- 3–7 dias: 50%;
- 8–15: 40%;
- 16–31: 35%;
- 32–46: 30%;
- 47–65: 25%;
- 66–76: 20%;
- 77–91: 10%;
- 92–105: 5%.

Nenhuma faixa nasce ativa.

`preview_expiry_offer_v2` exige simultaneamente:

- produto comercialmente elegível;
- engine de validade habilitada;
- regra ativa;
- validade compatível com entrega;
- preço válido;
- aprovação do guardião de margem;
- orçamento suficiente.

Com o estado padrão, responde `expiry_discount_disabled` e não grava nada.

## Promoções, cupons e benefícios

Estruturas dormentes:

- `promotion_campaigns`;
- `promotion_items`;
- `promotion_budget_events`;
- `commercial_coupons`;
- `commercial_benefit_policies`;
- `customer_benefit_grants`.

Todos nascem `enabled=false` e `execution_mode=off`.

A API administrativa consegue criar somente rascunhos. Não há operação de ativação/publicação.

## Aniversário

O cadastro já possui `birthday_day` e `birthday_month`.

`preview_birthday_benefit_v1` trabalha no mês de aniversário, mas só retorna benefício quando existir política ativa e o `benefit_engine_enabled` estiver liberado.

Por padrão retorna `birthday_benefit_runtime_disabled`.

## Recomendações baseadas em compras reais

Foi criada `delivered_customer_product_stats_v1`, que considera exclusivamente:

```text
orders.status = delivered
```

A nova `get_customer_recommendations_commercial_v2` usa:

- compras entregues;
- elegibilidade de estoque/validade;
- guardião de margem;
- afinidade por categoria;
- oferta/upsell somente quando comercialmente seguro.

Ela não substitui automaticamente as funções atuais. Permanece preparada para homologação futura.

## Relatórios

Foram preparados:

- `commercial_product_health_v1`;
- `commercial_expiry_report_v1`;
- `commercial_report_summary_v1`.

Eles expõem estoque efetivo, validade efetiva, ruptura, vencimento, custo desconhecido, margem de risco e indicadores de promoções/benefícios.

## Central Comercial no Admin

A área `COMERCIAL` foi preparada atrás de:

```text
commercialTruthUiEnabled=false
```

Inclui:

- indicadores de saúde comercial;
- próximos vencimentos;
- riscos de margem;
- lotes;
- campanhas;
- simulador de margem;
- preview FEFO;
- criação de lote draft;
- edição de thresholds em modo draft;
- kill switch.

A Edge `admin-commercial-truth-v1` exige JWT + `admin_users` e não possui ação para ligar runtime.

## Gates padrão

```text
enabled=false
execution_mode=off
lot_truth_enabled=false
lot_reservations_enabled=false
fefo_enabled=false
expiry_discount_enabled=false
promotion_engine_enabled=false
benefit_engine_enabled=false
margin_guard_enforced=false
recommendation_guard_enabled=false
legacy_offer_engine_allowed=false
canary_percent=0
commercialTruthUiEnabled=false
```

## Motor legado

`.github/workflows/processar-ofertas.yml` deve continuar com `LEGADO DESATIVADO` e sem `schedule`, `repository_dispatch` ou cadeia automática.

Os scripts antigos permanecem no Git apenas como histórico/referência até uma futura decisão de remoção. A Etapa 12 não usa Firebase como motor de promoções.

## CI

`Stage 12 Commercial Truth` valida:

- RLS e acesso server-only;
- defaults OFF;
- ausência de HTTP externo nas migrations;
- faixas antigas somente draft;
- FEFO determinístico;
- bloqueio de reserva por gate;
- guardião contra venda abaixo do custo/desconto não autorizado;
- promoções/benefícios/cupom OFF;
- compras entregues como fonte da recomendação segura;
- workflow legado desativado;
- Admin oculto;
- JWT da Edge;
- PGlite com as quatro migrations aplicadas;
- `deno check` da Edge Function.

## Fora de escopo de ativação

Não autoriza:

- migrar estoque atual para lotes automaticamente;
- ativar `lot_truth_enabled`;
- reservar/consumir lotes em pedidos reais;
- ativar regra de validade;
- publicar ofertas;
- habilitar cupons ou benefícios;
- enviar campanha/aniversário;
- trocar a função de recomendação em produção;
- reativar o motor antigo de ofertas;
- ativar Bling, Flow, Instagram, Messenger, Ads ou logística;
- alterar o WhatsApp `live=1%`.

A aplicação das migrations deve ocorrer somente após CI verde e auditoria pré-DDL dos invariantes existentes.
