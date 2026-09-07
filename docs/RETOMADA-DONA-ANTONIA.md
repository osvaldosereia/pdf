# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 — WhatsApp real: texto e áudio homologados ponta a ponta; próximo passo é imagem real**.

Este é o arquivo **autoritativo** para retomar o projeto em uma nova conversa. Não planejar do zero. Antes de alterar gates, executar testes reais ou tocar Bling, consultar o estado atual no GitHub, Supabase e Make.

## Documentos principais

- `docs/HOMOLOGACAO-WHATSAPP-AUDIO-FINAL-20260907.md` — **fonte final da homologação de áudio real**;
- `docs/HOMOLOGACAO-WHATSAPP-AUDIO-20260907.md` — histórico do primeiro áudio, bug pós-transcrição e correção PR #152;
- `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md` — menu, interativos, texto real e outbound Meta;
- `docs/WHATSAPP-BRIDGE-V3.md` — arquitetura da ponte event-driven;
- `docs/HOMOLOGACAO-OPENAI-20260907.md` — texto/transcrição/visão sintéticos;
- `docs/SALA-COMPRA-MOTOR-COMERCIAL-V1.md`;
- `docs/CONVERSATION-WORKER-V1.md`;
- `docs/EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`;
- `docs/ARQUITETURA-DONA-ANTONIA-V2.md` — histórico arquitetural.

---

# PONTO EXATO DE RETOMADA

## Concluído

1. **Sala de Compra + motor comercial determinístico**;
2. **OpenAI sintético**: texto, transcrição e visão;
3. **TTS real WhatsApp** com voz oficial `dona_antonia_marin_b_v1`;
4. **WhatsApp Bridge v3** event-driven;
5. **entrada real WhatsApp allowlisted**;
6. **menu determinístico real**;
7. **botões interativos reais**;
8. **IA real em texto ponta a ponta**;
9. **outbound real Meta com receipt metadata**;
10. **áudio real inbound ponta a ponta — HOMOLOGADO**;
11. **arquitetura de áudio em duas etapas — HOMOLOGADA**;
12. gates fechados e filas zeradas após o teste.

## Próximo passo imediato

**Homologar uma imagem/foto real pelo WhatsApp**, ainda somente no telefone de teste allowlisted.

Fluxo esperado:

```text
WhatsApp imagem real
→ Meta Cloud API
→ Make inbound 6779824
→ whatsapp-ingest-make-v1
→ whatsapp-ingest
→ download da mídia
→ Storage privado Supabase
→ job vision
→ gpt-4o-mini detail=low
→ interpretação segura
→ resposta determinística/controlada
→ outbound event-driven 7290488
→ Meta
```

Regras para o teste de imagem:

1. abrir `homologation` somente para o telefone de teste;
2. ativar Make inbound `6779824`;
3. confirmar filas zeradas antes da foto;
4. receber uma única foto real;
5. validar MIME/tamanho/caminho privado antes do provider;
6. usar workflow one-shot fail-closed ou worker manual com ID exato;
7. confirmar `vision` em `done`, `attempts=1`;
8. confirmar interpretação/response coerentes;
9. confirmar outbound Meta e receipt metadata;
10. fechar homologação e desativar inbound;
11. auditar `orders/order_sync/Bling = 0`.

**Não liberar `whatsapp_release_mode=live` antes de fechar a imagem real e fazer a auditoria final de texto + áudio + imagem.**

---

# ÁUDIO REAL — HOMOLOGAÇÃO FINAL CONCLUÍDA

A segunda gravação real, feita **depois da correção PR #152**, provou a cadeia nova inteira sem backfill, replay ou reutilização de job.

## Entrada real final

Message row:

`5871fcbf-6229-49b3-bb34-8cfe854b1746`

Mídia:

- `audio/ogg`;
- OGG/Opus;
- `20037` bytes;
- Storage privado `shopping-room-media`;
- caminho isolado da sessão;
- nenhuma URL pública.

Transcript:

> Boa tarde, tudo bem? Eu queria ver as cestas básicas que você tem aí para vender e queria também saber se eu posso trocar os produtos da cesta.

O transcript foi promovido automaticamente para `messages.body_text` e ficou idêntico a `messages.transcript`.

