# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 — observe real + preflight/live 1% sintético homologados**.

Este é o arquivo **autoritativo** para retomar o projeto. Não planejar do zero. Antes de alterar qualquer gate, auditar GitHub, Supabase e Make.

## Documentos principais

- `docs/HOMOLOGACAO-OBSERVE-CANARY-PREFLIGHT-20260907.md` — observe real, fallback, anti-backlog, preflight e live 1% sintético;
- `docs/HOMOLOGACAO-WORKER-V2-20260907.md` — Worker V2 event-driven + provider Vault + prova WhatsApp real;
- `docs/OPERACAO-WHATSAPP-GRADUAL-V1.md` — release gradual, budgets, fallback, Admin e emergency stop;
- `docs/HOMOLOGACAO-WHATSAPP-IMAGEM-FINAL-20260907.md`;
- `docs/HOMOLOGACAO-WHATSAPP-AUDIO-FINAL-20260907.md`;
- `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md`;
- `docs/WHATSAPP-BRIDGE-V3.md`;
- `docs/SALA-COMPRA-MOTOR-COMERCIAL-V1.md`;
- `docs/PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md` — futuro Gestor/Roteirista de Inteligência;
- `docs/EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`.

---

# PONTO EXATO DE RETOMADA

## Concluído

1. Sala de Compra + motor comercial determinístico;
2. OpenAI texto/transcrição/visão;
3. WhatsApp real texto/áudio/imagem — **HOMOLOGADOS**;
4. TTS real Marin B;
5. WhatsApp Bridge v3 event-driven;
6. outbound Meta com receipt metadata;
7. Conversation Worker V2 automático — **HOMOLOGADO SINTÉTICO E REAL**;
8. provider OpenAI do Worker V2 no Supabase Vault;
9. release gradual/canary/budgets/fallback humano/emergency stop;
10. Admin `Atendimento IA` com métricas, filas, handoff e emergency stop;
11. custo IA auditável: custo desconhecido = `não precificado`, nunca US$ 0 falso;
12. observe sintético — **PASSOU**;
13. ciclo handoff sintético fila → assumir → resolver → retomar IA — **PASSOU**;
14. correção da retomada IA web/Sala — PR #164;
15. observe real temporário/allowlisted — **HOMOLOGADO**;
16. anti-backlog real — **HOMOLOGADO**;
17. fallback humano real — **HOMOLOGADO**;
18. bug `integer → smallint` no handoff encontrado em teste real e corrigido — PR #168;
19. preflight obrigatório de `live` — PR #169;
20. roteamento `live=1%` sintético com Make inbound desligado — **HOMOLOGADO**;
21. zero efeito em pedido/Bling em todas as homologações acima.

## Próxima etapa exata

**Primeiro canary REAL de atendimento WhatsApp em `live=1%`.**

NÃO ativar automaticamente ao retomar. Esta é a primeira mudança que passa a afetar clientes reais. Exigir confirmação explícita do proprietário imediatamente antes da ativação.

Ordem obrigatória:

1. auditar estado atual no Supabase;
2. confirmar `whatsapp_live_preflight_v1(1)=ready`;
3. confirmar filas/reviews/handoffs zerados;
4. confirmar Make inbound `6779824` e outbound `7290488` tecnicamente saudáveis;
5. manter Bling fora;
6. perguntar explicitamente ao proprietário se autoriza abrir `live=1%`;
7. somente após autorização, ativar Make inbound e `configure_whatsapp_release_v1('live',1,...,'LIBERAR_ATENDIMENTO_REAL')` na ordem segura definida no momento;
8. monitorar imediatamente inbound, AI jobs, outbound, human_handoffs e erros;
9. emergency stop pronto para rollback;
10. não expandir percentual durante a mesma prova sem nova avaliação;
11. depois do canary estável, voltar/avaliar antes do primeiro pedido real no Bling.

**Não aumentar canary para fazer o telefone de homologação cair no cohort.** O telefone de homologação não está naturalmente no 1%; isso é esperado e não é motivo para elevar exposição.

---

# ESTADO SEGURO ATUAL

Última auditoria depois da prova sintética de live:

```text
whatsapp_release_mode = off
whatsapp_inbound_enabled = false
whatsapp_auto_reply_enabled = false
ai_enabled = false
conversation_worker_enabled = false
conversation_worker_dispatch_enabled = false
whatsapp_live_canary_percent = 0
active_ai_jobs = 0
active_outbound = 0
outbound_review = 0
active_handoffs = 0
active_allowlist = 0
orders criados pela prova = 0
order_sync = 0
bling_commands = 0
preflight 1% = ready
```

Make inbound `6779824`: **INATIVO** fora de teste.

Make outbound `7290488`: pode permanecer ativo; só reage a jobs legítimos.

Bling: **fora desta etapa**.

---

# OBSERVE REAL — HOMOLOGADO

Nova infraestrutura:

`arm_whatsapp_observe_homologation_v1(phone, minutes)`

Perfil:

```text
release = homologation
scope = single_allowlisted_phone
profile = observe_human_only
inbound = true
auto_reply = false
ai = false
worker = false
dispatch = false
```

Mensagem real comprovou:

```text
mode = human
should_reply = false
ai_job = null
conversation.status = needs_human
human_required = true
automation_cohort = observe
human_handoff.status = open
priority = 2
```

Dashboard mostrou `human_open=1` e evento `human_handoff_queued`.

Auditoria da mensagem:

```text
ai_jobs = 0
outbound = 0
orders = 0
order_sync = 0
bling = 0
```

