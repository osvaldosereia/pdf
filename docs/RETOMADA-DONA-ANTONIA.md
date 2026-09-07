# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 — Worker V2 real + observe/fallback/Admin validados**.

Este é o arquivo **autoritativo** para retomar o projeto. Não planejar do zero. Antes de alterar qualquer gate, auditar o estado real no GitHub, Supabase e Make.

## Documentos principais

- `docs/HOMOLOGACAO-WORKER-V2-20260907.md` — Worker V2 event-driven, provider Vault e prova real WhatsApp;
- `docs/OPERACAO-WHATSAPP-GRADUAL-V1.md` — release gradual, observe, canary, budgets, handoff, Admin e emergency stop;
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
3. WhatsApp text/audio/image real — **HOMOLOGADOS**;
4. TTS Marin B real;
5. WhatsApp Bridge v3 event-driven;
6. outbound Meta com receipt metadata;
7. Conversation Worker V2 event-driven — **HOMOLOGADO SINTÉTICO E REAL**;
8. provider OpenAI do Worker V2 no Supabase Vault;
9. release gradual/canary/budgets/fallback humano/emergency stop implementados;
10. `observe` sintético — **PASSOU**: ingest=true, auto-reply=false, `observe_human_only`;
11. ciclo de handoff humano — **PASSOU**: fila → assumir → resolver → retomar IA;
12. bug de retomada IA para canal web encontrado e corrigido na PR #164;
13. emergency stop sintético — **PASSOU**;
14. Admin `Atendimento IA` e filas/budgets — **VALIDADOS**;
15. custo IA do Admin agora é auditável: desconhecido aparece como `não precificado`, não US$ 0; PR #165;
16. zero efeito em pedido/Bling em todas essas homologações.

## Próxima etapa exata

**Criar e homologar uma observação real temporária e allowlisted.**

Não ativar `observe` global para testar. O modo global atual permite ingestão de todos os telefones, embora não responda automaticamente.

A operação de teste deve:

1. permitir inbound somente de um telefone em allowlist temporária;
2. usar anti-backlog (`whatsapp_inbound_since`);
3. manter `auto_reply=false`;
4. manter `ai=false`;
5. manter worker/dispatcher=false;
6. persistir a mensagem real;
7. gerar handoff humano;
8. bloquear qualquer outro telefone antes da persistência;
9. autoexpirar e voltar tudo para `off`;
10. manter Bling completamente fora.

Depois dessa prova:

1. validar/encerrar handoff real do teste no Admin;
2. revisar métricas;
3. preparar canary `live` mínimo com confirmação explícita e rollback imediato;
4. somente depois homologar **um único pedido real controlado no Bling**.

---

# WORKER V2 — OFICIAL

```text
ai_jobs pending
→ ai_job_event_dispatch_v2
→ pg_net
→ conversation-worker-v2
→ claim por job_id exato
→ OpenAI
→ finish_conversation_job
→ outbound quando gates permitem
```

Produção:

```text
conversation-worker-v2 = v2
custom auth server-to-server
provider OpenAI = Supabase Vault
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
bling_commands = 0
```

Documento: `docs/HOMOLOGACAO-WORKER-V2-20260907.md`.

---

# OBSERVE / FALLBACK HUMANO — ESTADO

`configure_whatsapp_release_v1('observe',...)` foi testado com Make inbound desligado.

Decisão comprovada:

```text
mode = observe
cohort = observe
reason = observe_human_only
allow_ingest = true
auto_reply_allowed = false
```

O release voltou imediatamente para `off`.

### Handoff humano

Ciclo sintético comprovado:

```text
queue_human_handoff_v1
→ conversation mode=human / status=needs_human
→ claim_human_handoff_admin_v1
→ resolve_human_handoff_admin_v1
→ resume_conversation_ai_admin_v1
→ conversation mode=ai / status=open
```

### Correção de canal web — PR #164

Bug encontrado: `whatsapp_account_id` é obrigatório inclusive em conversa `web`; a versão antiga usava a presença desse campo para decidir que a conversa dependia do release WhatsApp. Consequência: a Sala não conseguia voltar para IA enquanto WhatsApp estivesse `off`.

Corrigido em:

- PR #164;
- merge `00b7fb3fa231d8a43d5279983e4a00971155dd8f`;
- migration `20260907230000_resume_ai_channel_scope_v1.sql`.

Agora somente canais `whatsapp` e `hybrid` exigem cohort de release WhatsApp; `web` é independente.

---

# EMERGENCY STOP / ADMIN

