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

Corte do inbound:

```text
2026-09-07T23:48:18.455344+00:00
```

Make:

```text
inbound 6779824 = active
outbound 7290488 = active
legacy outbound 7290290 = inactive
```

## Eventos reais observados no canary

Auditoria mais recente:

```text
messages = 4
inbound = 4
outbound messages = 0
conversations = 2
ai_jobs = 0
outbound_jobs = 0
orders = 0
order_sync = 0
flow_events = 0
critical_ops_events = 0
```

Conversa 1:

```text
automation_bucket = 89
automation_cohort = human_control
conversation.status = needs_human
mode = human
human_required = true
handoff.status = open
handoff.reason = live_canary_human_control
inbound_count = 3
inbound_types = text, location, other
outbound_count = 0
```

Conversa 2 — novo evento real em `2026-09-08T01:55:07Z`:

```text
automation_bucket = 68
automation_cohort = human_control
conversation.status = needs_human
mode = human
human_required = true
handoff.status = open
handoff.reason = live_canary_human_control
inbound_count = 1
inbound_type = text
outbound_count = 0
```

Execução Make correspondente ao segundo evento:

```text
scenario = 6779824
execution = 87657f81a22f44bebb9596623774e414
status = success
operations = 2
```

Os buckets 89 e 68 estão fora do cohort de 1%. O comportamento correto foi confirmado nas duas conversas: ingestão + handoff humano, sem IA e sem outbound automático.

**Preservar os dois handoffs. Não assumir, resolver ou fechar automaticamente.**

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
- Flow não escreve carrinho enquanto `flow_cart_apply_not_enabled` estiver vigente;
- processamento externo incerto não recebe retry cego;
- job de IA é processado por ID exato;
- gates são rechecados antes de gasto externo;
- segredos e mídias privadas não vão para GitHub/docs;
- não combinar primeira homologação de Flow com primeira homologação real de Bling.

---

# FUNDAÇÃO WHATSAPP FLOW — CONCLUÍDA E DORMENTE EM PRODUÇÃO

## PR #175

`#175 — Dona Antônia: fundação criptografada do WhatsApp Flow Data Exchange`

Merge:

```text
3db08cd83238461fa76d7ea6b0e29f3f6568809b
```

Inclui:

- gates independentes de Data Exchange e envio;
- RSA-OAEP/SHA-256 + AES-128-GCM;
- IV de resposta invertido;
- HTTP 421 para falha de chave RSA;
- private key destinada ao Supabase Vault;
- chave pública/fingerprint operacional;
- token de Flow armazenado somente como SHA-256;
- auditoria sem payload, token cru, private key ou PII;
- handler read-only do Flow de personalização de cesta;
- replay guard por SHA-256 do envelope criptografado;
- TTL do guard de 24 horas;
- máquina de estados `INIT → BASKET_EDIT → BASKET_REVIEW`;
- replay idempotente;
- budget de 40 exchanges por sessão;
- takeover humano revalidado sob lock;
- `BASKET_REVIEW` com `write_enabled=false`.

### Correção Deno/WebCrypto

O `deno check` originalmente falhou pela tipagem mais estrita de `BufferSource` no Deno 2.x. Foi corrigido convertendo explicitamente os buffers para `ArrayBuffer`.

Commits relevantes:

```text
a93c7b712d1153846288aca376f3a431a093b2cc
a63607ec0dec42e3d0f0dbdc4c83aa7b77d190c6
```

## Migrations Flow aplicadas

Lista operacional do Supabase:

```text
20260908013915 whatsapp_flow_transport_foundation_v1
20260908014007 whatsapp_flow_transport_hardening_v1
```

Arquivos históricos no repositório:

```text
supabase/migrations/20260908010000_whatsapp_flow_transport_foundation_v1.sql
supabase/migrations/20260908010100_whatsapp_flow_transport_hardening_v1.sql
```

## Gates atuais

```text
experience_orchestrator_enabled = false
whatsapp_flow_data_exchange_enabled = false
whatsapp_flow_send_enabled = false
whatsapp_flow_max_exchanges_per_session = 40
```

Readiness:

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

# EDGE FUNCTIONS / AUTENTICAÇÃO — PR #176

PR:

`#176 — Dona Antônia: versionar autenticação das Edge Functions de Flow`

Merge:

```text
323c6b3b17331549e04a92364551edf06faaaca9
```

Configuração explícita:

```text
admin-experience-orchestrator-v1  verify_jwt = true
admin-whatsapp-flow-v1            verify_jwt = true
whatsapp-flow-data-exchange-v1    verify_jwt = false
```

Produção:

```text
admin-experience-orchestrator-v1 = ACTIVE v2
admin-whatsapp-flow-v1 = ACTIVE v1
whatsapp-flow-data-exchange-v1 = ACTIVE v1
```

O callback Meta usa `verify_jwt=false` porque a Meta não envia JWT Supabase. O endpoint continua inoperante comercialmente enquanto os gates do banco estiverem `false`.

Teste:

```text
scripts/test-whatsapp-flow-auth-config-v1.mjs
```

---

# HARDENING SECURITY DEFINER — PRs #177/#178

