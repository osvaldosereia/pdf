# Checkpoint final de produção — ETAPA 6 — Instagram Direct + comentários

Data: 08/09/2026 UTC.

Este é o checkpoint autoritativo da ETAPA 6. A execução desta rodada termina aqui. **Não iniciar ETAPA 7 a partir deste documento sem nova solicitação do usuário.**

## Arquitetura autoritativa

- PR #190 — `Dona Antônia: fundação dormente Instagram Direct + comentários`: fundação oficial inicial da ETAPA 6.
- PR #191 — `Dona Antônia: hardening final da etapa 6 Instagram`: human-first Direct, intenção, policy snapshot sem abertura de gate, revisão sem envio, serializers puros e atribuição conteúdo → conversa → pedido.
- PR #192 — `Dona Antônia: kill switch final da etapa 6 Instagram`: revisão de private reply também respeita `private_reply_prepare_enabled` após criação do rascunho.
- PR #189 foi **fechada sem merge** como implementação concorrente/superseded. Suas migrations antigas não devem ser aplicadas.

## Migrations aplicadas em produção

Fundação:
- `20260908034350 instagram_direct_comment_foundation_v1`

Hardening incremental:
- `20260908040144 instagram_stage6_human_policy_attribution_v2`
- `20260908040159 instagram_stage6_prepare_guard_fix_v2`
- `20260908040217 instagram_stage6_order_attribution_v2`
- `20260908040612 instagram_stage6_review_killswitch_v2`

## Entregas programáveis concluídas

### Direct humano-primeiro

- Instagram usa `channel_accounts` e `instagram_channel_controls`, sem flag global de liberação;
- todos os gates continuam `false` por padrão;
- Direct só pode entrar quando conta + controles futuros autorizarem observe/inbound;
- IGSID nasce como identidade `observed`;
- CRM só é reutilizado quando a identidade já está `verified`;
- conversa Instagram entra em `needs_human`, `mode=human`, `human_required=true`, cohort `human_control`;
- handoff usa motivo `instagram_direct_human_first`;
- IA/auto-reply/outbound não são ativados.

### Comentários e private reply

- classificação determinística sem custo: `purchase_interest`, `question`, `support`, `spam`, `other`;
- comentários da própria conta profissional são ignorados;
- somente compra/pergunta/suporte podem chegar à preparação;
- Live permanece bloqueado sem verificação externa de transmissão ativa;
- private reply permanece idempotente e `held`;
- revisão exige `owner/operator`;
- aprovação revalida política, prazo, conta e kill switch `private_reply_prepare_enabled`;
- aprovação permanece `state=held`, `hold_reason=instagram_transport_not_enabled`, `sent=false`;
- não existe dispatcher Meta.

### Política

O código registra snapshot revisado das regras atuais, mas `operationalGatePolicyVerifiedByDefault=false`.

`verify_instagram_policy_snapshot_v2`:
- owner-only;
- confirmação literal `CONFIRMAR_POLITICA_INSTAGRAM`;
- registra versão/janela somente para conta Instagram já cadastrada;
- retorna `gates_changed=false`;
- não liga webhook, observe, IA, auto-reply, prepare, send ou outbound.

### Apresentação

Contratos JSON puros foram preparados para:
- texto;
- private reply por `comment_id`;
- quick replies;
- Generic Template/carrossel;
- compartilhamento de post próprio (`MEDIA_SHARE`).

`transportReleased=false`; módulos não contêm `fetch`, `net.http_post`, token ou URL Graph.

### Atribuição

- `channel_attribution_events` preserva Direct/comentário/post/Reel/Story/Live/ad e IDs de campanha quando presentes;
- touchpoint pode ser ligado à conversa da mesma identidade externa sem inferir CRM;
- `order_channel_attribution_links` usa last-touch somente pela mesma `conversation_id`, antes do pedido e em janela de 30 dias;
- não há fallback por nome, telefone, e-mail ou `customer_id` isolado;
- triggers locais tratam ordem de chegada pedido/touchpoint sem rede externa.

