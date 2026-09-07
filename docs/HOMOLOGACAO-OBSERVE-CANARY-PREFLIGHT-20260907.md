# Homologação observe real + preflight de canary — Dona Antônia

Data: 07/09/2026

## Status

- observe real allowlisted: **HOMOLOGADO**;
- fallback humano real: **HOMOLOGADO**;
- anti-backlog real: **HOMOLOGADO**;
- preflight de `live`: **HOMOLOGADO**;
- roteamento `live=1%` sintético com Make inbound desligado: **HOMOLOGADO**;
- canary real com clientes: **NÃO ATIVADO**;
- Bling: **NÃO PARTICIPOU**.

## Observe real

Foi usada a função `arm_whatsapp_observe_homologation_v1` para abrir uma janela temporária restrita ao telefone de homologação.

Gates durante o teste:

```text
release = homologation
profile = observe_human_only
inbound = true
auto_reply = false
ai = false
worker = false
dispatch = false
```

Uma mensagem real entrou pelo cenário Make `6779824` e resultou em:

```text
mode = human
should_reply = false
ai_job = null
conversation.status = needs_human
conversation.human_required = true
automation_cohort = observe
human_handoff = open
priority = 2
```

Nenhuma resposta automática foi enviada.

## Bug encontrado e corrigido

A primeira tentativa real falhou com HTTP 500 porque `queue_human_handoff_v1` exige `smallint` para `p_priority`, mas o wrapper passava o literal `2` como `integer`.

A transação abortou completamente, provando comportamento fail-closed: não houve persistência parcial, IA, outbound, pedido ou Bling.

Correção:

- PR #168;
- merge `746de544fe25fa107335402071c9a5827c3740db`;
- migration `20260907232500_whatsapp_observe_handoff_smallint_fix.sql`;
- chamada corrigida para `2::smallint`;
- CI completo verde.

Depois da correção, o mesmo fluxo foi provado sinteticamente e em mensagem WhatsApp real.

## Anti-backlog

Um evento antigo do teste que havia falhado reapareceu depois. O novo corte `whatsapp_inbound_since` bloqueou corretamente esse evento com:

```text
reason = before_whatsapp_cutover
ignored = true
conversation_id = null
message_row_id = null
```

A mensagem nova, posterior ao corte, foi aceita normalmente.

## Handoff real

O handoff real apareceu no dashboard/Admin com `human_open=1` e evento `human_handoff_queued`.

Auditoria da mensagem real:

```text
ai_jobs = 0
outbound_since = 0
orders_since = 0
order_sync_since = 0
bling_since = 0
```

O handoff de homologação foi depois assumido e resolvido pelo backend administrativo para não deixar pendência artificial.

## Preflight obrigatório de live

PR #169 adicionou:

- `whatsapp_live_preflight_v1(canary_percent)`;
- `whatsapp_canary_bucket_v1(phone)`;
- preflight obrigatório dentro de `configure_whatsapp_release_v1` antes de abrir `live`.

Merge:

`fcfa6c9d4491368931ca27911b39a4f9fef1d301`

Migration:

`20260907234000_whatsapp_live_canary_preflight_v1.sql`

O preflight bloqueia `live` se houver:

- AI job pending/processing;
- estado IA que exige review;
- outbound pending/processing;
- outbound `review_required`;
- handoff open/claimed;
- allowlist de teste ainda ativa;
- emergency stop pendente;
- fallback humano desligado;
- secret do worker ausente;
- secret de ingest ausente;
- provider OpenAI não configurado;
- canary inválido;
- gates globais inconsistentes.

Antes da prova sintética, o preflight real para 1% retornou `ready=true` com todas as filas em zero.

## Prova sintética de `live=1%`

O cenário Make inbound foi confirmado **inativo** antes da prova.

Dois telefones fictícios foram escolhidos pelo bucket determinístico:

- um bucket 0;
- um bucket alto fora do 1%.

A prova foi executada dentro de uma única transação PostgreSQL:

```text
configure live=1%
→ consultar decisão bucket 0
→ consultar decisão bucket fora do 1%
→ configure off
→ commit
```

Se qualquer passo falhasse, a transação retornaria ao estado inicial `off`.

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

O fechamento ocorreu dentro da mesma transação.

Auditoria após a prova:

```text
release = off
inbound = false
auto_reply = false
ai = false
worker = false
dispatch = false
canary = 0
ai_active = 0
outbound_active = 0
outbound_review = 0
handoffs_active = 0
allowlist_active = 0
messages criadas pela prova = 0
orders = 0
order_sync = 0
bling = 0
preflight 1% = ready
```

## Regra para o próximo passo

O primeiro canary real deve começar em **1%**. Não aumentar o percentual apenas para fazer o telefone de homologação cair no cohort.

A mudança de `off` para `live` passa a atingir clientes reais. Portanto:

1. auditar preflight novamente imediatamente antes;
2. confirmar Make inbound/outbound;
3. exigir confirmação explícita do proprietário;
4. abrir `live=1%`;
5. monitorar dashboard/handoffs/jobs/outbound em tempo real;
6. ter emergency stop pronto;
7. não ativar Bling nesta fase;
8. se o canary for estável, encerrar/avaliar antes de qualquer expansão.
