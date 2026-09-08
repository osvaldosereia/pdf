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

**Status programável: fundação dormente implementada em branch própria; nenhuma conexão/subscription/deploy Meta realizado.**

### Política e segurança

Snapshot documentado em `docs/INSTAGRAM-DIRECT-POLICY-GUARDS-V1.md` e implementado em `supabase/functions/_shared/instagram-policy-v1.mjs`:

- conta profissional é pré-requisito externo;
- permissões de mensagens/comentários ficam registradas como pré-requisito de homologação, sem token ou App Review nesta etapa;
- no máximo um private reply por comentário;
- janela conservadora de até 7 dias para comentário;
- Live permanece bloqueado sem verificação de transmissão ativa;
- continuação após private reply exige resposta real do destinatário quando aplicável, com janela conservadora de 24h depois da resposta;
- quick replies registram limite de 13 itens e título de 20 caracteres para futura renderização;
- compartilhamento futuro só pode referenciar mídia da conta profissional;
- regras devem ser revalidadas contra documentação Meta imediatamente antes de homologação real.

### Banco dormente

Migration `supabase/migrations/20260908043000_instagram_direct_comment_foundation_v1.sql` cria, server-only/RLS:

- `channel_attribution_events`: comentário/Direct/post/Reel/Story/Live/ad + campaign/adset/ad/creative;
- `instagram_comment_events`: comentário normalizado, intenção, elegibilidade e deadline de private reply;
- `instagram_private_reply_jobs`: um candidato por comentário, somente `held`/`draft` nesta fundação, sem dispatcher Meta;
- `instagram_conversation_windows`: última entrada, private reply futuro, resposta do destinatário e janela de continuidade;
- índice único de conversa Instagram aberta por conta/IGSID;
- `record_instagram_attribution_v1`;
- `record_instagram_comment_event_v1`;
- `evaluate_instagram_private_reply_candidate_v1`;
- `ensure_instagram_direct_human_v1`.

`ensure_instagram_direct_human_v1` é humano-primeiro:

- exige `channel_accounts` Instagram já existente e explicitamente em `observe`/`active` com inbound ligado;
- sem esse gate, evento continua held;
- IGSID nasce apenas `observed`; cliente só é reutilizado se identidade já estiver `verified`;
- conversa nova nasce `status=needs_human`, `mode=human`, `human_required=true`, cohort `human_control`;
- cria handoff `instagram_direct_human_first` se necessário;
- não liga IA, auto-reply ou outbound.

A migration não contém `net.http_post`, não chama Graph API, não cria `channel_accounts` e não altera `automation_config`.

### Webhook dormente

`supabase/functions/instagram-webhook-v1/index.ts` foi versionado, mas **não deve ser implantado nesta etapa**:

- GET implementa verificação Meta somente quando `META_INSTAGRAM_VERIFY_TOKEN` estiver configurado;
- POST exige `META_APP_SECRET` e valida `x-hub-signature-256` HMAC-SHA256 antes de processar;
- guarda apenas SHA-256/referência do payload em `channel_raw_events`; não persiste payload cru na fundação;
- ignora conta Instagram desconhecida; nunca auto-cadastra conta Meta;
- normaliza Direct/comentários via `ingest_normalized_channel_event_v1`;
- Direct inbound segue para handoff humano;
- comentário usa classificador determinístico `purchase_interest`, `question`, `support`, `spam`, `other` e cria somente candidato/draft;
- nenhum endpoint de Send API/private reply existe no handler.

`supabase/config.toml` declara `verify_jwt=false` apenas para esse webhook futuro porque a Meta não envia JWT Supabase; a autenticação custom HMAC continua obrigatória no handler. Nenhuma Edge Function Instagram foi deployada e nenhuma subscription foi criada.

### CI

- `scripts/test-instagram-direct-comment-foundation-v1.mjs`: política, janela, Live, follow-up, intenção, idempotência, RLS, human-first e ausência de outbound/auto-cadastro Meta;
- `.github/workflows/dona-antonia-instagram-dormant-foundation.yml`: contrato Node + `deno check` do webhook;
- regressões existentes de núcleo omnichannel/runtime continuam acionadas pelos arquivos compartilhados quando aplicável.

### Pendências externas deliberadas da Etapa 6

Para cumprir a parte real da etapa futuramente ainda serão necessários, com nova autorização e revisão de política vigente:

1. conta/app/business Meta corretos;
2. permissões/App Review/Advanced Access/Business Verification aplicáveis;
3. secrets fora do repositório;
4. cadastro de `channel_accounts` começando em `dormant`;
5. deploy + subscription do webhook;
6. homologação `observe` e humano-primeiro;
7. somente depois canary IA Instagram independente;
8. dispatcher real de private reply/Direct após autorização específica.

## Próximo ponto

Abrir PR da fundação dormente da Etapa 6, exigir CI verde, integrar, auditar novamente produção e aplicar **somente a migration de banco dormente**. Não deployar `instagram-webhook-v1`, não criar subscription Meta, não cadastrar conta Instagram real, não enviar private reply e não alterar WhatsApp `live=1%`.
