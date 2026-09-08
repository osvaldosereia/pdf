# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 — primeiro canary real WhatsApp `live=1%` ATIVO**.

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
- `docs/ANALISE-WHATSAPP-FLOWS-COMERCIO-CONVERSACIONAL-V1.md` — análise dos relatórios de Flow/Magalu e estratégia aprovada para aperfeiçoamento futuro.

---

# PONTO EXATO DE RETOMADA

## Estado atual: CANARY REAL ATIVO

Autorização explícita do proprietário recebida para abrir **`live=1%`**, mantendo Bling fora.

Corte do inbound:

```text
2026-09-07T23:48:18.455344+00:00
```

Produção imediatamente após abertura:

```text
whatsapp_release_mode = live
whatsapp_live_canary_percent = 1
whatsapp_inbound_enabled = true
whatsapp_auto_reply_enabled = true
ai_enabled = true
conversation_worker_enabled = true
conversation_worker_dispatch_enabled = true
human_fallback_enabled = true
```

Make:

```text
inbound 6779824 = active
outbound 7290488 = active
```

Auditoria imediata pós-abertura:

```text
ai_active = 0
ai_review = 0
outbound_active = 0
outbound_review = 0
handoffs_active = 0
messages_since_cutover = 0
ai_jobs_since_cutover = 0
outbound_jobs_since_cutover = 0
handoffs_since_cutover = 0
orders_since_cutover = 0
order_sync_since_cutover = 0
```

### Próxima ação exata

**Monitorar os primeiros eventos reais do canary.**

Em cada rodada:

1. auditar mensagens desde o cutover;
2. identificar cohort `ai_canary` ou `human_control`;
3. conferir Worker V2/jobs IA;
4. conferir outbound Meta/receipt;
5. conferir `human_handoffs`;
6. conferir erros/review_required;
7. conferir tokens/custos;
8. confirmar `orders=0`, `order_sync=0` e Bling fora;
9. se houver comportamento duvidoso, usar emergency stop;
10. **não aumentar acima de 1% sem nova avaliação explícita**.

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
- emergency stop deve cortar inbound/auto/IA/worker/dispatcher;
- nenhum segredo ou telefone real no GitHub/docs;
- mídias privadas;
- **Bling continua desligado durante o canary de atendimento**.

---

# ADMIN / INTELIGÊNCIA

Admin `Atendimento IA` já possui observabilidade, filas, tokens, custo auditável, handoff e emergency stop.

Custo desconhecido nunca deve aparecer como US$ 0: usar `não precificado` até existir cálculo válido.

Futuro aprovado, ainda não implementar agora:

`docs/PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md`

Princípio:

**A IA entende e conversa; o sistema controla fatos críticos, regras comerciais e ações.**

Futuramente incluir conhecimento, FAQs, guidance, procedimentos, regras rígidas, mídias oficiais, entrega/pagamento/horários, simulador, versionamento, tokens/custos/qualidade e IA auxiliando o administrador a configurar a própria inteligência.

---

# FLOW / COMÉRCIO CONVERSACIONAL — PLANEJAMENTO APROVADO

A pesquisa entregue pelo proprietário foi analisada e consolidada em:

`docs/ANALISE-WHATSAPP-FLOWS-COMERCIO-CONVERSACIONAL-V1.md`

Decisão:

**incorporar WhatsApp Flow ao roadmap como interface especializada, não como substituto do chat ou da Sala.**

Arquitetura conceitual futura:

```text
Orquestrador Comercial
→ conversa simples quando conversar é melhor
→ carrossel para poucas recomendações
→ Flow para escolhas estruturadas
→ Sala/vitrine para exploração visual ampla
→ humano para exceções
```

Prioridades futuras, somente depois de o canary atual estar estável:

1. Flow 1 de personalização de cesta;
2. preservar preço comercial próprio da cesta e ocultar preços individuais dos componentes;
3. Flow reutilizável com sessão/payload dinâmicos, não Flow novo por cliente;
4. medir IA sem Flow vs IA + Flow;
5. carrossel para curadoria curta;
6. Sala de Compra para variedade/fotos/comparação;
7. Flow 2 de upsell somente depois de Flow 1 comprovado e sempre opcional;
8. integrar regras de seleção de interface ao futuro Gestor/Roteirista de Inteligência do Admin;
9. usar Flow para reduzir mensagens/tokens em tarefas multi-escolha, sem chamar LLM a cada campo;
10. validar documentação oficial vigente da Meta imediatamente antes da implementação.

Não alterar o canary `live=1%` por causa desta análise. Não misturar primeiro piloto de Flow com primeira homologação real de pedido Bling.

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

> Acesse `osvaldosereia/SUCEDOAN12`, leia `docs/RETOMADA-DONA-ANTONIA.md`, `docs/CANARY-LIVE-1PCT-20260907.md`, `docs/ANALISE-WHATSAPP-FLOWS-COMERCIO-CONVERSACIONAL-V1.md`, `docs/HOMOLOGACAO-OBSERVE-CANARY-PREFLIGHT-20260907.md` e `docs/OPERACAO-WHATSAPP-GRADUAL-V1.md`. Audite Supabase e Make imediatamente. O primeiro canary REAL `live=1%` está ativo. Monitore eventos, cohorts, jobs, outbound, handoffs e erros. Não aumente o canary sem nova avaliação explícita. Bling continua fora. A estratégia de Flow está aprovada apenas para aperfeiçoamento futuro e não deve alterar o canary atual.