# Etapa 12 — Order Promise + Order Change Control V1

Atualizado em 08/09/2026.

Status: **FUNDAÇÃO PROGRAMÁVEL DORMENTE — NÃO AUTORIZA PROMESSA AUTOMÁTICA NEM ALTERAÇÃO DE PEDIDO EM PRODUÇÃO**.

## Objetivo

Fechar duas lacunas operacionais entre venda, estoque e WMS:

1. não prometer uma data de entrega sem comprovar estoque/lote e capacidade operacional;
2. não permitir que um pedido digital seja alterado silenciosamente depois de materializado no WMS.

O módulo é determinístico. OpenAI pode futuramente explicar o resultado ou conversar com o cliente, mas não decide disponibilidade, validade, capacidade ou bloqueio operacional.

## Order Promise / ATP-CTP leve

A avaliação combina:

- itens reais do carrinho ou pedido;
- FEFO oficial de `inventory_lots`;
- somente lotes `available`, fisicamente verificados e com saldo livre;
- validade compatível com a data pretendida de entrega;
- capacidade diária de fulfillment;
- capacidade diária em unidades;
- capacidade de paradas de entrega;
- quantidade de entregadores disponíveis configurada para o dia;
- cutoff de entrega no mesmo dia;
- compromissos já registrados para aquela data;
- presença de endereço operacional.

Não há geocoding, Maps, IA, Bling, Make ou qualquer transporte externo nesta versão.

### Fail closed

`order_promise_runtime_config` nasce com:

- `enabled=false`;
- `execution_mode=off`;
- `preview_enabled=false`;
- `evaluation_recording_enabled=false`;
- `commitment_write_enabled=false`;
- `inventory_reservation_on_commit_enabled=false`;
- `change_control_enabled=false`;
- `canary_percent=0`.

Sem regra diária ativa de capacidade, a avaliação retorna `review`, não inventa capacidade.

Sem endereço, data válida ou estoque/lote suficiente, retorna `blocked` quando o fato torna a promessa impossível.

Capacidade incompleta/ausente retorna `review`.

## Capacidade diária

`order_promise_daily_capacity` representa uma fotografia configurável por data:

- `fulfillment_max_orders`;
- `fulfillment_max_item_units`;
- `delivery_max_stops`;
- `available_drivers`;
- `same_day_cutoff_local`;
- `version_no`.

A linha nasce `draft`; somente `status=active` entra no cálculo.

Isso atende à operação da Dona Antônia com dois entregadores sem assumir que os dois sairão todos os dias. Um dia pode ser configurado com `available_drivers=1`, outro com `2`, e futuramente um planner poderá sugerir essas capacidades sem substituir a decisão determinística.

## Avaliação de carrinho e pedido

RPCs server-only:

- `preview_cart_promise_v1`;
- `preview_order_promise_v1`;
- `preview_order_promise_core_v1`;
- `preview_promise_inventory_v1`.

O retorno contém:

- `eligible`, `review` ou `blocked`;
- motivos estruturados;
- resultado por item;
- lotes FEFO que suportariam a quantidade;
- snapshot de capacidade;
- unidades totais;
- confirmação de presença de endereço;
- `external_side_effect=false`.

A versão atual não confirma o carrinho/pedido e não reserva estoque automaticamente.

## Avaliações auditáveis

`order_promise_evaluations` registra uma avaliação somente quando `evaluation_recording_enabled=true`.

`evaluation_key` dá idempotência. Repetir a mesma gravação não duplica evento.

`order_promise_commitments` já existe como estrutura para a próxima evolução de capacidade/reserva, porém `commitment_write_enabled=false` e não existe nesta versão um caminho público/automático de commit.

Antes de habilitar commit real, a implementação deve reservar os lotes FEFO atomicamente e possuir liberação/compensação idempotente; não será permitido comprometer capacidade sem proteger o estoque correspondente.

## Order Change Control

O status comercial de `orders` não foi expandido com estados de picking.

`preview_order_change_control_v1` deriva o lock operacional do estado real:

- sem fulfillment materializado: `editable`;
- fulfillment `pending`: `soft_locked`;
- picking/checking/packing/ready/loading etc.: `fulfillment_locked`;
- pedido `ready`, em rota, entregue, cancelado ou devolvido: `closed`.

### Regra central

Depois que existe `fulfillment_order`, alterações deixam de ser silenciosas.

`create_order_change_request_v1` cria somente um pedido estruturado de alteração:

- `draft` se ainda é editável;
- `review_required` quando o WMS já foi materializado;
- erro `order_change_closed` quando o ciclo já está fechado para alteração comercial comum.

A função **não altera `orders` nem `order_items`**.

`order_operational_controls` preserva `order_version` para concorrência otimista futura.

`order_change_events` mantém trilha append-oriented.

## Próxima evolução antes de aplicar mudanças automaticamente

O próximo bloco deverá implementar reconciliador transacional para um Change Request aprovado:

1. revalidar `order_version`;
2. comparar itens antes/depois;
3. liberar reservas removidas;
4. reavaliar Promise/FEFO;
5. reservar novos lotes;
6. regenerar tarefas de picking quando ainda seguro;
7. exigir reconferência quando necessário;
8. recalcular total/preço somente pelo motor comercial oficial;
9. incrementar versão;
10. auditar tudo;
11. abortar atomicamente em qualquer conflito.

Mudança durante picking avançado deverá permanecer humana/supervisionada até homologação específica.

## Segurança

Todas as tabelas têm RLS habilitado e acesso direto de `public`, `anon` e `authenticated` revogado.

Todas as RPCs `SECURITY DEFINER` têm execução revogada de `public`, `anon` e `authenticated`; apenas `service_role` recebe execução.

Nenhum segredo é adicionado ao repositório.

## Testes

O CI `Stage 12 Order Promise` valida em PostgreSQL/PGlite isolado:

- defaults OFF;
- preview bloqueado enquanto runtime está OFF;
- falta de capacidade => revisão;
- lote não verificado não conta;
- validade incompatível não conta;
- endereço ausente bloqueia;
- capacidade consumida por compromissos é respeitada;
- avaliação auditável é idempotente;
- alteração antes do WMS vira draft sem mutar pedido;
- fulfillment materializado exige revisão;
- picking produz lock forte;
- pedido `ready` fecha mudança comum.

Nenhuma dessas provas ativa produção.
