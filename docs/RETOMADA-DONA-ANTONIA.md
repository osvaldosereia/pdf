# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 — Etapa 3 WhatsApp Bridge v3 incorporada ao main**.

Este é o arquivo **autoritativo** para retomar o projeto em uma nova conversa. Não voltar a planejar do zero. Primeiro ler este arquivo e `docs/WHATSAPP-BRIDGE-V3.md`, depois consultar o estado real no GitHub, Supabase e Make antes de alterar qualquer gate.

Documentos importantes:

- `docs/WHATSAPP-BRIDGE-V3.md`
- `docs/HOMOLOGACAO-OPENAI-20260907.md`
- `docs/SALA-COMPRA-MOTOR-COMERCIAL-V1.md`
- `docs/CONVERSATION-WORKER-V1.md`
- `docs/EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`
- `docs/ARQUITETURA-DONA-ANTONIA-V2.md` — contexto histórico, não fonte principal.

---

## PONTO EXATO DE RETOMADA

As etapas abaixo estão concluídas tecnicamente:

1. **Sala de Compra + motor comercial**;
2. **homologação OpenAI texto/áudio/imagem**;
3. **infraestrutura WhatsApp Bridge v3**.

A Etapa 3 foi desenvolvida na PR #146 e incorporada ao `main` por squash:

`1ee6003834d8cba8eab52d4fb8d00519085aaea9`

CI da PR passou integralmente antes do merge: worker, bridge WhatsApp, banco local, DOM/Sala, motor comercial, sintaxe JS e `deno check`.

Produção no fechamento desta atualização:

- `whatsapp-ingest` **v3**;
- `whatsapp-ingest-make-v1` **v1**;
- `whatsapp-outbound-v1` **v4**;
- Make inbound `6779824 — Dona Antônia - WhatsApp Inbound Controlado v1` — **inactive**;
- Make outbound oficial `7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3` — **active**;
- Make outbound legado `7290290 — LEGACY - NÃO USAR - WhatsApp Outbound HTTP v1` — **inactive**.

Estado final auditado no Supabase:

```text
whatsapp_release_mode = off
whatsapp_inbound_enabled = false
whatsapp_auto_reply_enabled = false
ai_enabled = false
conversation_worker_enabled = false
allowlist ativa = 0
seller_message pending = 0
seller_message processing = 0
seller_message error = 0
ai_jobs pending/processing/error = 0
```

Auditoria adicional da rodada:

```text
orders criados na última hora = 0
order_sync_jobs criados na última hora = 0
outbound não-conversacional criado na última hora = 0
mensagens WhatsApp reais processadas na etapa = 0
```

Healthcheck Supabase → Make v3 retornou HTTP 200:

```json
{"ok":true,"event":"healthcheck","sent":false}
```

A allowlist temporária foi testada apenas com telefone fictício: o telefone allowlisted passou e outro foi bloqueado. A janela foi fechada imediatamente e os gates voltaram para `off`.

### Próxima ação necessária

A próxima fase é uma **homologação real somente no telefone de teste do usuário**. Não falta configuração manual de conta/chave.

Quando o usuário estiver pronto para mandar uma mensagem:

1. chamar `get_whatsapp_bridge_health_v1()`;
2. confirmar release `off` e filas vazias;
3. armar `arm_whatsapp_homologation_v1(<telefone de teste>, 30–60)`;
4. ativar Make inbound `6779824`;
5. pedir ao usuário para enviar **uma mensagem de texto nova**;
6. validar ingest + welcome/menu determinístico com IA desligada;
7. somente depois ligar IA/worker dentro da allowlist;
8. testar texto IA;
9. testar áudio inbound → transcrição → resposta Marin B;
10. testar imagem inbound → visão;
11. fechar `close_whatsapp_homologation_v1()`;
12. desligar inbound ao terminar;
13. auditar zero efeito Bling e zero job incerto.

**Não liberar `whatsapp_release_mode=live` antes dessa homologação.**

A autorização Supabase→Make que chegou a ser iniciada como plano B não é necessária na arquitetura v3 e pode ser ignorada.

---

## Objetivo do projeto

Construir o sistema operacional e comercial da **Dona Antônia Cestas e Supermercado**, com atendimento altamente automatizado pelo WhatsApp e uma **Sala de Compra** visual integrada à mesma conversa/carrinho.

Experiência desejada:

- comprar pelo WhatsApp, inclusive áudio;
- usar a Sala quando o visual ajuda;
- alternar WhatsApp ↔ Sala sem perder carrinho/conversa;
- escolher/personalizar cestas;
- adicionar produtos complementares;
- usar texto, áudio e foto;
- informar cadastro/endereço;
- revisar e confirmar pedido;
- receber confirmação final pelo WhatsApp somente após o pedido oficial chegar ao Bling.

Princípio comercial:

> IA conversa e vende; interface apresenta; backend valida; Bling registra.

A automação deve ser relevante, contextual e parar de insistir quando o cliente demonstra desinteresse.

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

- **GitHub:** código, migrations, CI, deploys e documentação.
- **Supabase:** banco operacional, Storage, Auth, filas, funções determinísticas e estado de conversa.
- **Make:** ponte fina com Meta e, no áudio, com TTS; nunca backend principal.
- **Bling:** ERP oficial e pedido oficial.
- **OpenAI:** conversa/transcrição/visão/TTS; nunca preço, estoque ou criação de pedido.
- **Firebase:** lookup legado temporário de produtos; não expandir como banco novo.

---

## Etapa 1 — Sala de Compra + motor comercial

Concluída.

Sala oficial:

`/comprar/`

Motor comercial:

- não recomenda item já no carrinho;
- histórico do cliente tem peso alto;
- afinidade/oferta/upsell aumentam score;
- rejeição recente exclui/penaliza;
- máximo inicial de 2 iniciativas proativas por compra;
- “não quero” / “só a cesta” reduz pressão a zero;
- pressa → checkout;
- sem recomendação forte → não oferecer.

Edge dedicada:

`shopping-room-sales-v1`

O motor comercial é determinístico e não chama OpenAI, Meta ou Bling.

---

## Etapa 2 — OpenAI

Concluída com chamadas reais controladas para:

- texto;
- transcrição;
- visão.

Worker:

- `scripts/conversation-worker-v1.mjs`
- `scripts/lib/conversation-core-v1.mjs`

Modelos base:

- conversa/visão: `gpt-4o-mini`;
- transcrição: `gpt-4o-mini-transcribe`;
- TTS: `gpt-4o-mini-tts`.

### Voz oficial

O usuário ouviu testes reais no WhatsApp e escolheu:

`dona_antonia_marin_b_v1`

- voz `marin`;
- mulher adulta;
- português brasileiro natural;
- calorosa/tranquila;
- sem tom de locutora, URA ou anúncio;
- ritmo e pausas naturais.

O TTS usa chamada direta ao endpoint de fala para permitir `instructions` completas.

---

## Etapa 3 — WhatsApp Bridge v3

Detalhes completos: `docs/WHATSAPP-BRIDGE-V3.md`.

### Inbound

Make:

`6779824 — Dona Antônia - WhatsApp Inbound Controlado v1`

Suporta:

- texto;
- interativos;
- áudio;
- imagem;
- mídia privada;
- dedupe;
- customer/conversation;
- jobs de IA condicionais.

Os módulos HTTP v4 do inbound foram corrigidos com os campos avançados exigidos pelo runtime. Um cenário legado de health confirmou que essa configuração elimina o `BundleValidationError`.

O inbound foi ativado e desativado sem erro após a correção, com release do banco fechado durante todo o teste.

### Outbound oficial v3

Make:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Fluxo:

```text
outbound_jobs
→ trigger Postgres
→ pg_net
→ webhook Make
→ Meta texto OU OpenAI Marin B + Meta áudio
→ Webhook Response
→ net._http_response
→ reconciliação Postgres
→ provider_message_id
```

Não há polling.

Não há callback HTTP Make→Supabase.

Só marca enviado com resposta 2xx válida, `job_id` exato, `delivery_mode` exato e `provider_message_id` não vazio.

Estado ambíguo após possível envio:

`delivery_uncertain_review_required`

Sem retry cego.

### Outbound legado

`7290290 — LEGACY - NÃO USAR - WhatsApp Outbound HTTP v1`

Inativo. Não reativar.

`whatsapp-outbound-v1` v4 também bloqueia `claim/finish` legado com HTTP 410.

---

## Release gates / segurança WhatsApp

Campos principais:

- `whatsapp_release_mode`;
- `whatsapp_inbound_enabled`;
- `whatsapp_auto_reply_enabled`;
- `whatsapp_inbound_since`;
- `ai_enabled`;
- `conversation_worker_enabled`.

Modes:

- `off` — fechado;
- `observe` — ingest permitido, respostas ainda controladas;
- `homologation` — somente allowlist temporária;
- `live` — geral, ainda sujeito aos demais gates.

### Anti-backlog

Mensagens anteriores ao cutover são recusadas antes de criar cliente/conversa.