## Etapa 1 — transcription

Job:

`6ebb5a42-bd61-4418-99cb-9f0e9b460ca7`

Resultado:

```text
job_type = transcription
status = done
attempts = 1
reply_suppressed = true
```

OpenAI:

- modelo `gpt-4o-mini-transcribe`;
- request `req_1193975cb9244842ab00c270044f7489`;
- input tokens `84`;
- output tokens `34`.

A etapa de transcrição **não respondeu ao cliente**. Ela apenas salvou o transcript e criou automaticamente o job `conversation`.

## Etapa 2 — conversation

Job criado automaticamente:

`a8e14824-6512-44be-8732-513f66545b7e`

Resultado:

```text
job_type = conversation
status = done
attempts = 1
reply_suppressed = false
```

OpenAI:

- modelo `gpt-4o-mini`;
- request `req_1482777eb0684e8bbf256ddf3275d0c6`;
- input tokens `216`;
- output tokens `33`.

Interpretação correta:

```json
{
  "intent": "baskets",
  "description": "Cliente interessado em cestas básicas e troca de produtos."
}
```

Resposta:

> Claro. Posso te mostrar as cestas disponíveis e ajudar a personalizar os itens.

Reply message:

`916d28e1-331b-44a0-b2e7-25fc7f01c5ff`

Outbound job:

`13566c6f-7af7-4a5b-9023-40418074b462`

## Áudio Marin B real

Payload:

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

Confirmação:

```text
outbound.status = sent
dispatch_attempts = 1
dispatch_response_status = 200
provider_message_id = presente
review_required = 0
```

## GitHub Actions final

PR:

`#155 — Dona Antônia: homologar áudio real ponta a ponta após correção`

Merge:

`501e8f3140be2dac5040c36fe943f3d93b49148e`

Run:

`34161624075`

Job:

`101864470206`

Todas as etapas terminaram `success`:

- preflight de job/mídia;
- testes;
- transcrição;
- criação automática do segundo job;
- classificação;
- resposta;
- espera do receipt Meta;
- confirmação HTTP 200 e Marin B.

O workflow one-shot foi removido imediatamente no cleanup posterior.

---

# REGRA OBRIGATÓRIA DO ÁUDIO

Nunca voltar ao desenho antigo:

```text
transcrição
→ deterministicIntent(transcript)
→ resposta direta
```

Esse desenho foi rejeitado em teste real porque uma fala natural longa virou uma busca com a frase inteira.

A arquitetura oficial é:

```text
1. transcription
   → OpenAI transcribe
   → salva transcript/body_text
   → NÃO responde
   → cria conversation

2. conversation
   → classificador OpenAI do texto
   → intenção
   → resposta determinística/controlada
   → delivery_mode
   → Marin B quando inbound foi áudio e preferred_reply=auto
```

Orçamento:

- áudio pode usar até 2 chamadas de IA por evento: 1 transcrição + 1 interpretação;
- transcrição continua limitada a 1;
- texto normal continua usando apenas 1 chamada;
- nunca repetir chamada paga cegamente após resultado externo incerto.

Migration principal:

`20260907204500_audio_transcription_chain_v1.sql`

PR estrutural:

`#152`

Merge:

`dccf1a78f129f5c0852ac911e0ff317d70615f2d`

---

# ESTADO SEGURO APÓS O ÁUDIO FINAL

Foi executado:

`close_whatsapp_homologation_v1()`

