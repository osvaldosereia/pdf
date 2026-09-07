# Homologação OpenAI — Dona Antônia — 07/09/2026

## Estado

**Etapa 2 concluída com sucesso em produção: texto, áudio e imagem homologados usando somente conversa sintética técnica.**

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

- status: `done`
- model: `gpt-4o-mini`
- provider request id: `req_3eb540ecddca42fbbc32b2a699ed3c0a`
- input tokens: `195`
- output tokens: `31`
- início: `2026-09-07 18:11:14 UTC`
- fim: `2026-09-07 18:11:16 UTC`

Custo aproximado pelos preços oficiais consultados em 07/09/2026: **US$ 0,00004785**.

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

A pequena diferença de transcrição é atribuída à voz sintética robótica usada apenas para homologação. O objetivo foi validar a cadeia completa de upload privado, leitura do arquivo, chamada de transcrição, persistência e roteamento.

### Uso OpenAI de áudio auditado

- status: `done`
- model: `gpt-4o-mini-transcribe`
- provider request id: `req_3c2e2c11157f43f1a7c8ff1fbbe0e697`
- input tokens: `38`
- output tokens: `12`
- início: `2026-09-07 18:16:43 UTC`
- fim: `2026-09-07 18:16:46 UTC`

Custo aproximado pelos preços oficiais consultados em 07/09/2026: **US$ 0,0001075**.

## Imagem — execução aprovada

Workflow temporário: `Dona Antonia - OpenAI image homologation once`

GitHub Actions run: `34151126578`

Commit do disparo controlado: `3c5704e66bfdd6dc521cbdb98d45843354b3592e`

Mensagem sintética: `d8464c32-4457-4601-b8e6-826db45446ef`

Job de IA: `22d9fba9-763c-45d2-9a75-caa7315359f4`

O PNG foi gerado localmente pelo GitHub Runner, sem API de geração de imagem. A imagem continha uma embalagem sintética com o texto `ARROZ 5 KG` e foi enviada ao worker como `image/png`, usando visão em `detail=low`.

### Resultado funcional de imagem

- job final: `done`
- tentativas: `1`
- erro: `null`
- modelo: `gpt-4o-mini`
- intenção: `search`
- query gerada: `arroz 5kg`
- descrição do modelo: `Pacote de arroz de 5 kg.`
- resposta determinística: `Confira os resultados da busca e escolha os produtos que deseja.`
- resposta gravada na Sala: sim
- resposta enviada por WhatsApp/Meta: não

Mensagem de resposta criada no banco: `243979aa-3bd0-47fc-bbee-571b16c4ebcc`.

### Uso OpenAI de imagem auditado

- status: `done`
- model: `gpt-4o-mini`
- provider request id: `req_253da0d3294c4474b51665e2b70bf7ef`
- input tokens: `3026`
- output tokens: `32`
- início: `2026-09-07 18:19:37 UTC`
- fim: `2026-09-07 18:19:43 UTC`

Custo aproximado pelos preços oficiais consultados em 07/09/2026: **US$ 0,0004731**.

## Custo total aproximado desta homologação controlada

Somando as três chamadas auditadas com sucesso:

- texto: `US$ 0,00004785`
- áudio: `US$ 0,0001075`
- imagem: `US$ 0,0004731`
- total aproximado: **US$ 0,00062845**

A tentativa anterior de texto que terminou em estado incerto não possui `provider_request_id` nem tokens gravados e, por política de segurança, não foi repetida cegamente. Ela não entra no cálculo acima porque não é possível provar cobrança ou uso real pelo registro local.

## Auditoria de segurança após os testes

Flags finais:

- `automation_enabled=true`
- `ai_enabled=false`
- `conversation_worker_enabled=false`
- `outbound_enabled=true`

Auditoria específica da janela do teste de imagem:

- `outbound_jobs`: `0`
- `orders`: `0`
- `order_sync_jobs`: `0`
- `bling_commands`: `0`

A mesma auditoria de zero efeitos externos foi confirmada após texto e áudio. Portanto a Etapa 2 não escapou para Meta/WhatsApp nem Bling.

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

**Etapa 2 concluída. Próxima etapa: Etapa 3 — WhatsApp inbound/outbound real controlado.**

Antes de liberar atendimento amplo:

1. revisar estado atual dos cenários Make/Meta e da conta WhatsApp usada como ponte;
2. implementar/validar inbound real com idempotência, assinatura e associação à conversa;
3. validar apenas uma mensagem real de teste;
4. manter criação de pedido e Bling desligados durante a primeira rodada de WhatsApp;
5. validar outbound por fila, dedupe e status de entrega com um único destinatário autorizado;
6. só depois ampliar gradualmente.

Não liberar jobs retidos em massa. Não deixar `ai_enabled` ou `conversation_worker_enabled` permanentemente ativos até a Etapa 3 estar homologada ponta a ponta.
