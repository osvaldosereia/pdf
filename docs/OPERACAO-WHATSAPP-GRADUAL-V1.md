# Operação WhatsApp gradual V1 — Dona Antônia

Data: 07/09/2026

Status: Worker V2 automático homologado em WhatsApp real; `observe`, fallback humano, emergency stop e observabilidade validados sinteticamente. **Release geral permanece OFF.**

## Objetivo

Operar o atendimento de forma event-driven, auditável e fail-closed, permitindo evolução de `off` → observação controlada → canary mínimo → live gradual sem perder mensagens nem transformar falhas de IA/transporte em atendimento silenciosamente abandonado.

## Princípios

1. **Não perder a mensagem do cliente.** Fora do canary, em observe ou quando um limite é atingido, a conversa vai para humano; não é descartada.
2. **Sem retry cego após gasto externo.** Job `processing` com lease expirado vai para revisão/humano; nunca volta automaticamente para `pending`.
3. **Uma chamada, um job exato.** O dispatcher envia `job_id`; o Edge Worker só pode claimar esse ID.
4. **Gates rechecados antes do gasto.** O worker reconsulta configuração imediatamente antes de chamar OpenAI.
5. **Preço, estoque, pedido e Bling continuam fora da decisão da IA.** Esta etapa não libera pedidos.
6. **Fallback humano é parte da arquitetura.** Erros, budgets e cohorts humanos geram fila visível no Admin.
7. **Live não é botão simples.** A API server-side exige owner + confirmação explícita + percentual de canary.
8. **Emergency stop é imediato.** Corta inbound/auto-reply/IA/worker/dispatcher e preserva envios incertos para revisão.
9. **Custo desconhecido não é custo zero.** Tokens são exatos; custo só é mostrado como valor quando existe estimativa gravada para todas as chamadas contabilizadas.

## Worker operacional V2

Fluxo homologado:

```text
ai_jobs.pending
→ trigger Postgres
→ pg_net
→ conversation-worker-v2
→ autenticação server-to-server
→ claim_conversation_job_v2(job_id exato)
→ mídia privada quando necessária
→ revalidação de gates
→ OpenAI
→ finish_conversation_job
→ outbound event-driven quando permitido
```

Provider OpenAI do Worker V2 fica no Supabase Vault. A chave não é versionada nem devolvida pelo healthcheck.

Worker V2 passou em smoke sintético e em mensagem WhatsApp real allowlisted. Ver `docs/HOMOLOGACAO-WORKER-V2-20260907.md`.

### Recovery

Cron de 1 minuto:

- redispara apenas job que **continua `pending`** e cujo dispatch envelheceu;
- depois do limite de dispatch, job vai para humano;
- job `processing` com lease expirado vai para `lease_expired_review_required`/humano;
- nunca há `processing → pending` automático após possível chamada externa.

## Modos de release

### `off`

- inbound: desligado;
- auto-reply: desligado;
- IA/worker/dispatcher: desligados;
- canary: 0%.

Estado normal fora de testes e antes da liberação real.

### `homologation`

Número temporário em allowlist. Já foi usado para provar texto, áudio, imagem e Worker V2 automático.

### `observe`

Semântica atual do modo global:

- todas as mensagens novas após o cutover podem ser persistidas;
- **nenhuma resposta automática é enviada**;
- decisão retorna `observe_human_only`;
- atendimento é direcionado para controle humano.

**Importante:** `observe` atual é global. Portanto não deve ser ativado para teste real enquanto não houver uma variante temporária/allowlisted. O próximo passo é criar essa variante segura em vez de abrir ingestão para todos os clientes.

### `live`

Todas as mensagens entram, mas apenas uma fração estável entra no cohort `ai_canary`.

Bucket por telefone: 0–99, determinístico. Quem fica fora do canary entra em `human_control` e aparece no fallback humano.

## Limites iniciais conservadores

- novas conversas IA/hora: 10;
- chamadas IA WhatsApp/hora: 40;
- respostas automáticas IA/hora: 40;
- tokens de entrada/dia: 150.000 (soft limit);
- tokens de saída/dia: 30.000 (soft limit);
- dispatch por job: até 5 tentativas enquanto o job ainda estiver `pending`.

Quando limite é atingido, o sistema encaminha para humano. Não aumenta budget sozinho.

## Fallback humano — VALIDADO

Tabela `human_handoffs` mantém no máximo um atendimento ativo por conversa.

Motivos automáticos incluem:

- cliente pediu humano;
- falha de OpenAI/visão/transcrição;
- lease expirado em situação incerta;
- budget por evento/hora/dia;
- dispatch esgotado;
- cliente fora do cohort canary;
- cap de outbound.

