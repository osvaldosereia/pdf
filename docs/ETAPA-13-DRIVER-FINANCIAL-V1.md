# Etapa 13C — Driver App + contexto financeiro operacional V1

Status: fundação programável dormente.

## Objetivo

Levar a verdade financeira determinística da Etapa 13 para o App do Entregador sem transformar a observação do entregador em conciliação bancária ou confirmação fiscal.

O entregador precisa saber, por parada:

- **JÁ PAGO** — não cobrar novamente;
- **COBRAR** — valor restante, forma esperada e troco quando houver;
- **REVISAR** — impedir conclusão normal quando o estado financeiro estiver incerto/incompatível.

A regra central continua:

`ENTREGA` ≠ `RECEBIMENTO OPERACIONAL` ≠ `CONCILIAÇÃO` ≠ `FISCAL_READY`.

## Novos gates

Todos nascem `false`:

- `driver_financial_context_enabled`;
- `driver_collection_recording_enabled`;
- `driver_delivery_financial_guard_enabled`.

O runtime financeiro continua `enabled=false`, `execution_mode=off`, `canary_percent=0` em produção.

## Contexto financeiro da parada

`preview_driver_order_collection_v1(order_id, route_id)` combina de forma determinística:

- total do pedido;
- eventos confirmados/reconciliados do ledger;
- eventos ainda `observed/review_required`;
- última expectativa de recebimento da Etapa 13B;
- saldo restante;
- método esperado;
- valor que o cliente informou que entregará em dinheiro;
- troco necessário.

Decisões:

- `covered`: pedido já coberto pelo ledger operacional; não cobrar;
- `collect`: saldo definido e método de cobrança disponível;
- `review_required`: estado incerto, pagamento antecipado incompleto na rota, ausência de expectativa, pagamento observado ainda não conciliado, sobrepagamento ou outra inconsistência.

## Snapshot do entregador

`get_driver_route_snapshot_v2()` preserva o snapshot logístico existente e enriquece cada parada com `financial`.

Também entrega um resumo de rota somente de leitura:

- pedidos a cobrar;
- pedidos em revisão;
- total a cobrar;
- total em dinheiro;
- Pix;
- cartão;
- link;
- outros;
- troco necessário.

Se o financeiro estiver desligado, o snapshot logístico continua disponível sem contexto financeiro adicional.

## Registro da entrega e recebimento

`driver_deliver_stop_v3()` substitui o caminho do Driver App, mantendo `v2` apenas por compatibilidade histórica.

Quando `driver_delivery_financial_guard_enabled=true`:

### Pedido já pago

- não aceita nova cobrança;
- permite registrar apenas a entrega;
- pagamento antecipado sozinho nunca significou entrega; a entrega continua sendo fato separado.

### Pedido a cobrar

- exige payload de recebimento antes de concluir a entrega;
- valor precisa ser exatamente o saldo restante calculado pelo backend;
- para dinheiro, o valor entregue pelo cliente não pode ser menor que o saldo;
- troco é calculado em centavos inteiros;
- divergência bloqueia antes de mutar parada/pedido/ledger.

### Pedido em revisão

- a entrega normal é bloqueada com `financial_review_required`;
- o caso deve seguir para tratamento operacional, não ser resolvido por inferência da IA.

## Reconhecimento por forma de pagamento

### Dinheiro

O entregador presencia fisicamente o recebimento. O ledger registra:

`recognition_status = operational_confirmed`

Ainda assim, o caixa será confrontado no fechamento da rota. O lançamento não é considerado conciliação final automaticamente.

### Pix, cartão e link na entrega

O entregador pode observar a evidência apresentada, mas não é autoridade do provider. O ledger registra:

`recognition_status = observed`

O pagamento permanece aguardando conciliação posterior com provider/adquirente/banco quando essa integração for homologada.

## Separação fiscal obrigatória

`driver_deliver_stop_v3()` **não chama** `confirm_order_payment_v1()`.

Após a entrega, ele atualiza apenas o fato logístico em `order_fiscal_controls` e chama `refresh_order_fiscal_readiness_v1()` para recalcular o estado já existente.

Se nenhuma outra fonte governada confirmou o pagamento no domínio fiscal:

- `payment_status` permanece `pending`;
- `fiscal_status` permanece bloqueado;
- nenhuma NF-e é preparada ou emitida.

Isso preserva a decisão oficial:

`ENTREGUE + PAGAMENTO CONFIRMADO → FISCAL_READY → NF-e`.

## Driver PWA

A tela mobile agora apresenta:

- card verde **JÁ PAGO**;
- card de cobrança com valor, método e troco;
- card vermelho de **REVISÃO**;
- resumo financeiro da rota;
- sheet de confirmação de recebimento;
- mensagens explícitas de que Pix/cartão/link aguardam conciliação;
- fila offline existente preservada.

A fila offline não contorna validações. Ao reconectar, a requisição é revalidada no servidor contra rota, entregador, saldo, método e gates atuais.

## Segurança

- funções novas server-only;
- `public/anon/authenticated` sem `EXECUTE`;
- apenas `service_role` executa RPCs financeiras internas;
- valores financeiros em centavos inteiros;
- idempotência reaproveita `client_event_id` e gera chave de ledger `driver-collection:<client_event_id>`;
- nenhuma confiança é depositada no valor apresentado pela interface: o backend compara com o saldo calculado;
- nenhum provider externo é chamado.

## Integrações externas

Este bloco não chama:

- banco/Pix provider;
- adquirente/cartão;
- Bling financeiro;
- Bling fiscal;
- SEFAZ;
- Make;
- OpenAI;
- Maps/GPS adicional;
- HTTP financeiro externo.

A Edge Function `driver-logistics-v1` é atualizada no repositório para usar `v3`, mas não deve ser implantada/ativada automaticamente. O App do Entregador também permanece `enabled=false`.

## Testes

O CI específico cobre:

1. gates OFF e fail-closed;
2. snapshot com dinheiro + troco;
3. Pix antecipado já coberto → não cobrar novamente;
4. Pix na porta → ledger `observed`;
5. dinheiro na porta → ledger `operational_confirmed`;
6. valor divergente → bloqueio antes de entrega;
7. `confirm_order_payment_v1` transformada em erro no teste, provando que `v3` não a chama;
8. `order_fiscal_controls.payment_status` permanece `pending` após os registros do entregador;
9. PWA continua desabilitada por configuração;
10. `deno check` da Edge Function e `node --check` do PWA.

## Próximos blocos seguros da Etapa 13

Após 13C, ainda faltam para concluir a parte programável da etapa:

1. adapters abstratos de conciliação Pix/cartão/link, inicialmente sem provider real;
2. read model/Admin financeiro e central de exceções financeiras atrás de gate OFF;
3. GitHub Actions para reconciliação batch/auditoria;
4. política de limites/ajustes automáticos configurável;
5. somente depois, projeção determinística e homologada do ledger conciliado para o gate fiscal existente.

Nenhum desses itens autoriza movimentação financeira real ou rollout do Driver App.
