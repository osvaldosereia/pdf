# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 local / 08/09/2026 UTC — canary real WhatsApp `live=1%` ATIVO; PR #175 endurecida e CI verde**.

Este é o arquivo **autoritativo** para retomar o projeto. Antes de qualquer alteração, auditar GitHub, Supabase e Make. Não planejar do zero.

## Documentos principais

- `docs/CANARY-LIVE-1PCT-20260907.md` — estado e regras do canary real atual;
- `docs/HOMOLOGACAO-OBSERVE-CANARY-PREFLIGHT-20260907.md` — observe real, anti-backlog, fallback, preflight e live 1% sintético;
- `docs/HOMOLOGACAO-WORKER-V2-20260907.md` — Worker V2 automático + provider Vault + prova real;
- `docs/OPERACAO-WHATSAPP-GRADUAL-V1.md` — release gradual, budgets, fallback humano e emergency stop;
- `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md`;
- `docs/HOMOLOGACAO-WHATSAPP-AUDIO-FINAL-20260907.md`;
- `docs/HOMOLOGACAO-WHATSAPP-IMAGEM-FINAL-20260907.md`;
- `docs/WHATSAPP-BRIDGE-V3.md`;
- `docs/SALA-COMPRA-MOTOR-COMERCIAL-V1.md`;
- `docs/PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md` — futuro Gestor/Roteirista de Inteligência;
- `docs/ANALISE-WHATSAPP-FLOWS-COMERCIO-CONVERSACIONAL-V1.md` — análise dos relatórios de Flow/Magalu e estratégia aprovada para aperfeiçoamento futuro;
- `docs/WHATSAPP-FLOW-TRANSPORT-V1.md` — fundação criptografada + replay guard + máquina de estados do Flow, ainda dormente.

---

# MARCO MAIS RECENTE — PR #175 / FLOW DORMENTE

PR aberta:

`#175 — Dona Antônia: fundação criptografada do WhatsApp Flow Data Exchange`

Branch:

`codex/whatsapp-flow-transport-foundation-20260908`

## Falha `deno check` encontrada e corrigida

A falha específica vinha da tipagem mais estrita do WebCrypto no Deno 2.x: valores `Uint8Array<ArrayBufferLike>` usados como `BufferSource` em `crypto.subtle.importKey/decrypt/encrypt/digest` deixaram de satisfazer o type-check em alguns pontos.

Correção principal:

`a93c7b712d1153846288aca376f3a431a093b2cc` — `fix: normalizar BufferSource no WebCrypto Deno 2.9`

Complemento de teste:

`a63607ec0dec42e3d0f0dbdc4c83aa7b77d190c6` — `test: normalizar BufferSource no round-trip Flow`

A solução normaliza cada entrada WebCrypto para um `ArrayBuffer` próprio antes da chamada criptográfica. Depois disso o `deno check` das Edge Functions e o `deno test` de `crypto.test.ts` passaram.

## CI residual do Admin isolado corretamente

O workflow genérico `Testar Admin V2 definitivo` também aparecia vermelho no mesmo SHA, mas a causa era um conjunto de validações legadas de `/admin`, Criador de Canecas e Caneca Print, sem relação funcional com o Flow.

A PR acionava esse workflow apenas porque havia alterado `admin/config.js` para adicionar uma configuração que o frontend atual nem consumia. O arquivo foi restaurado exatamente ao conteúdo de `main` no commit:

`c16f465969abd940029e4665c9d318b811fb8584` — `ci: isolar PR Flow do Admin legado`

Assim a PR deixou de carregar uma alteração desnecessária em `admin/**` e o workflow legado deixou de ser um falso bloqueio desta entrega.

## Hardening adicional implementado

Commit funcional validado:

`57eb48963b5c14665a17700bd37666b4ddaf9b38` — replay/state machine/budget Flow.

A fundação agora inclui, ainda sem ativação:

- `whatsapp_flow_request_guard` com fingerprint SHA-256 do envelope criptografado;
- nenhuma persistência de body, `flow_token`, `encrypted_flow_data`, chave ou payload descriptografado no guard;
- replay explícito `claimed/replay` com TTL de 24 horas;
- `flow_current_screen`;
- `flow_state_version`;
- `flow_last_request_fingerprint`;
- budget padrão `whatsapp_flow_max_exchanges_per_session = 40`;
- transição válida `INIT → BASKET_EDIT → BASKET_REVIEW`;
- salto/stale transition rejeitado com `flow_transition_invalid`;
- replay reconhecido reconstrói resposta read-only sem avançar estado novamente;
- takeover humano rechecado sob lock imediatamente antes da regra de negócio;
- budget excedido falha fechado;
- `BASKET_REVIEW` continua com `write_enabled=false` e `flow_cart_apply_not_enabled`;
- nenhum carrinho, pedido ou Bling é alterado.

