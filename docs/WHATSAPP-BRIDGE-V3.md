# Dona Antônia — WhatsApp Bridge v3

Atualizado em 07/09/2026.

Este documento descreve a arquitetura operacional atual da Etapa 3 do atendimento WhatsApp. Ele complementa `docs/RETOMADA-DONA-ANTONIA.md` e deve ser lido antes de qualquer homologação real do canal.

## Objetivo

Permitir atendimento WhatsApp oficial com:

- entrada de texto, áudio, imagem e interativos;
- identificação idempotente de cliente/conversa;
- mídia privada no Supabase Storage;
- transcrição/visão/conversa por IA somente quando os gates permitirem;
- resposta em texto ou áudio;
- voz oficial `dona_antonia_marin_b_v1`;
- zero dependência do Bling durante esta etapa;
- fail-closed em qualquer estado ambíguo.

## Arquitetura atual

```text
Meta WhatsApp Cloud
        │
        ▼
Make — WhatsApp Inbound Controlado v1
        │
        ▼
whatsapp-ingest-make-v1 / whatsapp-ingest
        │
        ▼
Supabase Postgres + Storage privado
        │
        ├── regras determinísticas
        ├── ai_jobs (quando gates de IA estão ligados)
        └── outbound_jobs seller_message
                     │
                     ▼
             trigger Postgres
                     │
                     ▼
                  pg_net
                     │
                     ▼
Make — WhatsApp Outbound Event-Driven v3
        │                      │
        │ texto                │ áudio
        ▼                      ▼
Meta sendMessage        OpenAI TTS Marin B
                               │
                               ▼
                         Meta uploadMedia
                               │
                               ▼
                         Meta sendMessage
        │                      │
        └──────────┬───────────┘
                   ▼
          Webhook Response 200
                   │
                   ▼
          net._http_response
                   │
                   ▼
       reconciliação Postgres
                   │
          provider_message_id
```

O Make não é backend. Ele funciona como ponte fina para a Meta e, no áudio, para o endpoint TTS da OpenAI.

## Cenários Make

### Inbound

Scenario ID: `6779824`

Nome atual:

`Dona Antônia - WhatsApp Inbound Controlado v1`

Fluxo:

1. trigger oficial WhatsApp Business Cloud;
2. filtro de mensagens reais da conta correta;
3. POST urlencoded para `whatsapp-ingest-make-v1`;
4. resposta determinística com botões/texto quando autorizada;
5. para áudio/imagem: download da Meta;
6. multipart para `whatsapp-ingest`;
7. Storage privado + `ai_jobs`.

Os dois módulos HTTP v4 usam explicitamente:

- stop on HTTP error;
- timeout;
- redirects;
- cookies desativados;
- compressed response habilitada.

Isso corrigiu o `BundleValidationError` que ocorria quando os campos avançados não eram materializados no blueprint.

O cenário aceita ativação normalmente, mas deve permanecer desligado fora de uma janela de homologação controlada até a liberação final do canal.

### Outbound oficial

Scenario ID: `7290488`

Nome:

`Dona Antônia - WhatsApp Outbound Event-Driven v3`

Ele permanece ativo porque somente eventos válidos enviados pelo backend acionam rotas de entrega.

Não possui HTTP de callback para Supabase. O job completo chega no webhook já bloqueado pelo Postgres. O cenário:

- envia texto diretamente pela Meta; ou
- gera TTS `gpt-4o-mini-tts` com voz `marin`, configuração B, faz upload para a Meta e envia como áudio nativo;
- devolve sincronamente ao `pg_net` apenas:
  - `ok`;
  - `job_id`;
  - `provider_message_id`;
  - `delivery_mode`.

A resposta fica armazenada em `net._http_response` e é reconciliada no banco.

### Outbound legado

Scenario ID: `7290290`

Nome:

`LEGACY - NÃO USAR - WhatsApp Outbound HTTP v1`

Mantido inativo apenas como referência técnica. Não usar em produção.

## Edge Functions

### `whatsapp-ingest`

Produção: versão 3 no fechamento desta rodada.

- custom auth por `x-da-ingest-key` validado por hash server-only;
- `verify_jwt=false` por ser webhook com autenticação própria;
- normaliza Make flat e payload nativo;
- aceita áudio/imagem privados até 10 MiB;
- valida MIME;
- idempotência por mensagem/mídia;
- não contém Bling;
- quando o banco retorna `ignored=true`, responde sem `media_kind`/`media_id`, impedindo download de mídia bloqueada no Make.

### `whatsapp-ingest-make-v1`

Adaptador fino para o formulário/urlencoded do Make.

### `whatsapp-outbound-v1`

Produção: versão 4 no fechamento desta rodada.

O protocolo antigo `claim/finish` foi desativado. A função serve somente health/status autenticado. `claim` ou `finish` retorna `410 deprecated_event_driven_v3`.

O transporte real agora é Postgres + `pg_net` + webhook Make v3.

## Gates de release

`automation_config` possui gates independentes:

- `automation_enabled`;
- `outbound_enabled`;
- `ai_enabled`;
- `conversation_worker_enabled`;
- `whatsapp_inbound_enabled`;
- `whatsapp_auto_reply_enabled`;
- `whatsapp_inbound_since`;
- `whatsapp_release_mode`.

`whatsapp_release_mode`:

- `off`: nada entra;
- `observe`: entrada permitida sem exigir allowlist, mas respostas continuam sujeitas aos demais gates;
- `homologation`: somente números na allowlist temporária;
- `live`: canal geral, ainda sujeito aos demais gates.

Deploys de segurança terminam em `off`.

## Corte anti-backlog

Mensagens anteriores a `whatsapp_inbound_since` são ignoradas antes de qualquer persistência de cliente/conversa.

A Edge também zera rotas de resposta/mídia para eventos ignorados.

## Homologação controlada

Tabela server-only:

`whatsapp_test_allowlist`

RPCs:

- `arm_whatsapp_homologation_v1(phone, minutes)`;
- `close_whatsapp_homologation_v1()`;
- `expire_whatsapp_homologation_v1()`;
- `whatsapp_release_decision(phone, timestamp)`.

Ao armar:

- somente um telefone runtime fica habilitado;
- janela limitada a 5–180 minutos;
- `whatsapp_release_mode=homologation`;
- inbound e auto-reply ficam habilitados para esse teste;
- IA e conversation worker continuam desligados inicialmente;
- cutover é atualizado para `now()`.

Cron `dona-antonia-whatsapp-homologation-expiry-v1` roda a cada minuto e fecha automaticamente quando a allowlist expira.

Nenhum número de teste é versionado no GitHub.

## Outbound v3 — protocolo

Migration principal:

`20260907194000_whatsapp_outbound_webhook_response_v3.sql`

### Dispatch

`dispatch_whatsapp_outbound_job(job_id)`:

1. valida todos os gates;
2. valida job exato `seller_message/conversation_reply`;
3. valida janela de 24h e conversa em modo IA;
4. valida body;
5. carrega voice profile se áudio;
6. lê webhook do Make no Vault;
7. coloca job em `processing` com lock `pgnet-make-outbound-v3`;
8. incrementa attempt/dispatch attempt;
9. envia o job completo via `net.http_post`;
10. guarda `last_dispatch_request_id`.

### Reconciliação

`reconcile_whatsapp_outbound_responses_v3()` exige:

- HTTP 2xx;
- sem timeout/error;
- JSON objeto;
- `ok=true`;
- `job_id` exatamente igual;
- `delivery_mode` exatamente igual;
- `provider_message_id` não vazio.

Somente então chama `finish_outbound_job(... success=true ...)`.

Se houver dúvida após a possibilidade de envio, o job recebe:

`delivery_uncertain_review_required`

e é empurrado para uma data muito futura para impedir retry automático.

Não há retry cego após um envio potencialmente iniciado.

## Recuperação segura

`recover_whatsapp_outbound_dispatch()`:

- primeiro reconcilia respostas já existentes;
- redispara apenas falhas em que ainda não poderia ter ocorrido envio real, como erro ao enfileirar pg_net/webhook ausente/voice profile indisponível;
- nunca redispara `review_required`.

Cron existente:

`dona-antonia-whatsapp-outbound-recovery-v2`

## Healthcheck

RPC:

`get_whatsapp_bridge_health_v1()`

Retorna:

- release mode;
- gates;
- allowlist ativa;
- pending/processing/error/review_required de outbound;
- ai_jobs;
- última entrada WhatsApp;
- tráfego da última hora;
- status dos crons.

Healthcheck de transporte:

`dispatch_whatsapp_outbound_healthcheck_v3()`

Ele manda somente `event=healthcheck`. O Make responde:

`{"ok":true,"event":"healthcheck","sent":false}`

Essa rota não chama Meta nem OpenAI.

## Emergency stop

RPC:

`whatsapp_bridge_emergency_stop_v1(reason)`

Ação:

- fecha release mode;
- desliga inbound;
- desliga auto reply;
- desliga IA/worker;
- desabilita allowlist;
- cancela seller messages ainda não enviados;
- jobs já em processing vão para `review_required`, não são reenviados.

## Estado auditado no fechamento da rodada

- `release_mode=off`;
- `whatsapp_inbound_enabled=false`;
- `whatsapp_auto_reply_enabled=false`;
- `ai_enabled=false`;
- `conversation_worker_enabled=false`;
- allowlist ativa = 0;
- seller_message pending = 0;
- seller_message processing = 0;
- seller_message error = 0;
- AI pending/processing/error = 0;
- mensagens WhatsApp reais nesta etapa = 0;
- nenhum pedido Bling criado/modificado.

O healthcheck Supabase → Make v3 retornou HTTP 200 e `sent=false`.

A allowlist foi testada somente com telefone fictício e fechada imediatamente.

## Próxima homologação real

Não ativar produção geral.

Ordem recomendada:

1. confirmar health verde;
2. armar `arm_whatsapp_homologation_v1()` para o telefone de teste do usuário por 30–60 min;
3. ativar o cenário inbound `6779824`;
4. usuário envia uma mensagem de texto nova;
5. confirmar ingest + welcome/menu determinístico com IA desligada;
6. ligar IA/worker somente para allowlist;
7. testar texto IA;
8. testar áudio inbound + transcrição + resposta Marin B;
9. testar imagem inbound + visão;
10. fechar homologação;
11. auditar zero efeito Bling;
12. somente depois discutir `release_mode=live`.

Até esse ponto o Bling permanece fora do fluxo real.
