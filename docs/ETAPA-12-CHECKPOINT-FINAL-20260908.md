# Checkpoint final — Etapa 12 — 08/09/2026

Status: **PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE**.

Este documento fecha a Etapa 12 do `ROADMAP-FINAL-DONA-ANTONIA-20-ETAPAS.md` e passa a ser a referência de retomada para os módulos de estoque/lotes/OMS/WMS/Verdade Comercial. Nenhum item deste checkpoint autoriza ativação de produção.

## Resultado funcional

A Etapa 12 agora possui, de forma modular e fail-closed:

- Verdade Comercial de lotes, validade, FEFO, ofertas e Guardião de Margem;
- WMS/fulfillment mobile e barcode-first;
- reserva/liberação/consumo transacional por lote, com idempotência;
- picking, conferência independente, packing, volumes e loading;
- Central de Verdade Comercial no Admin atrás de feature gate OFF;
- snapshots/reporting de validade, ruptura, giro proxy e margem;
- Order Promise / ATP-CTP leve com estoque, validade, capacidade, entregadores e cutoff;
- Order Change Control com lock/versionamento e Change Request;
- Substitution Engine com grupos de equivalência e preferência por cliente;
- Cycle Counting com blind count, tolerâncias e `inventory_accuracy_percent`;
- Label Service 100×150 mm, volume N/M, barcode e sem valores;
- rastreabilidade reversa e Recall por lote;
- Control Tower read-only pedido→Promise→WMS→rota→pagamento→fiscal;
- SLA/Aging configurável, sem threshold hardcoded;
- benefícios/cupons/brindes/aniversário com orçamento, margem, FEFO e uma concessão de aniversário por cliente/ano;
- evidência de compra anterior baseada apenas em pedido realmente `delivered` + `delivered_at`.

## PRs principais

- #204 — Verdade Comercial: lotes/validade/FEFO/margem;
- #205 + #207 — fundação WMS e correção para reutilizar o schema oficial de lotes;
- #209 — hardening WMS, multi-lote, reservas e carregamento;
- #210 — Central de Verdade Comercial + snapshots/relatórios;
- #211 — Order Promise + Order Change Control;
- #212 — Substitution Engine + Cycle Counting;
- #213 — Label Service + Recall + Control Tower + SLA/Aging;
- #214 — benefícios/aniversário/cupons/brindes com guardrails;
- #215 — correção de runtime dos benefícios compatível com Supabase gerenciado.

Últimos merges relevantes:

```text
#213 -> 8f4dfb759f41f5feec44bed9ea0ed82bbbf62c53
#214 -> ec3a84e09ad2caaccb25dd9ec0df1497b37da187
#215 -> 8307f5e64f7f8f51174e660a9c7f1fed2be6d24b
```

## Migrations finais da Etapa 12 aplicadas no Supabase

```text
20260908121928 stage12_commercial_truth_foundation_v1
20260908122001 stage12_commercial_truth_admin_safety_v2
20260908122856 stage12_wms_fulfillment_v1
20260908131955 stage12_wms_hardening_v2
20260908132019 stage12_wms_hardening_v2_fix
20260908134129 stage12_order_promise_change_control_v1
20260908135223 stage12_substitution_cycle_count_v1
20260908140804 stage12_label_recall_control_tower_v1
20260908140820 stage12_label_recall_control_tower_v1_fix
20260908142112 stage12_benefits_guardrails_v1
20260908142627 stage12_benefits_guardrails_v1_conflict_fix
```

A tentativa intermediária de usar `SET plpgsql.variable_conflict` foi rejeitada pelo Supabase antes de qualquer alteração e **não foi registrada como migration**. A PR #215 substituiu esse mecanismo por `CREATE OR REPLACE FUNCTION` com variável `target_year`; a migration final acima foi aplicada com sucesso.

## Auditoria pós-DDL — Supabase

### Verdade Comercial

```text
enabled=false
execution_mode=off
canary_percent=0
lot_tracking_enabled=false
fefo_enforcement_enabled=false
expiry_block_enabled=false
promotions_enabled=false
benefits_enabled=false
margin_guard_enabled=false
reports_enabled=false
substitution_preview_enabled=false
substitution_recording_enabled=false
substitution_apply_enabled=false
cycle_count_planning_enabled=false
cycle_count_recording_enabled=false
cycle_count_adjustment_enabled=false
benefit_preview_enabled=false
benefit_recording_enabled=false
benefit_reservation_enabled=false
benefit_apply_enabled=false
delivered_purchase_evidence_enabled=false
```