CI do commit funcional `57eb489` passou integralmente:

- testes anteriores de WhatsApp;
- banco local/PGlite;
- orquestrador/experimentos;
- `test-whatsapp-flow-transport-v1.mjs` com replay/state machine/budget;
- Shopping Room tests;
- `node --check`;
- `deno check` de todas as Edge Functions relevantes;
- `deno test supabase/functions/whatsapp-flow-data-exchange-v1/crypto.test.ts`.

## Estado das migrations/produção do Flow

As migrations da PR #175 **não estão aplicadas em produção** neste marco:

```text
20260908010000 = não aplicada
20260908010100 = não aplicada
```

Portanto o hardening está somente na PR/código. Nenhum endpoint Flow novo foi ativado para cliente.

Produção continua com:

```text
experience_orchestrator_enabled = false
whatsapp live canary = 1%
```

Não aumentar canary, não publicar Flow, não registrar/chavear Data Exchange na Meta e não ativar Bling sem etapa de homologação/autorização correspondente.

---

# PONTO EXATO DE RETOMADA

## Estado atual: CANARY REAL ATIVO

Autorização explícita do proprietário recebida para abrir **`live=1%`**, mantendo Bling fora.

Corte do inbound:

```text
2026-09-07T23:48:18.455344+00:00
```

Produção:

```text
whatsapp_release_mode = live
whatsapp_live_canary_percent = 1
whatsapp_inbound_enabled = true
whatsapp_auto_reply_enabled = true
ai_enabled = true
conversation_worker_enabled = true
conversation_worker_dispatch_enabled = true
human_fallback_enabled = true
experience_orchestrator_enabled = false
emergency_stop_reason = null
```

Make:

```text
inbound 6779824 = active
outbound 7290488 = active
legacy outbound 7290290 = inactive
```

## Auditoria real mais recente do canary

Desde o cutover:

```text
messages = 3
inbound = 3
outbound messages = 0
conversations = 1
cohort = human_control
bucket = 89
ai_jobs = 0
outbound_jobs = 0
handoffs = 1
handoffs open = 1
orders = 0
order_sync = 0
ai_usage_events = 0
input_tokens = 0
output_tokens = 0
estimated_ai_cost = 0
critical_ops_events = 0
```

A conversa real observada está corretamente em:

```text
conversation.status = needs_human
mode = human
human_required = true
handoff.status = open
handoff.reason = live_canary_human_control
priority = 2
```

Tipos inbound observados, sem registrar PII nesta documentação:

```text
text
location
other
```

O bucket `89` está fora do 1%, portanto o sistema fez exatamente o esperado: ingeriu, preservou a conversa e transferiu para controle humano **sem criar job de IA e sem outbound automático**.

**Não assumir, resolver ou fechar automaticamente esse handoff. Preservar o atendimento humano já aberto.**

No Make, as execuções inbound observadas após o cutover ficaram `success`; o cenário outbound event-driven não teve execução no período auditado, coerente com `human_control`.

### Próxima ação exata

**Continuar monitorando os primeiros eventos reais do canary e manter a PR #175 somente como fundação dormente até revisão/merge seguro.**

Em cada rodada:

1. auditar mensagens desde o cutover;
2. identificar cohort `ai_canary` ou `human_control`;
3. conferir Worker V2/jobs IA;
4. conferir outbound Meta/receipt;
5. conferir `human_handoffs` e preservar qualquer atendimento humano em andamento;
6. conferir erros/review_required;
7. conferir tokens/custos;
8. confirmar `orders=0`, `order_sync=0` e Bling fora;
9. conferir `experience_orchestrator_enabled=false` e nenhum gate Flow ativo;
10. se houver comportamento duvidoso, usar emergency stop;
11. **não aumentar acima de 1% sem nova avaliação explícita**.

Não fechar o canary automaticamente só porque não houve mensagem imediata. Não expandir o percentual sem evidência real suficiente.

---

# PREFLIGHT LIVE — OBRIGATÓRIO

PR #169, merge:

`fcfa6c9d4491368931ca27911b39a4f9fef1d301`

Migration:

`20260907234000_whatsapp_live_canary_preflight_v1.sql`

Funções oficiais:

