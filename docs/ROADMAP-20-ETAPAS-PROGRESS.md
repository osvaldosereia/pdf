# Progresso — Roadmap Dona Antônia 20 etapas

Atualizado em 08/09/2026.

Este é o marcador de sequência para `docs/ROADMAP-FINAL-DONA-ANTONIA-20-ETAPAS.md`.

Ler sempre junto com `docs/RETOMADA-DONA-ANTONIA.md`. Os documentos antigos de 12 etapas e autonomia 13–20 permanecem como histórico/detalhamento, mas a ordem 7–20 deste roadmap reorganizado prevalece em caso de conflito.

## Estado preservado na reorganização

- WhatsApp: `live=1%` e não aumentar sem autorização explícita;
- Flow/Data Exchange: desligados;
- Experience Orchestrator: desligado;
- Bling order sync: desligado;
- contas Instagram/Messenger reais: nenhuma ativa;
- nenhum módulo novo deve ser ativado só porque foi programado;
- Make WhatsApp inbound/outbound realtime permanecem pontes justificadas;
- novas rotinas batch/periódicas devem preferir GitHub Actions quando adequado.

## ETAPA 1 — Fundação, limpeza e consolidação operacional
**CONCLUÍDA.**

## ETAPA 2 — Pedido real ponta a ponta + Bling
**PARTE PROGRAMÁVEL CONCLUÍDA.** Homologação real protegida para fase autorizada.

## ETAPA 3 — Núcleo omnichannel e evento normalizado
**CONCLUÍDA.**

## ETAPA 4 — Adapters, renderers e gates independentes
**CONCLUÍDA.**

## ETAPA 5 — CRM unificado, identidades e inbox única
**CONCLUÍDA.**

## ETAPA 6 — Instagram Direct + comentários/private reply
**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.** Transporte/conta real não liberados.

## ETAPA 7 — Facebook Messenger + centralização Meta
**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.** PR #194 integrada (`336869600392a9e634153fa14db061866e4d221d`); CI específico e regressão geral verdes. Migration real `20260908041226 messenger_stage7_foundation_v1` aplicada e auditada. Readiness pós-migration: `messenger_accounts=0`, `messenger_controls=0`, `transport_enabled_accounts=0`, `policy_verified_accounts=0`, `meta_attribution_events=0`, `transport_implemented=false`, `default_state=off`. Não há conta, token, subscription, Graph/Send API ou transporte Meta real ativado.

## ETAPA 8 — Sala de Compra + WhatsApp Flow + Orquestrador channel-aware
**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.** PR #195 integrada (`b34155266d254d2b87cae3295da205cbef523b06`). Foi consolidada a integração entre o `CAPABILITY_REGISTRY` omnichannel e o Experience Orchestrator, com capability registry server-only por canal/experiência, budgets de sessão, fallback fail-closed e precedência absoluta de handoff humano. A migration `stage8_channel_aware_orchestrator_v1` foi aplicada e auditada no Supabase. Readiness pós-migration: `experience_orchestrator_enabled=false`, `whatsapp_flow_data_exchange_enabled=false`, `whatsapp_flow_send_enabled=false`, `enabled_capabilities=0`, budgets `6 experiências / 40 exchanges Flow / 4 carrosséis / 2 handoffs para Sala`. Existem 3 handoffs humanos abertos preservados. CI específico da Etapa 8 e regressão geral do worker/Flow/Sala/Deno ficaram verdes. Nenhum Flow, Data Exchange, Sala real, canal Meta, Bling ou outbound novo foi ativado. Homologação externa/allowlisted e transporte real permanecem protegidos para etapa autorizada.

