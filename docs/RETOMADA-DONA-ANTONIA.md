# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 — homologação WhatsApp real em texto concluída**.

Este é o arquivo **autoritativo** para retomar o projeto em uma nova conversa. Não planejar do zero. Ler primeiro este arquivo e depois consultar o estado real no GitHub, Supabase e Make antes de alterar qualquer gate.

Documentos principais:

- `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md` — auditoria mais recente da homologação real;
- `docs/WHATSAPP-BRIDGE-V3.md` — arquitetura da ponte WhatsApp;
- `docs/HOMOLOGACAO-OPENAI-20260907.md` — homologação OpenAI texto/áudio/imagem sintética;
- `docs/SALA-COMPRA-MOTOR-COMERCIAL-V1.md`;
- `docs/CONVERSATION-WORKER-V1.md`;
- `docs/EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`;
- `docs/ARQUITETURA-DONA-ANTONIA-V2.md` — histórico, não fonte principal.

---

## PONTO EXATO DE RETOMADA

### Concluído

1. **Sala de Compra + motor comercial determinístico**;
2. **homologação OpenAI sintética**: texto, transcrição e visão;
3. **TTS real no WhatsApp** e escolha da voz oficial `dona_antonia_marin_b_v1`;
4. **WhatsApp Bridge v3** event-driven;
5. **entrada real WhatsApp allowlisted**;
6. **menu determinístico real**;
7. **botões interativos reais**;
8. **IA real em texto ponta a ponta**;
9. **outbound real Meta ponta a ponta**.

### Próximo passo

**Homologar áudio real inbound**, ainda somente no telefone de teste allowlisted:

```text
WhatsApp áudio real
→ Meta
→ Make inbound
→ download da mídia
→ Storage privado Supabase
→ job transcription
→ gpt-4o-mini-transcribe
→ decisão/reply
→ outbound WhatsApp
```

Primeiro validar resposta em **texto** ao áudio. Depois testar a resposta em **áudio Marin B**. Em seguida testar foto real → visão.

**Não liberar `whatsapp_release_mode=live` antes de fechar texto + áudio + imagem e auditar tudo.**

---

## Homologação real WhatsApp — resultado atual

Documento detalhado:

`docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md`

### Entrada real e allowlist

A primeira mensagem real foi bloqueada corretamente porque havia divergência de um dígito na allowlist. O backend retornou `homologation_phone_blocked` antes de criar cliente/conversa.

A allowlist foi então corrigida usando o número confirmado pela própria Meta. Nunca versionar telefone completo em documentação/código.

### Conversa real de homologação

Conversation:

`ff5c1e73-f3ed-4b88-8eba-b6e3a9883941`

O teste `Oi` confirmou:

- Meta → Make → Supabase;
- criação/identificação de cliente;
- conversa;
- sessão compartilhada;
- menu com Ver cestas / Pagamento / Ofertas;
- resposta sem chamada OpenAI.

### Hotfix PR #147 — campos do Make

A homologação revelou que o cenário Make atual envia campos genéricos:

- `media_id`;
- `caption`;
- `interactive_id`;
- `interactive_title`.

O adaptador antigo ainda esperava aliases específicos. Foi corrigido para aceitar ambos.

PR #147 incorporada ao `main`.

`whatsapp-ingest-make-v1` em produção: **v2**.

Essa correção também é necessária para áudio/imagem.

### Hotfix PR #148 — novo `Oi` em conversa existente

Um `Oi` enviado depois de a conversa já existir era persistido, mas com IA desligada podia retornar `should_reply=false`.

Foi criada a migration:

`20260907201500_whatsapp_greeting_menu_v1.sql`

Saudações/comandos curtos reabrem o menu determinístico sem gastar IA:

- oi/olá;
- bom dia/boa tarde/boa noite;
- menu/início/iniciar/começar.

PR #148 incorporada ao `main`.

### Botão Pagamento

Evento real:

`interactive_id=menu_pagamento`

Resposta real aceita pela Meta:

`O pagamento é feito somente na entrega. Se quiser, posso continuar e montar seu pedido agora.`

### IA real em texto — SUCESSO

Mensagem real:

`Quero uma cesta básica e também preciso de arroz`

Message row:

`e107c219-7581-40a0-8a91-891ef105f277`

AI job:

`e31ce832-e780-4888-8681-a84bc4c61b1c`

Antes do processamento havia exatamente 1 job pending/processing.

