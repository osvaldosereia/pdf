# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 — WhatsApp real: texto, áudio e imagem homologados ponta a ponta**.

Este é o arquivo **autoritativo** para retomar o projeto. Não planejar do zero. Antes de alterar qualquer gate, auditar o estado real no GitHub, Supabase e Make.

## Documentos principais

- `docs/HOMOLOGACAO-WHATSAPP-IMAGEM-FINAL-20260907.md` — fonte final da imagem real;
- `docs/HOMOLOGACAO-WHATSAPP-AUDIO-FINAL-20260907.md` — fonte final do áudio real;
- `docs/HOMOLOGACAO-WHATSAPP-AUDIO-20260907.md` — histórico do bug pós-transcrição e correção;
- `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md` — menu, interativos, texto real e outbound Meta;
- `docs/WHATSAPP-BRIDGE-V3.md` — ponte event-driven;
- `docs/HOMOLOGACAO-OPENAI-20260907.md` — texto/transcrição/visão sintéticos;
- `docs/SALA-COMPRA-MOTOR-COMERCIAL-V1.md`;
- `docs/CONVERSATION-WORKER-V1.md`;
- `docs/EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`.

---

# PONTO EXATO DE RETOMADA

## Concluído

1. Sala de Compra + motor comercial determinístico;
2. OpenAI sintético: texto, transcrição e visão;
3. TTS real WhatsApp com `dona_antonia_marin_b_v1`;
4. WhatsApp Bridge v3 event-driven;
5. entrada real allowlisted;
6. menu e botões interativos reais;
7. IA real em texto ponta a ponta;
8. outbound Meta real com receipt metadata;
9. áudio real ponta a ponta — **HOMOLOGADO**;
10. imagem real ponta a ponta — **HOMOLOGADA**;
11. gates fechados e filas zeradas depois das homologações;
12. zero efeito em pedido/Bling durante texto, áudio e imagem.

## Próxima etapa

**Preparar liberação gradual/controlada do atendimento real antes de qualquer `whatsapp_release_mode=live`.**

Objetivos imediatos:

1. transformar o Conversation Worker manual/one-shot em worker operacional seguro;
2. definir cadência/trigger sem polling agressivo e com custo baixo;
3. manter idempotência, budgets e `review_required`;
4. observabilidade/admin para jobs, falhas, consumo e conversas;
5. fallback humano e emergency stop;
6. testar uma pequena janela real allowlisted/observe com worker operacional;
7. só depois considerar `live`;
8. depois homologar **um pedido real controlado no Bling**;
9. confirmação final do pedido no WhatsApp;
10. depois migrar `/cadastro/` e avançar CRM/relatórios/recompra/aniversário.

**Não ativar atendimento geral nem Bling indiscriminadamente ainda.**

---

# HOMOLOGAÇÃO REAL DE IMAGEM — CONCLUÍDA

Foto real enviada pelo WhatsApp e recuperada com segurança do webhook Make que estava inativo.

Havia backlog no Make. Foi usado anti-backlog com corte imediatamente anterior ao evento da foto, evitando processar mensagens antigas.

Mensagem real:

`71438d3e-c412-4407-ba85-23b85ed26f1f`

Mídia:

- tipo `image`;
- MIME `image/jpeg`;
- `151860` bytes;
- Storage privado `shopping-room-media`;
- caminho isolado `sessions/<session>/image/whatsapp/...jpg`.

AI job:

`bda1dc33-94ab-4e0f-b2d4-79e87021cbf8`

Resultado:

```text
job_type = vision
status = done
attempts = 1
intent = search
query = amido de milho
```

Interpretação OpenAI:

`Pacote de amido de milho Kimimo, 200g.`

Resposta determinística:

`Vou procurar amido de milho para você.`

OpenAI:

- modelo `gpt-4o-mini`;
- request `req_b85f0f96b3d54d7d8ba811b2c55b4fb1`;
- input tokens `3026`;
- output tokens `36`;
- attempts `1`.

Outbound job:

`8bd12fed-a16c-43d9-9e48-52b3ea729150`

Resultado:

```text
status = sent
delivery_mode = text
dispatch_response_status = 200
provider_message_id = presente
review_required = 0
```

GitHub Actions:

- run `34162273559`;
- job `101866359410`;
- conclusão `success`.

O workflow one-shot de imagem foi removido após a homologação.

Documento detalhado:

`docs/HOMOLOGACAO-WHATSAPP-IMAGEM-FINAL-20260907.md`

---

# ÁUDIO — REGRA OBRIGATÓRIA

Arquitetura oficial:

```text
1. transcription
   → gpt-4o-mini-transcribe
   → salva transcript/body_text
   → NÃO responde
   → cria job conversation

2. conversation
   → gpt-4o-mini
   → intenção
   → resposta determinística/controlada
   → se inbound foi áudio e preferred_reply=auto: Marin B
```

Nunca voltar ao desenho antigo de transcrição → `deterministicIntent` → resposta direta.

Migration principal:

`20260907204500_audio_transcription_chain_v1.sql`

PR estrutural:

`#152`, merge `dccf1a78f129f5c0852ac911e0ff317d70615f2d`.

Áudio final fresco homologado no run `34161624075`.

