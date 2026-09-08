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

As migrations `stage11_logistics_foundation_v1`, `stage11_driver_actions_v1`, `stage11_logistics_policy_v2` e `stage11_route_drafts_notifications_v3` foram aplicadas e auditadas no Supabase. Readiness pós-DDL: `enabled=false`, `execution_mode=off`, `job_creation_enabled=false`, `routing_enabled=false`, `driver_app_enabled=false`, `gps_tracking_enabled=false`, `notifications_enabled=false`, `external_provider_enabled=false`, `provider_name=none`, `canary_percent=0`; `drivers=0`, `vehicles=0`, `jobs=0`, `routes=0`, `stops=0`, `locations=0`, `notifications=0` e `external_provider_calls=0`. Testes fail-closed confirmaram `logistics_job_creation_disabled` e `driver_runtime_disabled` sem side effects. O CI específico `Stage 11 Logistics / safety-contract` ficou verde no head integrado; workflows legados chamados apenas `validar` continuam com falhas preexistentes/agregadoras e não foram mascarados. Nenhum Maps/provider pago, OpenAI, cenário Make novo, GPS real, mensagem logística ou Edge Function logística foi ativado/deployado. A auditoria preservou WhatsApp `live=1%`, Flow/Data Exchange e Experience Orchestrator desligados, Bling order sync desligado/homologation-only e 3 handoffs humanos abertos / 0 claimed.

**Hardening fiscal pós-Etapa 11 em integração antes da Etapa 12.** A decisão `docs/DECISAO-FISCAL-ENTREGA-PAGAMENTO-NFE-V1.md` formaliza que a configuração fiscal de NF-e/venda pela internet já existente no Bling não será alterada pelo sistema. A nova fundação separa entrega, pagamento e elegibilidade fiscal: pagamento antecipado sozinho não libera NF-e; entrega sem pagamento não libera NF-e; somente `DELIVERED + PAYMENT_CONFIRMED + valor reconciliado` produz `FISCAL_READY`. Cancelamento/retorno/falha permanecem bloqueados. A migration `stage11_delivery_payment_fiscal_gate_v1` adiciona `fiscal_runtime_config`, `order_fiscal_controls`, `fiscal_issue_jobs`, preview/reconciliador determinístico e preparação idempotente de emissão, todos server-only e OFF por padrão. `driver_deliver_stop_v2` recebe contexto de pagamento opcional sem chamar Bling/SEFAZ. O adapter/dispatcher fiscal real não existe nesta versão; `external_side_effect=false`, `dispatcher_implemented=false`, `max_attempts=1`. CI e aplicação dormente ainda devem ficar verdes antes do merge; até lá a Etapa 12 não deve ser iniciada.

**Critério programável da Etapa 11 atendido.** Homologação com entregadores/rotas/GPS/Maps/WhatsApp logístico reais permanece protegida para fase autorizada; isso não bloqueia o avanço da programação.

## ETAPA 12 — Lotes + Validade + FEFO + Ofertas + Guardião de Margem
**PRÓXIMA ETAPA — PENDENTE.** Iniciar pela verdade determinística de lotes/validade/FEFO e políticas comerciais versionadas, mantendo ofertas/benefícios/margem e qualquer automação real desligados até validação. Antes de iniciar, concluir/mesclar o hardening fiscal pós-Etapa 11 descrito acima.

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