## ETAPA 9 — AI Action Registry + Governança de Autonomia
**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.** PR #196 integrada (`1939ae38cc52486923369e39d6015497290ed9a1`). Foi criado o catálogo central server-only `ai_action_registry`, versionamento de políticas e trilha `ai_action_executions`, com schemas de entrada/saída, precondições, side effects, compensação, confirmação, autonomia A/B/C/D, limite financeiro, canais/papéis, idempotência, custo e bloqueio por handoff humano. A migration real `ai_action_registry_stage9_v1` foi aplicada e auditada no Supabase. Readiness pós-migration: `actions=9`, `enabled_actions=0`, `non_off_actions=0`; todas as ações nasceram `enabled=false` e `execution_mode=off`. O simulador `simulate_ai_action_v1` é fail-closed e não produz side effects. A Edge Function `admin-ai-action-registry-v1` foi publicada em v1 com `verify_jwt=true`, oferecendo leitura, simulação, drafts de política e edição owner-only de metadados, deliberadamente sem endpoint para ativar `enabled`/`execution_mode`. CI específico da Etapa 9 e regressão geral do conversation worker ficaram verdes. Auditoria pós-DDL preservou WhatsApp `live=1%`, Flow/Data Exchange e Experience Orchestrator desligados, `enabled_actions=0` e 3 handoffs humanos abertos. Nenhum cenário Make novo foi criado; inbound/outbound WhatsApp realtime permanecem as pontes justificadas existentes.

## ETAPA 10 — Motor Geral de Automações + Builder no Admin
**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.**

A PR #197 criou a fundação server-only `TRIGGER → CONDITIONS → ACTIONS`, com `automation_workflows`, versões, execuções/eventos, RLS, acesso service-role, simulador sem efeitos e recomendador GitHub Actions first. A migration real `automation_engine_stage10_v1` segue aplicada.

A PR #198 (`3e82abbf5fa4138a6f15f85d5c66ceac6a7d8dcd`) montou o Automation Builder no Admin atrás de `automationBuilderUiEnabled=false`, adicionou conditions estruturadas, validação/simulação, kill switch unilateral e compilador determinístico de linguagem natural → draft revisável. Drafts permanecem forçados a `enabled=false`, `execution_mode=off`, `canary_percent=0`, `kill_switch=true`.

A PR #199 (`1098218ee6d14834ebfdcea6420d77ee7a92553c`) adicionou `automation-dispatcher-v1`, limitado a `observe`/`dry_run`, revalidando JWT/Admin, workflow, kill switch, handoff humano, budget, idempotência e AI Action Registry. Não existe executor de actions externas; `external_side_effect=false` e `live` é explicitamente não suportado. Builder e dispatcher permanecem versionados, mas não deployados.

A PR #200 (`dc3fac9652a23a848733be3a9f0c779ef905ce54`) concluiu o quarto bloco: compilador OpenAI real preparado no repositório, porém estritamente opt-in, owner-only e protegido pelo gate server-side `AUTOMATION_OPENAI_COMPILER_ENABLED`. Usa Responses API + Structured Outputs `json_schema` strict, allowlists do Action Registry/trigger/conditions/strategy, teto de custo e output tokens, timeout, observabilidade sanitizada e pós-validação backend. O fallback determinístico de custo zero continua padrão. O resultado OpenAI é sempre somente draft revisável, `enabled=false`, `execution_mode=off`, `kill_switch=true`, `canary_percent=0`, `requires_human_review=true`, sem persistência e sem ativação automática. Nenhum segredo, variável, deploy ou chamada OpenAI real foi feito nesta rodada.

O CI `Stage 10 Automation Engine` passou integralmente em v1/v2/v3/v4, incluindo sintaxe do Admin e `deno check` do Builder/dispatcher. A auditoria anterior à alteração confirmou no Supabase: `workflows=2`, `enabled_workflows=0`, `non_off_workflows=0`, `actions=9`, `enabled_actions=0`, `non_off_actions=0`, `open_handoffs=3`; `whatsapp_release_mode=live`, `whatsapp_live_canary_percent=1`, `experience_orchestrator_enabled=false`, `whatsapp_flow_data_exchange_enabled=false`, `whatsapp_flow_send_enabled=false`, `bling_order_sync_enabled=false`, `bling_order_homologation_only=true`. A lista de Edge Functions confirmou que Builder e dispatcher não estão publicados. Nenhum cenário Make novo foi criado.

