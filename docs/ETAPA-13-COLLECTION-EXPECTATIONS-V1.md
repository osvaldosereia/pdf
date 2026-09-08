# Etapa 13B — Expectativas de Recebimento e Manifesto Financeiro de Rota

Status: fundação programável dormente.

## Objetivo

Preparar a operação para saber, antes da saída do entregador:

- quanto cada pedido ainda precisa receber;
- forma de pagamento esperada;
- se o pedido já está coberto por pagamento antecipado;
- quanto de dinheiro precisa ser recebido na rua;
- quanto de troco precisa ser preparado;
- quais pedidos exigem revisão antes da rota;
- total esperado de arrecadação por rota e por meio de pagamento.

A fundação **não confirma pagamento**, **não confirma entrega**, **não altera rota** e **não libera NF-e**.

## Regra fundamental

`EXPECTATIVA DE PAGAMENTO` ≠ `PAGAMENTO RECEBIDO`.

Uma intenção como “vou pagar no Pix” ou “vou pagar R$ 120 em dinheiro” é um dado operacional de cobrança. Ela não cria um fato financeiro.

Somente um evento no ledger financeiro pode representar recebimento observado/confirmado/reconciliado.

Da mesma forma:

`PAGAMENTO ANTECIPADO` ≠ `ENTREGA`.

Mesmo quando o saldo financeiro já estiver coberto antes da rota, a decisão fiscal continua dependente da entrega real e dos demais gates já existentes.

## Novos gates

Adicionados em `financial_runtime_config`, todos `false` por padrão:

- `payment_expectation_preview_enabled`;
- `payment_expectation_recording_enabled`;
- `route_collection_manifest_preview_enabled`;
- `route_collection_manifest_recording_enabled`.

Nenhum deles é habilitado por migration.

## `financial_payment_expectations`

Tabela append-only e versionada por pedido.

Campos principais:

- `order_id`;
- `version_no`;
- `supersedes_expectation_id`;
- `collection_mode`: `prepaid`, `on_delivery`, `mixed`, `unknown`;
- `expected_method`;
- `expected_amount_cents`;
- `tender_amount_cents`;
- `change_required_cents`;
- `due_at`;
- `decision`;
- snapshot auditável.

Uma mudança futura de expectativa cria uma **nova versão** em vez de editar a anterior.

## Dinheiro e troco

Exemplo:

- pedido: R$ 100,00;
- cliente informa que pagará R$ 120,00 em dinheiro;
- saldo ainda devido: R$ 100,00;
- `change_required_cents=2000`.

Esse valor alimenta o manifesto da rota para ajudar a preparar numerário.

O sistema não presume que o pagamento ocorreu apenas porque o cliente informou o valor que pretende entregar.

## Pagamento antecipado

A expectativa `prepaid` pode estar normalmente pendente antes do pagamento ocorrer.

Exemplo:

- pedido R$ 50,00;
- esperado `prepaid_pix`;
- ainda não há evento financeiro.

Resultado da expectativa:

`decision=expected`, `reason=prepayment_pending`.

Quando o ledger registrar R$ 50,00 como recebido/reconciliado, o saldo da expectativa passa a zero (`covered`).

Se o pedido entrar numa rota ainda com saldo apesar de estar marcado como `prepaid`, o **manifesto da rota** exige revisão. Assim não mandamos o entregador para a rua supondo que um pré-pagamento aconteceu quando ele ainda não está no ledger.

## `financial_route_collection_manifests`

Snapshot append-only por versão da rota.

Consolida:

- pedidos da rota;
- total comercial esperado;
- valor já recebido;
- saldo a cobrar;
- cobrança em dinheiro;
- Pix;
- cartão;
- link;
- outros meios;
- troco necessário;
- número de pedidos a cobrar;
- número de pedidos que exigem revisão.

O manifesto pode resultar em:

- `ready`: as expectativas estão coerentes para a saída;
- `review_required`: falta expectativa, há pré-pagamento pendente, pagamento acima do pedido ou outra incoerência.

## RPCs server-only

- `financial_readiness_v2()`;
- `preview_order_payment_expectation_v1(...)`;
- `record_order_payment_expectation_v1(...)`;
- `preview_route_collection_manifest_v1(route_id)`;
- `record_route_collection_manifest_v1(route_id,idempotency_key)`.

Todas as gravações exigem gate e idempotência.

## Segurança e invariantes

- RLS/server-only;
- tabelas de expectativa/manifesto são append-only;
- o guard de imutabilidade é o `SECURITY INVOKER` já corrigido na Etapa 13A;
- nenhuma RPC atualiza `orders`;
- nenhuma RPC atualiza `delivery_routes`, `delivery_jobs` ou `delivery_stops`;
- nenhuma RPC atualiza `order_fiscal_controls`;
- não chama `confirm_order_payment_v1`;
- não chama Bling/SEFAZ;
- não chama banco/Pix/adquirente;
- não chama Make/OpenAI/HTTP externo.

## Teste representativo

O CI monta uma rota com dois pedidos:

1. R$ 100,00, pagamento na entrega em dinheiro, cliente entregará R$ 120,00 → R$ 20,00 de troco;
2. R$ 50,00, pagamento antecipado por Pix.

Antes do Pix chegar ao ledger, o manifesto exige revisão e mostra R$ 150,00 ainda pendentes.

Depois que um evento financeiro de R$ 50,00 cobre o segundo pedido, o manifesto fica `ready` e mostra somente:

- R$ 100,00 a cobrar;
- tudo em dinheiro;
- R$ 20,00 de troco necessário.

Nenhuma dessas operações confirma entrega, muda rota ou libera fiscal.

## Próximo bloco

Etapa 13C deverá integrar o **Driver App ao ledger/expectativas** atrás de gates próprios, preservando a distinção entre:

- informação de como cobrar;
- evento informado pelo entregador;
- reconhecimento operacional;
- conciliação externa;
- projeção fiscal.

Nenhum provider financeiro real deve ser ativado nesse primeiro passo.