Estado confirmado:

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
```

Make inbound:

`6779824 — Dona Antônia - WhatsApp Inbound Controlado v1`

Estado depois do teste: **inativo**.

Make outbound oficial:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Pode permanecer ativo porque trabalha somente sobre jobs outbound legítimos; com inbound/IA fechados não existe liberação geral de atendimento.

Auditoria de efeitos colaterais na janela final:

```text
orders = 0
order_sync_jobs = 0
bling_commands = 0
```

Bling permaneceu completamente fora.

---

# WHATSAPP BRIDGE V3

## Inbound oficial

Make:

`6779824 — Dona Antônia - WhatsApp Inbound Controlado v1`

Suporta:

- texto;
- interactive/button;
- áudio;
- imagem;
- download de mídia;
- attach ao backend;
- dedupe;
- customer/conversation/session;
- jobs IA condicionais.

Edge:

- `whatsapp-ingest` v3;
- `whatsapp-ingest-make-v1` v2.

## Outbound oficial

Make:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Fluxo:

```text
outbound_jobs
→ Postgres / pg_net
→ webhook Make
→ texto OU OpenAI Marin B + Meta áudio
→ Webhook Response
→ reconciliação Postgres
→ sent/provider_message_id/receipt metadata
```

Estado externo incerto:

`delivery_uncertain_review_required`

**Nunca retry cego** se pode ter ocorrido envio real.

Legado:

`7290290 — LEGACY - NÃO USAR - WhatsApp Outbound HTTP v1`

Manter inativo.

---

# RELEASE GATES / SEGURANÇA

Campos principais:

- `whatsapp_release_mode`;
- `whatsapp_inbound_enabled`;
- `whatsapp_auto_reply_enabled`;
- `whatsapp_inbound_since`;
- `ai_enabled`;
- `conversation_worker_enabled`;
- `automation_enabled`;
- `outbound_enabled`.

Modes:

- `off` — fechado;
- `observe` — observação/controlado;
- `homologation` — somente allowlist temporária;
- `live` — geral, ainda sujeito aos demais gates.

RPCs importantes:

- `get_whatsapp_bridge_health_v1()`;
- `whatsapp_bridge_emergency_stop_v1(reason)`;
- `whatsapp_release_decision(...)`;
- `arm_whatsapp_homologation_v1(...)`;
- `close_whatsapp_homologation_v1()`;
- `expire_whatsapp_homologation_v1()`;
- `dispatch_whatsapp_outbound_healthcheck_v3()`;
- `reconcile_whatsapp_outbound_responses_v3()`;
- `recover_whatsapp_outbound_dispatch()`.

Anti-backlog é obrigatório: mensagens anteriores a `whatsapp_inbound_since` não entram no core.

Nunca versionar telefone real, chave OpenAI, chave Meta, service role, segredo do Make ou credenciais Bling.

---

# VOZ OFICIAL

Perfil:

`dona_antonia_marin_b_v1`

Configuração:

- `gpt-4o-mini-tts`;
- voz `marin`;
- speed `1.0`;
- português brasileiro natural;
- mulher adulta;
- calorosa, próxima e tranquila;
- não soar como locutora, URA, anúncio ou telemarketing;
- pausas e variações naturais.

O usuário escolheu Marin B após comparação real no WhatsApp.

Na produção, manter disclosure apropriado de voz gerada por IA; não projetar o sistema para enganar o cliente sobre a natureza automatizada da voz.

---

# ARQUITETURA GERAL

```text
WhatsApp/Meta ──────┐
                    ├── Conversation Engine ── Supabase/Postgres
Sala de Compra ─────┘                 │
                                      ├── OpenAI somente quando necessário
                                      ├── regras determinísticas de preço/estoque
                                      └── carrinho/pedido
                                               │
                                      GitHub Actions / workers
                                               │
                                              Bling
                                               │
                                      outbound WhatsApp v3
