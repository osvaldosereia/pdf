# Operação WhatsApp gradual V1 — Dona Antônia

Data: 07/09/2026

Status: infraestrutura preparada, **release geral deve permanecer OFF até homologação do worker operacional**.

## Objetivo

Substituir o Conversation Worker manual/one-shot por execução event-driven segura, adicionar observabilidade e fallback humano e permitir uma liberação real por canary sem transformar uma falha de IA ou transporte em atendimento perdido.

## Princípios

1. **Não perder a mensagem do cliente.** Fora do canary, em observe ou quando um limite é atingido, a conversa vai para humano; não é descartada.
2. **Sem retry cego após gasto externo.** Job `processing` com lease expirado vai para `review_required`/humano; nunca volta automaticamente para `pending`.
3. **Uma chamada, um job exato.** O dispatcher envia `job_id`; o Edge Worker só pode claimar esse ID.
4. **Gates rechecados antes do gasto.** O worker reconsulta configuração imediatamente antes de chamar OpenAI.
5. **Preço, estoque, pedido e Bling continuam fora da decisão da IA.** Esta etapa não libera pedidos.
6. **Fallback humano é parte da arquitetura, não exceção.** Erros, budgets e cohorts humanos geram fila visível no Admin.
7. **Live não é botão simples.** A API server-side exige owner + confirmação explícita e percentual de canary.
8. **Emergency stop é imediato.** Corta inbound/auto-reply/IA/worker/dispatcher e preserva envios incertos para revisão.

## Worker operacional V2

Fluxo:

```text
ai_jobs.pending
→ trigger Postgres
→ pg_net
→ conversation-worker-v2 (Edge)
→ valida chave interna do Vault
→ claim_conversation_job_v2(job_id exato)
→ baixa mídia privada se necessário
→ revalida gates
→ OpenAI
→ finish_conversation_job
→ outbound event-driven já homologado
```

O segredo interno do worker é gerado no próprio Postgres e armazenado em Supabase Vault. Apenas o hash fica em `system_secrets`. Nenhuma chave é versionada.

### Recovery

Cron de 1 minuto:

- redispara apenas job que **continua `pending`** e cuja tentativa de dispatch envelheceu;
- depois do limite de dispatch, job vira `held` e cai em humano;
- job `processing` com lease >10 min vira `error/lease_expired_review_required` e cai em humano;
- nunca há `processing → pending` automático.

## Modos de release

### `off`

- inbound: desligado;
- auto-reply: desligado;
- IA/worker/dispatcher: desligados;
- canary: 0%.

Estado normal enquanto a infraestrutura está sendo preparada.

### `homologation`

Somente número temporário em allowlist. É o modo para provar o worker event-driven antes de qualquer cliente real.

### `observe`

- todas as mensagens novas podem ser persistidas;
- **nenhuma resposta automática é enviada**;
- conversas entram em `human_handoffs`;
- usado para observar volume/formatos sem risco de IA responder.

### `live`

Todas as mensagens entram, mas apenas uma fração estável entra no cohort `ai_canary`.

Bucket por telefone: 0–99, determinístico. Exemplo: canary 5% → apenas buckets 0–4 são candidatos a IA.

Quem ficar fora do canary entra em `human_control` e aparece no fallback humano. Não perde mensagem.

## Limites iniciais conservadores

Defaults de infraestrutura, ajustáveis futuramente pelo Admin seguro:

- novas conversas IA/hora: 10;
- chamadas IA WhatsApp/hora: 40;
- respostas automáticas IA/hora: 40;
- tokens de entrada/dia: 150.000 (soft limit);
- tokens de saída/dia: 30.000 (soft limit);
- dispatch por job: até 5 tentativas enquanto o job ainda estiver pending.

Quando um limite de IA é atingido, o atendimento vai para humano. O sistema não aumenta o limite sozinho.

## Fallback humano

Tabela `human_handoffs` mantém no máximo um atendimento ativo por conversa.

Motivos automáticos incluem:

- cliente pediu humano;
- job OpenAI/visão/transcrição falhou;
- lease expirou em situação incerta;
- budget por evento/hora/dia atingido;
- dispatch do worker esgotado;
- cliente ficou fora do cohort canary;
- cap de outbound atingido.

O Admin permite:

- visualizar fila;
- assumir atendimento;
- resolver;
- resolver e devolver à IA **somente se a conversa ainda for elegível pelo release atual**;
- emergency stop.

Não há botão de `live` nesta primeira versão do painel.

## Observabilidade no Admin

Seção **Atendimento IA** mostra:

- modo de release;
- percentual canary;
- gates inbound/auto-reply/IA/worker/dispatcher;
- filas IA/outbound/review;
- handoffs abertos/assumidos;
- chamadas IA na última hora;
- outbound da última hora;
- tokens do dia;
- eventos operacionais recentes;
- motivo do último emergency stop.

Nenhum telefone completo, chave ou payload sensível é necessário nessa tela.

## Plano de homologação antes de `live`

1. deploy do Edge Worker e Admin Ops com release OFF;
2. aplicar migrations com release OFF;
3. confirmar cron e dashboard, filas zeradas;
4. testar autenticação interna/dispatcher sem provider;
5. criar testes sintéticos de cohort/fallback e removê-los;
6. abrir `homologation` somente para o telefone de teste;
7. ativar o dispatcher operacional;
8. enviar uma mensagem real de texto;
9. provar que o job foi disparado automaticamente, sem workflow one-shot;
10. repetir com áudio para provar encadeamento transcription → conversation event-driven;
11. fechar homologation e auditar zero pendências;
12. somente depois estudar `observe` e um canary real muito pequeno.

## Critérios mínimos antes de canary real

- CI verde;
- worker event-driven real homologado;
- `human_handoffs` funcionando;
- emergency stop testado sem cliente real;
- dashboard Admin funcionando;
- filas zeradas;
- nenhum `review_required` sem dono;
- Make inbound tecnicamente estável;
- outbound v3 estável;
- equipe preparada para responder à fila humana;
- Bling ainda fora.

## Bling

**Esta etapa não autoriza pedido real.**

Depois de o atendimento operacional passar em homologação e em um canary controlado, o próximo marco é um único pedido real no Bling, com:

- cliente/teste conhecido;
- pedido exato auditado antes do envio;
- idempotência/dedupe;
- sem retry cego após resposta externa incerta;
- conferência de componentes da cesta e regra fiscal;
- confirmação final no WhatsApp somente depois do Bling confirmar o pedido.
