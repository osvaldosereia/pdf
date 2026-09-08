# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 local / 08/09/2026 UTC — canary real WhatsApp `live=1%` ATIVO; fundação WhatsApp Flow instalada e publicada, porém DORMENTE**.

Este é o arquivo **autoritativo** para retomar o projeto. Antes de qualquer alteração, auditar GitHub, Supabase e Make. Não planejar do zero e não repetir etapas já concluídas.

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
- `docs/PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md`;
- `docs/ANALISE-WHATSAPP-FLOWS-COMERCIO-CONVERSACIONAL-V1.md`;
- `docs/WHATSAPP-FLOW-TRANSPORT-V1.md` — fundação criptografada, replay guard, máquina de estados e budget do Flow.

---

# PONTO EXATO DE RETOMADA

## Estado atual: CANARY REAL 1% + FUNDAÇÃO FLOW DORMENTE EM PRODUÇÃO

O atendimento WhatsApp real continua em:

```text
whatsapp_release_mode = live
whatsapp_live_canary_percent = 1
whatsapp_inbound_enabled = true
whatsapp_auto_reply_enabled = true
ai_enabled = true
conversation_worker_enabled = true
conversation_worker_dispatch_enabled = true
human_fallback_enabled = true
emergency_stop_reason = null
```

A nova camada de experiência/Flow continua completamente fechada:

```text
experience_orchestrator_enabled = false
whatsapp_flow_data_exchange_enabled = false
whatsapp_flow_send_enabled = false
whatsapp_flow_max_exchanges_per_session = 40
```

**Não aumentar o canary acima de 1% sem nova autorização explícita do proprietário.**

**Não ativar Bling.**

**Não habilitar WhatsApp Flow/Data Exchange para clientes.**

**Não assumir, resolver ou fechar automaticamente atendimento humano já aberto.**

---

# MARCO FLOW — PR #175 INTEGRADA

PR:

`#175 — Dona Antônia: fundação criptografada do WhatsApp Flow Data Exchange`

Merge squash em `main`:

`3db08cd83238461fa76d7ea6b0e29f3f6568809b`

A PR implementou uma fundação fail-closed, sem ativação comercial:

- gates independentes para Data Exchange e envio;
- chave privada PKCS8 destinada ao Supabase Vault;
- chave pública/fingerprint operacional;
- token de Flow persistido apenas como SHA-256;
- RSA-OAEP/SHA-256 + AES-128-GCM;
- IV de resposta invertido conforme o protocolo de referência;
- HTTP 421 para falha de descriptografia da chave RSA;
- auditoria sem payload, token cru, chave privada ou PII;
- handler read-only do Flow de personalização de cesta;
- preços individuais dos componentes da cesta permanecem ocultos;
- aplicação no carrinho permanece explicitamente bloqueada.

## Erro `deno check` resolvido

A falha original do CI vinha da tipagem mais estrita do WebCrypto no Deno 2.x: `Uint8Array<ArrayBufferLike>` não satisfazia `BufferSource` em todos os pontos.

Correção principal:

`a93c7b712d1153846288aca376f3a431a093b2cc`

Complemento de teste:

`a63607ec0dec42e3d0f0dbdc4c83aa7b77d190c6`

A solução converte explicitamente os buffers WebCrypto para `ArrayBuffer`. `deno check` e `deno test` passaram depois da correção.

## Hardening adicional integrado

A fundação inclui:

- `whatsapp_flow_request_guard`;
- fingerprint SHA-256 somente do envelope criptografado;
- TTL de replay guard de 24 horas;
- `flow_current_screen`;
- `flow_state_version`;
- `flow_last_request_fingerprint`;
- budget padrão de 40 exchanges por sessão;
- máquina de estados `INIT → BASKET_EDIT → BASKET_REVIEW`;
- stale transition rejeitada com `flow_transition_invalid`;
- replay idempotente sem novo avanço de estado;
- takeover humano revalidado sob lock antes da regra de negócio;
- budget excedido falha fechado;
- `BASKET_REVIEW` continua `write_enabled=false` / `flow_cart_apply_not_enabled`.

O CI da PR passou com:

- testes anteriores de WhatsApp;
- PGlite/banco local;
- testes de orquestrador/experimentos;
- teste de transporte Flow;
- Shopping Room tests;
- `node --check`;
- `deno check` das Edge Functions relevantes;
- `deno test` criptográfico.

---

# MIGRATIONS FLOW — APLICADAS EM PRODUÇÃO, GATES FALSE