### Homologação allowlisted

Tabela server-only:

`whatsapp_test_allowlist`

RPCs:

- `whatsapp_release_decision(...)`;
- `arm_whatsapp_homologation_v1(...)`;
- `close_whatsapp_homologation_v1()`;
- `expire_whatsapp_homologation_v1()`.

A decisão é aplicada no banco antes do core de ingest.

Nenhum telefone de teste deve ser versionado.

Cron fecha a janela automaticamente quando expira.

### Health / emergency stop

RPCs:

- `get_whatsapp_bridge_health_v1()`;
- `whatsapp_bridge_emergency_stop_v1(reason)`;
- `dispatch_whatsapp_outbound_healthcheck_v3()`;
- `reconcile_whatsapp_outbound_responses_v3()`;
- `recover_whatsapp_outbound_dispatch()`.

Emergency stop:

- fecha release/inbound/auto/IA/worker;
- desativa allowlist;
- cancela jobs ainda não enviados;
- jobs em processing vão para revisão.

---

## Supabase

Projeto:

- ref `ssbesxgaijknwsjbsbcz`;
- região São Paulo `sa-east-1`;
- PostgreSQL 17.

Segurança:

- nunca versionar service role ou chaves Meta/Bling/OpenAI;
- server-only fechado para anon/authenticated;
- Edge pública apenas com autenticação custom adequada;
- mídia privada;
- idempotência obrigatória.

---

## Bling

Bling continua ERP oficial, mas ficou **fora da Etapa 3**.

Workers existentes:

- `scripts/bling-order-writer-v1.mjs`;
- `scripts/bling-stock-writer-v1.mjs`;
- `scripts/bling-product-writer-v1.mjs`.

Pedido real será homologado somente depois do WhatsApp ponta a ponta.

### Regra fiscal/comercial das cestas

- cesta tem preço comercial próprio;
- preço não é soma dos componentes;
- cliente não vê preço individual;
- Bling recebe componentes individualizados;
- diferença positiva → Outras despesas;
- diferença negativa → desconto;
- IA nunca calcula a diferença.

---

## Produtos / Firebase

Não importar todo legado em massa.

Fluxo:

```text
produto físico
→ EAN
→ Firebase apenas como lookup legado
→ conferência humana
→ Supabase
→ fila Bling
```

A página `/cadastro/` ainda deve ser migrada para Supabase em etapa posterior.

---

## CRM / evolução comercial futura

Requisitos em `docs/EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`:

- histórico completo de pedidos;
- relatórios admin;
- recompra personalizada;
- cadência configurável, ideia inicial ~15 dias;
- opt-in/template Meta quando necessário;
- aniversário opcional para benefício mensal;
- recomendações por perfil/histórico;
- expansão estratégica do carrinho sem insistência;
- regras determinísticas de validade/desconto.

Não ativar campanhas em massa agora.

---

## URLs operacionais

- `/admin/`
- `/contagem/`
- `/cadastro/` — legado a migrar
- `/comprar/`
- `/catalogo/` → redireciona para `/comprar/` preservando token.

Pagamento: somente na entrega.

Operação: somente entrega.

---

## NÃO liberado ainda

- atendimento IA geral para todos os clientes;
- `whatsapp_release_mode=live`;
- marketing/recompra em massa;
- criação indiscriminada de pedido Bling;
- writers Bling amplamente automáticos;
- remoção do Firebase antes da migração;
- desconto automático universal sem controle adequado de lote/preço.

---

## Ordem após homologar o WhatsApp

1. texto/áudio/imagem allowlisted;
2. fechar homologação e auditar;
3. decidir liberação gradual do canal;
4. homologar um pedido Bling real controlado;
5. confirmação final do pedido no WhatsApp;
6. migrar `/cadastro/` para Supabase;
7. CRM/relatórios/recompra/aniversário;
8. acabamento final/home/campanhas.

---

## Regra de trabalho

O usuário pediu:

- grandes blocos por rodada;
- código profissional e modular;
- análise global do projeto;
- funcionamento ponta a ponta antes do polimento;
- baixo custo;
- Make fino;
- integrações perigosas somente em validação controlada;
- andamento sempre atualizado no GitHub.

### Instrução para um novo chat

> Acesse `osvaldosereia/SUCEDOAN12`, leia `docs/RETOMADA-DONA-ANTONIA.md` e `docs/WHATSAPP-BRIDGE-V3.md`, consulte o estado real no Supabase e Make e continue exatamente do ponto indicado. Programe o máximo possível por rodada, mantendo os gates fechados fora de homologação controlada.
