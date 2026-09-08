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

**Concluída, integrada e aplicada em produção.** PR #187 integrada por squash em `main` no commit `9c243f508cba19e7b5ff6fe8aef669b23c221c23`; checkpoint de produção PR #188 integrado no commit `cb043c0a78748bba019e99c64712379f5b52be7e`.

Produção preservada: WhatsApp `live=1%`; Flow/orquestrador/Bling desligados; 3 handoffs humanos abertos e não assumidos, buckets 89/68/10; `channel_accounts=0`; nenhuma resposta humana enviada na implantação; Edge `admin-whatsapp-ops-v1` v2 com JWT/RBAC; cenário Make `6508939` de publicação automática no Instagram permanece inativo.

## ETAPA 6 — Instagram Direct + comentários → private reply → Direct

**Status programável: implementação dormente completa na PR #189; aguardando CI final/merge e aplicação somente das migrations locais. Nenhuma conexão/subscription/deploy Meta realizado.**

### Política atual codificada

`docs/INSTAGRAM-DIRECT-POLICY-GUARDS-V1.md` e `supabase/functions/_shared/instagram-policy-v1.mjs` registram o snapshot revisado em 08/09/2026:

- Instagram profissional é pré-requisito externo;
- máximo de 1 private reply por comentário;
- janela de até 7 dias;
- Live bloqueado sem confirmação de transmissão ativa;
- follow-up só após resposta real do destinatário quando aplicável, com janela conservadora de 24h;
- quick replies: máximo 13 itens, título até 20 caracteres;
- compartilhamento futuro de post exige mídia pertencente à conta profissional;
- regras devem ser revalidadas imediatamente antes de homologação real.

### Banco dormente

Migration `20260908043000_instagram_direct_comment_foundation_v1.sql`:

- `channel_attribution_events` para comentário/Direct/post/Reel/Story/Live/ad e IDs de campanha;
- `instagram_comment_events` normalizado e idempotente;
- `instagram_private_reply_jobs`, sem dispatcher;
- `instagram_conversation_windows`;
- Direct inbound humano-primeiro em `ensure_instagram_direct_human_v1`;
- IGSID nasce `observed`; CRM só reutiliza identidade `verified`;
- conversa Instagram nova nasce `needs_human`, `mode=human`, `human_required=true`, cohort `human_control`;
- nenhuma criação automática de `channel_accounts`, nenhuma abertura de IA/outbound e nenhuma chamada Graph.

Migration `20260908043100_channel_order_attribution_link_v1.sql`:

- cria `order_channel_attribution_links` server-only/RLS;
- last-touch usa exclusivamente a mesma `conversation_id` do pedido;
- touchpoint precisa ser anterior ao pedido e estar dentro de 30 dias;
- não há fallback por nome, telefone, e-mail ou `customer_id` isolado;
- trigger no pedido cria/recalcula vínculo local;
- trigger no touchpoint cobre webhook/replay fora de ordem;
- nenhuma rede externa é chamada.

Migration `20260908043200_instagram_private_reply_review_hardening_v1.sql`:

- somente `purchase_interest`, `question` e `support` podem virar candidato elegível;
- `spam`, `other` e `unknown` ficam bloqueados para evitar abordagem privada indevida;
- candidato elegível exige revisão humana;
- `review_instagram_private_reply_v1` exige admin `owner/operator` e revalida intenção, janela, Live e gates da conta;
- aprovação termina em `status=approved`, `blocked_reason=dispatcher_not_released`, `sent=false`;
- cancelamento não envia nada;
- cria `instagram_private_reply_review_v1` e `get_instagram_stage6_metrics_v1` com `transport_released=false` fixo;
- não existe `fetch`, `net.http_post` ou Graph API nessa camada.

### Contratos de apresentação, sem transporte

`supabase/functions/_shared/instagram-send-contract-v1.mjs` + wrapper Node preparam JSON puro para:

- texto;
- private reply por `comment_id`;
- quick replies;
- Generic Template/carrossel e botões;
- compartilhamento de post próprio via `MEDIA_SHARE`.

O módulo declara `transportReleased=false` e não contém token, URL Graph ou função de envio.

### Webhook dormente

`supabase/functions/instagram-webhook-v1/index.ts` está versionado, mas **não deve ser implantado nesta etapa**:

- GET de verificação somente se verify token externo estiver configurado;
- POST exige HMAC `x-hub-signature-256` contra `META_APP_SECRET`;
- persiste somente hash/referência do payload bruto;
- conta Instagram precisa existir previamente; conta desconhecida é ignorada;
- normaliza Direct/comentários;
- Direct inbound chama apenas o fluxo humano-primeiro;
- comentário classifica intenção e cria somente candidato/draft;
- não há Send API/private reply outbound.

`supabase/config.toml` registra `verify_jwt=false` apenas para esse callback futuro, pois a autenticação real será a assinatura Meta. A função não foi deployada e nenhuma subscription foi criada.

### CI da PR #189

- `scripts/test-instagram-direct-comment-foundation-v1.mjs`;
- `scripts/test-instagram-send-order-attribution-v1.mjs`;
- `.github/workflows/dona-antonia-instagram-dormant-foundation.yml` roda ambos e `deno check`;
- regressões de worker, núcleo omnichannel, runtime e CRM/inbox continuam sendo exigidas quando acionadas.

### Produção — invariantes obrigatórios antes/depois de DDL

- WhatsApp `live=1%`, sem aumento;
- Flow/Data Exchange/orquestrador desligados;
- Bling desligado;
- 3 handoffs humanos atuais preservados;
- `channel_accounts` sem Instagram real;
- zero private reply/Direct real enviado;
- cenário Make `6508939` de publicação Instagram continua inativo.

### Pendências externas deliberadas da própria Etapa 6

A parte real continua bloqueada por autorização/permissões externas e deve permanecer assim nesta execução:

1. conta/app/business Meta corretos;
2. permissões/App Review/Advanced Access/Business Verification aplicáveis;
3. secrets fora do repositório;
4. cadastro controlado de `channel_accounts` começando em `dormant`;
5. deploy + subscription do webhook;
6. homologação `observe` e humano-primeiro;
7. somente depois canary IA Instagram independente;
8. dispatcher real de private reply/Direct após autorização específica.

## Próximo ponto — SOMENTE ETAPA 6

Fechar CI da PR #189, corrigir qualquer falha, integrar somente quando tudo estiver verde, auditar produção, aplicar as três migrations dormentes em ordem, reauditar RLS/gates/handoffs/zero contas Meta/zero envios e criar checkpoint documental da Etapa 6. **Não iniciar a Etapa 7 nesta execução.**
