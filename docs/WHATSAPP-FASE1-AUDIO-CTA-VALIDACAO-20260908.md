# WhatsApp — Fase 1 — validação de áudio e botão CTA — 08/09/2026

## Objetivo

Validar as duas pendências de UX/operação levantadas após o checkpoint final da Fase 1:

1. transformar o acesso à vitrine em botão que abra a URL diretamente;
2. confirmar que o atendimento continua pronto para receber áudio e responder em áudio no estado atual de produção controlada.

## Estado de segurança preservado

Auditado no Supabase em 08/09/2026:

```text
whatsapp_release_mode=live
whatsapp_live_canary_percent=1
whatsapp_inbound_enabled=true
whatsapp_auto_reply_enabled=true
ai_enabled=true
whatsapp_sales_mvp_enabled=true
whatsapp_sales_interactive_enabled=true
whatsapp_flow_data_exchange_enabled=false
whatsapp_flow_send_enabled=false
bling_order_sync_enabled=false
experience_orchestrator_enabled=false
```

Nenhum gate foi ampliado nesta rodada.

## Áudio — resultado da validação

A arquitetura de áudio já havia sido homologada ponta a ponta em produção controlada:

```text
WhatsApp real
→ Meta Cloud API
→ Make inbound
→ download OGG/Opus
→ Storage privado Supabase
→ transcription job
→ gpt-4o-mini-transcribe
→ transcript/body_text
→ conversation job
→ gpt-4o-mini
→ resposta
→ outbound
→ gpt-4o-mini-tts / Marin B
→ upload Meta
→ sendMessage audio
→ Meta HTTP 200
```

A auditoria de 08/09/2026 encontrou três outbound de áudio recentes já reconciliados como `sent`, todos com `dispatch_response_status=200`, `provider_message_id` presente e `last_error=null`.

Também foram encontrados áudios inbound recentes sem transcrição. Eles não representam regressão: os registros estavam deliberadamente em:

```text
room_media.processing_status=held
ai_jobs.job_type=transcription
ai_jobs.status=held
ai_jobs.attempts=0
```

Isso é compatível com o canary de 1%/fail-closed: mensagens fora do cohort autorizado são preservadas, mas não processadas automaticamente.

Nos áudios que entraram no caminho liberado, houve transcrição normal em 08/09/2026, inclusive mensagens comerciais naturais como busca de produto, pedido com vários itens e solicitação de opções.

### Conclusão de áudio

**O atendimento está pronto para receber áudio e responder em áudio dentro do cohort autorizado do canary de 1%.**

Não liberar processamento dos itens `held` fora do canary apenas para aumentar cobertura; isso violaria o rollout controlado.

## Vitrine como botão — análise técnica

O WhatsApp Cloud API atual suporta mensagem interativa de CTA URL (`interactive.type=cta_url`), em que um botão abre diretamente uma URL externa. Esse é o UX correto para `Abrir vitrine`.

Entretanto, o módulo nativo `WhatsApp Business Cloud > Send a Message` disponível no Make e usado pelo cenário oficial atual expõe apenas os tipos interativos:

```text
list
button (reply button)
```

Ele não expõe `cta_url` no schema do módulo.

O cenário oficial atual `7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3` já possui rotas para:

- texto;
- áudio Marin B;
- imagem;
- reply buttons;
- list messages.

A conexão oficial do WhatsApp está saudável.

### Decisão

Não substituir a URL atual por um reply button que apenas devolva texto ao webhook, porque isso criaria um botão visualmente parecido com um link, mas exigiria uma interação adicional e não abriria a vitrine diretamente.

Também não criar transporte HTTP paralelo com token duplicado/hardcoded apenas para contornar a limitação do módulo Make. Isso aumentaria superfície de segredo, manutenção e risco operacional sem necessidade para o canary atual.

### Caminho profissional para o CTA

Implementar `cta_url` somente quando o transporter puder usar uma das alternativas seguras:

1. suporte nativo do módulo oficial do Make a `cta_url`; ou
2. chamada autorizada à Graph API reutilizando credencial gerenciada, sem token hardcoded; ou
3. template Meta aprovado com botão URL, se a política de janela/template exigir esse caminho.

Até lá, manter a URL HTTPS clicável com `preview_url=true`, que já está configurado no outbound de texto.

## Make auditado

Cenários WhatsApp ativos:

```text
6779824 — Dona Antônia - WhatsApp Inbound Controlado v1
7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3
```

O outbound oficial teve execução recente `success` em 08/09/2026 e a conexão Meta usada pelos módulos está `ok`.

Nenhum cenário adicional foi ativado.

## Pendências reais

- CTA URL direto da vitrine: desejável, mas bloqueado pela capacidade atual do módulo nativo do Make; não é bloqueador da Fase 1 porque a URL HTTPS permanece clicável e com preview habilitado.
- Áudio: sem pendência funcional conhecida dentro do cohort autorizado; continuar observação no canary.
- Continuar preservando `canary=1%`, Bling OFF, Flow OFF e Experience Orchestrator OFF até nova autorização explícita.

## Status final

```text
ÁUDIO RECEBER: PRONTO NO CANARY
ÁUDIO RESPONDER: PRONTO NO CANARY
VITRINE URL CLICÁVEL: PRONTO
VITRINE CTA URL DIRETO: PENDENTE DE TRANSPORTER SEGURO
CANARY: 1%
BLING: OFF
FLOW: OFF
```