**Critério programável da Etapa 10 atendido.** Homologação/ativação do compilador pago, do Builder e do dispatcher permanece protegida para fase autorizada; isso não bloqueia o avanço da programação.

## ETAPA 11 — Logística + Roteirização + App do Entregador
**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.** PR #201 integrada (`15786dcc1ca0d4ea484e0c22e567acb531cf0a6b`). Foram implementados domínio logístico separado de `orders`, `delivery_jobs`, drivers, vehicles, routes, stops, versions, events, incidents, locations, notifications e auditoria/custo de provider; fronteira idempotente `READY → delivery_job`; máquinas de estado backend-only; drafts determinísticos de rota; publicação protegida; bloqueio da próxima parada somente após receipt real do aviso; políticas configuráveis de ETA/GPS/prova de entrega/retenção/custo; PWA do entregador offline-first; Central LOGÍSTICA no Admin atrás de `logisticsUiEnabled=false`; provider abstrato com `NullRoutingProvider` sem rede; kill switch unilateral e Edge Functions versionadas com JWT obrigatório.

As migrations `stage11_logistics_foundation_v1`, `stage11_driver_actions_v1`, `stage11_logistics_policy_v2` e `stage11_route_drafts_notifications_v3` foram aplicadas e auditadas no Supabase. Readiness pós-DDL: `enabled=false`, `execution_mode=off`, `job_creation_enabled=false`, `routing_enabled=false`, `driver_app_enabled=false`, `gps_tracking_enabled=false`, `notifications_enabled=false`, `external_provider_enabled=false`, `provider_name=none`, `canary_percent=0`; `drivers=0`, `vehicles=0`, `jobs=0`, `routes=0`, `stops=0`, `locations=0`, `notifications=0` e `external_provider_calls=0`. Testes fail-closed confirmaram `logistics_job_creation_disabled` e `driver_runtime_disabled` sem side effects. O CI específico `Stage 11 Logistics / safety-contract` ficou verde no head integrado. Nenhum Maps/provider pago, OpenAI, cenário Make novo, GPS real, mensagem logística ou Edge Function logística foi ativado/deployado.

**Hardening fiscal pós-Etapa 11 CONCLUÍDO e dormente.** A PR #203 foi integrada em `main` (`9eeb63fd7954386d60488226e650e28bad891427`). A decisão `docs/DECISAO-FISCAL-ENTREGA-PAGAMENTO-NFE-V1.md` formaliza que a configuração de NF-e/venda pela internet já existente no Bling não será alterada pelo sistema. A migration `stage11_delivery_payment_fiscal_gate_v1` foi aplicada ao Supabase após CI verde. Entrega, pagamento e elegibilidade fiscal ficaram separados: pagamento antecipado sozinho não libera NF-e; entrega sem pagamento não libera NF-e; alteração isolada de `orders.status` também não substitui a confirmação logística explícita; somente `DELIVERED + PAYMENT_CONFIRMED + valor reconciliado` produz `FISCAL_READY`. Divergência de valor exige revisão e cancelamento/retorno permanecem bloqueados. Foram criados `fiscal_runtime_config`, `order_fiscal_controls`, `fiscal_issue_jobs`, reconciliador/preview determinísticos e preparação idempotente; `driver_deliver_stop_v2` recebe contexto de pagamento opcional. O adapter/dispatcher Bling/SEFAZ real não existe nesta versão; `external_side_effect=false`, `dispatcher_implemented=false`, `max_attempts=1`. O CI específico e a regressão geral do conversation worker ficaram verdes. O workflow da Etapa 11 também passou a usar sparse checkout para reduzir tempo/custo do GitHub Actions.