As migrations integradas pela PR #175 foram aplicadas com sucesso em produção:

```text
whatsapp_flow_transport_foundation_v1 = aplicada
whatsapp_flow_transport_hardening_v1 = aplicada
```

Arquivos versionados correspondentes:

```text
supabase/migrations/20260908010000_whatsapp_flow_transport_foundation_v1.sql
supabase/migrations/20260908010100_whatsapp_flow_transport_hardening_v1.sql
```

Auditoria imediatamente após aplicação confirmou:

```text
live canary = 1%
experience_orchestrator_enabled = false
whatsapp_flow_data_exchange_enabled = false
whatsapp_flow_send_enabled = false
flow budget = 40
flow events = 0
flow request guards = 0
orders = 0
order_sync = 0
ai_jobs = 0
outbound_jobs = 0
critical_ops = 0
```

Readiness atual do transporte:

```text
transport_ready = false
send_ready = false
private_key_configured = false
public_key_configured = false
meta_signature_status = unknown
key_version = 0
ready_flow_definitions = 0
active_flow_sessions = 0
replay_guard_enabled = true
state_machine_enabled = true
```

Nenhuma chave Flow foi gerada durante este marco.

---

# AUTENTICAÇÃO DAS EDGE FUNCTIONS — PR #176

PR:

`#176 — Dona Antônia: versionar autenticação das Edge Functions de Flow`

Merge squash:

`323c6b3b17331549e04a92364551edf06faaaca9`

`supabase/config.toml` passou a declarar explicitamente:

```text
admin-experience-orchestrator-v1  verify_jwt = true
admin-whatsapp-flow-v1            verify_jwt = true
whatsapp-flow-data-exchange-v1    verify_jwt = false
```

O callback Data Exchange usa `verify_jwt=false` porque a Meta não envia JWT do Supabase. Isso **não** libera a função para uso comercial: o handler continua protegido pela criptografia do protocolo, readiness/gates do banco, chave server-side, token de sessão, replay guard, máquina de estados, budget e revalidação de takeover humano.

Foi criado teste de regressão:

`scripts/test-whatsapp-flow-auth-config-v1.mjs`

O workflow da Dona Antônia passou a executar esse teste e a reagir também a alterações em `supabase/config.toml`.

CI da PR #176: **verde**.

---

# EDGE FUNCTIONS FLOW — PUBLICADAS, MAS INOPERANTES POR GATE

Produção agora possui:

```text
admin-experience-orchestrator-v1 = ACTIVE v2, verify_jwt=true
admin-whatsapp-flow-v1 = ACTIVE v1, verify_jwt=true
whatsapp-flow-data-exchange-v1 = ACTIVE v1, verify_jwt=false
```

O fato de a Edge Function Data Exchange estar `ACTIVE` significa apenas que o código foi publicado. O runtime de negócio permanece desligado porque:

```text
experience_orchestrator_enabled = false
whatsapp_flow_data_exchange_enabled = false
whatsapp_flow_send_enabled = false
private_key_configured = false
public_key_configured = false
```

Portanto não existe Flow utilizável por cliente neste momento.

---

# SEGURANÇA FLOW — AUDITORIA PÓS-DDL/DEPLOY

As tabelas novas possuem RLS habilitado:

```text
whatsapp_flow_transport_config = RLS true
whatsapp_flow_exchange_events = RLS true
whatsapp_flow_request_guard = RLS true
```

Privilégios confirmados:

```text
anon -> get private key = false
authenticated -> get private key = false
service_role -> get private key = true

anon -> claim replay = false
authenticated -> claim replay = false
service_role -> claim replay = true

anon -> handle exchange = false
authenticated -> handle exchange = false
service_role -> handle exchange = true
```

Auditoria de schema confirmou ausência de colunas proibidas em logs/guard:

```text
payload
data
body
flow_token
decrypted_payload
encrypted_flow_data
encrypted_aes_key
private_key
```

O Supabase Security Advisor reporta `RLS Enabled No Policy` como INFO para várias tabelas server-only, incluindo as três novas. Neste desenho isso é intencional: RLS permanece ligado, acesso cliente é revogado e operações são service-role/backend.

## Pendência de hardening encontrada pelo Advisor

O advisor também identificou quatro funções antigas `SECURITY DEFINER` executáveis por `anon`/`authenticated`:

```text
ai_job_dispatch_trigger_v2()
ai_job_human_fallback_trigger_v1()
guard_whatsapp_ai_outbound_rate_v1()
message_human_intent_trigger_v1()
```

