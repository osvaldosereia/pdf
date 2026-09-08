# Progresso — Roadmap Dona Antônia 12 etapas

Atualizado em 08/09/2026 UTC.

Este arquivo é o marcador persistente de execução do `docs/ROADMAP-FINAL-DONA-ANTONIA-12-ETAPAS.md`. A próxima rodada deve ler também `docs/RETOMADA-DONA-ANTONIA.md` e continuar da primeira etapa numerada ainda não concluída abaixo.

## ETAPA 1 — Fundação, limpeza e consolidação operacional

**Concluída.** PR #182 integrada. Canary WhatsApp permanece `live=1%`; Flow/orquestrador desligados; handoffs humanos preservados; Make consolidado com pontes realtime justificadas e batch priorizado em GitHub Actions.

## ETAPA 2 — Pedido real ponta a ponta + Bling

**Parte programável concluída.** PR #183 integrada; migrations `20260908024746 order_bling_homologation_foundation_v2` e `20260908024845 order_bling_stock_guard_v1` aplicadas. Bling continua desligado, allowlist-only e lote máximo 1. Homologação de um único pedido real permanece pendência externa para a Etapa 12.

## ETAPA 3 — Núcleo omnichannel e evento normalizado

**Concluída e aplicada.** PR #185 integrada. Migration `omnichannel_event_core_v1` aplicada em produção. `channel_accounts`, identidades por canal e eventos normalizados continuam server-only/fail-closed; nenhuma conta Instagram/Messenger foi criada.

## ETAPA 4 — Adapters, renderers e gates independentes

**Concluída.** PR #186 integrada após CI verde. Adapters WA/Web/IG/Messenger, `CAPABILITY_REGISTRY`, decisões comerciais neutras ao canal, renderers/fallbacks e gates independentes estão em `main`. Nenhum canal novo foi ativado.

## ETAPA 5 — CRM unificado, identidades e caixa de entrada única

**Concluída, integrada e aplicada em produção.** PR #187 integrada por squash em `main` no commit `9c243f508cba19e7b5ff6fe8aef669b23c221c23` após todos os workflows verdes.

### Implementação consolidada

Migration `supabase/migrations/20260908040000_unified_crm_inbox_v1.sql`:

- remove a dependência estrutural obrigatória de `conversations.whatsapp_account_id` e adiciona `channel_account_id` + `external_user_id` genéricos;
- exige conta/identidade explícita para futuras conversas Instagram/Messenger, sem criar nenhuma conta;
- permite identidades de canal apenas observadas antes de vínculo confirmado;
- cria `customer_emails` com normalização, verificação e unicidade apenas após confirmação;
- cria `customer_channel_consents` por canal/finalidade, sem ativar marketing;
- cria auditoria `customer_identity_link_events`;
- RPCs de confirmação de identidade exigem admin autorizado + evidência forte com referência SHA-256; nome/display name nunca é evidência de vínculo;
- generaliza `human_handoffs` com `channel`, `channel_account_id`, SLA, primeira resposta e última resposta de operador;
- cria `customer_timeline_v1`, reunindo eventos normalizados, mensagens legadas não espelhadas, pedidos, handoffs e respostas humanas;
- cria `unified_inbox_v1` e `get_unified_inbox_metrics_v1` com filtros/SLA/motivos;
- cria `operator_reply_jobs`, separado do outbound da IA;
- resposta humana exige conversa em `mode=human`, handoff `claimed` pelo mesmo operador e rechecagem de janela/gates antes do envio;
- WhatsApp humano reaproveita somente o transporte Make já existente; Instagram/Messenger ficam `held` com `channel_transport_not_enabled`;
- entrega incerta vira `review_required`, sem retry cego;
- nenhuma flag/canary é alterada.

Admin:

- `admin-whatsapp-ops-v1` expõe `inbox`, `timeline`, resumo de identidades/consentimentos e `operator_reply`, mantendo JWT/RBAC;
- `admin-v3/whatsapp-ops.js` transforma a visão operacional em **Inbox omnichannel** com filtros por canal/status/prioridade, CRM, timeline, SLA, assumir/resolver e resposta humana;
- a UI não oferece atalho automático `Resolver + IA`; resolver não retoma IA automaticamente.

### CI e correção de regressão

A primeira execução da PR #187 encontrou um teste legado que ainda exigia `resume_ai` no JavaScript do Admin. O teste foi corrigido para o novo contrato seguro: o RPC server-side continua disponível para uso explicitamente auditado, mas a Inbox não oferece mais `Resolver + IA` em um clique. Depois da correção, ficaram verdes:

- `Test Dona Antonia conversation worker`;
- `Dona Antonia unified CRM + inbox`;
- `Dona Antonia omnichannel core`;
- `Dona Antonia channel runtime`;
- `deno check` da Edge Function;
- testes Node/PGlite/Flow/Sala/orquestrador e sintaxe do Admin.

### Produção

- migration aplicada no Supabase como `20260908031655 unified_crm_inbox_v1`;
- Edge Function `admin-whatsapp-ops-v1` implantada como versão 2 com `verify_jwt=true`;
- cron `dona-antonia-operator-reply-reconcile-v1` ativo a cada minuto somente para reconciliação de respostas já despachadas; não redispara mensagens;
- `operator_reply_jobs=0` após implantação: nenhuma resposta real foi enviada durante a homologação técnica;
- `customer_emails=0`, `customer_channel_consents=0` e `customer_identity_link_events=0`: nenhum dado de cliente foi inventado ou vinculado automaticamente;
- `orders=0` e `order_sync_jobs=0`: nenhuma ação Bling/pedido foi criada pela etapa.

### Auditoria pós-DDL

- `whatsapp_release_mode=live` e `whatsapp_live_canary_percent=1` preservados;
- `experience_orchestrator_enabled=false`;
- `whatsapp_flow_data_exchange_enabled=false`;
- `whatsapp_flow_send_enabled=false`;
- `bling_order_sync_enabled=false`;
- os 3 handoffs reais continuam `open`, não assumidos, `mode=human`, `human_required=true`, canal `whatsapp`, cohort `human_control`, buckets 89/68/10;
- os 3 receberam somente `sla_due_at` calculado; nenhum foi assumido, respondido, resolvido ou fechado;
- `channel_accounts=0` e `meta_accounts_active=0`;
- novas tabelas `customer_emails`, `customer_channel_consents`, `customer_identity_link_events` e `operator_reply_jobs` têm RLS habilitado e acesso público/authenticated revogado;
- métricas da Inbox retornam 3 ativos, 3 abertos, 0 assumidos, todos no canal WhatsApp e motivo `live_canary_human_control`;
- Security Advisor não apontou novo WARN de schema; permanecem INFOs esperados `RLS Enabled No Policy` em tabelas server-only e o WARN preexistente `Leaked Password Protection Disabled`.

### Make

- WhatsApp inbound `6779824` e outbound realtime `7290488` permanecem ativos e sem alterações;
- cenário `6508939 — POSTAR PRIMEIRO CARROSSEL KIT NOVO` permanece **inativo** após ter sido desativado reversivelmente por conter publicação real automática no Instagram.

## Próxima etapa

Avançar para **ETAPA 6 — Instagram Direct + comentários → private reply → Direct**, executando apenas a fundação programável/dormente enquanto Instagram/Messenger reais continuarem proibidos. Não criar subscription Meta real, não ativar inbound/IA/outbound, não enviar private reply real e não alterar o canary WhatsApp de 1%.