---

# WHATSAPP BRIDGE V3

Inbound oficial:

`6779824 — Dona Antônia - WhatsApp Inbound Controlado v1`

Estado quando não há teste ativo: **inativo**.

Suporta:

- texto;
- interactive/button;
- áudio;
- imagem;
- download/attach de mídia privada;
- dedupe;
- customer/conversation/session;
- jobs IA condicionais.

Edge:

- `whatsapp-ingest` v3;
- `whatsapp-ingest-make-v1` v2.

Outbound oficial:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Fluxo:

```text
outbound_jobs
→ Postgres / pg_net
→ webhook Make
→ texto OU TTS Marin B
→ Meta
→ Webhook Response
→ reconciliação Postgres
→ sent/provider_message_id/receipt metadata
```

Nunca retry cego se um envio externo puder ter ocorrido.

Legado:

`7290290 — LEGACY - NÃO USAR - WhatsApp Outbound HTTP v1`

Manter inativo.

---

# ESTADO SEGURO ATUAL

Confirmado após a imagem real:

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

Make inbound `6779824`: **inativo**.

Make outbound `7290488`: pode permanecer ativo para jobs legítimos; com inbound/IA fechados não existe atendimento geral.

Supabase projeto:

`ssbesxgaijknwsjbsbcz`

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
- `homologation` — allowlist temporária;
- `live` — geral, ainda sujeito aos demais gates.

RPCs:

- `get_whatsapp_bridge_health_v1()`;
- `whatsapp_bridge_emergency_stop_v1(reason)`;
- `whatsapp_release_decision(...)`;
- `arm_whatsapp_homologation_v1(...)`;
- `close_whatsapp_homologation_v1()`;
- `expire_whatsapp_homologation_v1()`;
- `reconcile_whatsapp_outbound_responses_v3()`;
- `recover_whatsapp_outbound_dispatch()`.

Anti-backlog é obrigatório. Nunca versionar telefone real, keys, service role, Meta/OpenAI/Bling secrets ou webhook secreto.

---

# VOZ OFICIAL

`dona_antonia_marin_b_v1`

- `gpt-4o-mini-tts`;
- voz `marin`;
- speed `1.0`;
- PT-BR natural;
- mulher adulta;
- calorosa, próxima e tranquila;
- sem voz de locutora/URA/telemarketing;
- disclosure apropriado de voz gerada por IA em produção.

---

# SALA / MOTOR COMERCIAL

Sala oficial:

`/comprar/`

Edge:

`shopping-room-sales-v1`

Regras:

- nunca recomendar item já no carrinho;
- histórico do cliente tem peso alto;
- ofertas/afinidade/upsell aumentam score;
- rejeição recente penaliza/exclui;
- máximo inicial de 2 iniciativas proativas;
- “não quero”/“só a cesta” zera pressão;
- pressa → checkout;
- sem recomendação relevante → não oferecer.

Motor comercial é determinístico e não chama OpenAI/Meta/Bling.

---

# CESTAS / FISCAL

- cesta tem preço comercial próprio;
- preço da cesta não é soma dos componentes;
- cliente não vê preços individuais dos componentes;
- Bling recebe componentes individualizados;
- diferença positiva → Outras despesas;
- diferença negativa → desconto;
- IA nunca calcula diferença fiscal.

Pagamento: **somente na entrega**.

Operação: **somente entrega**.

---

# BLING

Ainda fora da homologação WhatsApp.

Não executar writers amplamente ainda.

Próximo passo Bling: depois da preparação de release gradual do WhatsApp, homologar **um único pedido real controlado**, conferir componentes da cesta, diferença fiscal, contato, estoque e confirmação final no WhatsApp.

Workers existentes:

- `scripts/bling-order-writer-v1.mjs`;
- `scripts/bling-stock-writer-v1.mjs`;
- `scripts/bling-product-writer-v1.mjs`.

---

# CRM / EVOLUÇÃO FUTURA

Planejado, não ativar em massa agora:

- histórico completo de pedidos;
- relatórios admin;
- recompra personalizada;
- cadência configurável, ideia inicial ~15 dias;
- opt-in/templates Meta quando exigidos;
- aniversário opcional;
- recomendações por perfil/histórico;
- expansão estratégica do carrinho sem insistência.

Documento:

`docs/EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`

---

# REGRA DE TRABALHO

Preferências do usuário:

- programar blocos grandes por rodada;
- padrão profissional e modular;
- análise global;
- fazer funcionar ponta a ponta antes de polir;
- baixo custo;
- Make como ponte fina;
- integrações perigosas só em homologação controlada;
- atualizar sempre a retomada no GitHub.

## Instrução para novo chat

> Acesse `osvaldosereia/SUCEDOAN12`, leia `docs/RETOMADA-DONA-ANTONIA.md`, `docs/HOMOLOGACAO-WHATSAPP-IMAGEM-FINAL-20260907.md`, `docs/HOMOLOGACAO-WHATSAPP-AUDIO-FINAL-20260907.md` e `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md`. Consulte o estado real no Supabase e Make antes de alterar gates. Continue pela preparação de **liberação gradual/controlada do atendimento real**; não ative `live` nem Bling indiscriminadamente.