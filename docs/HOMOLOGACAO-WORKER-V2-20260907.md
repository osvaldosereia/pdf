# Homologação operacional — Conversation Worker V2 — 07/09/2026

## Resultado desta etapa

O Conversation Worker deixou de depender do workflow manual/one-shot para processar jobs de conversa.

Arquitetura operacional validada:

```text
ai_jobs pending
→ trigger ai_job_event_dispatch_v2
→ dispatch_conversation_worker_job_v2
→ pg_net
→ conversation-worker-v2
→ claim_conversation_job_v2(job exato)
→ OpenAI
→ finish_conversation_job
→ mensagem interna / outbound controlado conforme canal
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
- homologação de Worker V2 com allowlist temporária e autoexpiração;
- fechamento/expiração desligam também `conversation_worker_dispatch_enabled`;
- provider OpenAI guardado no Supabase Vault;
- segredo do provider nunca é retornado pelo healthcheck;
- instalador one-shot do provider foi removido após a instalação.

## Pull requests / commits principais

- PR #160 — camada operacional, worker event-driven, canary, fallback e Admin;
- PR #161 — provider OpenAI via Vault;
- PR #162 — correção `extensions.digest` para funções `SECURITY DEFINER` com `search_path=''`;
- merge PR #162: `6b34492d46df8014e791fb65eebafd41b9e0cd0e`.

## Edge Function

`conversation-worker-v2`

Produção após esta rodada:

```text
version = 2
verify_jwt = false
custom auth = x-da-worker-key
provider = OpenAI via env ou RPC service-role/Vault
```

`verify_jwt=false` é intencional: a função implementa autenticação interna própria com chave server-to-server, hash em `system_secrets` e chave plaintext somente no Vault.

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

Job:

`4902159b-c877-40c4-8e86-05be6962f395`

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

Resposta determinística interna:

`Você pode conferir as cestas e personalizar os itens.`

A prova usou o trigger real `ai_job_event_dispatch_v2`; não houve chamada manual ao Worker.

Após o teste:

- gates IA/worker/dispatcher foram fechados;
- conversa, mensagem, job e sessão sintéticos foram removidos;
- `ai_jobs pending/processing = 0`;
- `outbound_jobs pending/processing = 0`;
- `order_sync_jobs pending/processing = 0`;
- nenhum efeito em Meta ou Bling.

## Homologação real allowlisted — EM ANDAMENTO

Depois do smoke test, foi validado:

- Make inbound `6779824 — Dona Antônia - WhatsApp Inbound Controlado v1` estava inativo e foi reativado;
- Make outbound `7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3` está ativo;
- `arm_whatsapp_homologation_ai_v2(...)` foi acionado para um único telefone de teste, sem versionar o número;
- janela temporária de 30 minutos;
- `whatsapp_release_mode=homologation`;
- IA, worker e dispatcher ligados somente dentro da janela controlada;
- autoexpiração fecha todos os gates.

### Próximo passo exato

Enviar pelo WhatsApp de teste a frase:

`Quero uma cesta básica e também preciso de arroz.`

Depois inspecionar:

1. execução Make inbound;
2. mensagem inbound persistida;
3. `ai_job` criado automaticamente;
4. trigger event-driven → Worker V2;
5. uso OpenAI;
6. `outbound_job seller_message`;
7. Make outbound v3;
8. provider message id da Meta;
9. zero `orders`, `order_sync_jobs` e `bling_commands` provocados pelo teste;
10. fechar homologação imediatamente após a prova.

Não ativar `live` nem Bling nesta etapa.
