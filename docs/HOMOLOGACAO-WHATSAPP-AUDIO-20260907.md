# Homologação real WhatsApp — áudio — 07/09/2026

Documento de auditoria da homologação real de áudio da Dona Antônia. O teste foi restrito ao telefone de homologação allowlisted. Nenhum telefone completo, chave, token ou segredo é versionado aqui.

## Resultado executivo

A cadeia de transporte de áudio foi comprovada ponta a ponta:

```text
WhatsApp real
→ Meta Cloud API
→ Make inbound
→ download da mídia
→ Storage privado Supabase
→ gpt-4o-mini-transcribe
→ Conversation Worker
→ outbound event-driven
→ gpt-4o-mini-tts / Marin B
→ upload Meta
→ WhatsApp real
```

O primeiro áudio real revelou um problema de **lógica pós-transcrição**, não de transporte: a transcrição estava correta, mas o código antigo tentava transformar diretamente o transcript em uma decisão determinística e uma frase natural longa virou uma busca com a frase inteira.

A falha foi corrigida estruturalmente na PR #152. A arquitetura oficial de áudio agora é obrigatoriamente em duas etapas:

```text
1. transcription job
   → transcreve
   → salva transcript/body_text
   → NÃO responde
   → cria conversation job

2. conversation job
   → usa o mesmo classificador OpenAI do texto já homologado
   → cria reply
   → escolhe delivery_mode
   → para inbound de áudio em preferred_reply=auto: responde em áudio Marin B
```

Uma repetição controlada sobre o mesmo transcript real confirmou que a nova etapa de classificação produz a intenção correta e envia uma resposta correta em áudio Marin B.

Ainda falta **um último áudio novo**, gravado depois da PR #152, para provar a cadeia nova inteira desde a criação do `transcription` job até o áudio de resposta sem qualquer backfill/replay. Depois disso, avançar para imagem real.

---

## Segurança da homologação

Durante os testes reais:

- `whatsapp_release_mode=homologation` somente durante janelas curtas;
- allowlist de um telefone de teste, documentado apenas como `+55 65 *****-0975`;
- Make inbound ativado somente quando uma nova mensagem era necessária;
- worker principal permaneceu manual/one-shot;
- cada chamada paga foi precedida por validação de job exato;
- Bling ficou fora do fluxo;
- não houve criação de pedido, `order_sync_job` ou comando Bling;
- qualquer estado externo incerto continua sem retry cego;
- ao final os gates foram fechados e Make inbound foi mantido inativo.

Auditoria final depois do replay corrigido:

```text
whatsapp_release_mode = off
whatsapp_inbound_enabled = false
whatsapp_auto_reply_enabled = false
ai_enabled = false
conversation_worker_enabled = false
allowlist ativa = 0
ai_jobs pending/processing = 0
seller_message pending/processing = 0
seller_message review_required = 0
orders última hora = 0
order_sync_jobs última hora = 0
bling_commands última hora = 0
```

---

## 1. Entrada de áudio real — SUCESSO

Mensagem real:

- message row: `abbb8676-b4da-4f9b-a432-4dfd588f19d8`;
- conversation: `ff5c1e73-f3ed-4b88-8eba-b6e3a9883941`;
- catalog session: `350a288f-1541-441f-96c1-5220ad9c98b2`;
- message type: `audio`.

Make inbound execution:

`8b290f018092437897b996b55794f934`

A execução validou:

1. recebimento do evento Meta;
2. `whatsapp-ingest-make-v1`;
3. download do media real pela conexão WhatsApp Business Cloud;
4. attach da mídia ao backend;
5. gravação em Storage privado.

Mídia:

- room_media: `6732e6df-1859-426c-a93d-3bc749964e9d`;
- MIME normalizado: `audio/ogg`;
- codec de origem: OGG/Opus;
- bytes: `13262`;
- bucket privado: `shopping-room-media`;
- caminho isolado por sessão em `sessions/<session>/audio/whatsapp/...`.

Nenhuma URL pública de mídia é usada.

---

## 2. Transcrição real — SUCESSO

Job inicial:

`b3d4a2e1-5831-45f3-a9e4-ab6402d5b038`

Tipo:

`transcription`

Workflow temporário fail-closed:

- GitHub Actions run `34160362996`;
- job `101860718352`;
- resultado `success`;
- commit que disparou o one-shot: `09f3ff3741a8baa119a36adcdba087cc81f75f2b`.

Antes de qualquer gasto, o workflow exigia:

- exatamente um job pending;
- ID exato do job;
- message ID exato;
- `job_type=transcription`;
- mídia `audio/ogg`;
- tamanho maior que zero e menor que 10 MiB;
- caminho privado de áudio WhatsApp;
- `AI_JOB_LIMIT=1`.

OpenAI:

- modelo `gpt-4o-mini-transcribe`;
- provider request ID `req_3dd28fc60ac847c49e963ff739bb4a5d`;
- input tokens `55`;
- output tokens `21`;
- attempts `1`;
- status `done`.

Transcript obtido:

> Olá, eu gostaria de uma cesta básica e também preciso de arroz. Você poderia me ajudar?

A transcrição correspondeu ao conteúdo falado e foi considerada excelente.

---

## 3. Bug encontrado no código antigo

O worker antigo tratava `transcription` desta forma:

```text
transcrever
→ deterministicIntent(transcript)
→ fallback search/clarify
→ responder no mesmo job
```

Isso era insuficiente para fala natural. O transcript real foi interpretado como `search` e a query virou a frase inteira.

Resposta incorreta gerada pelo fluxo antigo:

> Vou procurar Olá, eu gostaria de uma cesta básica e também preciso de arroz. Você poderia me ajudar? para você.

Essa frase **não é aceitável comercialmente** e não deve ser reproduzida pela arquitetura nova.

O teste, porém, comprovou que o transporte de áudio de saída já funcionava.

Outbound do teste antigo:

- job `1f541c3e-e34c-41f3-baea-32f0633241db`;
- Make execution `01e3ef8c3af24e46be39f2a6acd67a9c`;
- TTS direto OpenAI executou;
- upload de áudio Meta executou;
- envio de áudio Meta executou;
- Meta devolveu `wamid` real;
- Webhook Response executou;
- reconciliação terminou sem `review_required`.

Conclusão: **transporte aprovado, semântica rejeitada**.

---

## 4. Correção estrutural — PR #152

PR:

`#152 — Dona Antônia: corrigir áudio em duas etapas antes da resposta`

Squash incorporado ao `main`:

`dccf1a78f129f5c0852ac911e0ff317d70615f2d`

Migration:

`20260907204500_audio_transcription_chain_v1.sql`

Arquivos centrais alterados:

- `scripts/conversation-worker-v1.mjs`;
- `scripts/conversation-worker-v1.test.mjs`;
- `scripts/audio-transcription-chain-v1.test.mjs`;
- `.github/workflows/test-conversation-worker-v1.yml`.

### Nova regra do provider

Para `job_type=transcription`, `createProvider().analyze()` retorna somente:

```json
{
  "transcript": "..."
}
```

É proibido retornar `intent`, `reply` ou fazer roteamento comercial nesta etapa.

### Nova regra de conclusão da transcrição

`finish_conversation_job` agora:

1. valida transcript não vazio;
2. salva `messages.transcript`;
3. copia o transcript para `messages.body_text`;
4. marca a mídia como processada;
5. registra provenance do job de transcrição;
6. cria `job_type=conversation` para a mesma mensagem;
7. finaliza a transcrição com `reply_suppressed=true`;
8. não cria `messages.direction=outbound`;
9. não cria `outbound_jobs`.

### Orçamento de chamadas

`max_ai_calls_per_event` passou a permitir `2` chamadas para o caso de áudio:

- 1 transcrição;
- 1 interpretação/conversa.

`max_transcriptions_per_event` continua `1`.

Texto normal continua precisando de apenas uma chamada.

Isso é uma escolha deliberada: economizar a segunda classificação do áudio degradava o atendimento e produzia decisões ruins.

### Testes

O teste antigo que esperava uma intenção determinística na transcrição foi removido/substituído.

Os testes agora exigem:

- transcript-only no provider de transcrição;
- ausência de intent/reply na etapa 1;
- criação do segundo job `conversation`;
- resposta suprimida na transcrição;
- outbound somente depois da classificação;
- orçamento máximo compatível com as duas etapas.

CI da PR #152 passou integralmente.

---

## 5. Teste sintético da nova cadeia no Postgres — SUCESSO

Depois da migration em produção, foi criado um conjunto de dados sintéticos com os gates fechados.

Resultado:

- transcript salvo em `messages.transcript`;
- mesmo texto salvo em `messages.body_text`;
- `transcription` terminou `done`;
- segundo job `conversation` criado;
- como os gates estavam fechados, o segundo job ficou `held`;
- `seller_replies = 0`;
- `outbound_jobs = 0`.