## Webhook Meta

`meta-instagram-webhook-v1` permanece **somente no GitHub**:
- não aparece na lista de Edge Functions implantadas do Supabase;
- runtime exige `META_INSTAGRAM_WEBHOOK_RUNTIME_ENABLED=true`;
- POST exige HMAC `X-Hub-Signature-256`;
- conta precisa existir previamente;
- não contém Graph Send API;
- não há subscription Meta real.

## CI final

PR #191:
- `Dona Antonia Instagram Stage 6 hardening` — verde;
- `Dona Antonia Instagram foundation` — verde;
- `Test Dona Antonia conversation worker` — verde, incluindo Node/PGlite/Deno/Flow/Sala.

PR #192:
- `Dona Antonia Instagram Stage 6 final kill switch` — verde;
- `Test Dona Antonia conversation worker` — verde.

## Auditoria final de produção

### Gates

- `whatsapp_release_mode=live`;
- `whatsapp_live_canary_percent=1`;
- `experience_orchestrator_enabled=false`;
- `whatsapp_flow_data_exchange_enabled=false`;
- `whatsapp_flow_send_enabled=false`;
- `bling_order_sync_enabled=false`.

### Handoffs reais

Continuam 3 handoffs WhatsApp:
- todos `open`;
- nenhum `claimed`;
- `needs_human`;
- `mode=human`;
- `human_required=true`;
- cohort `human_control`;
- buckets 89, 68 e 10.

Nenhum foi assumido, respondido, resolvido ou fechado pela ETAPA 6.

### Instagram/atribuição

- `channel_accounts` Instagram = 0;
- `instagram_channel_controls` = 0;
- `instagram_comment_observations` = 0;
- `instagram_private_reply_jobs` = 0;
- `instagram_conversation_windows` = 0;
- `channel_attribution_events` Instagram = 0;
- `order_channel_attribution_links` = 0;
- pedidos = 0;
- `order_sync_jobs` = 0.

Readiness e métricas:
- `transport_implemented=false`;
- `customer_runtime_released=false`;
- `private_reply_sent=0`;
- `instagram_handoffs_active=0`.

### Segurança

RLS está habilitado em:
- `instagram_channel_controls`;
- `instagram_comment_observations`;
- `instagram_private_reply_jobs`;
- `instagram_conversation_windows`;
- `channel_attribution_events`;
- `order_channel_attribution_links`.

Security Advisor:
- nenhum novo WARN de schema da ETAPA 6;
- INFO `RLS Enabled No Policy` permanece esperado para tabelas server-only;
- WARN preexistente `Leaked Password Protection Disabled` continua como pendência de Auth, fora da ativação Instagram.

## Make

O cenário `6508939 — POSTAR PRIMEIRO CARROSSEL KIT NOVO` continua `inactive`. Nenhuma publicação automática Instagram foi reativada.

## Pendências externas da própria ETAPA 6

Permanecem deliberadamente não executadas:
1. cadastrar conta Instagram profissional real em `channel_accounts`;
2. Meta App/Business correto e permissões vigentes;
3. App Review / Advanced Access / Business Verification quando aplicável;
4. secrets externos do webhook;
5. deploy de `meta-instagram-webhook-v1`;
6. subscription oficial de mensagens/comentários;
7. homologação observe + humano-primeiro real;
8. canary IA independente do Instagram;
9. dispatcher real de private reply/Direct.

Esses itens exigem nova autorização/credenciais/permissões externas. Nenhum deles deve ser antecipado por automação.

## Ponto de retomada

A **ETAPA 6 está concluída na parte programável/dormente e auditada em produção**. Se o usuário pedir para continuar futuramente, confirmar o escopo solicitado antes de avançar. Não iniciar ETAPA 7 automaticamente.
