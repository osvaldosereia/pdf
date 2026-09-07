# Homologação WhatsApp real — áudio — FINAL — 07/09/2026

Este documento fecha a homologação real de áudio da Dona Antônia após a correção estrutural da cadeia de transcrição em duas etapas. Não contém telefone completo, chave, token ou segredo.

## Status

**ÁUDIO REAL HOMOLOGADO PONTA A PONTA.**

A prova final foi feita com um áudio novo, gravado depois da PR #152, sem backfill, replay ou reaproveitamento de job anterior.

Fluxo comprovado:

```text
WhatsApp real
→ Meta Cloud API
→ Make inbound
→ download OGG/Opus
→ Storage privado Supabase
→ job transcription
→ gpt-4o-mini-transcribe
→ transcript salvo em transcript + body_text
→ criação automática de job conversation
→ gpt-4o-mini
→ intenção comercial
→ resposta determinística
→ outbound event-driven
→ gpt-4o-mini-tts / Marin B
→ upload Meta
→ sendMessage audio
→ Meta HTTP 200 + wamid
→ reconciliação Supabase = sent
```

## Áudio final fresco

Message row:

`5871fcbf-6229-49b3-bb34-8cfe854b1746`

Mídia:

- formato: `audio/ogg`;
- origem WhatsApp OGG/Opus;
- tamanho: `20037` bytes;
- Storage privado `shopping-room-media`;
- caminho isolado por sessão;
- nenhuma URL pública usada.

Transcript real:

> Boa tarde, tudo bem? Eu queria ver as cestas básicas que você tem aí para vender e queria também saber se eu posso trocar os produtos da cesta.

O transcript foi promovido automaticamente para `messages.body_text` e permaneceu idêntico a `messages.transcript`.

## Etapa 1 — transcrição

Job:

`6ebb5a42-bd61-4418-99cb-9f0e9b460ca7`

Resultado:

- `job_type=transcription`;
- `status=done`;
- `attempts=1`;
- `reply_suppressed=true`;
- nenhum outbound criado na etapa de transcrição;
- segundo job `conversation` criado automaticamente.

OpenAI:

- modelo `gpt-4o-mini-transcribe`;
- provider request ID `req_1193975cb9244842ab00c270044f7489`;
- input tokens `84`;
- output tokens `34`.

## Etapa 2 — interpretação da conversa

Job criado automaticamente:

`a8e14824-6512-44be-8732-513f66545b7e`

Resultado:

- `job_type=conversation`;
- `status=done`;
- `attempts=1`;
- `reply_suppressed=false`.

OpenAI:

- modelo `gpt-4o-mini`;
- provider request ID `req_1482777eb0684e8bbf256ddf3275d0c6`;
- input tokens `216`;
- output tokens `33`.

Interpretação:

```json
{
  "intent": "baskets",
  "description": "Cliente interessado em cestas básicas e troca de produtos."
}
```

Resposta criada:

> Claro. Posso te mostrar as cestas disponíveis e ajudar a personalizar os itens.

Reply message:

`916d28e1-331b-44a0-b2e7-25fc7f01c5ff`

Outbound job:

`13566c6f-7af7-4a5b-9023-40418074b462`

## Resposta real em áudio

Payload confirmado:

```text
delivery_mode = audio
voice_profile = dona_antonia_marin_b_v1
```

Make oficial:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Execution:

`4839c1b92aab44afa88a4d84d467c4f4`

Módulos executados sem erro:

1. Custom Webhook;
2. TransformToJSON;
3. OpenAI direct API TTS;
4. WhatsApp uploadMedia;
5. WhatsApp sendMessage audio;
6. Webhook Response.

Resultado:

```text
outbound.status = sent
dispatch_attempts = 1
dispatch_response_status = 200
provider_message_id = presente
voice_profile = dona_antonia_marin_b_v1
review_required = 0
```

## GitHub Actions fail-closed

PR de disparo:

`#155 — Dona Antônia: homologar áudio real ponta a ponta após correção`

Merge:

`501e8f3140be2dac5040c36fe943f3d93b49148e`

Run:

`34161624075`

Job:

`101864470206`

Todas as etapas terminaram `success`:

- preflight de job e mídia antes do provider;
- suíte de testes;
- transcrição + conversation, exatamente uma tentativa cada;
- pós-validação de transcript/body_text;
- confirmação de outbound real;
- confirmação Meta HTTP 200;
- confirmação de áudio Marin B.

O workflow one-shot foi removido imediatamente na rodada de cleanup posterior.

## Auditoria de efeitos colaterais

Após o envio real:

```text
ai_jobs pending/processing = 0
outbound pending/processing = 0
outbound review_required = 0
orders última hora = 0
order_sync_jobs última hora = 0
bling_commands última hora = 0
```

Bling permaneceu completamente fora da homologação.

## Estado de segurança final

Foi executado `close_whatsapp_homologation_v1()`.

Estado confirmado:

```text
whatsapp_release_mode = off
whatsapp_inbound_enabled = false
whatsapp_auto_reply_enabled = false
ai_enabled = false
conversation_worker_enabled = false
allowlist ativa = 0
ai_jobs pending/processing/error = 0
outbound pending/processing = 0
outbound review_required = 0
```

Make inbound `6779824` foi desativado ao final.

O outbound oficial event-driven permanece disponível para jobs legítimos, mas sem inbound/IA liberados não há entrada geral automática.

## Conclusão técnica

A arquitetura de áudio oficial é obrigatoriamente:

```text
transcription
→ salva transcript
→ cria conversation
→ classificação inteligente
→ resposta determinística
→ áudio Marin B
```

Nunca voltar ao desenho antigo `transcrição → deterministicIntent direto`, porque ele foi rejeitado em teste real por gerar resposta comercial inadequada para fala natural.

## Próximo passo

**Homologar uma foto real pelo WhatsApp.**

Fluxo esperado:

```text
WhatsApp imagem real
→ Meta
→ Make inbound
→ download
→ Storage privado
→ job vision
→ gpt-4o-mini detail=low
→ intenção/descrição
→ resposta controlada
→ Meta
```

Depois da foto real:

1. fechar gates e auditar novamente;
2. decidir liberação gradual do WhatsApp;
3. só então avançar para um pedido Bling real controlado.