Os registros sintéticos foram apagados imediatamente após a auditoria.

Esse teste provou que a etapa 1 não consegue mais responder prematuramente ao cliente.

---

## 6. Replay controlado do transcript real usando a arquitetura nova — SUCESSO

Como o áudio original havia sido transcrito antes da migration nova, foi feito um replay controlado **somente da segunda etapa**, sem pedir nova gravação ao usuário.

Para a mensagem real antiga foi feito backfill pontual:

```text
body_text = transcript
```

Novos áudios não precisam desse backfill; a migration #152 já faz isso automaticamente.

Job de classificação real:

`a2997ca0-6e55-4976-bec0-a3169cbc6d5d`

Tipo:

`conversation`

Workflow temporário fail-closed:

- PR #153;
- merge `9d17d21ff9d7574c5078c9dbcc360835955c84e5`;
- GitHub Actions run `34161048559`;
- job `101862803251`;
- resultado `success`.

Proteções do one-shot:

- exatamente um job pending;
- ID exato do job;
- message ID exato;
- `job_type=conversation`;
- mensagem `message_type=audio`;
- `body_text` não vazio;
- `body_text == transcript`;
- `AI_JOB_LIMIT=1`;
- suíte de testes antes do provider;
- pós-validação exigindo `done`, `attempts=1` e reply não suprimido.

OpenAI classificação:

- modelo `gpt-4o-mini`;
- provider request ID `req_25042456fa3543a3a7a1282ddcd24c73`;
- input tokens `203`;
- output tokens `32`;
- attempts `1`;
- status `done`.

Interpretação correta:

```json
{
  "intent": "baskets",
  "description": "Cliente interessado em cesta básica e arroz."
}
```

Resposta correta:

> Claro. Posso te mostrar as cestas disponíveis e ajudar a personalizar os itens.

Reply message:

`67d990a3-070c-48ec-ac25-32ef18fd5afc`

Outbound job:

`49941570-a21b-4c34-9eaf-bfad2207afe4`

Payload relevante:

```text
delivery_mode = audio
voice_profile = dona_antonia_marin_b_v1
```

---

## 7. Resposta corrigida em áudio Marin B — SUCESSO

Make oficial:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Execution:

`20451224eaca41b4ab9f614267536c3b`

Módulos executados sem erro:

1. Custom Webhook;
2. montar JSON TTS Marin B;
3. OpenAI direct API TTS;
4. uploadMedia para Meta;
5. sendMessage em áudio;
6. Webhook Response.

Resultado no Supabase:

```text
outbound.status = sent
delivery_mode = audio
voice_profile = dona_antonia_marin_b_v1
dispatch_response_status = 200
provider_message_id = presente
messages.delivery_status = sent
messages.whatsapp_message_id = presente
review_required = 0
```

A resposta corrigida foi enviada ao telefone de teste como áudio real.

Não registrar custo TTS exato sem metadata oficial de usage; a chamada ocorreu dentro da homologação explicitamente autorizada.

---

## 8. Estado final após o replay corrigido

Após a confirmação do envio:

- `close_whatsapp_homologation_v1()` executado;
- `ai_enabled=false`;
- `conversation_worker_enabled=false`;
- inbound fechado;
- auto-reply fechado;
- allowlist vazia;
- Make inbound `6779824` inativo;
- Make outbound oficial permanece ativo para jobs legítimos/event-driven;
- filas de IA e seller_message zeradas;
- `review_required=0`;
- orders/order_sync/Bling zerados na janela auditada.

O workflow one-shot da classificação deve ser removido do `main` na PR de documentação/cleanup desta homologação.

---

## Próximo passo exato

Falta uma única prova para declarar **áudio real completamente homologado na arquitetura nova**:

1. abrir homologação allowlisted;
2. ativar Make inbound `6779824`;
3. receber **um novo áudio real**;
4. validar `transcription` job;
5. processar transcrição;
6. confirmar criação automática do `conversation` job;
7. processar classificação;
8. confirmar resposta inteligente;
9. confirmar `delivery_mode=audio` / Marin B;
10. confirmar Meta `sent` e receipt metadata;
11. fechar gates e inbound.

Depois disso:

**imagem real inbound → Storage privado → `vision` → resposta controlada**.

Somente após texto + áudio fresco + imagem real estarem fechados deve ser considerada qualquer liberação gradual do WhatsApp. Bling continua fora até lá.
