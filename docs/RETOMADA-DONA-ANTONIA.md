# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 — Worker V2 automático homologado em WhatsApp real**.

Este é o arquivo **autoritativo** para retomar o projeto. Não planejar do zero. Antes de alterar qualquer gate, auditar o estado real no GitHub, Supabase e Make.

## Documentos principais

- `docs/HOMOLOGACAO-WORKER-V2-20260907.md` — Worker V2 event-driven, provider Vault e prova real WhatsApp;
- `docs/OPERACAO-WHATSAPP-GRADUAL-V1.md` — release gradual, canary, budgets, handoff e emergency stop;
- `docs/HOMOLOGACAO-WHATSAPP-IMAGEM-FINAL-20260907.md` — imagem real;
- `docs/HOMOLOGACAO-WHATSAPP-AUDIO-FINAL-20260907.md` — áudio real final;
- `docs/HOMOLOGACAO-WHATSAPP-AUDIO-20260907.md` — histórico/correção da cadeia transcrição → interpretação;
- `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md` — menu, interativos, texto real e outbound Meta;
- `docs/WHATSAPP-BRIDGE-V3.md` — ponte event-driven;
- `docs/HOMOLOGACAO-OPENAI-20260907.md` — texto/transcrição/visão sintéticos;
- `docs/SALA-COMPRA-MOTOR-COMERCIAL-V1.md`;
- `docs/PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md` — futuro Gestor/Roteirista de Inteligência;
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
8. áudio real ponta a ponta — **HOMOLOGADO**;
9. imagem real ponta a ponta — **HOMOLOGADA**;
10. outbound Meta real com receipt metadata;
11. `Conversation Worker V2` event-driven — **HOMOLOGADO SINTÉTICO E REAL**;
12. provider OpenAI do Worker V2 no Supabase Vault;
13. release gradual/canary/budgets/fallback humano/emergency stop implementados;
14. área Admin `Atendimento IA` preparada para observabilidade/handoff;
15. zero efeito em pedido/Bling durante todas as homologações WhatsApp/Worker V2.

## Próxima etapa exata

**Validar o modo `observe` e o fallback humano antes de qualquer `whatsapp_release_mode=live`.**

Ordem recomendada:

1. revisar o Admin `Atendimento IA` e confirmar métricas/gates/handoffs;
2. testar `observe`: entrada real pode ser registrada, mas sem auto-resposta IA;
3. confirmar que atendimento fora do canary/observe cai em controle humano, não é descartado;
4. testar assumir/resolver handoff e retomada de IA;
5. testar emergency stop pelo caminho administrativo;
6. auditar budgets/limites de volume/tokens e recovery;
7. somente depois preparar um canary `live` mínimo, explicitamente confirmado e com rollback imediato;
8. manter Bling fora até o canary do atendimento estar comprovado;
9. depois homologar **um único pedido real controlado no Bling**;
10. depois migrar `/cadastro/` e avançar CRM/relatórios/recompra/aniversário.

**Não ativar atendimento geral nem Bling indiscriminadamente.**

---

# WORKER V2 — ESTADO OFICIAL

Arquitetura:

```text
ai_jobs pending
→ trigger ai_job_event_dispatch_v2
→ dispatch_conversation_worker_job_v2
→ pg_net
→ conversation-worker-v2
→ claim_conversation_job_v2(job exato)
→ OpenAI
→ finish_conversation_job
→ outbound_jobs quando canal WhatsApp e gates permitem
```

Produção:

```text
conversation-worker-v2 version = 2
verify_jwt = false
custom auth = x-da-worker-key
provider = OpenAI via Vault/service-role
```

Segurança:

- dispatcher nasce fechado;
- job é reclamado por ID exato;
- lease expirado após possível chamada externa não volta cegamente para pending;
- erro/limite inseguro cai em handoff humano;
- provider OpenAI guardado no Supabase Vault;
- healthcheck expõe apenas `provider_configured=true/false`;
- instalador one-shot do provider removido;
- fechamento/expiração de homologação desligam também o dispatcher.

