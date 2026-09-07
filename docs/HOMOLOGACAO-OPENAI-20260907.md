# Homologação OpenAI — Dona Antônia — 07/09/2026

## Estado

**Homologações de texto e áudio concluídas com sucesso em produção, usando somente conversa sintética técnica. Imagem ainda pendente nesta etapa.**

Nenhum cliente real participou dos testes. Não houve envio para Meta/WhatsApp, criação de pedido, sincronização de pedido ou comando Bling.

## Texto — execução aprovada

Workflow temporário: `Dona Antonia - OpenAI homologation once`

GitHub Actions run: `34150569308`

Commit do disparo controlado: `127f7cbb8df133d78d71eac3ca457ae1e47f1e45`

Job de IA: `1b3e5ab3-afe1-4d9d-bac1-da1ef1d0dc29`

Mensagem sintética: `1e5f7244-5d97-4da0-a7f0-287e303d45a4`

Conversa técnica: `e075cf1f-7e37-4a9b-a8a7-b0f50477d5fe`

Sessão técnica: `0174ba72-0a34-4b33-8e61-1d10bdb924aa`

Texto usado: `Quero uma cesta básica e também preciso de arroz.`

### Resultado funcional de texto

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

### Uso OpenAI de texto auditado

`ai_usage_events` registrou:

- status: `done`
- model: `gpt-4o-mini`
- provider request id: `req_3eb540ecddca42fbbc32b2a699ed3c0a`
- input tokens: `195`
- output tokens: `31`
- início: `2026-09-07 18:11:14 UTC`
- fim: `2026-09-07 18:11:16 UTC`

Pelos preços oficiais consultados em 07/09/2026 para GPT-4o mini — US$ 0,15 por 1M tokens de entrada e US$ 0,60 por 1M de saída — esta chamada custa aproximadamente **US$ 0,00004785**.

## Áudio — execução aprovada

Workflow temporário: `Dona Antonia - OpenAI audio homologation once`

GitHub Actions run: `34150929016`

Commit do disparo controlado: `b7544afdcbea98fbe745169885542f50c6f52f2c`

Mensagem sintética: `cd7bd6f5-f465-45e1-83ff-0bcb0d5c61dd`

Job de IA: `edb47da5-352c-4d0e-9064-1ab23dca72e4`

O MP3 foi gerado localmente pelo GitHub Runner com `espeak-ng` e `ffmpeg`, sem chamar uma segunda API paga. Frase original sintetizada: `Quero uma cesta básica e também preciso de arroz.`

### Resultado funcional de áudio

- job final: `done`
- tentativas: `1`
- erro: `null`
- modelo: `gpt-4o-mini-transcribe`
- transcrição retornada: `Caduma cesta básica e também preço de arroz.`
- intenção determinística após transcrição: `search`
- resposta determinística: `Confira os resultados da busca e escolha os produtos que deseja.`
- resposta gravada na Sala: sim
- resposta enviada por WhatsApp/Meta: não

A pequena diferença de transcrição é atribuída à voz sintética robótica usada apenas para homologação. O objetivo do teste foi validar a cadeia técnica completa de upload privado, leitura do arquivo, chamada de transcrição, persistência e roteamento.

### Uso OpenAI de áudio auditado

`ai_usage_events` registrou:

- status: `done`
- model: `gpt-4o-mini-transcribe`
- provider request id: `req_3c2e2c11157f43f1a7c8ff1fbbe0e697`
- input tokens: `38`
- output tokens: `12`
- início: `2026-09-07 18:16:43 UTC`
- fim: `2026-09-07 18:16:46 UTC`

Pelos preços oficiais consultados em 07/09/2026 para GPT-4o Mini Transcribe — US$ 1,25 por 1M tokens de áudio de entrada e US$ 5,00 por 1M tokens de saída — custo aproximado desta chamada: **US$ 0,0001075**.

## Auditoria de segurança após os testes

Flags verificadas após os workflows:

- `automation_enabled=true`
- `ai_enabled=false`
- `conversation_worker_enabled=false`
- `outbound_enabled=true`

Auditoria específica do teste de áudio:

- `outbound_jobs`: `0`
- `orders`: `0`
- `order_sync_jobs`: `0`
- `bling_commands`: `0`

Portanto as homologações não escaparam para Meta/WhatsApp nem Bling.

## Correção descoberta durante a primeira tentativa de texto

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

**Etapa 2 falta somente homologar visão de forma controlada antes da integração real com WhatsApp:**

1. imagem sintética simples → `gpt-4o-mini` visão em `detail=low`;
2. verificar `ai_usage_events`, persistência, limites de mídia e fechamento dos gates;
3. garantir novamente zero Meta outbound e zero Bling;
4. depois iniciar a Etapa 3: inbound/outbound WhatsApp real controlado.

Não liberar jobs retidos em massa. Continuar usando testes sintéticos e limite `AI_JOB_LIMIT=1` nas homologações.
