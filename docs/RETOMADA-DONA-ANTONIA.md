# RETOMADA — Projeto Dona Antônia

Atualizado em **08/09/2026**.

Este é o arquivo **autoritativo de retomada operacional**. Ler junto com:

1. `docs/ROADMAP-FINAL-DONA-ANTONIA-20-ETAPAS.md`;
2. `docs/ROADMAP-20-ETAPAS-PROGRESS.md`;
3. `docs/ETAPA-12-CHECKPOINT-FINAL-20260908.md`;
4. documentos de decisão mais recentes.

Antes de programar: auditar GitHub e Supabase; auditar Make se o bloco tocar automações/conectores ou para confirmar o baseline operacional. Não reiniciar etapa concluída.

---

## Ponto exato de retomada

**ETAPAS 1–12: parte programável segura concluída.**

A primeira etapa numerada ainda não concluída é:

> **ETAPA 13 — Financeiro Operacional, Recebimentos e Conciliação.**

Não voltar à Etapa 12 salvo bug/regressão ou decisão nova do proprietário.

Primeiro bloco seguro recomendado da Etapa 13:

- ledger operacional imutável/idempotente;
- expectativa de recebimento por pedido e rota;
- recebimento por dinheiro/Pix/cartão/link como eventos separados de entrega;
- fechamento de rota/entregador;
- divergência esperado × recebido/declarado;
- `review_required` em incerteza;
- abstração de conciliação externa sem provider/chamada real inicialmente;
- read models/Admin atrás de gate OFF;
- GitHub Actions para reconciliação batch quando fizer sentido.

---

## Estado de produção que DEVE ser preservado

Auditoria em 08/09/2026:

```text
whatsapp_release_mode=live
whatsapp_live_canary_percent=1
whatsapp_inbound_enabled=true
whatsapp_auto_reply_enabled=true
ai_enabled=true
experience_orchestrator_enabled=false
whatsapp_flow_data_exchange_enabled=false
whatsapp_flow_send_enabled=false
bling_order_sync_enabled=false
bling_order_homologation_only=true
```

### Handoffs humanos

```text
open_handoffs=10
claimed_open_handoffs=0
```

Preservar todos. Handoff humano tem precedência absoluta sobre IA/Flow.

### Make — cenários ativos autorizados

Auditoria em 08/09/2026 encontrou exatamente:

```text
Dona Antônia - WhatsApp Inbound Controlado v1
Dona Antônia - WhatsApp Outbound Event-Driven v3
consultar no cpf
```

Não ativar cenário Make adicional sem necessidade/decisão. `consultar no cpf` está explicitamente autorizado a permanecer ativo.

---

## Proibições de rollout ainda vigentes

- **não aumentar WhatsApp acima de 1%** sem nova autorização explícita;
- não ativar WhatsApp Flow/Data Exchange para clientes;
- não ativar Experience Orchestrator;
- não ativar Bling order sync;
- não ativar emissão fiscal real/SEFAZ;
- não alterar configuração fiscal já existente no Bling;
- não ativar Instagram/Messenger/Ads;
- não ativar logística/GPS/Maps/notifications reais;
- não ativar compras, pagamentos, conciliação bancária ou qualquer movimentação financeira real;
- não criar gasto pago/OpenAI/Maps/provider externo apenas porque a fundação existe;
- não contornar bloqueio de segurança de ferramenta/deploy.

Todo módulo novo deve nascer OFF, com idempotência, auditoria, RLS/RBAC e rollback/kill switch quando aplicável.

---

## Decisão fiscal oficial — preservar

A configuração de NF-e e tipo de venda **`venda pela internet`** já está configurada no Bling pelo proprietário. O sistema não deve alterar CFOP, natureza, tributação ou tipo de operação.

Fluxo oficial:

```text
PEDIDO
→ SEPARAÇÃO
→ PRONTO
→ EM ROTA
→ ENTREGUE + PAGAMENTO CONFIRMADO
→ FISCAL_READY
→ NF-e
→ CONCLUÍDO
```

Regras:

- pagamento antecipado sozinho não libera NF-e;
- `PAID + IN_ROUTE` não é fiscal-ready;
- entrega falha/ausência/recusa/desistência não gera NF-e;
- entrega parcial/alterada exige reconciliação antes do fiscal;
- IA não decide entrega, pagamento, valor ou elegibilidade fiscal.

Bling/SEFAZ continuam sem dispatcher real autorizado.

---

## Etapa 12 — checkpoint concluído

Referência completa: `docs/ETAPA-12-CHECKPOINT-FINAL-20260908.md`.

Últimos merges:

```text
PR #213 -> 8f4dfb759f41f5feec44bed9ea0ed82bbbf62c53
PR #214 -> ec3a84e09ad2caaccb25dd9ec0df1497b37da187
PR #215 -> 8307f5e64f7f8f51174e660a9c7f1fed2be6d24b
```

