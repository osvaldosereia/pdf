# Etapa 13A — Financial Ledger Operacional V1

Status: fundação programável dormente.

## Objetivo

Separar corretamente:

`ENTREGUE` ≠ `RECEBIDO` ≠ `CONCILIADO` ≠ `FISCAL_READY`.

A Etapa 11 já possui confirmação operacional de pagamento ligada ao gate fiscal. Esta fundação da Etapa 13 cria a verdade financeira auditável que futuramente permitirá conciliar dinheiro, Pix, cartão/link e fontes externas sem apagar histórico ou inferir pagamento por IA.

## Princípios

- ledger append-only;
- correção por evento de reversão, nunca UPDATE do lançamento original;
- valores em centavos inteiros no ledger;
- idempotência obrigatória;
- pagamento, entrega, fiscal e rota permanecem domínios separados;
- nenhum provider externo no V1;
- incerteza vira `review_required`;
- nenhuma divergência é automaticamente perdoada sem tolerância configurada;
- tolerância financeira é configuração, não hardcode;
- IA pode explicar divergências, nunca decidir que um valor foi recebido.

## Objetos

### `financial_runtime_config`

Todos os gates nascem OFF:

- `enabled=false`;
- `execution_mode=off`;
- `preview_enabled=false`;
- `receipt_recording_enabled=false`;
- `reversal_recording_enabled=false`;
- `route_cash_recording_enabled=false`;
- `route_close_preview_enabled=false`;
- `route_close_recording_enabled=false`;
- `reconciliation_case_recording_enabled=false`;
- `fiscal_projection_enabled=false`;
- `external_reconciliation_enabled=false`;
- `canary_percent=0`.

`allowed_cash_difference_cents` nasce `NULL`: diferença diferente de zero exige revisão até o proprietário configurar uma política.

### `financial_ledger_entries`

Eventos imutáveis:

- `payment_received`;
- `payment_reversed`;
- `route_cash_float_start`;
- `route_cash_declaration`;
- `route_cash_handover`.

Reconhecimento:

- `observed`;
- `operational_confirmed`;
- `reconciled`;
- `review_required`.

O trigger `trg_financial_ledger_append_only` bloqueia UPDATE e DELETE. Reversão cria novo evento referenciando o lançamento original.

### `financial_route_close_evaluations`

Snapshot append-only do fechamento financeiro de rota. Não encerra a rota e não muda o entregador.

### `financial_reconciliation_cases`

Fila estruturada para divergência de pedido, caixa da rota, provider ou alinhamento fiscal.

## RPCs server-only

- `financial_readiness_v1()`;
- `preview_order_financial_state_v1(order_id)`;
- `record_payment_receipt_v1(...)`;
- `record_payment_reversal_v1(...)`;
- `record_route_cash_event_v1(...)`;
- `preview_route_financial_close_v1(route_id)`;
- `record_route_close_evaluation_v1(...)`;
- `open_financial_reconciliation_case_v1(...)`.

Todas são revogadas de `public/anon/authenticated` e concedidas somente a `service_role`.

## Estado financeiro por pedido

O preview calcula deterministicamente:

- valor esperado = `orders.total` convertido para centavos;
- recebimentos operacionais/reconciliados;
- reversões;
- saldo líquido recebido;
- diferença;
- entradas ainda observadas/em revisão;
- estado: `pending`, `balanced`, `underpaid`, `overpaid` ou `review_required`;
- alinhamento somente de leitura com `order_fiscal_controls`.

O V1 **não chama** `confirm_order_payment_v1`, não atualiza `order_fiscal_controls` e não prepara NF-e.

## Dinheiro do entregador / rota

O fechamento usa:

`caixa inicial + recebimentos em dinheiro - reversões = caixa esperado`.

Compara com a última declaração do entregador.

- diferença zero -> `balanced`;
- diferença não zero + tolerância não configurada -> `review`;
- diferença dentro de tolerância explicitamente configurada -> `balanced` com motivo auditável;
- diferença acima da tolerância -> `review`;
- entradas não resolvidas -> `review`.

A função de avaliação nunca muda `delivery_routes.status`.

## Relação com o fluxo fiscal

Fluxo futuro desejado:

`delivery event → financial event → reconciliation → fiscal projection → fiscal readiness`.

Por segurança, `fiscal_projection_enabled=false` e **não existe executor de projeção fiscal neste V1**. O gate fiscal existente da Etapa 11 continua intacto.

## Integrações externas

Não existem chamadas para:

- banco;
- Pix/provider financeiro;
- adquirente/cartão;
- Bling financeiro;
- SEFAZ;
- Make;
- OpenAI;
- HTTP externo.

`external_reconciliation_enabled=false` é apenas uma reserva arquitetural para bloco posterior.

## Testes

O CI específico valida:

- gates OFF;
- fail-closed;
- receipt idempotente;
- ledger imutável;
- reversão por evento;
- fechamento de rota sem mutar logística;
- divergência/fiscal somente em leitura;
- reconciliation case sem ação externa;
- ausência de transportes/providers.

## Próximos blocos da Etapa 13

1. expectativa de recebimento por pedido/rota e pagamento antecipado;
2. integração do Driver App com ledger, ainda atrás de gate;
3. conciliação Pix/cartão/link por adapters sem provider real inicialmente;
4. read model/Admin financeiro;
5. GitHub Actions de reconciliação batch;
6. somente após homologação, projeção determinística para o gate fiscal existente.

Nenhum bloco autoriza movimentação financeira real ou alteração do canary do WhatsApp.
