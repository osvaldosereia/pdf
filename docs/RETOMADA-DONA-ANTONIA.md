# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 — WhatsApp real: texto concluído, áudio corrigido em duas etapas e replay real aprovado; falta 1 áudio fresco + imagem real**.

Este é o arquivo **autoritativo** para retomar o projeto em uma nova conversa. Não planejar do zero. Antes de alterar qualquer gate, consultar o estado real no GitHub, Supabase e Make.

Documentos principais:

- `docs/HOMOLOGACAO-WHATSAPP-AUDIO-20260907.md` — auditoria do áudio real, bug encontrado e correção em duas etapas;
- `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md` — texto/menu/interativos reais;
- `docs/WHATSAPP-BRIDGE-V3.md` — arquitetura da ponte event-driven;
- `docs/HOMOLOGACAO-OPENAI-20260907.md` — homologação OpenAI sintética;
- `docs/SALA-COMPRA-MOTOR-COMERCIAL-V1.md`;
- `docs/CONVERSATION-WORKER-V1.md`;
- `docs/EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`.

---

## PONTO EXATO DE RETOMADA

### Já concluído

1. Sala de Compra `/comprar/` + motor comercial determinístico;
2. OpenAI sintético: texto, transcrição e visão;
3. TTS real no WhatsApp e escolha da voz oficial `dona_antonia_marin_b_v1`;
4. WhatsApp Bridge v3 event-driven;
5. entrada real allowlisted;
6. menu real e botões reais;
7. IA real em texto ponta a ponta;
8. receipt metadata Meta (`whatsapp_message_id`, `delivery_status`, `last_outbound_at`);
9. download de áudio real Meta → Make → Storage privado;
10. transcrição real OGG/Opus → `gpt-4o-mini-transcribe`;
11. bug pós-transcrição identificado e corrigido estruturalmente;
12. replay do transcript real pela nova segunda etapa `conversation` → intent correto → resposta correta → áudio Marin B real → Meta `sent`.

### Ainda falta para fechar áudio

Fazer **um único áudio novo**, gravado depois da correção #152, para provar a cadeia nova inteira sem replay/backfill:

```text
WhatsApp áudio novo
→ Meta
→ Make inbound
→ Storage privado
→ job transcription
→ gpt-4o-mini-transcribe
→ transcript salvo em transcript + body_text
→ cria automaticamente job conversation
→ gpt-4o-mini classifica
→ reply determinístico
→ delivery_mode=audio
→ TTS Marin B
→ Meta
→ receipt metadata
```

Depois desse áudio fresco:

**foto real → Storage privado → vision → resposta controlada**.

Não liberar `whatsapp_release_mode=live` antes de fechar áudio fresco + imagem real e auditar tudo.

---

## Estado seguro no fechamento da última rodada

Auditoria após o replay corrigido:

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

Make inbound `6779824` está **inactive**.

Make outbound oficial `7290488` permanece **active** e event-driven.

Bling continua completamente fora da Etapa 3.

---

## Última homologação real de áudio

Telefone de teste: documentar somente como `+55 65 *****-0975`.

Mensagem real:

- DB message: `abbb8676-b4da-4f9b-a432-4dfd588f19d8`;
- conversation: `ff5c1e73-f3ed-4b88-8eba-b6e3a9883941`;
- session: `350a288f-1541-441f-96c1-5220ad9c98b2`;
- media OGG/Opus: `13262` bytes;
- Make inbound execution: `8b290f018092437897b996b55794f934`.

Transcription job:

`b3d4a2e1-5831-45f3-a9e4-ab6402d5b038`

OpenAI:

- `gpt-4o-mini-transcribe`;
- request `req_3dd28fc60ac847c49e963ff739bb4a5d`;
- input `55` tokens;
- output `21` tokens;
- attempts `1`.

Transcript real:

> Olá, eu gostaria de uma cesta básica e também preciso de arroz. Você poderia me ajudar?

### Bug encontrado

A implementação anterior tentava usar `deterministicIntent(transcript)` diretamente após a transcrição. Uma frase natural longa virou `search` com a frase inteira e gerou uma resposta ruim.

O transporte de áudio/TTS/Meta funcionou, mas a semântica foi rejeitada.

### Correção PR #152

PR #152 incorporada ao `main`:

`dccf1a78f129f5c0852ac911e0ff317d70615f2d`

