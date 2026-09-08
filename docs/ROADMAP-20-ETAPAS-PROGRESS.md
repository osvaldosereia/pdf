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
**EM IMPLEMENTAÇÃO — BLOCOS 1 E 2 PROGRAMÁVEIS CONCLUÍDOS E DORMENTES.** A PR #197 criou a fundação server-only `TRIGGER → CONDITIONS → ACTIONS`, com `automation_workflows`, versões, execuções/eventos, RLS, acesso service-role, simulador sem efeitos e recomendador GitHub Actions first. A migration real `automation_engine_stage10_v1` segue aplicada e não foi alterada nesta rodada.

A PR #198 foi integrada no `main` (`3e82abbf5fa4138a6f15f85d5c66ceac6a7d8dcd`) e concluiu o segundo bloco seguro: o Automation Builder agora está montado no Admin, porém permanece invisível atrás de `automationBuilderUiEnabled=false`; visualiza `TRIGGER → CONDITIONS → ACTIONS`, valida e simula workflows e só oferece mutação operacional unilateralmente segura de kill switch. Foi adicionado compilador linguagem natural → workflow draft **não persistente, revisável e sem side effects**, com fallback determinístico sem custo externo e leitura apenas das chaves existentes no AI Action Registry. A chamada OpenAI real permanece deliberadamente não automática/opt-in para evitar gasto antes do contrato final e ainda deve ser integrada em bloco posterior com schema validation e revisão humana. Conditions ganharam allowlist estruturada de campos e operadores; drafts continuam forçados a `enabled=false`, `execution_mode=off`, `canary_percent=0`, `kill_switch=true`.

O CI específico da Etapa 10 foi ampliado para testes v1/v2, `node --check` do Builder e `deno check` da Edge Function e ficou verde. O workflow passou a usar sparse checkout somente dos arquivos necessários, reduzindo checkout/custo do repositório grande. A regressão completa do conversation worker também ficou verde, incluindo worker, áudio, WhatsApp, Flow, Sala de Compra, hardening, Deno checks e crypto tests. Dois workflows legados não relacionados permanecem com drift já identificado: `Testar Admin V2 definitivo` continua falhando somente no agregador final `Confirmar resultado` depois de todas as validações técnicas passarem; `Testar player do vídeo das canecas` cobra markers V5/V24 que já não existem no `main` atual (bridge está no build V25), portanto é uma falha de contrato legado do subsistema Caneca Fácil, não uma regressão da Etapa 10.

Auditoria Supabase antes do bloco confirmou `workflows=2`, `enabled_workflows=0`, `non_off_workflows=0`, `actions=9`, `enabled_actions=0`, `non_off_actions=0`, `open_handoffs=3`. Nenhuma migration, deploy, workflow real, OpenAI real ou cenário Make foi acionado neste bloco; canary/Flow/Bling/handoffs não foram tocados.

**Próximo bloco da própria Etapa 10:** implementar dispatcher auditável estritamente limitado a `observe`/`dry_run`, gravando execução/eventos com `external_side_effect=false`, idempotência e revalidação de handoff/AI Action Registry/budget; preparar integração OpenAI do compilador atrás de gate explícito, schema estrito, custo medido e revisão antes de persistir. Só considerar Etapa 10 programaticamente concluída após esses guardrails e regressão correspondente; não iniciar Etapa 11 antes disso.

## ETAPA 11 — Logística + Roteirização + App do Entregador
**PENDENTE.** Prioridade operacional alta.

## ETAPA 12 — Lotes + Validade + FEFO + Ofertas + Guardião de Margem
**PENDENTE.**

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