- `whatsapp_live_preflight_v1(canary_percent)`;
- `whatsapp_canary_bucket_v1(phone)`;
- `configure_whatsapp_release_v1(...)` exige preflight verde antes de `live`.

O preflight bloqueia live se houver:

- AI pending/processing;
- AI em review;
- outbound pending/processing;
- outbound `review_required`;
- handoff open/claimed;
- allowlist de teste ativa;
- emergency stop pendente;
- fallback humano desligado;
- worker/ingest/provider secrets ausentes;
- canary inválido;
- gates globais inconsistentes.

Imediatamente antes da abertura real, `whatsapp_live_preflight_v1(1)` retornou `ready=true` e o próprio `configure_whatsapp_release_v1` repetiu esse preflight antes de abrir os gates.

---

# REGRA DO CANARY 1%

Bucket determinístico 0–99.

```text
bucket < canary_percent → ai_canary
bucket fora do percentual → human_control
```

No canary de 1%:

- bucket 0 → IA automática permitida;
- buckets 1–99 → ingest permitido, mas atendimento humano;
- não-canary nunca é simplesmente descartado;
- não aumentar o percentual para fazer um telefone específico cair na IA.

A prova sintética `live=1%` com Make inbound desligado já confirmou bucket 0 → `ai_canary` e bucket alto → `human_control`.

---

# OBSERVE/FALLBACK HUMANO — HOMOLOGADOS

Observe real temporário/allowlisted passou com:

```text
mode = human
should_reply = false
ai_job = null
conversation.status = needs_human
human_required = true
automation_cohort = observe
human_handoff = open
```

O Admin mostrou o handoff, que foi assumido e resolvido pelo backend administrativo.

Bug encontrado no primeiro teste real: `queue_human_handoff_v1` exige `smallint`, mas o wrapper passava integer. Corrigido pela PR #168, merge `746de544fe25fa107335402071c9a5827c3740db`, migration `20260907232500_whatsapp_observe_handoff_smallint_fix.sql`.

Anti-backlog também foi provado em produção: evento antigo retornou `before_whatsapp_cutover` e não persistiu nada.

---

# WORKER V2 — OFICIAL

```text
ai_jobs pending
→ trigger ai_job_event_dispatch_v2
→ pg_net
→ conversation-worker-v2
→ claim por job_id exato
→ OpenAI
→ finish_conversation_job
→ outbound event-driven quando permitido
```

Produção:

```text
conversation-worker-v2 = v2
provider OpenAI = Supabase Vault
custom server-to-server auth
```

Prova real anterior:

```text
status = done
attempts = 1
worker_dispatch_attempts = 1
intent = baskets
model = gpt-4o-mini
input_tokens = 194
output_tokens = 29
outbound = sent
Meta HTTP = 200
orders = 0
order_sync = 0
bling = 0
```

---

# WHATSAPP — HOMOLOGAÇÕES CONCLUÍDAS

- texto real: homologado;
- áudio real: homologado;
- transcrição → interpretação em dois jobs: obrigatória;
- TTS Marin B real: homologado;
- imagem real/visão: homologada;
- outbound event-driven + receipt Meta: homologado;
- Worker V2 automático: homologado;
- observe/fallback humano: homologado;
- preflight/canary sintético: homologado;
- **canary real 1%: ativo e em observação**.

Voz oficial:

`dona_antonia_marin_b_v1` — `gpt-4o-mini-tts`, `marin`, speed 1.0.

Arquitetura de áudio obrigatória:

```text
transcription
→ salva transcript/body_text
→ cria job conversation
→ conversation interpreta
→ resposta controlada
→ Marin B quando aplicável
```

Nunca voltar para transcrição → resposta direta.

---

# REGRAS DE SEGURANÇA QUE NÃO PODEM REGREDIR

- IA entende/conversa; sistema controla preço, estoque, regras críticas e ações;
- preço/estoque/pedido/Bling nunca são inventados pela IA;
- anti-backlog obrigatório em cada nova abertura de inbound;
- processing externo incerto nunca recebe retry cego;
- job é processado por ID exato;
- gates rechecados antes de gasto externo;
- fallback humano permanece ativo;
- atendimento humano aberto nunca é tomado de volta automaticamente por IA/Flow;
- emergency stop deve cortar inbound/auto/IA/worker/dispatcher;
- nenhum segredo ou telefone real no GitHub/docs;
- mídias privadas;
- Flow/Data Exchange/orquestração nova deve nascer dormente por feature flag;
- **Bling continua desligado durante o canary de atendimento**.

---

# ADMIN / INTELIGÊNCIA