Auditoria pós-DDL: `fiscal_runtime_config.enabled=false`, `execution_mode=off`, `bling_invoice_prepare_enabled=false`, `bling_invoice_send_enabled=false`, `canary_percent=0`, com `require_delivery_confirmation=true` e `require_payment_confirmation=true`; `orders=0`, `order_fiscal_controls=0`, `fiscal_issue_jobs=0`, `delivery_jobs=0`, `delivery_routes=0`, `driver_locations=0`. Logística segue `enabled=false`, `execution_mode=off`, provider `none`, canary 0. WhatsApp foi preservado em `live=1%`; Flow/Data Exchange e Experience Orchestrator seguem desligados; Bling order sync segue desligado/homologation-only; 3 handoffs humanos continuam abertos / 0 claimed. Nenhuma chamada Bling/SEFAZ, emissão de NF-e, deploy da Edge Function logística ou mudança fiscal no Bling ocorreu.

**Critério programável da Etapa 11 atendido.** Homologação com entregadores/rotas/GPS/Maps/WhatsApp logístico e emissão real de NF-e permanecem protegidas para fase autorizada; isso não bloqueia o avanço da programação.

## ETAPA 12 — Lotes + Validade + FEFO + Ofertas + Guardião de Margem
**EM ANDAMENTO — BLOCOS DE VERDADE COMERCIAL E WMS/FULFILLMENT INTEGRADOS E DORMENTES.** PR #204 integrada (`437e660da97bdb250b6fdb4b68b2e264ec912691`). Foram criadas a verdade de lotes `inventory_lots`, ledger base `inventory_lot_movements`, políticas comerciais versionadas, regras promocionais desligadas, trilha de guardião de margem, preview FEFO determinístico e compatível com data prevista de entrega, guardião de margem determinístico e preview de desconto por validade somente mediante política ativa e sempre `applied=false`. Nenhum lote/política/promoção real foi retropreenchido a partir de `products.stock`, `validity_date` ou dados existentes.

As migrations `stage12_commercial_truth_foundation_v1` e `stage12_commercial_truth_admin_safety_v2` foram aplicadas ao Supabase após CI verde. Readiness pós-DDL: `enabled=false`, `execution_mode=off`, `lot_tracking_enabled=false`, `fefo_enforcement_enabled=false`, `expiry_block_enabled=false`, `promotions_enabled=false`, `benefits_enabled=false`, `margin_guard_enabled=false`, `reports_enabled=false`, `canary_percent=0`; `lots=0`, `available_lots=0`, `inventory_lot_movements=0`, `commercial_policy_versions=0`, `active_policies=0`, `promotion_rules=0`, `enabled_promotions=0` e `margin_guard_events=0`.

O FEFO só considera lotes `available`, fisicamente verificados, com saldo livre e validade compatível com `delivery_date + min_shelf_life_days`, ordenando deterministicamente por validade, recebimento e ID. O guardião de margem bloqueia receita líquida zero, margem negativa e margem abaixo do mínimo. A camada administrativa adicionou kill switch unilateral e RPCs owner-only para criar somente drafts: lote nasce `draft`, `physically_verified=false` e `quantity_available=0`; política nasce `draft`; promoção nasce `enabled=false`/`execution_mode=off`. A Edge Function `admin-commercial-truth-v1` ficou versionada com `verify_jwt=true`, sem caminho de ativação, e não foi deployada. `admin/config.js` já possui `commercialTruthUiEnabled=false`; a UI visual ainda não foi montada.

**WMS/Fulfillment leve integrado.** A PR #205 introduziu a fundação mobile/barcode-first e a PR corretiva #207 integrou-a à verdade comercial oficial, eliminando um schema concorrente de lotes e movendo a migration WMS para `stage12_wms_fulfillment_v1` (`20260908130200`). O WMS reutiliza exclusivamente `inventory_lots` da Verdade Comercial; `inventory_lot_locations` acrescenta apenas localização física do lote. Foram criados `fulfillment_runtime_config`, `warehouse_staff`, `warehouse_locations`, `product_location_assignments`, `inventory_lot_locations`, `fulfillment_orders`, `fulfillment_items`, `fulfillment_scan_events` e `order_packages`, todos server-only/RLS.

