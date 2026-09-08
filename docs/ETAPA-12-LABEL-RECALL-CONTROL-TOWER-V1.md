# Etapa 12E–12H — Label Service + Recall + Control Tower + SLA/Aging V1

Atualizado em 08/09/2026.

Status: **FUNDAÇÃO DORMENTE, SERVER-ONLY E SEM TRANSPORTE/IMPRESSÃO/QUARENTENA AUTOMÁTICA**.

## Objetivo

Fechar os submódulos 12E–12H da decisão arquitetural operacional sem criar uma segunda verdade de pedido, estoque, logística ou fiscal.

A implementação reutiliza:

- `orders` como pedido comercial;
- `fulfillment_orders/items` como verdade física de separação;
- `order_packages` como volumes/barcodes;
- `inventory_lots` e `inventory_lot_movements` como lotes/ledger;
- `delivery_jobs` como verdade logística;
- `order_fiscal_controls` como fronteira entrega/pagamento/fiscal;
- `order_promise_commitments` como compromisso de entrega.

## Runtime único do bloco

`operational_control_runtime_config` nasce com:

- `enabled=false`;
- `execution_mode=off`;
- label preview/recording/dispatch `false`;
- recall preview/case/quarantine `false`;
- Control Tower `false`;
- SLA preview/exception recording `false`;
- `canary_percent=0`.

Não há alteração automática desses gates na migration.

---

## 12E — Label Service

### Formato

A V1 formaliza a etiqueta operacional padrão:

- 100 × 150 mm;
- pedido/cliente/endereço;
- volume `N/M` quando for etiqueta de pacote;
- barcode já existente em `order_packages`;
- **sem valor/preço** (`amount_visible=false` e `price_fields=[]`).

### Estruturas

- `label_documents`;
- `label_events`.

O documento nasce `draft`, `print_count=0`, `external_side_effect=false`.

`preview_fulfillment_label_v1` apenas monta payload determinístico.

`record_label_draft_v1` grava draft idempotente somente quando recording estiver explicitamente habilitado em modo de homologação/canary/live.

**Não existe dispatcher de impressora nesta versão.** O gate `label_dispatch_enabled` existe para uma etapa futura, mas nenhuma função o transforma em chamada de rede/impressão.

Reimpressão futura deve gerar evento auditável, nunca sobrescrever histórico silenciosamente.

---

## 12F — Recall por lote

### Rastreabilidade reversa

`preview_lot_reverse_trace_v1` resolve:

`lote → fulfillment_items → fulfillment_order → order → customer → delivery_job`

e também expõe o ledger de `inventory_lot_movements` do lote.

O resultado diferencia implicitamente pedidos ainda em operação dos já entregues pelo `order_status`, `fulfillment_status`, `delivery_status` e `delivered_at`.

### Casos de recall

Estruturas:

- `recall_cases`;
- `recall_case_lots`;
- `recall_events`.

`create_recall_case_draft_v1`:

- exige preview/case gates;
- cria somente `draft`;
- captura snapshot do lote e impacto;
- é idempotente;
- não altera `inventory_lots.status`;
- não envia WhatsApp/e-mail;
- marca explicitamente `quarantine_applied=false` e `notifications_sent=false`.

O gate `recall_quarantine_enabled` foi reservado para reconciliador transacional futuro, mas **não há executor de quarentena nesta V1**.

---

## 12G — Control Tower inicial

`control_tower_order_snapshot_v1` cria um read model único por pedido, sem persistir cópias concorrentes de estado.

Retorna:

- pedido/cliente;
- promessa ativa quando houver;
- fulfillment e timestamps;
- quantidade de volumes e volumes carregados;
- último delivery job;
- entrega/pagamento/fiscal;
- `current_stage`;
- `stage_anchor` usado pelo aging.

Estágios operacionais previstos:

- `confirmed`;
- `fulfillment_pending`;
- `picking`;
- `checking`;
- `packing`;
- `ready`;
- `delivery`;
- `delivered_unreconciled`;
- `fiscal_ready`;
- `closed`.

`control_tower_queue_v1` agrega pedidos não encerrados, até limite protegido de 500, chamando o mesmo snapshot canônico. Não modifica nenhum domínio.

---

## 12H — SLA / Aging Engine

### Política

`operational_sla_policies` é versionada por estágio e nasce em `draft`.

Cada política pode ter:

- `threshold_minutes`;
- severidade `info / warning / critical`;
- metadata futura.

Não existe threshold hardcoded. Sem política ativa/threshold, o preview retorna `review` + `sla_policy_missing`.

### Avaliação

`preview_order_aging_v1` usa `current_stage + stage_anchor` da Control Tower e calcula idade determinística em minutos.

Resultado:

- `closed`;
- `within_sla`;
- `breach`;
- `review` quando não há política confiável.

### Exceções

`operational_sla_exceptions` guarda exceção auditável/idempotente.

`record_sla_exception_v1` só grava quando:

- runtime geral ligado;
- Control Tower ligado;
- SLA preview ligado;
- recording ligado;
- modo homologation/canary/live;
- avaliação realmente é `breach`.

Não dispara mensagem, workflow, Make ou transporte externo.

---

## Segurança

Todas as tabelas usam RLS; `public`, `anon` e `authenticated` não têm acesso direto. RPCs ficam apenas em `service_role`.

A CI bloqueia regressões que introduzam:

- HTTP/OpenAI/Maps/Meta/Bling;
- `UPDATE inventory_lots` no recall V1;
- `UPDATE orders` no Control Tower;
- criação de `delivery_notifications`;
- criação de `bling_commands`.

## Próximo passo seguro

Após CI verde e aplicação dormente:

1. montar visual Control Tower no Admin atrás de feature flag;
2. montar fila mobile de cycle count e impressão somente como interface, ainda sem dispatcher;
3. preparar políticas comerciais/validade/aniversário já decididas em drafts versionados;
4. consolidar relatórios de margem/giro/validade/ruptura;
5. somente depois avaliar se a Etapa 12 atingiu todo o critério programável antes de iniciar a Etapa 13.