### Fulfillment/WMS

```text
enabled=false
execution_mode=off
canary_percent=0
picking_enabled=false
checking_enabled=false
packing_enabled=false
ready_release_enabled=false
loading_enabled=false
lot_reservation_enabled=false
lot_consumption_enabled=false
fefo_enforced=false
barcode_required=true
require_independent_checker=true
allow_manual_barcode_override=false
```

### Order Promise / Change Control

```text
enabled=false
execution_mode=off
canary_percent=0
preview_enabled=false
evaluation_recording_enabled=false
commitment_write_enabled=false
inventory_reservation_on_commit_enabled=false
change_control_enabled=false
require_capacity_rule=true
require_delivery_address=true
same_day_cutoff_enforced=true
```

### Label / Recall / Control Tower / SLA

```text
enabled=false
execution_mode=off
canary_percent=0
label_preview_enabled=false
label_recording_enabled=false
label_dispatch_enabled=false
recall_preview_enabled=false
recall_case_enabled=false
recall_quarantine_enabled=false
control_tower_enabled=false
sla_preview_enabled=false
sla_exception_recording_enabled=false
```

### Contagens reais pós-DDL

Todas permaneceram em zero:

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
enabled_promotion_rules=0
```

Fail-closed confirmado em produção para benefícios:

```text
preview_customer_benefit_v1 -> benefit_preview_disabled
customer_delivered_purchase_evidence_v1 -> delivered_purchase_evidence_disabled
```

Os demais blocos também haviam sido auditados fail-closed durante suas respectivas rodadas.

## Segurança e Advisor

O Security Advisor pós-DDL não apresentou alerta crítico novo. Permanecem:

- INFO `RLS Enabled No Policy` nas tabelas server-only, padrão intencional do projeto porque browser/anon/authenticated são revogados e o acesso é service-role;
- WARN preexistente `Leaked Password Protection Disabled` no Supabase Auth.

Não alterar essa configuração de Auth automaticamente; é decisão operacional/administrativa separada.

## Produção preservada

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

Existem **10 handoffs humanos abertos e 0 claimed**. Preservar; handoff humano continua tendo precedência sobre IA/Flow.

Make possui exatamente 3 cenários ativos autorizados:

```text
Dona Antônia - WhatsApp Inbound Controlado v1
Dona Antônia - WhatsApp Outbound Event-Driven v3
consultar no cpf
```

Nenhum cenário ativo extra foi encontrado nesta auditoria.

## Regras comerciais confirmadas

- cestas têm preço comercial próprio; nunca recalcular automaticamente pela soma dos componentes;
- promoção em componente da cesta não altera automaticamente o preço da cesta;
- validade 31–60 dias: política inicial configurável de 20%;
- validade 0–30 dias: política inicial configurável de 30%;
- vencido: bloquear;
- aniversário: dia/mês opcional, desconto OU brinde configurado, no máximo uma concessão por ano;
- benefício só pode ser elegível com margem e orçamento conhecidos;
- brinde exige estoque/lote/validade compatíveis via FEFO;
- não há desconto, brinde ou promoção real seedado nesta etapa.

## Fronteira fiscal preservada

Permanece oficial:

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

Pagamento antecipado sozinho não libera NF-e. Falha/recusa/ausência não gera NF-e. A configuração fiscal existente no Bling (`venda pela internet`) não deve ser alterada pelo sistema.

## Próxima etapa oficial

**ETAPA 13 — Financeiro Operacional, Recebimentos e Conciliação.**

Primeiro bloco seguro recomendado:

1. ledger operacional imutável/idempotente;
2. expectativa de recebimento por pedido/rota;
3. recebimentos por dinheiro/Pix/cartão/link sem confundir entrega com conciliação;
4. fechamento de rota/entregador;
5. divergência esperada × declarada e `review_required`;
6. abstrações de conciliação externa, sem chamada real inicialmente;
7. dashboards/read models e policies no Admin atrás de gate OFF;
8. GitHub Actions para reconciliação batch onde apropriado.

Não ativar pagamentos, Bling financeiro, adquirente, banco, Pix ou qualquer movimentação real só porque a fundação for programada.
