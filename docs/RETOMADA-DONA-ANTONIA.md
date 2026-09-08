# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 local / 08/09/2026 UTC**.

Este é o arquivo **autoritativo** para retomar o projeto. Antes de qualquer alteração, auditar GitHub, Supabase e Make. Não recomeçar etapas já concluídas.

---

# ESTADO OPERACIONAL ATUAL

## WhatsApp real

O primeiro canary real continua ativo e **não pode ser ampliado sem nova autorização explícita do proprietário**.

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

Corte do inbound atual:

```text
2026-09-07T23:48:18.455344+00:00
```

Make:

```text
inbound 6779824 = active
outbound 7290488 = active
legacy outbound 7290290 = inactive
```

## Primeiro evento real do canary

Desde o cutover, a auditoria mais recente confirma:

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
critical_ops_events = 0
```

A conversa observada permanece:

```text
conversation.status = needs_human
mode = human
human_required = true
automation_cohort = human_control
automation_bucket = 89
handoff.status = open
handoff.reason = live_canary_human_control
```

O bucket 89 está fora do cohort de 1%; portanto o comportamento correto é ingestão + atendimento humano, sem job de IA e sem outbound automático.

**Preservar esse handoff. Não assumir, resolver ou fechar automaticamente.**

---

# INVARIANTES QUE NÃO PODEM SER ALTERADAS SEM AUTORIZAÇÃO

- canary permanece em **1%**;
- não ativar Bling;
- não ativar WhatsApp Flow/Data Exchange para clientes;
- não ativar o orquestrador de experiências;
- novas features de Flow/orquestração permanecem atrás de flags;
- atendimento humano aberto nunca volta automaticamente para IA/Flow;
- IA entende e conversa; backend controla preço, estoque, pedido, regras críticas e ações;
- preço individual dos componentes das cestas não é exposto ao cliente;
- nenhuma etapa Flow escreve carrinho enquanto `flow_cart_apply_not_enabled` estiver vigente;
- processamento externo incerto não recebe retry cego;
- job de IA é processado por ID exato;
- gates são rechecados antes de gasto externo;
- mídias privadas e segredos não vão para GitHub/docs;
- não combinar primeira homologação de Flow com primeira homologação real de Bling.

---

# FUNDAÇÃO WHATSAPP FLOW — CONCLUÍDA E DORMENTE EM PRODUÇÃO

## PR #175

`#175 — Dona Antônia: fundação criptografada do WhatsApp Flow Data Exchange`

Merge em `main`:

```text
3db08cd83238461fa76d7ea6b0e29f3f6568809b
```

A fundação inclui:

- gates independentes de Data Exchange e envio;
- RSA-OAEP/SHA-256 para chave AES;
- AES-128-GCM para payload;
- IV invertido na resposta;
- HTTP 421 para falha de descriptografia da chave RSA;
- chave privada destinada ao Supabase Vault;
- chave pública + fingerprint operacional;
- token de Flow armazenado somente como SHA-256;
- auditoria sem payload, token cru, chave privada ou PII;
- handler read-only do Flow de personalização de cesta;
- replay guard por SHA-256 do envelope criptografado;
- TTL de replay guard de 24 horas;
- máquina de estados `INIT → BASKET_EDIT → BASKET_REVIEW`;
- `flow_current_screen`, `flow_state_version`, `flow_last_request_fingerprint`;
- replay idempotente sem novo avanço de estado;
- budget padrão de 40 exchanges por sessão;
- takeover humano revalidado sob lock;
- stale transition rejeitada;
- `BASKET_REVIEW` continua `write_enabled=false` / `flow_cart_apply_not_enabled`.

## Correção do Deno/WebCrypto

O `deno check` originalmente falhou por tipagem mais estrita de `BufferSource` no Deno 2.x. A correção converte explicitamente `Uint8Array<ArrayBufferLike>` para `ArrayBuffer` antes das operações WebCrypto.

Commits relevantes da PR:

```text
a93c7b712d1153846288aca376f3a431a093b2cc
a63607ec0dec42e3d0f0dbdc4c83aa7b77d190c6
```

Após a correção passaram `deno check`, `deno test` criptográfico e os testes PGlite/Node anteriores.

## Migrations Flow aplicadas

Produção já recebeu:

```text
20260908013915 whatsapp_flow_transport_foundation_v1
20260908014007 whatsapp_flow_transport_hardening_v1
```

Arquivos versionados de origem:

```text
supabase/migrations/20260908010000_whatsapp_flow_transport_foundation_v1.sql
supabase/migrations/20260908010100_whatsapp_flow_transport_hardening_v1.sql
```