Migration:

`20260907204500_audio_transcription_chain_v1.sql`

Regra nova:

- `transcription` retorna somente transcript;
- salva `messages.transcript` e `messages.body_text`;
- NÃO responde;
- cria segundo job `conversation`;
- só o `conversation` pode criar seller reply/outbound;
- `max_ai_calls_per_event` permite 2 para áudio;
- `max_transcriptions_per_event` continua 1;
- texto normal continua usando 1 chamada.

Teste sintético em produção, com gates fechados, confirmou:

- follow-up `conversation` criado;
- `reply_suppressed=true` na transcrição;
- 0 seller replies;
- 0 outbound jobs.

Dados sintéticos foram apagados depois.

### Replay real da etapa 2

Conversation job:

`a2997ca0-6e55-4976-bec0-a3169cbc6d5d`

GitHub Actions run:

`34161048559`

Job:

`101862803251`

Resultado:

`success`

OpenAI classificação:

- modelo `gpt-4o-mini`;
- request `req_25042456fa3543a3a7a1282ddcd24c73`;
- input `203` tokens;
- output `32` tokens;
- attempts `1`.

Interpretação correta:

```json
{
  "intent": "baskets",
  "description": "Cliente interessado em cesta básica e arroz."
}
```

Reply correto:

> Claro. Posso te mostrar as cestas disponíveis e ajudar a personalizar os itens.

Reply message:

`67d990a3-070c-48ec-ac25-32ef18fd5afc`

Outbound job:

`49941570-a21b-4c34-9eaf-bfad2207afe4`

Make outbound execution:

`20451224eaca41b4ab9f614267536c3b`

Fluxo Make executado sem erro:

```text
webhook
→ JSON TTS
→ OpenAI direct speech
→ uploadMedia Meta
→ sendMessage audio
→ Webhook Response
```

Resultado:

```text
delivery_mode = audio
voice_profile = dona_antonia_marin_b_v1
outbound.status = sent
dispatch_response_status = 200
provider_message_id = presente
messages.delivery_status = sent
messages.whatsapp_message_id = presente
review_required = 0
```

O workflow one-shot da classificação foi removido após o teste.

---

## IA real em texto — já concluída

Mensagem real:

`Quero uma cesta básica e também preciso de arroz`

AI job:

`e31ce832-e780-4888-8681-a84bc4c61b1c`

GitHub Actions run:

`34159364103`

OpenAI:

- `gpt-4o-mini`;
- request `req_f7b1d3da0599432bbd366f08b45d2dcf`;
- input `194`;
- output `31`;
- intent `baskets`.

Resposta real:

> Claro. Posso te mostrar as cestas disponíveis e ajudar a personalizar os itens.

Outbound event-driven real concluído com Meta `sent`.

---

## Hotfixes importantes da homologação real

### PR #147 — campos atuais do Make

`whatsapp-ingest-make-v1` aceita campos genéricos atuais e aliases legados:

- `media_id`;
- `caption`;
- `interactive_id`;
- `interactive_title`.

Produção: adaptador v2.

### PR #148 — saudações em conversa existente

`Oi`, `Olá`, bom dia/tarde/noite e comandos de menu reabrem o menu determinístico sem gastar IA.

Migration:

`20260907201500_whatsapp_greeting_menu_v1.sql`

### PR #150 — receipt metadata

Migration:

`20260907203500_whatsapp_outbound_message_receipt_v1.sql`

Após confirmação Meta, persiste:

- `messages.whatsapp_message_id`;
- `messages.delivery_status=sent`;
- `conversations.last_outbound_at`.

Nunca transformar falha de metadata em retry cego de mensagem possivelmente entregue.

---

## Arquitetura oficial WhatsApp

```text
WhatsApp/Meta
→ Make inbound fino
→ Supabase Conversation Engine
   → texto: conversation
   → áudio: transcription → conversation
   → imagem: vision
→ regras determinísticas / Sala / carrinho
→ outbound_jobs
→ pg_net
→ Make outbound event-driven
   → Meta texto
   → OU OpenAI Marin B + Meta áudio
→ Webhook Response
→ reconciliação Postgres
```

Sem polling no outbound.

Sem callback HTTP Make → Supabase.

Estado ambíguo depois de possível envio:

`delivery_uncertain_review_required`

Nunca retry cego.

---

## Make

### Inbound