O handoff real de homologação foi depois assumido e resolvido pelo backend Admin para não deixar pendência artificial.

### Bug encontrado no primeiro observe real — PR #168

A primeira tentativa retornou HTTP 500 porque `queue_human_handoff_v1` exige `p_priority smallint` e o wrapper passava o literal inteiro `2`.

A transação abortou inteira: nenhuma persistência parcial ou ação externa ocorreu.

Correção:

- PR #168;
- merge `746de544fe25fa107335402071c9a5827c3740db`;
- migration `20260907232500_whatsapp_observe_handoff_smallint_fix.sql`;
- `2::smallint` explícito;
- CI completo verde;
- prova sintética e WhatsApp real passaram depois.

### Anti-backlog

Evento antigo reaparecido foi bloqueado com:

```text
reason = before_whatsapp_cutover
ignored = true
conversation_id = null
message_row_id = null
```

A mensagem nova posterior ao corte foi aceita.

---

# LIVE CANARY PREFLIGHT — PR #169

PR #169 merge:

`fcfa6c9d4491368931ca27911b39a4f9fef1d301`

Migration:

`20260907234000_whatsapp_live_canary_preflight_v1.sql`

Funções:

- `whatsapp_canary_bucket_v1(phone)` — preview server-side do bucket 0–99;
- `whatsapp_live_preflight_v1(canary_percent)` — readiness fail-closed;
- `configure_whatsapp_release_v1` agora exige preflight verde antes de `live`.

Preflight bloqueia live se houver:

- AI pending/processing;
- AI em estado review;
- outbound pending/processing;
- outbound review_required;
- handoff open/claimed;
- allowlist de teste ativa;
- emergency stop pendente;
- fallback humano desligado;
- worker secret ausente;
- ingest secret ausente;
- provider OpenAI ausente;
- canary inválido;
- gates globais inconsistentes.

Produção verificada:

```text
whatsapp_live_preflight_v1(1).ready = true
ai_active = 0
ai_review = 0
outbound_active = 0
outbound_review = 0
human_handoffs_active = 0
test_allowlist_active = 0
provider/worker/ingest configured = true
```

---

# PROVA SINTÉTICA LIVE=1%

Make inbound foi mantido **inativo**.

Dois números fictícios foram escolhidos por bucket determinístico e a prova executada em uma única transação:

```text
configure live 1%
→ release_decision(bucket 0)
→ release_decision(bucket fora do 1%)
→ configure off
→ commit
```

Resultado:

```text
bucket 0:
  cohort = ai_canary
  allow_ingest = true
  auto_reply_allowed = true
  reason = live_canary_ai

bucket fora do 1%:
  cohort = human_control
  allow_ingest = true
  auto_reply_allowed = false
  reason = live_canary_human_control
```

O fechamento aconteceu dentro da mesma transação. Nenhuma mensagem, IA, Meta ou Bling participou.

---

# WORKER V2 — OFICIAL

```text
ai_jobs pending
→ trigger ai_job_event_dispatch_v2
→ pg_net
→ conversation-worker-v2
→ claim job_id exato
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

Prova WhatsApp real:

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

# REGRAS DE SEGURANÇA QUE NÃO PODEM REGREDIR

- preço/estoque/pedido/Bling nunca ficam a cargo da IA;
- não-canary em live vai para humano, não é descartado;
- processing externo incerto nunca recebe retry cego;
- job é processado por ID exato;
- gates são rechecados antes de gasto externo;
- anti-backlog obrigatório em toda abertura de inbound;
- emergency stop corta inbound/auto/IA/worker/dispatcher;
- nenhum segredo ou telefone real no GitHub/docs;
- mídias continuam privadas;
- Bling continua desligado até o canary de atendimento estar comprovado.

---

# ÁUDIO

Arquitetura obrigatória:

```text
transcription
→ salva transcript/body_text
→ cria job conversation
→ conversation interpreta
→ resposta determinística/controlada
→ Marin B quando aplicável
```

Nunca voltar a transcrição → resposta direta.

Voz oficial: `dona_antonia_marin_b_v1` (`gpt-4o-mini-tts`, `marin`, speed 1.0).

---

# ADMIN DE INTELIGÊNCIA — FUTURO APROVADO

Documento: `docs/PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md`.

Princípio:

**A IA entende e conversa; o sistema controla fatos críticos, regras comerciais e ações.**

Futuramente: conhecimento, FAQs, guidance, procedimentos, regras rígidas, mídias oficiais, entrega/pagamento/horários, simulador, versionamento, tokens/custos/qualidade e IA auxiliando o próprio administrador a configurar a inteligência.

---

# BLING

Ainda NÃO liberar writers amplamente.

Depois de canary real do atendimento comprovado:

1. homologar um único pedido real controlado;
2. conferir contato;
3. componentes individualizados da cesta;
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
- atualizar sempre esta retomada;
- minimizar passos manuais.

## Instrução para novo chat

> Acesse `osvaldosereia/SUCEDOAN12`, leia `docs/RETOMADA-DONA-ANTONIA.md`, `docs/HOMOLOGACAO-OBSERVE-CANARY-PREFLIGHT-20260907.md`, `docs/HOMOLOGACAO-WORKER-V2-20260907.md` e `docs/OPERACAO-WHATSAPP-GRADUAL-V1.md`. Audite Supabase e Make. O próximo passo é o primeiro canary REAL `live=1%`, mas NÃO o ative sem confirmação explícita do proprietário imediatamente antes. Bling continua fora.
