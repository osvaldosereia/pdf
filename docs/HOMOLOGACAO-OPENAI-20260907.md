# Homologação OpenAI — Dona Antônia — 07/09/2026

## Estado

**Homologação de texto concluída com sucesso em produção, usando somente conversa sintética técnica.**

Nenhum cliente real participou do teste. Não houve envio para Meta/WhatsApp, criação de pedido, sincronização de pedido ou comando Bling.

## Execução aprovada

Workflow temporário: `Dona Antonia - OpenAI homologation once`

GitHub Actions run: `34150569308`

Commit do disparo controlado: `127f7cbb8df133d78d71eac3ca457ae1e47f1e45`

Job de IA: `1b3e5ab3-afe1-4d9d-bac1-da1ef1d0dc29`

Mensagem sintética: `1e5f7244-5d97-4da0-a7f0-287e303d45a4`

Conversa técnica: `e075cf1f-7e37-4a9b-a8a7-b0f50477d5fe`

Sessão técnica: `0174ba72-0a34-4b33-8e61-1d10bdb924aa`

Texto usado: `Quero uma cesta básica e também preciso de arroz.`

## Resultado funcional

- job final: `done`
- tentativas: `1`
- erro: `null`
- modelo: `gpt-4o-mini`
- intenção: `baskets`
- descrição do modelo: `Cliente solicita cesta básica e arroz.`
- resposta determinística: `Você pode conferir as cestas e personalizar os itens.`
- UI: `baskets`
- resposta gravada na Sala: sim
- resposta enviada por WhatsApp/Meta: não

Mensagem de resposta criada no banco: `2c7a2c3d-b8f0-43a0-a657-12ee04594f9e`.

## Uso OpenAI auditado

`ai_usage_events` registrou:

- status: `done`
- model: `gpt-4o-mini`
- provider request id: `req_3eb540ecddca42fbbc32b2a699ed3c0a`
- input tokens: `195`
- output tokens: `31`
- início: `2026-09-07 18:11:14 UTC`
- fim: `2026-09-07 18:11:16 UTC`

Pelos preços oficiais consultados em 07/09/2026 para GPT-4o mini — US$ 0,15 por 1M tokens de entrada e US$ 0,60 por 1M de saída — esta chamada custa aproximadamente **US$ 0,00004785**. O banco ainda não calcula `estimated_cost_usd` automaticamente; isso fica como melhoria futura de observabilidade.

## Auditoria de segurança após o teste

Flags verificadas após o workflow:

- `automation_enabled=true`
- `ai_enabled=false`
- `conversation_worker_enabled=false`
- `outbound_enabled=true`

Auditoria a partir do início do teste:

- `outbound_jobs` da conversa: `0`
- `orders` da conversa: `0`
- `order_sync_jobs` recentes: `0`
- `bling_commands` recentes: `0`

Portanto a homologação não escapou para Meta/WhatsApp nem Bling.

## Correção descoberta durante a primeira tentativa

A primeira execução real revelou uma inconsistência antiga: `messages` tinha o trigger `trg_messages_updated_at`, mas não possuía a coluna `updated_at`. Isso fazia a finalização do worker falhar depois do claim.

Correção aplicada em produção e versionada:

- migration: `supabase/migrations/20260907180600_fix_messages_updated_at_trigger.sql`
- commit: `f8fa3cd87b1b9d48d7978e128df161527d0de3b7`

Antes de repetir uma chamada paga, a persistência foi testada isoladamente sem OpenAI e concluiu corretamente com `reply_suppressed=true`.

## Credenciais

Os GitHub Actions secrets foram validados com sucesso:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

Nunca registrar seus valores em código, documentação, logs ou issues.

## Próximo ponto exato

**Etapa 2 ainda deve homologar mídia de forma controlada antes da integração real com WhatsApp:**

1. áudio sintético curto → `gpt-4o-mini-transcribe` → roteamento determinístico;
2. imagem sintética simples → `gpt-4o-mini` visão em `detail=low`;
3. verificar `ai_usage_events`, limites de mídia e fechamento dos gates após cada teste;
4. não criar Meta outbound nem Bling;
5. somente depois iniciar a Etapa 3: inbound/outbound WhatsApp real controlado.

Não liberar jobs retidos em massa. Continuar usando testes sintéticos e limite `AI_JOB_LIMIT=1` nas homologações.
