# RETOMADA — Projeto Dona Antônia

Atualizado em **08/09/2026**.

Este é o arquivo **autoritativo de retomada operacional**. Ler junto com:

1. `docs/ROADMAP-FINAL-DONA-ANTONIA-20-ETAPAS.md`;
2. `docs/ROADMAP-20-ETAPAS-PROGRESS.md`;
3. `docs/ETAPA-12-CHECKPOINT-FINAL-20260908.md`;
4. `docs/PLANO-IA-ATENDIMENTO-VENDAS-2026-09-08.md`;
5. documentos de decisão mais recentes.

O plano de IA é uma **diretriz transversal obrigatória**: Cost Policy Engine configurável, política de ação segura/confirmação, confiança versionada, memória comercial útil com evidência, pedido implícito, Next Best Action, compressão com baixa carga cognitiva e ordem de objetivos `resolver → facilitar → fechar → aumentar ticket`.

Antes de programar: auditar GitHub e Supabase; auditar Make se o bloco tocar automações/conectores ou para confirmar o baseline operacional. Não reiniciar etapa concluída.

---

## Ponto exato de retomada

**ETAPAS 1–12: parte programável segura concluída.**

A primeira etapa numerada ainda não concluída é:

> **ETAPA 13 — Financeiro Operacional, Recebimentos e Conciliação — EM ANDAMENTO.**

Não voltar à Etapa 12 salvo bug/regressão ou decisão nova do proprietário.

### Etapa 13 já concluída nesta sequência

**13A — Financial Ledger Operacional V1**

- ledger append-only/idempotente;
- recebimentos, reversões, caixa de rota e reconciliação estruturados;
- incerteza em `review_required`;
- nenhum provider financeiro real;
- trigger append-only endurecida para `SECURITY INVOKER`.

**13B — Expectativas de recebimento + manifesto financeiro da rota**

- PR #220 integrada;
- expectativa por pedido `prepaid | on_delivery | mixed | unknown`;
- saldo, método, valor entregue em dinheiro e troco;
- manifesto financeiro da rota por dinheiro/Pix/cartão/link;
- pagamento antecipado coberto deixa de ser cobrado na rota.

**13C — Driver App + contexto financeiro ledger-first**

- PR #221 integrada;
- merge commit `541224e480502707760f073bb08a980351ae3ace`;
- migration `stage13_driver_financial_context_v1` aplicada;
- PWA mostra `JÁ PAGO | COBRAR | REVISAR`;
- dinheiro na porta -> ledger `operational_confirmed`;
- Pix/cartão/link na porta -> ledger `observed`, aguardando conciliação;
- valor divergente bloqueia antes da entrega;
- `driver_deliver_stop_v3` não chama `confirm_order_payment_v1`;
- Driver App não confirma pagamento fiscal;
- PWA continua `enabled=false`;
- `driver-logistics-v1` foi atualizado apenas no repositório e **não foi implantado**.

Documentos:

- `docs/ETAPA-13-FINANCIAL-LEDGER-V1.md`;
- `docs/ETAPA-13-COLLECTION-EXPECTATIONS-V1.md`;
- `docs/ETAPA-13-DRIVER-FINANCIAL-V1.md`.

### Próximo bloco seguro da Etapa 13

Continuar com **conciliação abstrata + read model/Admin financeiro**, ainda totalmente dormente:

1. adapters internos/versionados para Pix/cartão/link sem provider/chamada real inicialmente;
2. eventos externos normalizados e idempotentes separados do ledger operacional;
3. matcher determinístico pedido/valor/provider/ref com `matched | unmatched | ambiguous | review_required`;
4. nenhuma inferência de IA para declarar pagamento conciliado;
5. read model/Admin de caixa, recebimentos, divergências e rotas atrás de gate OFF;
6. GitHub Actions para batch/auditoria/reconciliação;
7. políticas/limites configuráveis;
8. deixar projeção fiscal determinística para bloco posterior, após conciliação homologada.

O financeiro da Etapa 13 deve expor somente **contexto determinístico** para o futuro `next_best_action`; a IA não decide se pagamento ocorreu nem reconcilia valores por inferência.

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

