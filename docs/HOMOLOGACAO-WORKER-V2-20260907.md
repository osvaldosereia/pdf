# Homologação operacional — Conversation Worker V2 — 07/09/2026

## Status final

**HOMOLOGADO PONTA A PONTA EM WHATSAPP REAL.**

O Conversation Worker deixou de depender de workflows manuais/one-shot para processar jobs de conversa.

Arquitetura operacional comprovada:

```text
WhatsApp real
→ Meta
→ Make inbound controlado
→ Supabase ingest
→ ai_jobs pending
→ trigger ai_job_event_dispatch_v2
→ dispatch_conversation_worker_job_v2
→ pg_net
→ conversation-worker-v2
→ claim_conversation_job_v2(job exato)
→ OpenAI
→ finish_conversation_job
→ outbound_jobs seller_message
→ Make outbound v3
→ Meta
→ receipt metadata no Postgres
```

## Segurança implantada

- dispatcher nasce fechado;
- `whatsapp_release_mode=off` impede atendimento geral;
- canary nasce em 0%;
- budgets por evento, hora e dia;
- processamento com lease expirado não volta cegamente para pending;
- falha insegura ou budget excedido cai em handoff humano;
- `human_handoffs` e painel Admin de operação;
- emergency stop;
- cron de recovery do dispatcher;
- homologação do Worker V2 usa allowlist temporária e autoexpiração;
- fechamento/expiração desligam também `conversation_worker_dispatch_enabled`;
- provider OpenAI guardado no Supabase Vault;
- segredo do provider nunca é retornado pelo healthcheck;
- instalador one-shot do provider foi removido após a instalação;
- Bling permaneceu fora de toda esta homologação.

## Pull requests / commits principais

- PR #160 — camada operacional, worker event-driven, canary, fallback e Admin;
- PR #161 — provider OpenAI via Vault;
- PR #162 — correção `extensions.digest` para funções `SECURITY DEFINER` com `search_path=''`;
- merge PR #162: `6b34492d46df8014e791fb65eebafd41b9e0cd0e`.

## Edge Function

`conversation-worker-v2`

Produção:

```text
version = 2
verify_jwt = false
custom auth = x-da-worker-key
provider = OpenAI via env ou RPC service-role/Vault
```

`verify_jwt=false` é intencional: a função implementa autenticação interna própria server-to-server, valida hash em `system_secrets` e não expõe a chave do provider.

## Provider OpenAI

Fluxo de instalação concluído:

```text
GitHub Actions secret existente
→ RPC service-role only
→ Supabase Vault
→ hash em system_secrets
→ Worker V2
```

Health confirmado sem revelar segredo:

```json
{
  "provider": "openai",
  "configured": true
}
```

O workflow temporário `install-conversation-worker-provider-once.yml` foi removido depois da instalação.

## Smoke test sintético automático — PASSOU

Canal: `shopping_room`.

Entrada sintética:

`Quero uma cesta básica e também preciso de arroz.`

Resultado:

```text
status = done
attempts = 1
worker_dispatch_attempts = 1
intent = baskets
model = gpt-4o-mini
input_tokens = 195
output_tokens = 31
HTTP worker = 200
outbound_job_id = null
```

A prova usou o trigger real `ai_job_event_dispatch_v2`; não houve chamada manual ao Worker.

Todos os dados sintéticos foram apagados depois da prova.

---

# Homologação real allowlisted — PASSOU

Mensagem real enviada pelo telefone de teste allowlisted:

`Quero uma cesta básica e também preciso de arroz`

## Inbound Make

Cenário:

`6779824 — Dona Antônia - WhatsApp Inbound Controlado v1`

Execução da mensagem:

`e416645ea7ae47ae98138f5642c8821d`

Resultado do ingest:

```text
should_reply = true
action = needs_ai
reply_type = none
mode = ai
```

O Make não respondeu diretamente. Ele apenas persistiu/enfileirou o evento, deixando a resposta para o pipeline assíncrono oficial.

Mensagem inbound:

`d5f288dc-597b-4f13-951f-6e26bc2e3a17`

AI job:

`c86a7476-312f-4865-ac70-ad9a437676b2`

## Worker V2 real

Resultado:

```text
status = done
attempts = 1
worker_dispatch_attempts = 1
worker_dispatch_request_id = 15
intent = baskets
error = null
```

Interpretação:

`Cliente busca cesta básica e arroz.`

Resposta determinística:

`Claro. Posso te mostrar as cestas disponíveis e ajudar a personalizar os itens.`

OpenAI:

```text
model = gpt-4o-mini
input_tokens = 194
output_tokens = 29
provider_request_id = registrado
```

## Outbound real

Outbound job:

`240adb9b-ede8-4ed1-bfc6-ecffa0139c63`

Resultado:

```text
status = sent
attempts = 1
delivery_mode = text
dispatch_response_status = 200
provider_message_id = presente
last_error = null
```

Mensagem outbound:

`9898a5f1-5a12-4c89-8d19-d76aaa9bf0b8`

Receipt metadata:

```text
delivery_status = sent
whatsapp_message_id = presente
```

Cenário outbound:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Execução:

`82b0a21a195a43799b3bd5322a37717f`

Módulos executados sem erro:

```text
1  webhook inbound do job
4  enviar mensagem de texto pela Meta
11 responder receipt ao Supabase
```

## Auditoria de efeitos colaterais

Durante o teste real:

```text
active_ai_jobs = 0
active_outbound = 0
orders criados = 0
order_sync_jobs criados = 0
bling_commands criados = 0
```

Portanto, o Worker V2 foi comprovado em produção sem qualquer efeito em pedido ou Bling.

## Fechamento

Depois da prova:

```text
whatsapp_release_mode = off
whatsapp_inbound_enabled = false
whatsapp_auto_reply_enabled = false
ai_enabled = false
conversation_worker_enabled = false
conversation_worker_dispatch_enabled = false
active_ai_jobs = 0
active_outbound = 0
```

Make inbound `6779824` voltou para **inativo**.

Make outbound `7290488` pode permanecer ativo, pois depende de jobs legítimos e não cria atendimento por conta própria.

---

# Próximo passo

O Worker V2 automático está homologado e não é mais necessário criar workflows one-shot para texto normal.

Próxima etapa segura:

1. testar/validar modo `observe` com atendimento real sem auto-resposta;
2. validar fila/fallback humano no Admin;
3. revisar métricas, budgets e emergency stop no painel;
4. somente depois preparar um canary `live` mínimo e explicitamente confirmado;
5. manter Bling fora até concluir o canary de atendimento;
6. só então homologar **um único pedido real controlado no Bling**.

Não ativar atendimento geral nem Bling indiscriminadamente.
