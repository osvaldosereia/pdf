# Instagram Direct + comentários — decisão V1

Atualizado em 08/09/2026 UTC.

Este documento registra a decisão programável da ETAPA 6 do roadmap Dona Antônia. Ele não autoriza conexão real da Meta, App Review, assinatura de webhook, resposta privada, Direct automático, campanha ou publicação.

## Estado de segurança

- nenhuma conta Instagram está cadastrada em `channel_accounts`;
- nenhum segredo Meta foi criado ou alterado nesta etapa;
- `META_INSTAGRAM_WEBHOOK_RUNTIME_ENABLED` deve permanecer ausente/false;
- `instagram_channel_controls` nasce com todos os gates `false`;
- política temporal de private reply nasce desconhecida (`private_reply_window_seconds=0`) e só pode ser preenchida depois de revisão humana da documentação vigente da Meta;
- jobs de private reply nascem `held` e com no máximo uma tentativa;
- o transporte de private reply **não é implementado nesta etapa**;
- continuidade automática após private reply exige resposta do usuário e validação posterior da política vigente;
- nenhum caminho desta etapa reabre handoff humano ou interfere no canary WhatsApp de 1%.

## Arquitetura

### Entrada

`meta-instagram-webhook-v1` é um adapter fino e dormente. Quando futuramente habilitado de forma explícita, ele:

1. valida `X-Hub-Signature-256` com HMAC-SHA256 usando `META_APP_SECRET` server-side;
2. aceita challenge GET somente com `META_WEBHOOK_VERIFY_TOKEN` correto;
3. ignora ecos do próprio Direct;
4. normaliza mensagens Direct e comentários;
5. resolve a conta por `channel_accounts(channel='instagram', external_account_id=...)`;
6. chama `ingest_instagram_observation_v1`;
7. não envia nenhuma mensagem para a Graph API.

O endpoint usa `verify_jwt=false` somente porque a Meta não envia JWT Supabase. A autenticação externa é a assinatura Meta e o runtime ainda possui um gate ambiental adicional fail-closed.

### Observe mode

A conta precisa estar em `status in ('observe','active')`, `inbound_enabled=true` e ter `instagram_channel_controls.webhook_ingest_enabled=true`. Direct e comentário possuem gates separados (`direct_observe_enabled` e `comment_observe_enabled`).

O objetivo da primeira homologação futura é **somente observar** eventos reais, validar normalização/idempotência/atribuição e manter atendimento humano. IA/outbound/private reply continuam fechados.

### Comentários e private reply

Comentários entram em `normalized_channel_events` e recebem uma referência em `instagram_comment_observations`. O texto não é duplicado na tabela de observação.

`prepare_instagram_private_reply_v1` cria apenas um rascunho operacional `held`. A função não publica nada. Ela exige gate de preparação e trata política Meta não revisada como bloqueio (`meta_policy_not_verified`). A janela só poderá ser calculada depois que `policy_version`, `policy_verified_at` e `private_reply_window_seconds` forem preenchidos em homologação externa controlada.

`instagram_private_reply_jobs` impõe:

- unicidade por comentário;
- `idempotency_key` SHA-256;
- estado inicial `held`;
- máximo de uma tentativa;
- `requires_user_response=true`;
- nenhuma rotina de retry ou cron de envio.

## Make x GitHub Actions

Nenhum cenário Make novo é necessário para a ETAPA 6. Webhook Meta é realtime e deve terminar diretamente em uma Edge Function segura; adicionar Make aqui só aumentaria custo, latência e superfície de erro. Batch, auditorias, testes, snapshots e relatórios devem continuar em GitHub Actions.

Os cenários Make de postagem automática antigos permanecem inativos. Eles não são reativados como parte do Instagram Direct.

## Pendências externas reservadas para a ETAPA 12

- criar/confirmar o App Meta correto, Business/Page/Instagram profissional e permissões;
- revisar a política Meta vigente de Messaging API/private replies no dia da homologação;
- configurar App Secret/verify token por mecanismo seguro, sem versionar segredo;
- cadastrar uma única conta Instagram em modo observe;
- assinar webhook real em allowlist/homologação;
- validar eventos reais de Direct/comentários antes de qualquer IA;
- somente depois avaliar App Review/Advanced Access e private reply controlado.

Até essas ações ocorrerem, a fundação deve permanecer dormente e não deve ser interpretada como integração Meta ativa.
