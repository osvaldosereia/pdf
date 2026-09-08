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

## ETAPA 6 — Instagram Direct + comentários → private reply → Direct

**Parte programável segura concluída, integrada e aplicada de forma dormente.** PR #190 integrada por squash em `main` no commit `93bab27391acb833c974f5ff454709fb18873344` após CI verde.

### Implementação

- `lib/omnichannel/instagram-runtime-v1.mjs` normaliza Direct e comentários e mantém gates independentes para observe mode, preparação e despacho;
- `supabase/migrations/20260908053500_instagram_direct_comment_foundation_v1.sql` cria controles Instagram server-only, observações de comentários e fila idempotente de private reply;
- todos os controles nascem `false`; política Meta de private reply nasce explicitamente não verificada (`private_reply_window_seconds=0`);
- private replies nascem em estado `held`, com `requires_user_response=true` e no máximo uma tentativa; não existe retry cego nem cron de envio;
- `prepare_instagram_private_reply_v1` prepara somente rascunho operacional e nunca publica;
- `get_instagram_readiness_v1` declara explicitamente `transport_implemented=false` e `customer_runtime_released=false`;
- `meta-instagram-webhook-v1` foi implementada no repositório com validação `X-Hub-Signature-256`/HMAC-SHA256, challenge token e gate ambiental `META_INSTAGRAM_WEBHOOK_RUNTIME_ENABLED`; ela não contém transporte Graph API nem private reply;
- documentação de decisão em `docs/INSTAGRAM-DIRECT-COMMENTS-DECISION-V1.md` preserva homologação futura em observe mode e revisão da política Meta vigente antes de qualquer envio.

### CI

- parser/gates e invariantes SQL passaram;
- `deno check` inicialmente encontrou incompatibilidade de tipo WebCrypto no Deno 2.x; a função foi corrigida para converter explicitamente `Uint8Array` em `ArrayBuffer`;
- após a correção, `Dona Antonia Instagram foundation` e a regressão completa `Test Dona Antonia conversation worker` ficaram verdes.

### Produção dormente

- migration aplicada no Supabase como `20260908034350 instagram_direct_comment_foundation_v1`;
- não foi criada nenhuma conta Instagram/Messenger;
- `instagram_channel_controls=0`, `instagram_comment_observations=0` e `instagram_private_reply_jobs=0`;
- readiness: `accounts=0`, `active_accounts=0`, `webhook_enabled_accounts=0`, `policy_verified_accounts=0`, `private_reply_send_enabled_accounts=0`, `ready_private_reply_jobs=0`, `transport_implemented=false`, `customer_runtime_released=false`;
- a tentativa de implantar a nova Edge Function foi bloqueada pelo controle de segurança da ferramenta; não houve contorno. Portanto o código está integrado/testado, mas o endpoint Meta novo permanece **não implantado**, o que mantém a etapa ainda mais fail-closed;
- nenhuma subscription Meta, App Secret, verify token, conta, webhook real, Direct, comentário ou private reply real foi criado/enviado.

### Invariantes revalidadas

- WhatsApp continua `live=1%`;
- os 3 handoffs continuam `open` e 0 `claimed`;
- Flow/Data Exchange e orquestrador continuam desligados;
- Bling continua desligado;
- `orders=0` e `order_sync_jobs=0`;
- nenhum cenário Make novo foi criado; inbound/outbound WhatsApp realtime permanecem as pontes justificadas;
- os INFOs `RLS Enabled No Policy` nas três novas tabelas são intencionais porque elas são server-only, RLS está ativo e `public/anon/authenticated` foram revogados; o WARN preexistente `Leaked Password Protection Disabled` continua sem alteração.

## Próxima etapa

Avançar para **ETAPA 7 — Facebook Messenger + centralização Meta**, executando somente arquitetura/adapters/webhooks/gates/Admin em modo dormente. Reutilizar o núcleo omnichannel e a Inbox, não conectar conta Meta real, não ativar IA/outbound, não publicar nada e não alterar o canary WhatsApp de 1%. A implantação pendente de `meta-instagram-webhook-v1` deve continuar registrada para a regressão/homologação externa da Etapa 12, salvo se uma próxima rodada conseguir implantá-la com o mesmo gate fail-closed sem reduzir segurança.
