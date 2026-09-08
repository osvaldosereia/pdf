# ETAPA 6 — Instagram Direct / comentários — hardening v2

Atualizado em 08/09/2026 UTC.

Este documento consolida a arquitetura autoritativa da ETAPA 6 após a integração da PR #190 e substitui qualquer intenção de integrar migrations concorrentes da PR #189.

## Base oficial

A PR #190 (`Dona Antônia: fundação dormente Instagram Direct + comentários`) é a fundação oficial já integrada/aplicada. Ela mantém:

- `instagram_channel_controls` por conta, todos os gates `false` por padrão;
- política de private reply operacionalmente **não verificada** por padrão (`policy_verified_at=null`, janela `0`);
- observações de comentários server-only;
- fila `instagram_private_reply_jobs` idempotente, `held`, máximo de uma tentativa e sem transporte;
- parser/gates em `instagram-runtime-v1.mjs`;
- `meta-instagram-webhook-v1` versionado, porém não implantado, com kill switch ambiental, HMAC e sem Graph Send API;
- readiness com `transport_implemented=false` e `customer_runtime_released=false`.

A PR #189 contém uma implementação paralela anterior e **não deve ser integrada**: algumas tabelas usam esquemas diferentes da base #190. Os avanços úteis foram portados por migrations incrementais compatíveis neste hardening.

## Política revisada sem abertura de gate

`instagram-policy-v2.mjs` registra um snapshot técnico das regras oficiais revisadas em 08/09/2026:

- no máximo um private reply por comentário;
- janela de até 7 dias;
- Live somente enquanto a transmissão estiver ativa;
- follow-up somente após resposta do destinatário quando exigido, com janela de 24h;
- quick replies com até 13 opções e título até 20 caracteres;
- Generic Template preparado com no máximo 3 botões por item;
- compartilhamento de mídia exige confirmação de que o post pertence à conta profissional.

O snapshot contém `operationalGatePolicyVerifiedByDefault=false`: conhecer a regra atual não autoriza operação. Para gravar uma política como verificada no banco é necessário RPC owner-only, confirmação literal e conta Instagram já cadastrada. Essa ação **não liga nenhum gate**.

## Direct humano primeiro

`ensure_instagram_direct_human_v2` complementa a fundação:

1. revalida conta Instagram + `instagram_channel_controls` + observe/inbound;
2. cria IGSID apenas como `observed`;
3. só reutiliza CRM quando a identidade já estiver `verified`;
4. cria/reutiliza conversa `channel=instagram`;
5. força `status=needs_human`, `mode=human`, `human_required=true`, cohort `human_control`;
6. cria `human_handoff` com motivo `instagram_direct_human_first`;
7. atualiza janela de conversa;
8. nunca liga IA, auto-reply ou outbound.

## Comentários e private reply

O webhook dormente adiciona classificação determinística sem custo:

- `purchase_interest`;
- `question`;
- `support`;
- `spam`;
- `other`.

Comentários da própria conta profissional são ignorados. Somente `purchase_interest`, `question` e `support` podem chegar à preparação de private reply; spam/other ficam bloqueados.

`prepare_instagram_private_reply_v1` continua compatível com a fundação #190 e permanece fail-closed:

- exige `private_reply_prepare_enabled`;
- exige política operacional explicitamente verificada;
- bloqueia Live sem verificação externa;
- respeita expiração;
- cria/retorna job em estado `held`/`expired`, nunca envia.

`review_instagram_private_reply_v2` permite revisão owner/operator:

- revalida política, intenção, Live, prazo e conta;
- cancelamento permanece local;
- aprovação registra auditoria, mas mantém `state=held` e `hold_reason=instagram_transport_not_enabled`;
- retorna `sent=false`.

Não existe dispatcher Meta.

## Contratos de apresentação

`instagram-send-contract-v2.mjs` cria somente objetos JSON puros para uso futuro:

- texto;
- private reply por `comment_id`;
- quick replies;
- Generic Template/carrossel;
- compartilhamento de post próprio (`MEDIA_SHARE`).

`transportReleased=false`. O módulo não contém `fetch`, `net.http_post`, token ou endpoint Graph.

## Atribuição

`channel_attribution_events` preserva origem de comentário/Direct/post/Reel/Story/Live/anúncio e IDs de campanha quando presentes.

Direct da mesma IGSID pode associar touchpoints recentes à conversa sem vincular cliente por nome/display name.

`order_channel_attribution_links` liga conversa a pedido em last-touch apenas quando:

- o pedido possui `conversation_id`;
- o touchpoint pertence à mesma conversa;
- ocorreu antes do pedido;
- ocorreu nos 30 dias anteriores.

Não existe fallback por telefone, e-mail, nome ou `customer_id` isolado. Triggers locais tratam pedido/touchpoint fora de ordem sem rede externa.

## Webhook

`meta-instagram-webhook-v1` permanece código dormente:

- `META_INSTAGRAM_WEBHOOK_RUNTIME_ENABLED` precisa ser literal `true` para operar;
- HMAC `X-Hub-Signature-256` obrigatório;
- não auto-cadastra `channel_accounts`;
- ignora echoes e comentários da própria conta;
- normaliza Direct/comentários e chama apenas RPCs locais;
- não possui Send API, Graph API nem dispatcher de private reply.

**Não implantar, assinar webhook ou configurar conta Meta nesta etapa sem autorização externa posterior.**

## Migrations incrementais

Aplicar somente depois de CI verde e auditoria de produção, nesta ordem:

1. `20260908060000_instagram_stage6_human_policy_attribution_v2.sql`
2. `20260908060001_instagram_stage6_prepare_guard_fix_v2.sql`
3. `20260908060100_instagram_stage6_order_attribution_v2.sql`

As migrations antigas da PR #189 (`20260908043000...`, `20260908043100...`, `20260908043200...`) não fazem parte do caminho de produção e não devem ser aplicadas.

## Invariantes de saída

Após DDL, confirmar:

- WhatsApp permanece `live=1%`;
- Flow/Data Exchange/orquestrador permanecem `false`;
- Bling permanece `false`;
- os 3 handoffs WhatsApp existentes permanecem abertos/intocados;
- `channel_accounts` continua sem Instagram real;
- zero comentário/Direct/private reply real foi processado/enviado;
- readiness e métricas continuam `transport_implemented=false` / `customer_runtime_released=false`;
- cenário Make de postagem automática Instagram continua inativo;
- Security Advisor sem novo WARN de schema.

A execução atual termina na ETAPA 6. Não iniciar ETAPA 7.