Foi usado um workflow temporário fail-closed com:

- ID exato do job;
- exatamente 1 pending;
- `job_type=conversation`;
- `AI_JOB_LIMIT=1`;
- testes antes do provider;
- pós-validação exigindo o mesmo job `done`.

GitHub Actions run:

`34159364103`

Resultado:

`success`

OpenAI:

- modelo `gpt-4o-mini`;
- provider request `req_f7b1d3da0599432bbd366f08b45d2dcf`;
- input tokens `194`;
- output tokens `31`;
- attempts `1`;
- status `done`.

Interpretação:

```json
{
  "intent": "baskets",
  "description": "Pedido de cesta básica e arroz."
}
```

Resposta criada:

`Claro. Posso te mostrar as cestas disponíveis e ajudar a personalizar os itens.`

Reply message:

`910690f4-ea6a-417a-92cd-3c448d6bc005`

Outbound job:

`83c966ea-59b4-43d2-bebf-d2f36db558bc`

### Outbound real event-driven — SUCESSO

Make oficial:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Execution:

`916fafa0ee5a4e6c8c8c8e3141f19f4f`

Meta devolveu um `wamid` real; o webhook respondeu `200`; o Postgres reconciliou:

```text
outbound status = sent
provider_message_id = presente
dispatch_response_status = 200
review_required = 0
```

Nenhum retry cego foi executado.

### Hotfix de rastreabilidade pós-envio

O teste real revelou que o `outbound_job` recebia o `provider_message_id`, mas a linha em `messages` ainda não recebia automaticamente:

- `whatsapp_message_id`;
- `delivery_status=sent`;
- `conversations.last_outbound_at`.

Correção versionada em:

`20260907203500_whatsapp_outbound_message_receipt_v1.sql`

O `finish_outbound_job` passa a persistir esses metadados. A atualização de metadata nunca deve transformar um envio real em retry.

Existe também backfill genérico para envios `seller_message` já confirmados.

---

## Estado seguro após o teste de texto

A IA foi desligada novamente após o único job real:

```text
ai_enabled = false
conversation_worker_enabled = false
ai_jobs pending = 0
ai_jobs processing = 0
ai_jobs error = 0
outbound pending = 0
outbound processing = 0
outbound review_required = 0
```

A homologação allowlisted é temporária e possui cron de expiração. Sempre consultar `get_whatsapp_bridge_health_v1()` antes de assumir que ainda está aberta.

Quando não estiver executando um teste ativo, preferir fechar com:

`close_whatsapp_homologation_v1()`

---

## Arquitetura oficial

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
- **OpenAI:** conversa, transcrição, visão e TTS; nunca decide preço/estoque/pedido;
- **Firebase:** lookup legado temporário de produtos; não expandir.

---

## WhatsApp Bridge v3

### Inbound oficial

Make:

`6779824 — Dona Antônia - WhatsApp Inbound Controlado v1`

Suporta:

- texto;
- interactive/button;
- áudio;
- imagem;
- mídia privada;
- dedupe;
- customer/conversation;
- jobs IA condicionais.

Edge:

- `whatsapp-ingest` v3;
- `whatsapp-ingest-make-v1` v2.

### Outbound oficial

Make:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Fluxo:

```text
outbound_jobs
→ Postgres
→ pg_net
→ webhook Make
→ Meta texto OU OpenAI Marin B + Meta áudio
→ Webhook Response
→ net._http_response
→ reconciliação Postgres
→ sent/provider_message_id
```

Sem polling e sem callback HTTP Make → Supabase.

Estado ambíguo:

`delivery_uncertain_review_required`

Nunca retry cego se pode ter ocorrido envio externo.

### Legado

`7290290 — LEGACY - NÃO USAR - WhatsApp Outbound HTTP v1`

Manter inativo.

`whatsapp-outbound-v1` v4 permanece apenas para health/deprecation; claim/finish HTTP legado retorna bloqueio.

---

## Release gates / segurança

Campos:

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
- `observe` — entrada observada/controlada;
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

Nenhum telefone real, chave OpenAI, chave Meta, service role ou segredo do Make deve ser versionado.

---

## Conversation Worker

Arquivos:

- `scripts/conversation-worker-v1.mjs`;
- `scripts/lib/conversation-core-v1.mjs`;
- `.github/workflows/conversation-worker-v1.yml`.

Modelos base:

- conversa/visão: `gpt-4o-mini`;
- transcrição: `gpt-4o-mini-transcribe`;
- TTS: `gpt-4o-mini-tts`.

O worker principal continua manual por `workflow_dispatch` neste estágio. Para homologações pontuais pode ser usado workflow one-shot fail-closed, removido imediatamente após o teste.

Nunca repetir automaticamente uma chamada paga se a conclusão no banco ficar incerta.

---

## Voz oficial

Perfil:

`dona_antonia_marin_b_v1`

Configuração:

- modelo `gpt-4o-mini-tts`;
- voz `marin`;
- velocidade `1.0`;
- português brasileiro natural;
- mulher adulta;
- calorosa, próxima e tranquila;
- não soar como locutora, URA, anúncio ou telemarketing;
- pausas e variações naturais.

O usuário escolheu B após comparação real no WhatsApp.

Na produção, manter disclosure apropriado de que a voz é gerada por IA; não projetar o sistema para enganar o cliente sobre a natureza automatizada da voz.

---

## Sala de Compra / motor comercial

Sala oficial:

`/comprar/`

Edge:

`shopping-room-sales-v1`

Regras principais:

- nunca recomendar item já no carrinho;
- histórico do cliente tem peso alto;
- oferta/afinidade/upsell aumentam score;
- rejeição recente exclui/penaliza;
- máximo inicial de 2 iniciativas proativas;
- “não quero” / “só a cesta” zera pressão;
- pressa → checkout;
- sem recomendação relevante → não oferecer.

O motor comercial é determinístico e não chama OpenAI/Meta/Bling.

---

## Cestas / regra comercial e fiscal

- cesta tem preço comercial próprio;
- não é soma dos componentes;
- cliente não vê preço individual dos componentes;
- Bling recebe os componentes individualizados;
- diferença positiva → Outras despesas;
- diferença negativa → desconto;
- IA nunca calcula diferença fiscal.

Pagamento: **somente na entrega**.

Operação: **somente entrega**.

---

## Bling

Bling continua fora da homologação WhatsApp.

Workers existentes:

- `scripts/bling-order-writer-v1.mjs`;
- `scripts/bling-stock-writer-v1.mjs`;
- `scripts/bling-product-writer-v1.mjs`.

Próximo teste Bling real só depois de texto + áudio + imagem do WhatsApp estarem fechados ponta a ponta.

---

## Produtos / Firebase

Não importar todo o legado em massa.

Fluxo desejado:

```text
produto físico
→ EAN
→ Firebase apenas como lookup legado
→ conferência humana
→ Supabase
→ fila Bling
```

`/cadastro/` ainda deve ser migrado para Supabase depois da homologação operacional.

---

## CRM / evolução comercial futura

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

## Ordem de execução daqui para frente

1. incorporar/aplicar o hotfix de receipt metadata;
2. abrir homologação allowlisted apenas quando o telefone de teste estiver pronto;
3. áudio real inbound → download → Storage → transcrição → resposta em texto;
4. áudio real inbound → resposta TTS Marin B;
5. imagem real → visão → resposta;
6. fechar homologação e auditar zero jobs incertos;
7. decidir liberação gradual do WhatsApp;
8. homologar um pedido Bling real;
9. confirmação final do pedido no WhatsApp;
10. migrar `/cadastro/`;
11. CRM/relatórios/recompra/aniversário;
12. acabamento final/home/campanhas.

---

## NÃO liberado ainda

- `whatsapp_release_mode=live`;
- IA geral para todos os clientes;
- marketing/recompra em massa;
- pedido Bling indiscriminado;
- writers Bling amplamente automáticos;
- remoção do Firebase antes da migração;
- desconto universal sem lote/preço controlado.

---

## Regra de trabalho

Preferências do usuário para este projeto:

- programar blocos grandes por rodada;
- padrão profissional e modular;
- análise global do sistema;
- fazer funcionar ponta a ponta antes de polir;
- baixo custo;
- Make como ponte fina;
- integrações perigosas só em homologação controlada;
- atualizar sempre a retomada no GitHub.

### Instrução para novo chat

> Acesse `osvaldosereia/SUCEDOAN12`, leia `docs/RETOMADA-DONA-ANTONIA.md` e `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md`, consulte o estado real no Supabase e Make e continue exatamente do ponto indicado. Não assuma gates; audite antes. Programe o máximo possível por rodada mantendo fail-closed fora de homologação controlada.