### Etapa 13 / logística / fiscal — pós 13C

```text
financial.enabled=false
financial.execution_mode=off
financial.canary_percent=0
driver_financial_context_enabled=false
driver_collection_recording_enabled=false
driver_delivery_financial_guard_enabled=false
logistics.enabled=false
logistics.execution_mode=off
logistics.driver_app_enabled=false
logistics.gps_tracking_enabled=false
fiscal.enabled=false
fiscal.execution_mode=off
bling_invoice_prepare_enabled=false
bling_invoice_send_enabled=false
orders=0
drivers=0
routes=0
stops=0
financial_ledger_entries=0
financial_payment_expectations=0
financial_route_collection_manifests=0
```

Fail-closed 13C confirmado:

```text
preview_driver_order_collection_v1 -> driver_financial_context_disabled
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
- não ativar Driver App real apenas porque a Etapa 13C existe;
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
- registro do entregador em dinheiro/Pix/cartão/link não confirma `payment_status` fiscal por si só;
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

## Diretriz transversal de IA comercial

Referência oficial: `docs/PLANO-IA-ATENDIMENTO-VENDAS-2026-09-08.md`.

Regras que precisam orientar novas implementações:

- Cost Policy Engine configurável/versionado; preço de canal nunca hardcoded;
- custo desconhecido/desatualizado => bloquear;
- minimizar mensagens **e** carga cognitiva;
- ações seguras/reversíveis podem ser executadas conforme política;
- ações irreversíveis/obrigacionais exigem confirmação;
- confiança é configurável e nunca bypassa confirmação irreversível;
- memória comercial só vira preferência com evidência/confiança/recorrência;
- pedido implícito deve gerar ação útil quando houver contexto suficiente;
- Next Best Action decide antes da geração textual;
- ordem de objetivos: `resolver corretamente → facilitar → fechar → aumentar ticket`;
- aprendizado futuro usa evidência e testes controlados, sem alterar regras críticas automaticamente.

---

## Segurança / Supabase Advisor

Auditoria pós-DDL da Etapa 13C não encontrou alerta novo da implementação.

As novas RPCs 13C:

```text
financial_readiness_v3
preview_driver_order_collection_v1
get_driver_route_snapshot_v2
driver_deliver_stop_v3
```

estão com:

```text
anon_execute=false
authenticated_execute=false
service_role_execute=true
```

Persistem:

- INFO `RLS Enabled No Policy` para várias tabelas server-only; isso é compatível com o padrão do projeto porque `anon/authenticated` são revogados e o acesso é service-role;
- WARN preexistente `Leaked Password Protection Disabled` no Supabase Auth.

Não alterar configuração de Auth automaticamente. Referência do aviso: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

---

## Estratégia de implementação daqui para frente

- PostgreSQL/Supabase para verdade transacional e regras determinísticas;
- GitHub Actions primeiro para batch/reconciliação/auditoria/reporting;
- Make apenas em realtime/conectores onde houver benefício claro;
- OpenAI para interpretação, triagem, linguagem e sugestão — nunca como calculadora/autoridade de saldo, preço, margem, pagamento, fiscal, rota ou estoque;
- todo executor externo deve ser separado de preview/evaluation e ficar atrás de gate próprio;
- estados incertos devem virar `review_required`, nunca confirmação inventada.

## Próxima ação ao receber “continue”

1. reler este arquivo, roadmap/progresso, documentos 13A/13B/13C e plano de IA;
2. auditar `main`/PRs recentes e Supabase;
3. continuar **Etapa 13** com adapters abstratos de conciliação Pix/cartão/link + read model/Admin financeiro, tudo OFF;
4. não conectar banco/adquirente/Pix/Bling financeiro real nesse bloco;
5. preferir GitHub Actions para batch/reconciliação/auditoria;
6. deixar projeção determinística para o gate fiscal como bloco posterior, depois da conciliação homologada;
7. persistir cada rodada em PR + testes + CI + docs + auditoria pós-DDL.
