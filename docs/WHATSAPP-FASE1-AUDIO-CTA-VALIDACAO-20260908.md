# WhatsApp — Fase 1 — validação de áudio e botão CTA — 08/09/2026

## Objetivo

Validar as duas pendências de UX/operação levantadas após o checkpoint final da Fase 1:

1. transformar o acesso à vitrine em botão que abra a URL diretamente;
2. confirmar que o atendimento continua pronto para receber áudio e responder em áudio no estado atual de produção controlada.

## Estado de segurança preservado

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

O canary global continua em 1%; Bling, Flow/Data Exchange e Experience Orchestrator continuam OFF.

## Áudio

Áudio permanece homologado ponta a ponta no cohort autorizado, com transcrição, resposta por IA e TTS Marin B.

## CTA URL — evolução em 09/09/2026

O CTA URL foi homologado com sucesso em chamada real à Meta Cloud API usando credencial HTTP gerenciada pelo Make, sem token hardcoded no cenário.

### Make

- cenário configurável: `7315702 — Dona Antônia - CTA URL Cesta (configurável)`;
- credencial HTTP gerenciada usada pelo transporter CTA;
- cenário oficial `7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3` recebeu rota própria para `delivery_mode=interactive` + `interactive.type=cta_url`;
- resposta da Meta é reconciliada pelo `provider_message_id` retornado pela Graph API.

O cenário configurável aceita destinatário, nome da cesta, URL e texto do botão. O padrão do botão é:

```text
Ver Cesta
```

### Supabase

Migration aplicada em produção:

```text
20260909033656 whatsapp_basket_cta_url_v1
```

A fila `queue_whatsapp_sales_reply_v1` passou a aceitar `interactive.type=cta_url` com validações fail-closed:

- action deve ser `cta_url`;
- URL obrigatoriamente HTTPS;
- label obrigatória;
- body obrigatório.

Ao cliente escolher uma cesta na lista, o roteador determinístico agora cria a sessão da cesta e responde com:

```text
Cesta escolhida: <NOME DA CESTA> — R$ <PREÇO>.
Toque em Ver Cesta para ver a foto, os produtos e ajustar as quantidades.
```

seguido do botão URL direto:

```text
Ver Cesta
```

O botão abre a URL individual da sessão `/cesta/?t=<token>` da cesta escolhida.

## Teste real

Teste real concluído com sucesso no número de homologação. O cenário configurável enviou a cesta `Média Koblenz` com botão `Ver Cesta` apontando para a sessão real da cesta. Execução Make concluída como `success`.

## Chat de homologação controlada

O número de teste do proprietário foi colocado temporariamente na allowlist existente com `purpose=controlled_live_homologation`, validade de 24 horas. O handoff aberto de `live_canary_human_control` desse número foi resolvido e a conversa voltou para `mode=ai` para permitir testes livres do atendimento.

Decisão confirmada após a alteração:

```text
mode=live
cohort=homologation
reason=controlled_live_homologation
profile=automation_test
allow_ingest=true
auto_reply_allowed=true
canary_percent=1
```

Isso libera apenas o número de homologação, sem aumentar o canary global.

## Status final

```text
ÁUDIO RECEBER: PRONTO NO CANARY/HOMOLOGAÇÃO
ÁUDIO RESPONDER: PRONTO NO CANARY/HOMOLOGAÇÃO
CTA URL DIRETO: PRONTO
BOTÃO CESTA: Ver Cesta
CENÁRIO OFICIAL CTA: CONFIGURADO
CHAT DO NÚMERO DE TESTE: LIBERADO POR 24H
CANARY GLOBAL: 1%
BLING: OFF
FLOW: OFF
EXPERIENCE ORCHESTRATOR: OFF
```
