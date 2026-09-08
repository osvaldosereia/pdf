# Progresso — Roadmap Dona Antônia 12 etapas

Atualizado em 08/09/2026 UTC.

Este arquivo é o marcador persistente de execução do `docs/ROADMAP-FINAL-DONA-ANTONIA-12-ETAPAS.md`. A próxima rodada deve ler também `docs/RETOMADA-DONA-ANTONIA.md` e continuar da primeira etapa numerada ainda não concluída abaixo.

## ETAPA 1 — Fundação, limpeza e consolidação operacional

**Concluída.** PR #182 integrada. Canary WhatsApp permanece `live=1%`; Flow/orquestrador desligados; handoffs humanos preservados; Make consolidado com pontes realtime justificadas e batch priorizado em GitHub Actions.

## ETAPA 2 — Pedido real ponta a ponta + Bling

**Parte programável concluída.** PR #183 integrada; migrations `20260908024746 order_bling_homologation_foundation_v2` e `20260908024845 order_bling_stock_guard_v1` aplicadas. Bling continua desligado, allowlist-only e lote máximo 1. Homologação de um único pedido real permanece pendência externa para a Etapa 12.

## ETAPA 3 — Núcleo omnichannel e evento normalizado

**Concluída e aplicada nesta rodada.** PR #185 integrada em `main` após CI verde. Migration `omnichannel_event_core_v1` aplicada em produção.

Auditoria pós-DDL:
- `whatsapp_live_canary_percent=1` preservado;
- `experience_orchestrator_enabled=false`;
- `whatsapp_flow_data_exchange_enabled=false`;
- `whatsapp_flow_send_enabled=false`;
- `bling_order_sync_enabled=false`;
- existem 3 handoffs humanos abertos, preservados;
- `channel_accounts` está vazio: nenhuma conta Instagram/Messenger/Web adicional foi criada ou ativada.

Entregas: `channel_accounts`, `customer_channel_identities`, `channel_raw_events`, `normalized_channel_events`, contrato idempotente e RPC server-only `ingest_normalized_channel_event_v1`.

## ETAPA 4 — Adapters, renderers e gates independentes

**Status programável: implementada nesta rodada em PR própria; nenhum canal novo ativado.**

### Implementado

- `lib/omnichannel/channel-runtime-v1.mjs` define WA Adapter, Web/Sala Adapter, Instagram Adapter e Messenger Adapter sobre o mesmo envelope interno;
- `CAPABILITY_REGISTRY` descreve suporte por canal para texto, imagem, áudio, botões, quick replies, cards, carrosséis e Flow;
- gates continuam independentes por conta/canal: inbound, IA, auto-reply, outbound e canary; o runtime bloqueia outbound quando `outbound_enabled=false`;
- decisão comercial fica neutra ao canal (`mission`, `cards`, `buttons`, `quick_replies`), sem acoplar regra comercial à API Meta;
- renderer seleciona apresentação por capacidade e aplica fallback determinístico quando o canal não suporta o recurso;
- exemplo neutro `mission=show_three_baskets` pode virar carrossel em WA/IG/Messenger/Web, sem duplicar regra de venda;
- fallback testado: quick replies no WhatsApp degradam para texto, enquanto Instagram/Messenger/Web podem preservá-las;
- limites de botões/carrossel são aplicados no renderer, não no cérebro comercial;
- adapters e renderers são funções puras, sem chamadas externas, sem credenciais e sem possibilidade de ativar Meta;
- CI em GitHub Actions valida adapters, gates, capacidades e fallbacks; nenhuma automação Make foi adicionada.

### Segurança operacional

- Instagram/Messenger continuam sem `channel_accounts` em produção;
- nenhuma flag global libera todos os canais;
- nenhuma alteração foi feita no canary WhatsApp de 1%;
- nenhum handoff humano foi alterado;
- nenhum Flow, Bling, Meta Ads, Google Ads ou marketing foi ativado.

### Arquivos

- `lib/omnichannel/channel-runtime-v1.mjs`
- `scripts/test-channel-runtime-v1.mjs`
- `.github/workflows/dona-antonia-channel-runtime.yml`

## Próxima etapa

Após CI verde e integração da PR desta etapa, a próxima execução deve atacar **ETAPA 5 — CRM unificado, identidades e caixa de entrada única**, generalizando inbox/handoffs por canal e vínculo seguro de identidades sem depender de permissões externas Meta.