Ciclo sintético comprovado:

```text
conversa IA
→ queue_human_handoff_v1
→ mode=human / status=needs_human
→ Admin assume
→ handoff=claimed
→ Admin resolve
→ handoff=resolved
→ retomar IA
→ mode=ai / status=open / human_required=false
```

Durante essa validação foi descoberto um bug real: `whatsapp_account_id` é obrigatório inclusive para conversa web, então a função antiga tratava qualquer conversa web como WhatsApp ao devolver para IA. A Sala ficaria bloqueada quando o release WhatsApp estivesse `off`.

Correção:

- PR #164;
- migration `20260907230000_resume_ai_channel_scope_v1.sql`;
- gate WhatsApp agora se aplica apenas a `channel in ('whatsapp','hybrid')`;
- conversa `web` pode retomar IA independentemente do release WhatsApp.

A mesma conversa sintética que falhou antes passou depois da migration. Dados sintéticos foram apagados.

## Observe — VALIDAÇÃO SINTÉTICA PASSOU

Foi ativado `observe` por poucos segundos somente no banco, com Make inbound desligado.

`whatsapp_release_decision` retornou:

```text
mode = observe
cohort = observe
reason = observe_human_only
allow_ingest = true
auto_reply_allowed = false
```

Em seguida o release voltou imediatamente para `off`.

Conclusão: a semântica está correta; falta apenas uma forma **allowlisted e autoexpirável** para a prova real sem abrir observe globalmente.

## Emergency stop — VALIDADO

Teste sintético com filas vazias confirmou:

- release `off`;
- inbound desligado;
- auto-reply desligado;
- IA desligada;
- worker desligado;
- dispatcher desligado;
- allowlist fechada;
- nenhum envio pendente cancelado indevidamente;
- nenhum processamento incerto criado.

Depois do teste, o motivo sintético foi limpo e o estado permaneceu `off`.

## Observabilidade no Admin — VALIDADA

Seção **Atendimento IA** mostra:

- release;
- canary;
- gates;
- filas IA/outbound/review;
- handoffs abertos/assumidos;
- chamadas IA e outbound/hora;
- tokens do dia;
- eventos operacionais;
- emergency stop.

Ciclo assumir/resolver/resolver+IA foi validado no backend.

### Custo OpenAI auditável

Foi corrigida uma inconsistência antes do canary: chamadas com tokens, mas sem estimativa gravada, apareciam como `US$ 0`.

Correção:

- PR #165;
- migration `20260907230500_whatsapp_ops_usage_truthful_v1.sql`;
- Admin distingue `priced`, `unpriced` e `no_usage`;
- se houver qualquer evento sem preço, `estimated_cost_usd=null` e a UI mostra **“não precificado”**;
- tokens e quantidade de chamadas continuam exatos.

Validação de produção após a correção:

```text
cost_status = unpriced
input_tokens = 7231
output_tokens = 291
total_events = 11
priced_events = 0
unpriced_events = 11
estimated_cost_usd = null
```

Isso evita falsa percepção de custo zero.

## Critérios antes de canary real

Já concluídos:

- CI verde;
- Worker V2 event-driven real homologado;
- provider Vault;
- fallback humano sintético;
- retomada IA web corrigida;
- emergency stop sintético;
- Admin/filas/budgets funcionando;
- custo/token auditável;
- filas zeradas;
- outbound v3 estável;
- Bling fora.

Ainda falta:

1. implementar observação real temporária e allowlisted;
2. provar com uma mensagem real que ela é persistida e vira handoff humano **sem resposta automática e sem OpenAI**;
3. fechar automaticamente a janela;
4. auditar filas e resolver o handoff de teste;
5. só então preparar canary `live` mínimo.

## Próximo passo técnico

Criar uma operação dedicada de **observe homologation**. Requisitos:

- somente telefone allowlisted;
- janela curta com expiração;
- anti-backlog via `whatsapp_inbound_since`;
- `auto_reply=false`;
- `ai=false`;
- `conversation_worker=false`;
- `dispatcher=false`;
- inbound permitido somente para o telefone de teste;
- mensagem persistida e encaminhada para handoff humano;
- outros telefones bloqueados antes da persistência;
- fechamento e expiry retornam tudo para `off`;
- nenhuma participação do Bling.

Não usar `observe` global para esta prova.

## Bling

**Esta etapa não autoriza pedido real.**

Somente depois da observação real segura e de um canary mínimo do atendimento, homologar um único pedido real no Bling com idempotência, componentes da cesta, regra fiscal e confirmação final no WhatsApp.