PRs principais:

- #160 — operação gradual, Worker V2, canary, fallback e Admin;
- #161 — provider Vault;
- #162 — correção `extensions.digest` em SECURITY DEFINER.

## Prova sintética automática

Passou usando o trigger real, sem chamada manual ao Worker:

```text
intent = baskets
status = done
attempts = 1
worker_dispatch_attempts = 1
model = gpt-4o-mini
input_tokens = 195
output_tokens = 31
HTTP = 200
```

Dados sintéticos removidos depois.

## Prova WhatsApp real allowlisted

Mensagem:

`Quero uma cesta básica e também preciso de arroz`

Inbound Make:

`6779824 — Dona Antônia - WhatsApp Inbound Controlado v1`

AI job:

`c86a7476-312f-4865-ac70-ad9a437676b2`

Resultado:

```text
status = done
attempts = 1
worker_dispatch_attempts = 1
intent = baskets
model = gpt-4o-mini
input_tokens = 194
output_tokens = 29
```

Resposta:

`Claro. Posso te mostrar as cestas disponíveis e ajudar a personalizar os itens.`

Outbound job:

`240adb9b-ede8-4ed1-bfc6-ecffa0139c63`

Resultado:

```text
status = sent
attempts = 1
delivery_mode = text
dispatch_response_status = 200
provider_message_id = presente
last_error = null
```

Make outbound:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Execução real:

`82b0a21a195a43799b3bd5322a37717f`

Sem erros.

Auditoria do teste:

```text
active_ai_jobs = 0
active_outbound = 0
orders = 0
order_sync_jobs = 0
bling_commands = 0
```

---

# ESTADO SEGURO APÓS A PROVA REAL

Confirmado depois do fechamento:

```text
whatsapp_release_mode = off
whatsapp_inbound_enabled = false
whatsapp_auto_reply_enabled = false
ai_enabled = false
conversation_worker_enabled = false
conversation_worker_dispatch_enabled = false
active_ai_jobs = 0
active_outbound = 0
orders do teste = 0
order_sync_jobs do teste = 0
bling_commands do teste = 0
```

Make inbound `6779824`: **inativo** quando não há teste.

Make outbound `7290488`: pode permanecer ativo; ele só processa jobs legítimos e não cria atendimento sozinho.

Supabase projeto:

`ssbesxgaijknwsjbsbcz`

---

# RELEASE GRADUAL / SEGURANÇA

Modos:

- `off` — fechado;
- `observe` — registrar/controlar sem auto-resposta IA;
- `homologation` — allowlist temporária;
- `live` — somente com confirmação server-side e canary.

Campos principais:

- `whatsapp_release_mode`;
- `whatsapp_inbound_enabled`;
- `whatsapp_auto_reply_enabled`;
- `whatsapp_inbound_since`;
- `ai_enabled`;
- `conversation_worker_enabled`;
- `conversation_worker_dispatch_enabled`;
- `whatsapp_live_canary_percent`;
- `automation_enabled`;
- `outbound_enabled`.

Regras obrigatórias:

- canary inicial 0%;
- não-canary deve ir para controle humano, nunca ser descartado silenciosamente;
- budgets por volume/tokens;
- `review_required`/handoff para estados externos incertos;
- emergency stop desliga inbound, auto-reply, IA, worker e dispatcher;
- anti-backlog obrigatório;
- nunca retry cego se uma chamada externa puder ter ocorrido;
- nunca versionar telefone real, service role, Meta/OpenAI/Bling keys ou webhook secreto.

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

Nunca voltar ao desenho antigo de transcrição → resposta direta.

Voz oficial:

`dona_antonia_marin_b_v1`

- `gpt-4o-mini-tts`;
- `marin`;
- speed 1.0;
- PT-BR natural, mulher adulta, calorosa e próxima;
- sem voz de locutora/URA;
- disclosure apropriado de voz gerada por IA em produção.

