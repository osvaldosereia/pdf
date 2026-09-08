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

**Status programável: implementada em branch/PR própria; aguardando CI e integração antes de qualquer DDL.**

### Auditoria de entrada

- Supabase produção correto: `ssbesxgaijknwsjbsbcz`;
- WhatsApp continua `release_mode=live` e `canary=1%`;
- `experience_orchestrator_enabled=false`;
- `whatsapp_flow_data_exchange_enabled=false`;
- `whatsapp_flow_send_enabled=false`;
- `bling_order_sync_enabled=false`;
- os 3 handoffs humanos reais continuam `open`, `mode=human`, `human_required=true`, cohort `human_control`, buckets 89/68/10;
- `channel_accounts` continua sem Instagram/Messenger ativos;
- Make WhatsApp inbound `6779824` e outbound `7290488` permanecem ativos e sem alterações;
- cenário Make `6508939 — POSTAR PRIMEIRO CARROSSEL KIT NOVO` foi encontrado ativo com publicação automática real em Instagram e foi **desativado reversivelmente**, pois marketing/Instagram real deve permanecer desligado nesta fase.

### Implementação da Etapa 5

Migration `supabase/migrations/20260908040000_unified_crm_inbox_v1.sql`:

- remove a dependência estrutural obrigatória de `conversations.whatsapp_account_id` e adiciona `channel_account_id` + `external_user_id` genéricos;
- exige conta/identidade explícita para futuras conversas Instagram/Messenger, sem criar nenhuma conta;
- permite identidades de canal apenas observadas antes de vínculo confirmado;
- cria `customer_emails` com normalização, verificação e unicidade apenas após confirmação;
- cria `customer_channel_consents` por canal/finalidade, sem ativar marketing;
- cria auditoria `customer_identity_link_events`;
- RPCs de confirmação de identidade exigem admin autorizado + evidência forte com referência SHA-256; nome/display name nunca é evidência de vínculo;
- generaliza `human_handoffs` com `channel`, `channel_account_id`, SLA, primeira resposta e última resposta de operador;
- preserva estado dos handoffs existentes; migration não assume, resolve nem fecha nenhum;
- cria `customer_timeline_v1`, reunindo eventos normalizados, mensagens legadas não espelhadas, pedidos, handoffs e respostas humanas;
- cria `unified_inbox_v1` e `get_unified_inbox_metrics_v1` com filtros/SLA/motivos;
- cria `operator_reply_jobs`, separado do outbound da IA;
- resposta humana exige conversa em `mode=human`, handoff `claimed` pelo mesmo operador e rechecagem de janela/gates antes do envio;
- WhatsApp humano reaproveita somente o transporte Make já existente; Instagram/Messenger ficam `held` com `channel_transport_not_enabled`;
- entrega incerta vira `review_required`, sem retry cego;
- nenhuma flag/canary é alterada.

Admin:

- `admin-whatsapp-ops-v1` passa a expor `inbox`, `timeline`, resumo de identidades/consentimentos e `operator_reply`, mantendo RBAC;
- `admin-v3/whatsapp-ops.js` transforma a antiga visão WhatsApp em **Inbox omnichannel** com filtros por canal/status/prioridade, CRM, timeline, SLA, assumir/resolver e resposta humana;
- a UI não oferece atalho automático `Resolver + IA`; resolver preserva explicitamente a regra de não retomar IA automaticamente.

CI:

- `scripts/test-unified-crm-inbox-v1.mjs` valida fail-closed, identidade segura, RLS, handoff, ausência de ativação Meta e ausência de retry cego;
- `.github/workflows/dona-antonia-unified-crm-inbox.yml` executa contrato Node, `node --check` do Admin e `deno check` da Edge Function.

### Regra de integração

Não aplicar a migration nem redeployar Edge Function antes de CI verde e merge. Pós-DDL: reauditar canary/gates, confirmar 3 handoffs intactos, confirmar zero contas Meta ativas, validar RLS/views/RPCs e Security Advisor. Só então marcar Etapa 5 concluída.

## Próxima etapa

Após Etapa 5 verde, integrada, aplicada e auditada, avançar para **ETAPA 6 — Instagram Direct + comentários → private reply → Direct**, mas apenas na parte programável/dormente enquanto permissões e ativação Meta continuarem proibidas.