```

Responsabilidades:

- **GitHub:** código, migrations, CI, workers e documentação;
- **Supabase:** banco operacional, Storage privado, estado, filas e RPCs;
- **Make:** ponte fina com Meta e TTS; não é backend principal;
- **Bling:** ERP oficial e pedido oficial;
- **OpenAI:** conversa, transcrição, visão e TTS; nunca decide preço, estoque ou pedido;
- **Firebase:** lookup legado temporário de produtos; não expandir.

Supabase projeto:

`ssbesxgaijknwsjbsbcz`

---

# SALA DE COMPRA / MOTOR COMERCIAL

Sala oficial:

`/comprar/`

Edge:

`shopping-room-sales-v1`

Regras principais:

- nunca recomendar item já no carrinho;
- histórico do cliente tem peso alto;
- ofertas/afinidade/upsell aumentam score;
- rejeição recente exclui/penaliza;
- máximo inicial de 2 iniciativas proativas;
- “não quero” / “só a cesta” zera pressão;
- pressa → checkout;
- sem recomendação relevante → não oferecer.

Motor comercial é determinístico e não chama OpenAI/Meta/Bling.

---

# CESTAS / REGRA COMERCIAL E FISCAL

- cesta tem preço comercial próprio;
- preço da cesta **não é a soma** dos componentes;
- cliente não vê preços individuais dos itens da cesta;
- Bling recebe os componentes individualizados;
- diferença positiva entre fiscal e comercial → `Outras despesas`;
- diferença negativa → desconto;
- IA nunca calcula diferença fiscal.

Pagamento: **somente na entrega**.

Operação: **somente entrega**.

UI das cestas:

- foto quadrada da cesta;
- nome e quantidade dos itens;
- `+ / - / remover` por item;
- sem foto individual obrigatória;
- sem preço individual dos componentes.

---

# BLING

**Ainda não homologar pedido real até concluir a foto real e a auditoria final do WhatsApp.**

Workers existentes:

- `scripts/bling-order-writer-v1.mjs`;
- `scripts/bling-stock-writer-v1.mjs`;
- `scripts/bling-product-writer-v1.mjs`.

Próxima sequência depois da imagem:

1. decidir liberação gradual do WhatsApp;
2. homologar um pedido Bling real controlado;
3. confirmar componentes da cesta + diferença fiscal;
4. confirmar resposta final no WhatsApp;
5. somente depois expandir automações.

---

# PRODUTOS / FIREBASE

Não importar todo o legado em massa.

Fluxo desejado:

```text
produto físico
→ EAN
→ Firebase somente como lookup legado
→ conferência humana
→ Supabase
→ fila Bling
```

`/cadastro/` ainda deve ser migrado para Supabase depois da homologação operacional principal.

---

# CRM / EVOLUÇÃO COMERCIAL FUTURA

Planejado, não ativar em massa agora:

- histórico completo de pedidos;
- relatórios admin;
- recompra personalizada;
- cadência configurável, ideia inicial ~15 dias;
- opt-in/templates Meta quando exigidos;
- aniversário opcional para benefício no mês;
- recomendações por perfil e histórico;
- expansão estratégica do carrinho sem insistência;
- regras determinísticas de validade/desconto.

Documento:

`docs/EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`

---

# ORDEM DE EXECUÇÃO DAQUI PARA FRENTE

1. **imagem real WhatsApp** → homologar ponta a ponta;
2. fechar gates e auditar zero jobs incertos;
3. revisar texto + áudio + imagem como conjunto;
4. decidir liberação gradual do WhatsApp;
5. homologar **um** pedido Bling real;
6. confirmar pedido final no WhatsApp;
7. migrar `/cadastro/` para Supabase;
8. CRM/relatórios/recompra/aniversário;
9. home/acabamento/campanhas;
10. limpeza final de legado.

---

# NÃO LIBERADO AINDA

- `whatsapp_release_mode=live`;
- IA geral para todos os clientes;
- marketing/recompra em massa;
- pedido Bling indiscriminado;
- writers Bling amplamente automáticos;
- remoção do Firebase antes da migração;
- desconto universal sem lote/preço controlado.

---

# REGRA DE TRABALHO

Preferências do usuário para este projeto:

- programar blocos grandes por rodada;
- padrão profissional, modular e seguro;
- analisar o projeto globalmente;
- fazer funcionar ponta a ponta antes de polir;
- custo baixo;
- Make como ponte fina;
- integrações perigosas somente em homologação controlada;
- atualizar sempre a retomada no GitHub;
- não pedir trabalho manual se puder ser executado diretamente pelas ferramentas disponíveis.

## Instrução para novo chat

> Acesse `osvaldosereia/SUCEDOAN12`, leia primeiro `docs/RETOMADA-DONA-ANTONIA.md`, depois `docs/HOMOLOGACAO-WHATSAPP-AUDIO-FINAL-20260907.md` e `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md`. Consulte o estado real no Supabase e Make antes de alterar gates. Continue exatamente do ponto indicado: **homologação de imagem real pelo WhatsApp**. Não libere `live`, não toque Bling antes da imagem, e mantenha fail-closed fora de homologação controlada.