Os nomes/timestamps dos arquivos históricos do repositório são anteriores ao versionamento atribuído pelo Supabase ao aplicar; a lista de migrations do banco é a verdade operacional sobre o que foi aplicado.

## Estado dos gates Flow

```text
experience_orchestrator_enabled = false
whatsapp_flow_data_exchange_enabled = false
whatsapp_flow_send_enabled = false
whatsapp_flow_max_exchanges_per_session = 40
```

Readiness atual:

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

**Nenhuma chave Flow foi gerada. Nenhuma chave pública foi registrada na Meta. Nenhum Flow foi liberado para cliente.**

---

# AUTENTICAÇÃO DAS EDGE FUNCTIONS — PR #176

PR:

`#176 — Dona Antônia: versionar autenticação das Edge Functions de Flow`

Merge:

```text
323c6b3b17331549e04a92364551edf06faaaca9
```

`supabase/config.toml` fixa:

```text
admin-experience-orchestrator-v1  verify_jwt = true
admin-whatsapp-flow-v1            verify_jwt = true
whatsapp-flow-data-exchange-v1    verify_jwt = false
```

O callback Data Exchange usa `verify_jwt=false` porque a Meta não envia JWT do Supabase. Isso não o torna funcional para clientes: ele continua fail-closed por gates do banco, criptografia, chave server-side, token de sessão, replay guard, state machine, budget e takeover humano.

Teste de regressão:

```text
scripts/test-whatsapp-flow-auth-config-v1.mjs
```

## Edge Functions publicadas

```text
admin-experience-orchestrator-v1 = ACTIVE v2, verify_jwt=true
admin-whatsapp-flow-v1 = ACTIVE v1, verify_jwt=true
whatsapp-flow-data-exchange-v1 = ACTIVE v1, verify_jwt=false
```

O código está publicado, mas o runtime Flow permanece desabilitado pelos gates `false`.

---

# HARDENING SECURITY DEFINER — PR #177 + MIGRATION DE PRODUÇÃO

O Supabase Security Advisor identificou quatro funções de infraestrutura `SECURITY DEFINER` que herdavam `EXECUTE` de `PUBLIC` e apareciam como RPC executável por `anon/authenticated`:

```text
ai_job_dispatch_trigger_v2()
ai_job_human_fallback_trigger_v1()
guard_whatsapp_ai_outbound_rate_v1()
message_human_intent_trigger_v1()
```

Cada uma é função de trigger ativa, não API pública:

```text
ai_job_dispatch_trigger_v2            -> ai_job_event_dispatch_v2 / ai_jobs
ai_job_human_fallback_trigger_v1      -> ai_job_human_fallback_v1 / ai_jobs
guard_whatsapp_ai_outbound_rate_v1    -> guard_whatsapp_ai_outbound_rate_v1 / outbound_jobs
message_human_intent_trigger_v1       -> message_human_intent_v1 / messages
```

## PR #177

`#177 — Dona Antônia: hardening RPC das trigger functions + retomada de produção`

Merge:

```text
cca416e7f03e42598c94605bf0d8f92ebf7b2457
```

O CI provou em PGlite que:

- `anon/authenticated` perdem `EXECUTE` direto;
- `service_role` mantém `EXECUTE`;
- os quatro triggers continuam disparando depois da revogação;
- nenhuma função/tabela/trigger é recriada pela migration;
- todos os testes anteriores, `deno check` e `deno test` continuam verdes.

## Migration aplicada em produção

Identificador real atribuído pelo Supabase:

```text
20260908015211 whatsapp_trigger_rpc_hardening_v1
```

Arquivo definitivo versionado:

```text
supabase/migrations/20260908015211_whatsapp_trigger_rpc_hardening_v1.sql
```

Após aplicação, produção confirmou para as quatro funções:

```text
PUBLIC execute = false
anon execute = false
authenticated execute = false
service_role execute = true
trigger enabled = O
```

O Security Advisor foi executado novamente e os WARNs de `anon_security_definer_function_executable` dessas funções desapareceram.

Restam apenas:

- INFO `RLS Enabled No Policy` em tabelas server-only — esperado no desenho atual, com acesso cliente revogado;
- WARN de conta `Leaked Password Protection Disabled` no Supabase Auth — não alterado nesta etapa.

Referências:

```text
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
```

---

# SEGURANÇA FLOW — AUDITORIA ATUAL

As tabelas novas possuem RLS:

```text
whatsapp_flow_transport_config = true
whatsapp_flow_exchange_events = true
whatsapp_flow_request_guard = true
```

RPCs críticos:

```text
get_whatsapp_flow_private_key_v1:
  anon=false
  authenticated=false
  service_role=true

claim_whatsapp_flow_request_v1:
  anon=false
  authenticated=false
  service_role=true

handle_whatsapp_flow_exchange_v1:
  anon=false
  authenticated=false
  service_role=true
```

Auditoria de schema confirmou ausência de colunas de payload/token/chave em logs e replay guard.

---

# WORKER V2 — ARQUITETURA OFICIAL

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

```text
dona_antonia_marin_b_v1
gpt-4o-mini-tts
voice = marin
speed = 1.0
```

Nunca voltar para transcrição → resposta direta.

---

# CESTAS / BLING

Cestas:

- preço comercial próprio;
- não mostrar preço individual dos componentes;
- Bling futuramente recebe componentes individualizados;
- diferença positiva → Outras despesas;
- diferença negativa → desconto;
- IA nunca calcula diferença fiscal;
- pagamento somente na entrega;
- somente entrega.

Bling continua **fora do canary atual**.

Quando houver autorização futura para homologar Bling:

1. um único pedido real controlado;
2. validar contato;
3. validar componentes da cesta;
4. validar diferença fiscal;
5. validar estoque;
6. validar idempotência;
7. sem retry cego;
8. confirmação WhatsApp somente após confirmação do Bling.

---

# PRÓXIMA AÇÃO EXATA

1. manter monitoramento do canary `live=1%`;
2. preservar qualquer `human_handoff` aberto;
3. confirmar CI do PR que versiona a migration `20260908015211` e esta atualização de retomada;
4. integrar essa rastreabilidade em `main`;
5. reauditar canary após o merge, sem DDL adicional;
6. próximo avanço de Flow deve ser **somente preparação/homologação de chave**, ainda sem ligar Data Exchange ou envio;
7. geração/rotação da chave deve acontecer pelo endpoint owner-only já criado, nunca expondo private key ao navegador/chat/GitHub;
8. registrar apenas a chave pública na Meta em etapa separada;
9. criar/publicar Flow real somente em homologação controlada/allowlisted;
10. não elevar `live=1%`, não ativar Bling e não liberar Flow para clientes sem nova autorização explícita.

---

# DOCUMENTOS PRINCIPAIS

- `docs/CANARY-LIVE-1PCT-20260907.md`
- `docs/HOMOLOGACAO-OBSERVE-CANARY-PREFLIGHT-20260907.md`
- `docs/HOMOLOGACAO-WORKER-V2-20260907.md`
- `docs/OPERACAO-WHATSAPP-GRADUAL-V1.md`
- `docs/HOMOLOGACAO-WHATSAPP-REAL-20260907.md`
- `docs/HOMOLOGACAO-WHATSAPP-AUDIO-FINAL-20260907.md`
- `docs/HOMOLOGACAO-WHATSAPP-IMAGEM-FINAL-20260907.md`
- `docs/WHATSAPP-BRIDGE-V3.md`
- `docs/SALA-COMPRA-MOTOR-COMERCIAL-V1.md`
- `docs/PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md`
- `docs/ANALISE-WHATSAPP-FLOWS-COMERCIO-CONVERSACIONAL-V1.md`
- `docs/WHATSAPP-FLOW-TRANSPORT-V1.md`

---

# REGRA DE TRABALHO

- programar blocos grandes, modulares e profissionais;
- baixo custo;
- Make como ponte fina;
- testes perigosos sempre controlados;
- documentar cada marco nesta retomada;
- minimizar passos manuais;
- não repetir etapas concluídas;
- antes de qualquer alteração em produção, auditar gates e handoffs;
- depois de qualquer DDL/deploy, reauditar canary, handoffs, jobs, outbound, pedidos e Security Advisor.

## Instrução para novo chat

> Acesse `osvaldosereia/SUCEDOAN12` e leia primeiro `docs/RETOMADA-DONA-ANTONIA.md`. O canary REAL continua `live=1%` e não pode subir sem nova autorização. Existe um handoff humano aberto em `human_control`, bucket 89, que deve ser preservado. PRs #175, #176 e #177 já foram integradas. As migrations Flow e o hardening `20260908015211 whatsapp_trigger_rpc_hardening_v1` já estão aplicados. As Edge Functions Flow estão publicadas, porém `experience_orchestrator_enabled=false`, `whatsapp_flow_data_exchange_enabled=false`, `whatsapp_flow_send_enabled=false`, sem chave configurada e sem Flow para clientes. Bling continua fora. O Security Advisor não apresenta mais os WARNs das quatro SECURITY DEFINER trigger functions. Continue monitorando `live=1%` e só avance para preparação de chave Flow sem ativar runtime ou clientes.