Essas funções são de infraestrutura/trigger e não devem ser RPCs públicos. **Próxima camada de segurança:** auditar definições/dependências e revogar `EXECUTE` de `PUBLIC`, `anon` e `authenticated` sem alterar a execução interna dos triggers. Fazer em migration própria + testes, separada do Flow.

Também existe aviso de conta sobre `Leaked Password Protection Disabled`; é configuração de Auth e não foi alterada nesta rodada.

Referência do advisor para RLS sem policy:

`https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy`

Referência do advisor para SECURITY DEFINER público:

`https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable`

---

# CANARY REAL — AUDITORIA MAIS RECENTE

Corte do inbound:

```text
2026-09-07T23:48:18.455344+00:00
```

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
orders = 0
order_sync = 0
flow_events = 0
flow_request_guards = 0
critical_ops_events = 0
```

A conversa real observada permanece:

```text
conversation.status = needs_human
mode = human
human_required = true
automation_cohort = human_control
automation_bucket = 89
handoff.status = open
handoff.reason = live_canary_human_control
```

O bucket 89 está fora do cohort de 1%; o comportamento correto é ingestão + controle humano, sem IA/outbound automático.

**Preservar esse handoff. Não assumir, resolver ou fechar automaticamente.**

Make:

```text
inbound 6779824 = active
outbound 7290488 = active
legacy outbound 7290290 = inactive
```

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

Arquitetura de áudio obrigatória:

```text
transcription
→ salva transcript/body_text
→ cria job conversation
→ conversation interpreta
→ resposta controlada
→ Marin B quando aplicável
```

Voz oficial:

`dona_antonia_marin_b_v1` — `gpt-4o-mini-tts`, `marin`, speed 1.0.

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
- Flow/Data Exchange/orquestração nova permanece dormente até homologação;
- preço individual dos componentes das cestas não é exposto ao cliente;
- Flow não escreve carrinho enquanto `flow_cart_apply_not_enabled` estiver vigente;
- **canary permanece em 1% até nova autorização explícita**;
- **Bling continua fora durante este canary de atendimento**.

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

Somente depois de canary estável e revisão explícita:

1. homologar um único pedido real controlado;
2. conferir contato;
3. componentes da cesta;
4. diferença fiscal;
5. estoque;
6. idempotência;
7. sem retry cego;
8. confirmação WhatsApp somente depois da confirmação do Bling.

Nunca combinar a primeira homologação de Flow com a primeira homologação real de Bling.

---

# PRÓXIMA AÇÃO EXATA

1. continuar monitorando `live=1%` sem elevar percentual;
2. preservar qualquer `human_handoff` aberto;
3. criar migration de hardening para as quatro trigger functions `SECURITY DEFINER` expostas como RPC;
4. adicionar testes que garantam `anon/authenticated=false` e backend/trigger preservado;
5. CI verde → merge → aplicar migration → rodar Security Advisor novamente;
6. reauditar canary após qualquer DDL;
7. somente depois avançar preparação de chave pública Flow;
8. geração/registro de chave não deve ligar `whatsapp_flow_data_exchange_enabled` ou `whatsapp_flow_send_enabled`;
9. criação/publicação do Flow real na Meta será homologação separada e allowlisted;
10. nenhuma etapa Flow deve alterar `live=1%` ou envolver Bling.

---

# REGRA DE TRABALHO

- programar blocos grandes e profissionais;
- modularidade;
- baixo custo;
- Make como ponte fina;
- testes perigosos sempre controlados;
- atualizar esta retomada após cada marco;
- minimizar passos manuais;
- não repetir etapas já concluídas.

## Instrução para novo chat

> Acesse `osvaldosereia/SUCEDOAN12` e leia primeiro `docs/RETOMADA-DONA-ANTONIA.md`. Audite Supabase e Make. O canary REAL `live=1%` está ativo e não pode subir sem nova autorização. Existe um handoff humano aberto em `human_control`/bucket 89 que deve ser preservado. A PR #175 já foi integrada (`3db08cd...`), as migrations Flow já foram aplicadas com gates false, e as Edge Functions Flow já foram publicadas. A PR #176 já foi integrada (`323c6b3...`) e fixa `verify_jwt`. Flow/Data Exchange/orquestrador permanecem desligados, sem chave configurada, sem eventos Flow e sem envio para clientes. Bling continua fora. Próxima camada: corrigir os quatro `SECURITY DEFINER` trigger RPCs apontados pelo Security Advisor, em migration separada e com testes, mantendo `live=1%` intacto.
