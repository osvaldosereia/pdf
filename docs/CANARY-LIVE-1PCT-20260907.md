# Canary real WhatsApp — 1%

Data: 07/09/2026

## Status

**ATIVO EM PRODUÇÃO**, autorizado explicitamente pelo proprietário.

Corte do inbound:

```text
2026-09-07T23:48:18.455344+00:00
```

Configuração:

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

- inbound `6779824` = ativo;
- outbound event-driven v3 `7290488` = ativo;
- conexões WhatsApp = saudáveis.

Bling permanece **fora desta etapa**.

## Preflight imediatamente antes da abertura

`whatsapp_live_preflight_v1(1)` retornou `ready=true`.

Checks verdes:

- automation/outbound globais ativos;
- emergency stop limpo;
- fallback humano ativo;
- provider OpenAI configurado;
- secret de ingest configurado;
- secret do Worker V2 configurado;
- AI active = 0;
- AI review = 0;
- outbound active = 0;
- outbound review = 0;
- handoffs ativos = 0;
- allowlist de teste ativa = 0.

## Abertura

Ordem usada:

```text
preflight final
→ confirmar Make inbound inativo / outbound ativo
→ ativar Make inbound ainda com release=off
→ configure_whatsapp_release_v1('live',1,...,'LIBERAR_ATENDIMENTO_REAL')
→ auditoria imediata
```

O `configure_whatsapp_release_v1` executou novamente o preflight internamente antes de abrir os gates.

## Auditoria imediata pós-abertura

```text
release = live
canary = 1
inbound = true
auto_reply = true
ai = true
worker = true
dispatch = true
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

## Regra do cohort

- bucket 0 entra em `ai_canary` e pode receber IA automática;
- demais buckets entram em `human_control` e não recebem auto-resposta da IA;
- não aumentar o percentual apenas para encaixar telefone de teste;
- qualquer estado incerto/limite/falha deve cair em humano/review;
- emergency stop permanece disponível;
- não expandir acima de 1% sem nova avaliação explícita.

## Próxima ação operacional

Monitorar os primeiros eventos reais do canary:

1. inbound desde o cutover;
2. cohort `ai_canary` vs `human_control`;
3. jobs do Worker V2;
4. outbound Meta + receipt;
5. human_handoffs;
6. erros/review_required;
7. tokens/custos;
8. zero efeitos em pedido/Bling.

Não iniciar homologação de pedido Bling enquanto este canary não estiver estável e revisado.