A Etapa 12 contém de forma dormente:

- lotes/validade/FEFO;
- Guardião de Margem;
- WMS barcode-first;
- reservas e consumo por lote;
- Order Promise/capacidade/cutoff;
- Order Change Control;
- Substitution Engine;
- Cycle Counting;
- etiquetas 100×150 sem valores;
- Recall/rastreabilidade reversa;
- Control Tower + SLA/Aging;
- benefícios, cupons, brindes e aniversário com orçamento/margem/FEFO;
- evidência de compra apenas por pedido realmente entregue.

### Supabase — estado final da Etapa 12

Principais runtimes:

```text
commercial_truth.enabled=false
commercial_truth.execution_mode=off
commercial_truth.canary_percent=0
fulfillment.enabled=false
fulfillment.execution_mode=off
fulfillment.canary_percent=0
order_promise.enabled=false
order_promise.execution_mode=off
order_promise.canary_percent=0
operational_control.enabled=false
operational_control.execution_mode=off
operational_control.canary_percent=0
```

Todos os subgates de escrita/aplicação/preview relevantes estão OFF, inclusive:

```text
benefits_enabled=false
benefit_preview_enabled=false
benefit_recording_enabled=false
benefit_reservation_enabled=false
benefit_apply_enabled=false
delivered_purchase_evidence_enabled=false
substitution_apply_enabled=false
cycle_count_adjustment_enabled=false
label_dispatch_enabled=false
recall_quarantine_enabled=false
sla_exception_recording_enabled=false
lot_reservation_enabled=false
lot_consumption_enabled=false
commitment_write_enabled=false
change_control_enabled=false
```

Contagens reais após DDL:

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

Fail-closed dos benefícios confirmado:

```text
preview_customer_benefit_v1 -> benefit_preview_disabled
customer_delivered_purchase_evidence_v1 -> delivered_purchase_evidence_disabled
```

Últimas migrations aplicadas:

```text
20260908140804 stage12_label_recall_control_tower_v1
20260908140820 stage12_label_recall_control_tower_v1_fix
20260908142112 stage12_benefits_guardrails_v1
20260908142627 stage12_benefits_guardrails_v1_conflict_fix
```

Observação: a primeira tentativa de correção dos benefícios baseada em `SET plpgsql.variable_conflict` foi rejeitada antes de aplicar e não foi registrada. A PR #215 substituiu por redefinição explícita com `target_year`; a migration `20260908142627` entrou com sucesso.

---

## Regras comerciais que não podem ser perdidas

- cestas têm preço comercial próprio; não são soma automática dos itens;
- diferença entre preço da cesta e soma dos componentes é custo/estrutura comercial interna e não deve ser exposta automaticamente;
- componente em promoção não recalcula automaticamente o preço comercial da cesta;
- validade 31–60 dias: política inicial configurável de 20%;
- validade 0–30 dias: política inicial configurável de 30%;
- vencido: bloquear;
- aniversário: dia/mês opcional, desconto OU brinde, no máximo uma concessão por ano;
- benefício só pode ser liberado com orçamento e margem conhecidos;
- brinde depende de estoque/FEFO/validade compatíveis;
- IA pode sugerir/explicar, mas backend determinístico valida preço, estoque, margem, validade, pagamento e fiscal.

---

## Segurança / Supabase Advisor

Última auditoria não encontrou alerta crítico novo.

Persistem:

- INFO `RLS Enabled No Policy` para várias tabelas server-only; isso é compatível com o padrão do projeto porque `anon/authenticated` são revogados e o acesso é service-role;
- WARN preexistente `Leaked Password Protection Disabled` no Supabase Auth.

Não alterar configuração de Auth automaticamente.

---

## Estratégia de implementação daqui para frente

- PostgreSQL/Supabase para verdade transacional e regras determinísticas;
- GitHub Actions primeiro para batch/reconciliação/auditoria/reporting;
- Make apenas em realtime/conectores onde houver benefício claro;
- OpenAI para interpretação, triagem, linguagem e sugestão — nunca como calculadora/autoridade de saldo, preço, margem, pagamento, fiscal, rota ou estoque;
- todo executor externo deve ser separado de preview/evaluation e ficar atrás de gate próprio;
- estados incertos devem virar `review_required`, nunca confirmação inventada.

## Próxima ação ao receber “continue”

1. reler este arquivo, roadmap e checkpoint da Etapa 12;
2. auditar `main`/PRs recentes e Supabase;
3. iniciar **Etapa 13** somente com fundação financeira dormente;
4. não conectar banco/adquirente/Pix/Bling financeiro real no primeiro bloco;
5. persistir cada rodada em PR + testes + CI + docs + auditoria pós-DDL.
