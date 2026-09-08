# Progresso — Roadmap Dona Antônia 20 etapas

Atualizado em **08/09/2026**.

Este é o marcador oficial de sequência para `docs/ROADMAP-FINAL-DONA-ANTONIA-20-ETAPAS.md`.

Ler sempre junto com:

- `docs/RETOMADA-DONA-ANTONIA.md`;
- `docs/ETAPA-12-CHECKPOINT-FINAL-20260908.md`;
- decisões arquiteturais mais recentes.

Os documentos antigos de 12 etapas permanecem como histórico/detalhamento. A ordem deste roadmap de 20 etapas prevalece.

## Baseline de produção preservado

```text
WhatsApp live=1%
Flow/Data Exchange=OFF
Experience Orchestrator=OFF
Bling order sync=OFF / homologation-only
Instagram/Messenger reais=OFF/dormentes
Logística/GPS/Maps/notificações reais=OFF
Benefícios/promoções reais=OFF
Financeiro real/conciliação externa=OFF
```

Make ativo autorizado em 08/09/2026:

```text
Dona Antônia - WhatsApp Inbound Controlado v1
Dona Antônia - WhatsApp Outbound Event-Driven v3
consultar no cpf
```

Handoffs humanos atuais: `10 open / 0 claimed`. Preservar precedência humana.

---

## ETAPA 1 — Fundação, limpeza e consolidação operacional

**CONCLUÍDA.**

Fundação de dados/admin/segurança, saneamento inicial e base operacional estabelecidos.

## ETAPA 2 — Pedido real ponta a ponta + Bling

**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA.**

Integração preparada e homologação protegida. Bling real permanece OFF/homologation-only.

## ETAPA 3 — Núcleo omnichannel e evento normalizado

**CONCLUÍDA.**

## ETAPA 4 — Adapters, renderers e gates independentes

**CONCLUÍDA.**

## ETAPA 5 — CRM unificado, identidades e inbox única

**CONCLUÍDA.**

## ETAPA 6 — Instagram Direct + comentários/private reply

**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.**

Sem conta/transporte Meta real ativado.

## ETAPA 7 — Facebook Messenger + centralização Meta

**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.**

PR #194 integrada. Migration `messenger_stage7_foundation_v1` aplicada. Transporte real permanece OFF.

## ETAPA 8 — Sala de Compra + WhatsApp Flow + Orquestrador channel-aware

**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.**

PR #195 integrada. Capability registry, budgets, fallback fail-closed e precedência de handoff implementados. Flow/Data Exchange e Orchestrator permanecem OFF.

## ETAPA 9 — AI Action Registry + Governança de Autonomia

**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.**

PR #196 integrada. Catálogo de ações, políticas, autonomia A/B/C/D, idempotência, compensação, confirmação e limites implementados. Ações continuam OFF.

## ETAPA 10 — Motor Geral de Automações + Builder no Admin

**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.**

PRs #197–#200 integradas. Builder/dispatcher/compiler preparados com kill switch, budgets e drafts revisáveis. Sem executor externo live autorizado.

## ETAPA 11 — Logística + Roteirização + App do Entregador

**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.**

PR #201 e hardening subsequente integrados. Drivers/vehicles/routes/stops/GPS/provider/notifications continuam OFF.

Hardening fiscal pós-entrega também concluído:

```text
ENTREGUE + PAGAMENTO CONFIRMADO -> FISCAL_READY -> NF-e
```

Pagamento antecipado isolado não libera NF-e. Bling/SEFAZ continuam sem dispatcher real autorizado.

## ETAPA 12 — Lotes + Validade + FEFO + Verdade Comercial + OMS/WMS

**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.**

Checkpoint oficial: `docs/ETAPA-12-CHECKPOINT-FINAL-20260908.md`.

### Blocos concluídos

- PR #204 — lotes, validade, FEFO, políticas e Guardião de Margem;
- PR #205/#207 — WMS integrado ao schema oficial de lotes;
- PR #209 — hardening WMS, reservas/consumo multi-lote, volumes/loading;
- PR #210 — Central de Verdade Comercial + snapshots/reporting;
- PR #211 — Order Promise + Order Change Control;
- PR #212 — Substitution Engine + Cycle Counting;
- PR #213 — Label Service + Recall + Control Tower + SLA/Aging;
- PR #214 — benefícios/aniversário/cupons/brindes com guardrails;
- PR #215 — correção de runtime dos benefícios compatível com Supabase gerenciado.

### Estado final auditado

Todos os runtimes relevantes:

```text
enabled=false
execution_mode=off
canary_percent=0
```

Todos os subgates de aplicação/escrita real permanecem OFF.

Contagens reais:

```text
orders=0
inventory_lots=0
fulfillment_orders=0
order_promise_commitments=0
substitution_evaluations=0
cycle_count_tasks=0
label_documents=0
recall_cases=0
operational_sla_exceptions=0
customer_benefit_evaluations=0
customer_benefit_reservations=0
promotion_rules=0
```

