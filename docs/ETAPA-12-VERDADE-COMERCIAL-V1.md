# Etapa 12 — Verdade Comercial V1

Atualizado em 08/09/2026.

Status: **BLOCO 1 PROGRAMÁVEL — DORMENTE POR PADRÃO**.

Este bloco cria a base determinística de lotes, validade, FEFO e guardião de margem. Não ativa ofertas, cupons, benefícios, marketing, estoque por lote real, sincronização Bling ou qualquer gasto/API externa.

## Princípios

- `products.stock` continua sendo o estoque agregado legado enquanto a operação por lotes não for homologada.
- `inventory_lots` nasce vazio e não retropreenche lotes automaticamente a partir de `products.validity_date` ou estoque atual.
- FEFO só considera lote `available`, fisicamente verificado, com quantidade livre e validade compatível com a data prevista de entrega.
- lote sem validade fica depois de lotes com validade no ordenamento FEFO; não é tratado como vencido por inferência.
- uma automação comercial nunca pode usar OpenAI como verdade de preço, custo, margem ou validade.
- descontos por validade exigem política versionada ativa e passam pelo guardião de margem.
- todos os previews retornam `external_side_effect=false`.

## Objetos

Migration:

`20260908130000_stage12_commercial_truth_foundation_v1.sql`

Cria:

- `commercial_truth_runtime_config`;
- `inventory_lots`;
- `inventory_lot_movements`;
- `commercial_policy_versions`;
- `promotion_rules`;
- `margin_guard_events`;
- `preview_fefo_allocation_v1`;
- `evaluate_margin_guard_v1`;
- `preview_expiry_offer_v2`;
- `stage12_readiness_v1`.

Todas as tabelas possuem RLS e acesso server-only. As RPCs ficam restritas a `service_role`.

## Gates padrão

```text
enabled=false
execution_mode=off
lot_tracking_enabled=false
fefo_enforcement_enabled=false
expiry_block_enabled=false
promotions_enabled=false
benefits_enabled=false
margin_guard_enabled=false
reports_enabled=false
canary_percent=0
```

## FEFO

`preview_fefo_allocation_v1(product, quantity, delivery_date, min_shelf_life_days)` é read-only. Ele ordena por:

1. menor `expires_at` válido;
2. menor `received_at`;
3. UUID para desempate estável.

Lotes não verificados, bloqueados/quarentenados, vencidos ou incompatíveis com `delivery_date + min_shelf_life_days` não entram na alocação.

O preview informa `sufficient`, `shortage` e a composição por lote, sem reservar ou consumir estoque.

## Guardião de margem

`evaluate_margin_guard_v1` recebe receita bruta, custo estimado, desconto proposto e margem mínima. A matemática é exclusivamente backend determinístico.

Bloqueios explícitos:

- receita líquida zero;
- margem negativa;
- margem abaixo do mínimo configurado.

Não existe aplicação automática de desconto neste bloco.

## Política de validade

O preview legado `preview_expiry_offer` permanece histórico. O novo `preview_expiry_offer_v2` só sugere oferta quando existe `commercial_policy_versions(policy_key='expiry_discount', status='active')`.

As faixas de dias e percentuais ficam em JSON versionado; a oferta só é elegível se o guardião de margem também permitir. O retorno sempre contém `applied=false`.

Nenhuma política ativa é semeada pela migration. Logo nenhuma oferta nasce liberada.

## Custo e integração

Não foi adicionado Make, OpenAI, Maps ou API paga. FEFO, validade e margem são regras locais e determinísticas; Supabase/Postgres é a opção de menor custo e maior consistência para este bloco.

GitHub Actions executa os testes batch/CI. Não existe polling ou cron pago.

## Testes

O workflow `Stage 12 Commercial Truth` usa sparse checkout e PGlite. Valida:

- defaults OFF;
- RLS/server-only;
- FEFO determinístico;
- exclusão de lote não verificado ou incompatível com a data de entrega;
- insuficiência de estoque explícita;
- guardião de margem allow/block;
- ausência de desconto sem política ativa;
- preview de desconto com política versionada;
- bloqueio de oferta economicamente inviável;
- nenhum side effect externo.

## Próximo bloco seguro da Etapa 12

Após CI e migration dormente verdes:

- Admin de lotes/políticas atrás de feature flag;
- ledger de reserva/consumo por lote com idempotência;
- compatibilidade FEFO no checkout/separação em `observe/dry_run` antes de enforcement;
- relatórios/snapshots de validade, giro, ruptura e margem por GitHub Actions;
- benefícios/cupons/brindes/birthday apenas como drafts/policies OFF até decisão comercial.
