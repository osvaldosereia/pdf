# Progresso — Roadmap Dona Antônia 12 etapas

Atualizado em 08/09/2026 UTC.

Este arquivo é o marcador persistente de execução do `docs/ROADMAP-FINAL-DONA-ANTONIA-12-ETAPAS.md`. A próxima rodada deve ler também `docs/RETOMADA-DONA-ANTONIA.md` e continuar da primeira etapa numerada ainda não concluída abaixo.

## ETAPA 1 — Fundação, limpeza e consolidação operacional

**Status programável: concluída e integrada em `main` pela PR #182.**

Consolidado: canary WhatsApp `live=1%`; Flow/orquestrador desligados; handoffs humanos preservados; Security Advisor revisado; cenários Make temporários/teste/Bling inativos; Make mantido somente como ponte fina realtime quando justificado; inventário e CI de custo versionados.

## ETAPA 2 — Pedido real ponta a ponta + Bling

**Status programável: concluída e integrada em `main` pela PR #183. Homologação Bling real permanece pendência externa deliberadamente bloqueada.**

Produção mantém `bling_order_sync_enabled=false`, homologação allowlist-only, lote máximo 1 e nenhum pedido/job real criado pela etapa. Migrations aplicadas: `20260908024746 order_bling_homologation_foundation_v2` e `20260908024845 order_bling_stock_guard_v1`. Homologação de um único pedido real fica registrada para a Etapa 12 e exige autorização explícita.

## ETAPA 3 — Núcleo omnichannel e evento normalizado

**Status programável: implementada nesta rodada em PR própria; Instagram/Messenger permanecem dormentes.**

### Implementado

- `conversations.channel` preparado para `instagram` e `messenger`, preservando `whatsapp`, `web` e `hybrid`;
- `channel_accounts` centraliza contas por canal e nasce fail-closed: `status=dormant`, inbound/IA/auto-reply/outbound `false`, canary `0%`;
- `customer_channel_identities` modela E.164, IGSID, PSID, identidade web/e-mail sem unificação automática por nome; novas identidades nascem apenas `observed`;
- `channel_raw_events` guarda somente hash SHA-256 e referência segura opcional, evitando colocar payload cru no motor central;
- `normalized_channel_events` implementa contrato comum com canal, conta, usuário externo, mensagem/evento externo, direção, tipo, reply-to, source, referral, timestamp, mídia normalizada e referência ao evento bruto;
- índices únicos garantem idempotência por canal/conta/mensagem externa ou evento externo;
- `ingest_normalized_channel_event_v1` é server-only, replay-safe e mantém evento `held` quando o canal não estiver explicitamente habilitado; web permanece compatível com a Sala existente;
- nenhuma conta Instagram/Messenger é criada/ativada pela migration; nenhuma chamada Meta é feita;
- CI GitHub Actions valida o contrato e os defaults fail-closed sem gastar créditos Make.

### Auditoria desta rodada

- GitHub: Etapas 1 e 2 confirmadas em `main` pelo marcador persistente antes da alteração;
- Make: WhatsApp inbound `6779824` e outbound realtime `7290488` continuam ativos; nenhuma nova automação Make foi criada para a Etapa 3;
- Supabase: tentativa de leitura nesta rodada foi recusada pelo conector por permissão; por segurança não houve escrita/DDL em produção antes de CI. O estado autoritativo imediatamente anterior permanece canary `live=1%`, três handoffs humanos abertos e Bling/Flow/orquestrador desligados até nova auditoria permitida.

### Arquivos

- `supabase/migrations/20260908032000_omnichannel_event_core_v1.sql`
- `scripts/test-omnichannel-event-core-v1.mjs`
- `.github/workflows/dona-antonia-omnichannel-core.yml`

### Regra de integração

Só integrar/aplicar a migration depois de CI verde. Após DDL, reauditar gates, handoffs, pedidos/jobs e confirmar que Instagram/Messenger continuam sem conta ativa, inbound, IA ou outbound.

## Próxima etapa

Quando a PR da Etapa 3 estiver verde, integrar e aplicar a migration dormente; em seguida a próxima execução deve atacar **ETAPA 4 — Adapters, renderers e gates independentes**, sem depender de permissões Meta externas.