---

# WHATSAPP BRIDGE

Inbound oficial:

`6779824 — Dona Antônia - WhatsApp Inbound Controlado v1`

Suporta:

- texto;
- interactive/button;
- áudio;
- imagem;
- download/attach de mídia privada;
- dedupe;
- customer/conversation/session;
- jobs IA condicionais.

Edge inbound:

- `whatsapp-ingest`;
- `whatsapp-ingest-make-v1`.

Outbound oficial:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Fluxo:

```text
outbound_jobs
→ pg_net
→ Make
→ texto OU TTS Marin B
→ Meta
→ Webhook Response
→ reconciliação Postgres
→ sent/provider_message_id/receipt metadata
```

Legado:

`7290290 — LEGACY - NÃO USAR - WhatsApp Outbound HTTP v1`

Manter inativo.

---

# SALA / MOTOR COMERCIAL

Sala oficial:

`/comprar/`

Regras:

- nunca recomendar item já no carrinho;
- histórico do cliente tem peso alto;
- ofertas/afinidade/upsell aumentam score;
- rejeição recente penaliza/exclui;
- máximo inicial de 2 iniciativas proativas;
- “não quero”/“só a cesta” zera pressão;
- pressa → checkout;
- sem recomendação relevante → não oferecer;
- motor comercial determinístico não chama OpenAI/Meta/Bling.

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

# ADMIN DE INTELIGÊNCIA — FUTURO APROVADO, NÃO IMPLEMENTAR AGORA

Documento:

`docs/PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md`

Princípio central:

**A IA entende e conversa; o sistema controla fatos críticos, regras comerciais e ações.**

Planejado:

- conhecimento da empresa;
- FAQs canônicas;
- orientações/guidance;
- procedimentos semiflexíveis;
- regras rígidas;
- mídias oficiais;
- entrega/pagamento/horários;
- simulador antes de publicar;
- versionamento/publicação;
- custos/tokens/qualidade;
- IA auxiliando o próprio administrador a transformar instruções em conhecimento, orientação, procedimento ou regra determinística.

Não transformar tudo em árvore rígida nem tudo em prompt gigante. Usar arquitetura híbrida e recuperação somente do conhecimento relevante para reduzir tokens.

---

# BLING

Ainda fora da liberação WhatsApp.

Não executar writers amplamente.

Somente depois de `observe` + canary de atendimento concluídos:

1. homologar **um único pedido real controlado**;
2. conferir contato;
3. componentes individualizados da cesta;
4. diferença fiscal;
5. estoque;
6. idempotência;
7. confirmação final no WhatsApp;
8. depois ampliar gradualmente.

Workers existentes:

- `scripts/bling-order-writer-v1.mjs`;
- `scripts/bling-stock-writer-v1.mjs`;
- `scripts/bling-product-writer-v1.mjs`.

---

# CRM / EVOLUÇÃO FUTURA

Depois da base operacional/pedido real:

- histórico completo de pedidos;
- relatórios admin;
- recompra personalizada;
- cadência configurável, ideia inicial ~15 dias;
- opt-in/templates Meta quando exigidos;
- aniversário opcional;
- recomendações por perfil/histórico;
- expansão estratégica do carrinho sem insistência.

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
- atualizar sempre esta retomada no GitHub;
- minimizar passos manuais quando puderem ser executados com segurança pelas ferramentas.

## Instrução para novo chat

> Acesse `osvaldosereia/SUCEDOAN12`, leia `docs/RETOMADA-DONA-ANTONIA.md`, `docs/HOMOLOGACAO-WORKER-V2-20260907.md` e `docs/OPERACAO-WHATSAPP-GRADUAL-V1.md`. Consulte o estado real no Supabase e Make antes de alterar gates. Continue pela validação de **observe + fallback humano/Admin**; não ative `live` nem Bling indiscriminadamente.