`6779824 — Dona Antônia - WhatsApp Inbound Controlado v1`

Suporta texto, interativo, áudio e imagem.

Ativar somente durante homologação enquanto `release_mode` estiver controlado.

### Outbound oficial

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Active.

### Legado

`7290290 — LEGACY - NÃO USAR - WhatsApp Outbound HTTP v1`

Manter inativo.

---

## Voz oficial

Perfil:

`dona_antonia_marin_b_v1`

- `gpt-4o-mini-tts`;
- voice `marin`;
- speed `1.0`;
- português brasileiro natural;
- mulher adulta;
- calorosa, próxima e tranquila;
- sem tom de locutora, URA, anúncio ou telemarketing;
- pausas e variações naturais.

O usuário escolheu B após testes reais.

Manter disclosure apropriado de voz gerada por IA na produção.

---

## Supabase / segurança

Projeto:

`ssbesxgaijknwsjbsbcz`

Regras:

- nunca versionar service role, OpenAI key, Meta token, Bling token ou segredo Make;
- mídia privada;
- idempotência obrigatória;
- allowlist de homologação server-side;
- anti-backlog por `whatsapp_inbound_since`;
- gates consultados antes de provider spend;
- `get_whatsapp_bridge_health_v1()` antes/depois de testes;
- `close_whatsapp_homologation_v1()` ao terminar;
- emergency stop disponível.

---

## Sala / comercial

Sala oficial:

`/comprar/`

Motor:

`shopping-room-sales-v1`

Princípio:

> IA conversa e vende; interface apresenta; backend valida; Bling registra.

Cestas:

- preço comercial próprio;
- não é soma dos componentes;
- cliente não vê preço individual dos componentes;
- Bling recebe componentes individualizados;
- diferença positiva → Outras despesas;
- diferença negativa → desconto;
- IA nunca calcula diferença fiscal.

Pagamento: somente na entrega.

Operação: somente entrega.

---

## Bling

Continua fora da homologação WhatsApp.

Só homologar um pedido real depois de:

1. texto real — concluído;
2. áudio novo completo — falta 1 teste final;
3. imagem real — pendente.

---

## Próxima execução prática

Quando o usuário disser que está pronto:

1. auditar `get_whatsapp_bridge_health_v1()`;
2. confirmar filas vazias e release `off`;
3. armar homologação 20–30 min para o telefone de teste;
4. ativar Make inbound `6779824`;
5. pedir **um áudio novo curto e natural**;
6. confirmar exatamente 1 `transcription` job + mídia privada;
7. executar transcrição one-shot/controlada;
8. confirmar que `finish_conversation_job` criou automaticamente exatamente 1 `conversation` job e nenhuma resposta precoce;
9. executar conversation one-shot/controlada;
10. confirmar intent/reply correto;
11. confirmar Make outbound em Marin B e Meta `sent`;
12. confirmar receipt metadata;
13. fechar homologação e desativar inbound;
14. remover workflows temporários;
15. atualizar esta retomada marcando áudio real como concluído;
16. seguir para foto real/visão.

Não pedir configuração manual ao usuário; ele só precisa enviar o áudio quando solicitado.

---

## Depois do WhatsApp

Ordem macro:

1. finalizar áudio fresco;
2. finalizar imagem real;
3. decidir liberação gradual do atendimento;
4. homologar 1 pedido Bling real;
5. confirmação final do pedido no WhatsApp;
6. migrar `/cadastro/` para Supabase;
7. CRM/relatórios/recompra/aniversário;
8. acabamento final/home/campanhas.

Não ativar marketing em massa agora.

---

## Regra de trabalho do usuário

- programar blocos grandes por rodada;
- padrão profissional e modular;
- análise global do projeto;
- fazer funcionar ponta a ponta antes de polir;
- baixo custo;
- Make como ponte fina;
- integrações perigosas somente em homologação controlada;
- atualizar a retomada no GitHub após avanços importantes.

### Instrução para novo chat

> Acesse `osvaldosereia/SUCEDOAN12`, leia `docs/RETOMADA-DONA-ANTONIA.md`, `docs/HOMOLOGACAO-WHATSAPP-AUDIO-20260907.md` e `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md`. Consulte o estado real no Supabase e Make e continue exatamente do ponto indicado. Não assuma gates. Programe o máximo possível por rodada mantendo fail-closed fora de homologação controlada.