O estado físico fica separado de `orders.status`: `pending → picking → picked → checking → checked → packing/packed → ready → loading → loaded`. `preview_fulfillment_order_v1` detecta produtos sem posição; a criação falha explicitamente com `product_location_missing` em vez de usar localização genérica. O picking segue `pick_sequence` determinística por gôndola/prateleira, valida GTIN/SKU, rejeita item errado e excesso, registra scans idempotentes e exige conferente diferente do separador por padrão. `release_fulfillment_ready_v1` é o caminho protegido para promover o pedido comercial a `ready`; assim `READY` passa a representar pedido fisicamente separado e conferido. A PWA `warehouse-app/` foi criada para celulares/tablets/leitores que emulam teclado, com cache e fila offline, porém permanece `enabled=false` e sem API operacional deployada.

Durante a primeira aplicação foi detectado que a PR #204 já havia criado `inventory_lots` com schema oficial (`expires_at`, `quantity_available`, `physically_verified` etc.). A tentativa WMS original falhou dentro da transação antes de qualquer DDL parcial. A PR #207 corrigiu a dependência, e o CI passou aplicando `Commercial Truth → WMS` em sequência e simulando em PGlite: posição → FEFO → barcode errado rejeitado → picking correto → conferência por funcionário independente → `CHECKED → READY`. O `Stage 12 WMS` e a regressão completa `Test Dona Antonia conversation worker` ficaram verdes.

A migration corrigida `stage12_wms_fulfillment_v1` foi aplicada ao Supabase e auditada: `enabled=false`, `execution_mode=off`, `picking_enabled=false`, `checking_enabled=false`, `packing_enabled=false`, `ready_release_enabled=false`, `loading_enabled=false`, `fefo_enforced=false`, `canary_percent=0`, `require_independent_checker=true`, `allow_manual_barcode_override=false`; `warehouse_staff=0`, `warehouse_locations=0`, `fulfillment_orders=0`, `fulfillment_scan_events=0`, `order_packages=0` e `orders=0`. A Verdade Comercial continua simultaneamente OFF, com `lots=0`, `available_lots=0`, `active_policies=0` e `enabled_promotions=0`. Nenhum estoque, pedido, funcionário, localização, lote ou operação real foi criado/movimentado.

O Security Advisor pós-DDL manteve o padrão informativo `RLS Enabled No Policy` das tabelas server-only (RLS + acesso anon/auth revogado + service-role) e o WARN preexistente de proteção de senha vazada desabilitada; nenhum desses avisos foi alterado nesta rodada.

**Próximo bloco da Etapa 12:** completar o WMS de forma dormente com API `warehouse-ops-v1` versionada mas não deployada, snapshot/fila de trabalho mobile, onboarding/mapeamento de gôndola/prateleira a partir dos campos legados somente em preview/draft, reserva/liberação/consumo idempotentes por lote, criação/scan de volumes e carregamento por rota; em paralelo montar a Central de Verdade Comercial no Admin atrás de `commercialTruthUiEnabled=false` e preparar relatórios/snapshots de validade, giro, ruptura e margem via GitHub Actions. Cupons/brindes/benefícios/aniversário continuam somente como drafts/policies OFF. A Etapa 13 ainda não deve começar.

## ETAPA 13 — Financeiro Operacional + Recebimentos + Conciliação
**PENDENTE.**

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

## Regra para cada rodada

1. Continuar da primeira etapa ainda não concluída.
2. Programar o maior bloco seguro/coerente possível.
3. Não transformar pendência externa em bloqueio para componentes independentes.
4. Todo módulo novo nasce desligado e configurável no Admin quando seguro.
5. Testar/regredir/documentar em cada etapa; não esperar a etapa 20 para testar.
6. Preservar idempotência, auditoria, RLS/RBAC, budgets, canary e rollback.
7. Antes de usar Make/OpenAI/Maps/API paga, registrar por que alternativa determinística/GitHub Actions/Supabase não resolve melhor ou mais barato.
8. Nunca ativar produção, gasto ou side effect real sem autorização/gates correspondentes.