Admin `Atendimento IA` já possui observabilidade, filas, tokens, custo auditável, handoff e emergency stop.

Custo desconhecido nunca deve aparecer como US$ 0: usar `não precificado` até existir cálculo válido.

Futuro aprovado:

`docs/PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md`

Princípio:

**A IA entende e conversa; o sistema controla fatos críticos, regras comerciais e ações.**

Futuramente incluir conhecimento, FAQs, guidance, procedimentos, regras rígidas, mídias oficiais, entrega/pagamento/horários, simulador, versionamento, tokens/custos/qualidade e IA auxiliando o administrador a configurar a própria inteligência.

---

# FLOW / COMÉRCIO CONVERSACIONAL — PLANEJAMENTO E FUNDAÇÃO

A pesquisa entregue pelo proprietário foi analisada e consolidada em:

`docs/ANALISE-WHATSAPP-FLOWS-COMERCIO-CONVERSACIONAL-V1.md`

Decisão:

**incorporar WhatsApp Flow ao roadmap como interface especializada, não como substituto do chat ou da Sala.**

Arquitetura conceitual:

```text
Orquestrador Comercial
→ conversa simples quando conversar é melhor
→ carrossel para poucas recomendações
→ Flow para escolhas estruturadas
→ Sala/vitrine para exploração visual ampla
→ humano para exceções
```

A fundação técnica criptografada está na PR #175, mas continua dormente e não foi aplicada/ativada em produção.

Prioridades futuras, sem alterar o canary atual:

1. Flow 1 de personalização de cesta;
2. preservar preço comercial próprio da cesta e ocultar preços individuais dos componentes;
3. Flow reutilizável com sessão/payload dinâmicos, não Flow novo por cliente;
4. replay guard + máquina de estados antes de qualquer escrita — já programados na PR #175;
5. medir IA sem Flow vs IA + Flow;
6. carrossel para curadoria curta;
7. Sala de Compra para variedade/fotos/comparação;
8. Flow 2 de upsell somente depois de Flow 1 comprovado e sempre opcional;
9. integrar regras de seleção de interface ao futuro Gestor/Roteirista de Inteligência do Admin;
10. usar Flow para reduzir mensagens/tokens em tarefas multi-escolha, sem chamar LLM a cada campo;
11. validar documentação oficial vigente da Meta imediatamente antes da homologação externa.

Não alterar o canary `live=1%` por causa desta implementação. Não misturar primeiro piloto de Flow com primeira homologação real de pedido Bling.

---

# CESTAS / BLING

Cestas:

- preço comercial próprio;
- não mostrar preço individual dos componentes ao cliente;
- Bling futuramente recebe componentes individualizados;
- diferença positiva → Outras despesas;
- diferença negativa → desconto;
- IA nunca calcula diferença fiscal;
- pagamento somente na entrega;
- somente entrega.

Bling:

**NÃO participar durante o canary real de atendimento.**

Somente depois de canary estável e revisado:

1. homologar um único pedido real controlado;
2. conferir contato;
3. componentes da cesta;
4. diferença fiscal;
5. estoque;
6. idempotência;
7. sem retry cego;
8. confirmação WhatsApp somente depois da confirmação do Bling.

---

# REGRA DE TRABALHO

- programar blocos grandes e profissionais;
- modularidade;
- baixo custo;
- Make como ponte fina;
- testes perigosos sempre controlados;
- atualizar esta retomada após cada marco;
- minimizar passos manuais.

## Instrução para novo chat

> Acesse `osvaldosereia/SUCEDOAN12`, leia `docs/RETOMADA-DONA-ANTONIA.md`, `docs/CANARY-LIVE-1PCT-20260907.md`, `docs/WHATSAPP-FLOW-TRANSPORT-V1.md`, `docs/ANALISE-WHATSAPP-FLOWS-COMERCIO-CONVERSACIONAL-V1.md`, `docs/HOMOLOGACAO-OBSERVE-CANARY-PREFLIGHT-20260907.md` e `docs/OPERACAO-WHATSAPP-GRADUAL-V1.md`. Audite Supabase e Make imediatamente. O canary REAL `live=1%` está ativo. O primeiro evento real caiu em `human_control` e possui handoff humano aberto, que deve ser preservado. Monitore eventos, cohorts, jobs, outbound, handoffs e erros. Não aumente o canary sem nova avaliação explícita. Bling continua fora. A PR #175 contém a fundação Flow criptografada + replay guard + máquina de estados, mas tudo permanece dormente e as migrations ainda não foram aplicadas em produção.