Últimas migrations:

```text
20260908140804 stage12_label_recall_control_tower_v1
20260908140820 stage12_label_recall_control_tower_v1_fix
20260908142112 stage12_benefits_guardrails_v1
20260908142627 stage12_benefits_guardrails_v1_conflict_fix
```

CI específico e regressão geral verdes para os blocos finais. Security Advisor sem alerta crítico novo.

**Critério programável da Etapa 12 atendido:** nenhuma automação comercial possui caminho autorizado para oferecer produto inválido, vencido, sem estoque/validade compatível ou benefício economicamente inviável. Aplicação real continua protegida por gates e homologação futura.

---

## ETAPA 13 — Financeiro Operacional, Recebimentos e Conciliação

**EM ANDAMENTO — PRIMEIRA ETAPA INCOMPLETA.**

### Blocos programáveis já concluídos/dormentes

**13A — Financial Ledger Operacional V1**

- ledger append-only/idempotente;
- recebimento/reversão separados;
- caixa de rota e fechamento financeiro;
- divergências estruturadas em `review_required`/reconciliation cases;
- nenhum provider financeiro real;
- trigger append-only endurecida para `SECURITY INVOKER` e execução pública revogada.

Documento: `docs/ETAPA-13-FINANCIAL-LEDGER-V1.md`.

**13B — Expectativas de recebimento + manifesto financeiro da rota**

- PR #220 integrada;
- expectativa `prepaid | on_delivery | mixed | unknown`;
- saldo restante por pedido;
- dinheiro com valor entregue/troco;
- pagamento antecipado coberto deixa de entrar na cobrança da rota;
- manifesto por dinheiro/Pix/cartão/link/outros;
- nenhum evento confirma entrega/fiscal por inferência.

Documento: `docs/ETAPA-13-COLLECTION-EXPECTATIONS-V1.md`.

**13C — Driver App + contexto financeiro ledger-first**

- PR #221 em validação nesta rodada;
- `JÁ PAGO | COBRAR | REVISAR` por parada;
- saldo/método/troco determinísticos no PWA;
- dinheiro recebido pelo entregador -> ledger `operational_confirmed`;
- Pix/cartão/link observados na porta -> ledger `observed`, aguardando conciliação;
- valor divergente bloqueia antes da entrega;
- `driver_deliver_stop_v3` não chama `confirm_order_payment_v1`;
- pagamento do domínio fiscal não é confirmado pelo Driver App;
- PWA permanece `enabled=false` e Edge Function não é implantada automaticamente.

Documento: `docs/ETAPA-13-DRIVER-FINANCIAL-V1.md`.

### Estado de runtime preservado

```text
financial.enabled=false
financial.execution_mode=off
financial.canary_percent=0
logistics.enabled=false
logistics.driver_app_enabled=false
fiscal.enabled=false
bling_invoice_prepare_enabled=false
bling_invoice_send_enabled=false
```

### O que ainda falta para concluir a Etapa 13

- adapters abstratos de conciliação Pix/cartão/link, inicialmente sem provider real;
- read model/Admin financeiro e central de exceções atrás de gate OFF;
- GitHub Actions para reconciliação batch/auditoria;
- políticas/limites financeiros configuráveis;
- projeção determinística, homologada e separada do ledger conciliado para o gate fiscal existente.

Não ativar banco/Pix/adquirente/Bling financeiro real apenas por programar a fundação.

## ETAPA 14 — Compras + Fornecedores + Reposição + Demanda + Qualidade

**PENDENTE.**

## ETAPA 15 — Pós-venda Autônomo + Trocas + Devoluções + Crédito

**PENDENTE.**

## ETAPA 16 — CRM Preditivo + Fidelidade + Recorrência + Marketing Omnicanal

**PENDENTE.**

## ETAPA 17 — Social + Meta Ads + Google + Crescimento

**PENDENTE.**

## ETAPA 18 — AutoQA + Voz do Cliente + Melhoria Contínua

**PENDENTE.**

## ETAPA 19 — Gerente IA + Central de Exceções + Workload Manager

**PENDENTE.**

## ETAPA 20 — Homologação Integrada + Autorizações + Rollout Final

**PENDENTE.**

---

## Regra para cada rodada

1. Continuar da primeira etapa numerada ainda não concluída.
2. Programar o maior bloco seguro/coerente possível.
3. Não transformar pendência externa em bloqueio para componentes independentes.
4. Todo módulo novo nasce OFF e configurável quando seguro.
5. Testar/regredir/documentar em cada etapa.
6. Preservar idempotência, auditoria, RLS/RBAC, budgets, canary e rollback.
7. Preferir GitHub Actions para batch/auditoria/reconciliação; Make só quando realtime/conector justificar.
8. IA nunca substitui cálculo/verdade determinística de preço, estoque, margem, pagamento, fiscal, rota ou saldo.
9. Nunca ativar produção, gasto ou side effect real sem autorização/gates correspondentes.
