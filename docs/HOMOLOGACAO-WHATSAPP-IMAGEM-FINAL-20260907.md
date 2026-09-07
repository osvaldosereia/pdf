# Homologação real WhatsApp — imagem — 07/09/2026

Status: **HOMOLOGADO ponta a ponta**.

Teste executado somente no telefone de homologação allowlisted. Nenhum telefone completo, chave, token ou segredo é versionado neste documento.

## Fluxo comprovado

```text
WhatsApp imagem real
→ Meta Cloud API
→ Make inbound 6779824
→ download de mídia
→ Storage privado Supabase
→ ai_job vision
→ gpt-4o-mini com image detail=low
→ classificação estruturada
→ resposta determinística
→ outbound event-driven
→ Make 7290488
→ Meta
→ WhatsApp real
```

## Entrada real

A foto foi enviada enquanto o Make inbound estava inativo. O webhook reteve o evento em fila. Havia 14 entregas acumuladas, então o cenário **não foi simplesmente ativado**.

Foi usado corte anti-backlog em `2026-09-07T21:08:30Z`, imediatamente antes da foto real, para impedir processamento dos eventos anteriores. Apenas a foto passou pelo core.

Mensagem:

- message row: `71438d3e-c412-4407-ba85-23b85ed26f1f`;
- conversation: `ff5c1e73-f3ed-4b88-8eba-b6e3a9883941`;
- message type: `image`;
- MIME: `image/jpeg`.

Mídia privada:

- room_media: `1cc65383-116b-49f2-af34-b41e83aa1457`;
- bytes: `151860`;
- bucket: `shopping-room-media`;
- object path isolado em `sessions/<session>/image/whatsapp/...jpg`.

Make inbound execution:

`4581fe3afcdf4f5dac5a1fde78f21b07`

Módulos executados sem erro:

1. WhatsApp Business Cloud event;
2. ingest HTTP;
3. download media;
4. attach media HTTP.

## Job de visão

AI job:

`bda1dc33-94ab-4e0f-b2d4-79e87021cbf8`

Tipo:

`vision`

O job ficou inicialmente `held` porque `ai_enabled=false` e `conversation_worker_enabled=false` durante a drenagem segura do backlog. Depois de confirmar que era o único job correto, os gates de IA foram abertos apenas para a homologação e esse job exato foi promovido para `pending`.

## Worker fail-closed

PR temporária:

`#157 — Dona Antônia: homologar visão real pelo WhatsApp`

Merge que disparou o one-shot:

`93d44df6f808b06665ba7898fab303f620fd54d1`

GitHub Actions:

- run `34162273559`;
- job `101866359410`;
- conclusão `success`.

Antes do provider o workflow exigiu:

- exatamente 1 job pending;
- ID exato do job;
- message ID exato;
- `job_type=vision`;
- attempts=0;
- mensagem inbound `image`;
- uma única mídia privada JPEG;
- tamanho maior que zero e menor que 10 MiB;
- caminho `/image/whatsapp/`;
- `AI_JOB_LIMIT=1`;
- suíte de testes passando.

## OpenAI Vision

Modelo:

`gpt-4o-mini`

Provider request ID:

`req_b85f0f96b3d54d7d8ba811b2c55b4fb1`

Uso registrado:

- input tokens: `3026`;
- output tokens: `36`;
- attempts: `1`;
- status: `done`.

Interpretação estruturada:

```json
{
  "intent": "search",
  "description": "Pacote de amido de milho Kimimo, 200g.",
  "query": "amido de milho"
}
```

Resposta determinística:

`Vou procurar amido de milho para você.`

A IA não decidiu preço, estoque, pedido nem ação no Bling.

## Outbound real

Reply message:

`2656be0d-ef96-498c-a5d0-87fa2c9f0773`

Outbound job:

`8bd12fed-a16c-43d9-9e48-52b3ea729150`

Resultado:

```text
status = sent
delivery_mode = text
dispatch_response_status = 200
provider_message_id = presente
attempts = 1
dispatch_attempts = 1
review_required = 0
```

A resposta foi enviada pelo cenário oficial:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

## Segurança / estado final

Depois da confirmação Meta:

```text
whatsapp_release_mode = off
whatsapp_inbound_enabled = false
whatsapp_auto_reply_enabled = false
ai_enabled = false
conversation_worker_enabled = false
allowlist ativa = 0
ai_jobs pending = 0
ai_jobs processing = 0
ai_jobs error = 0
outbound pending = 0
outbound processing = 0
outbound review_required = 0
orders última hora = 0
order_sync_jobs última hora = 0
bling_commands última hora = 0
```

Make inbound `6779824` foi desativado novamente.

O workflow one-shot de imagem é temporário e foi removido na PR de cleanup após a homologação.

## Conclusão

Com esta prova, os três canais reais principais estão homologados:

1. **texto real**;
2. **áudio real**: Meta → Storage → transcrição → interpretação → Marin B → Meta;
3. **imagem real**: Meta → Storage → visão → interpretação → texto → Meta.

O próximo passo não é liberar tudo indiscriminadamente. Primeiro deve ser preparada a **liberação gradual/controlada do atendimento real**, incluindo worker operacional, observabilidade, fail-safe, tratamento humano e só depois teste de pedido real no Bling.