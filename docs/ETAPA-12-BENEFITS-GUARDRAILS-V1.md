# Etapa 12I — Benefícios, aniversário, cupons e brindes com guardrails V1

Atualizado em 08/09/2026.

Status: **FUNDAÇÃO DORMENTE — SEM BENEFÍCIO REAL, SEM PUBLICAÇÃO, SEM APLICAÇÃO EM PEDIDO E SEM GASTO DE ORÇAMENTO**.

## Objetivo

Fechar a lacuna programável da Etapa 12 para benefícios comerciais sem permitir que uma automação invente desconto, brinde, margem ou orçamento.

A camada reutiliza a Verdade Comercial existente (`promotion_rules`, `commercial_policy_versions`, FEFO e Guardião de Margem) e adiciona somente avaliação/auditoria/reserva interna.

## Princípios

- nenhum valor de desconto é hardcoded;
- nenhum produto de brinde é hardcoded;
- regras precisam estar configuradas em `promotion_rules`;
- aniversário usa somente dia/mês opcional já armazenado no CRM;
- aniversário permite no máximo **uma concessão por cliente por ano**;
- benefício pode ser desconto percentual, desconto fixo ou produto-brinde;
- orçamento da promoção precisa ser conhecido para decisão `allow`;
- margem mínima precisa ser conhecida para decisão `allow`;
- brinde precisa ter custo conhecido, estoque/lote FEFO suficiente e validade compatível com a entrega;
- condição de compra anterior considera somente `orders.status='delivered'` com `delivered_at` real;
- avaliação/reserva nunca altera pedido, item, estoque, lote ou `spent_cents`;
- não existe função `apply_customer_benefit` nesta versão.

## Gates

Todos nascem `false`:

```text
benefit_preview_enabled=false
benefit_recording_enabled=false
benefit_reservation_enabled=false
benefit_apply_enabled=false
delivered_purchase_evidence_enabled=false
```

Além disso, a camada depende dos gates globais já existentes:

```text
commercial_truth_runtime_config.enabled=false
commercial_truth_runtime_config.benefits_enabled=false
execution_mode=off
canary_percent=0
```

## Estruturas

### `customer_benefit_evaluations`

Snapshot auditável e idempotente da avaliação de uma regra para um cliente. Guarda decisão, benefício, margem, orçamento e evidência comercial sem aplicar nada.

### `customer_benefit_reservations`

Reserva interna protegida para futura homologação. A restrição parcial `(customer_id, benefit_scope_key, benefit_year)` impede duas reservas/aplicações ativas do mesmo escopo no mesmo ano. Para aniversário, o escopo é globalmente `birthday`.

A reserva deliberadamente retorna:

```text
budget_spent=false
order_mutated=false
stock_mutated=false
applied=false
external_side_effect=false
```

## Motor de elegibilidade

`preview_customer_benefit_v1` verifica deterministicamente:

1. gates do runtime;
2. cliente ativo;
3. tipo/regra habilitada e janela temporal;
4. mês de aniversário quando aplicável;
5. limite anual;
6. pedido mínimo configurado;
7. evidência de compra entregue quando a regra exigir;
8. tipo e valor do benefício configurados;
9. orçamento restante conhecido/suficiente;
10. margem mínima conhecida e Guardião de Margem;
11. para brinde: produto ativo, custo conhecido, FEFO, estoque e validade na data de entrega.

Qualquer incerteza relevante vira `review` ou `block`; nunca benefício inventado.

## Compra entregue como evidência

`customer_delivered_purchase_evidence_v1` só considera pedidos com:

```text
status = delivered
delivered_at != null
```

Pedido apenas confirmado, em rota, cancelado ou sem confirmação real de entrega não é usado como evidência de compra concluída.

## Segurança

- tabelas com RLS;
- `public`, `anon` e `authenticated` sem acesso direto;
- RPCs somente `service_role`;
- nenhuma chamada HTTP/OpenAI/Make/Meta/Bling;
- nenhum outbound;
- nenhuma alteração em estoque ou pedido;
- nenhuma atualização de orçamento gasto;
- nenhuma regra/promoção real é criada por esta migration.

## Testes

- contrato estático bloqueia executores de aplicação, mutações de pedido/lote/orçamento e transports externos;
- PostgreSQL/PGlite isolado testa:
  - defaults OFF;
  - fail-closed;
  - evidência somente de compra entregue;
  - aniversário no mês correto;
  - uma concessão/ano;
  - bloqueio por margem;
  - bloqueio/review por orçamento;
  - brinde com FEFO;
  - reserva idempotente sem gasto/mutação.

## Pendência proposital

A aplicação real do benefício em carrinho/pedido, consumo de orçamento, baixa de brinde e comunicação com cliente ficam fora desta versão e só podem nascer em homologação futura, com guardrails e autorização explícita. O simples fato de a fundação existir não autoriza ativação.