O Security Advisor detectou quatro trigger functions `SECURITY DEFINER` herdando `EXECUTE` de `PUBLIC`:

```text
ai_job_dispatch_trigger_v2()
ai_job_human_fallback_trigger_v1()
guard_whatsapp_ai_outbound_rate_v1()
message_human_intent_trigger_v1()
```

PR #177 merge:

```text
cca416e7f03e42598c94605bf0d8f92ebf7b2457
```

Migration aplicada em produção:

```text
20260908015211 whatsapp_trigger_rpc_hardening_v1
```

PR #178 versionou a migration definitiva e consolidou a rastreabilidade.

Merge:

```text
0922c85f9ad6048464eb4d151a3272129deec174
```

Arquivo definitivo:

```text
supabase/migrations/20260908015211_whatsapp_trigger_rpc_hardening_v1.sql
```

Estado pós-hardening para as quatro funções:

```text
PUBLIC execute = false
anon execute = false
authenticated execute = false
service_role execute = true
trigger enabled = O
```

O Security Advisor foi executado novamente e os WARNs `anon_security_definer_function_executable` dessas funções desapareceram.

Restam:

- INFO `RLS Enabled No Policy` em tabelas server-only — esperado no desenho atual;
- WARN de conta `Leaked Password Protection Disabled` no Auth — não alterado nesta etapa.

Referências:

```text
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
```

---

# PAINEL DORMENTE DE CICLO DE CHAVE FLOW — PR #179

PR:

`#179 — Dona Antônia: painel dormente de ciclo de vida da chave WhatsApp Flow`

Status nesta atualização: **CI verde; aguardando merge**.

O módulo `admin-v3/experience-orchestrator.js`, que continua atrás de:

```text
experienceOrchestratorUiEnabled = false
```

passa a preparar somente operações seguras:

- consultar dashboard/readiness de `admin-whatsapp-flow-v1`;
- mostrar versão da chave, fingerprint e status Meta;
- mostrar/copiar **somente a chave pública**;
- gerar ou rotacionar par RSA apenas se o usuário for `owner`;
- exigir confirmação literal `GERAR_CHAVE_FLOW`;
- bloquear geração/rotação enquanto Data Exchange ou envio estiver ligado;
- falhar fechado se a resposta do backend sugerir vazamento de private key;
- oferecer `disable_transport` como kill switch unilateral;
- **não oferecer nenhuma ação para habilitar Data Exchange, envio, Flow ou orquestrador**.

Teste novo:

```text
scripts/test-whatsapp-flow-key-lifecycle-admin-v1.mjs
```

O teste confirmou:

- UI continua dormente;
- operação de chave é owner-only;
- confirmação literal obrigatória;
- private key não é renderizada;
- chave pública é a única chave exibível;
- não existe ação `enable_transport`/`enable_flow`;
- backend limpa a referência da private key depois de instalar no Vault;
- backend retorna `private_key_returned=false`;
- kill switch só coloca `whatsapp_flow_data_exchange_enabled=false` e `whatsapp_flow_send_enabled=false`.

**Esta PR não gera chave.**

---

# SEGURANÇA FLOW — AUDITORIA ATUAL

RLS:

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

Logs/guard não possuem colunas de payload, token cru, encrypted payload ou private key.

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

Áudio obrigatório:

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

1. integrar PR #179 depois do CI verde — sem gerar chave;
2. reauditar `live=1%`, handoffs, IA/outbound/pedidos após o merge;
3. manter os dois handoffs `human_control` abertos;
4. continuar monitorando eventos reais do canary;
5. próxima etapa externa de Flow será geração controlada do primeiro par de chaves pelo endpoint owner-only;
6. a geração da chave **não** deve ligar Data Exchange/envio/orquestrador;
7. registrar apenas a chave pública na Meta em etapa separada;
8. validar status/assinatura da chave antes de qualquer homologação Data Exchange;
9. criar/publicar Flow real somente em homologação controlada/allowlisted;
10. não elevar `live=1%`, não ativar Bling e não liberar Flow para clientes sem nova autorização explícita.

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
- depois de DDL/deploy, reauditar canary, handoffs, jobs, outbound, pedidos e Security Advisor.

## Instrução para novo chat

> Acesse `osvaldosereia/SUCEDOAN12` e leia primeiro `docs/RETOMADA-DONA-ANTONIA.md`. O canary REAL continua `live=1%` e não pode subir sem nova autorização. Existem dois handoffs humanos abertos em `human_control`, buckets 89 e 68, que devem ser preservados. PRs #175, #176, #177 e #178 já foram integradas; a migration `20260908015211 whatsapp_trigger_rpc_hardening_v1` está aplicada e versionada. As Edge Functions Flow estão publicadas, porém `experience_orchestrator_enabled=false`, `whatsapp_flow_data_exchange_enabled=false`, `whatsapp_flow_send_enabled=false`, sem chave configurada e sem Flow para clientes. Bling continua fora. PR #179 prepara, ainda dormente, o painel de ciclo de vida da chave e não gera chave. Continue monitorando `live=1%` e só avance para homologação de chave sem ativar runtime ou clientes.