Emergency stop sintético passou com filas vazias:

- release off;
- inbound/auto/IA/worker/dispatcher false;
- allowlist fechada;
- nenhum pending transformado incorretamente;
- nenhum estado externo incerto criado.

Admin `Atendimento IA` mostra:

- release/canary/gates;
- filas IA/outbound/review;
- handoffs;
- calls/outbound por hora;
- tokens;
- eventos operacionais;
- emergency stop.

Não há botão simples de `live`.

### Custo auditável — PR #165

Antes: chamadas sem preço gravado apareciam como `US$ 0`.

Agora:

- `cost_status=priced|unpriced|no_usage`;
- se existir chamada não precificada, `estimated_cost_usd=null`;
- UI mostra `não precificado` e quantidade de chamadas sem preço;
- tokens permanecem exatos.

PR #165 merge:

`8d32fccecc21e0ef709493d03c372af15713909b`

Migration:

`20260907230500_whatsapp_ops_usage_truthful_v1.sql`

Produção verificada:

```text
cost_status = unpriced
input_tokens = 7231
output_tokens = 291
total_events = 11
unpriced_events = 11
estimated_cost_usd = null
```

---

# ESTADO SEGURO ATUAL

Última auditoria:

```text
whatsapp_release_mode = off
whatsapp_inbound_enabled = false
whatsapp_auto_reply_enabled = false
ai_enabled = false
conversation_worker_enabled = false
conversation_worker_dispatch_enabled = false
emergency_stop_reason = null
active_handoffs = 0
active_ai_jobs = 0
active_outbound = 0
```

Make inbound `6779824`: **INATIVO** fora de teste.

Make outbound `7290488`: pode permanecer ativo; só reage a jobs legítimos.

Bling: **fora desta etapa**.

---

# RELEASE GRADUAL

- `off`: tudo fechado;
- `homologation`: allowlist temporária com automação;
- `observe`: global, persiste mas não responde — **não usar globalmente para a próxima prova**;
- `live`: somente confirmação owner + canary 1–100%.

Próxima implementação deve criar um observe homologation restrito/temporário em vez de abrir `observe` global.

Regras:

- não-canary → humano;
- budget atingido → humano;
- processing incerto → review/humano;
- anti-backlog obrigatório;
- sem retry cego;
- nenhum segredo/telefone real versionado.

---

# ÁUDIO

Regra oficial:

```text
transcription
→ salva transcript/body_text
→ cria conversation
→ conversation interpreta
→ resposta determinística
→ Marin B quando aplicável
```

Nunca voltar para transcrição → resposta direta.

Voz: `dona_antonia_marin_b_v1` (`gpt-4o-mini-tts`, `marin`, speed 1.0).

---

# CESTAS / FISCAL

- preço da cesta é próprio;
- não mostrar preço individual dos componentes;
- Bling recebe componentes individualizados;
- diferença positiva → Outras despesas;
- diferença negativa → desconto;
- IA nunca calcula diferença fiscal;
- pagamento somente na entrega;
- somente entrega.

---

# ADMIN DE INTELIGÊNCIA — FUTURO, NÃO IMPLEMENTAR AGORA

`docs/PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md`

Princípio:

**A IA entende e conversa; o sistema controla fatos críticos, regras comerciais e ações.**

Futuramente incluir conhecimento, FAQ, guidance, procedimentos, regras rígidas, mídias, entrega/pagamento/horários, simulador, versionamento, custo/tokens e IA ajudando o administrador a configurar a própria inteligência.

---

# BLING

Ainda não liberar writer amplamente.

Somente após observação real segura + canary mínimo:

1. um único pedido real controlado;
2. contato;
3. componentes da cesta;
4. diferença fiscal;
5. estoque;
6. idempotência;
7. confirmação final WhatsApp.

---

# REGRA DE TRABALHO

- programar blocos grandes e profissionais;
- modularidade;
- baixo custo;
- Make como ponte fina;
- testes perigosos sempre controlados;
- atualizar esta retomada;
- minimizar passos manuais.

## Instrução para novo chat

> Acesse `osvaldosereia/SUCEDOAN12`, leia `docs/RETOMADA-DONA-ANTONIA.md`, `docs/HOMOLOGACAO-WORKER-V2-20260907.md` e `docs/OPERACAO-WHATSAPP-GRADUAL-V1.md`. Audite Supabase e Make. Continue criando uma **observação real temporária e allowlisted**; não ative `observe` global, `live` ou Bling indiscriminadamente.
