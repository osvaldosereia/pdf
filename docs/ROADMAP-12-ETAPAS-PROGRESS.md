# Progresso — Roadmap Dona Antônia 12 etapas

Atualizado em 08/09/2026 UTC.

Este arquivo é o marcador persistente de execução do `docs/ROADMAP-FINAL-DONA-ANTONIA-12-ETAPAS.md`. A próxima rodada deve ler também `docs/RETOMADA-DONA-ANTONIA.md` e continuar da primeira etapa numerada ainda não concluída abaixo.

## ETAPA 1 — Fundação, limpeza e consolidação operacional

**Status programável: concluída e integrada em `main` pela PR #182.**

Consolidado: canary WhatsApp `live=1%`; Flow/orquestrador desligados; handoffs humanos preservados; Security Advisor revisado; cenários Make temporários/teste/Bling inativos; Make mantido somente como ponte fina realtime quando justificado; inventário e CI de custo versionados.

## ETAPA 2 — Pedido real ponta a ponta + Bling

**Status programável: fundação transacional/homologação implementada nesta rodada; homologação real continua bloqueada por autorização explícita.**

### Implementado nesta rodada

- auditoria real confirmou Supabase saudável, `whatsapp_release_mode=live`, `whatsapp_live_canary_percent=1`, Flow/Data Exchange/orquestrador `false` e Make com somente inbound `6779824` + outbound realtime `7290488` ativos entre os cenários Dona Antônia;
- preservada a arquitetura existente de carrinho/cesta com `fiscal_subtotal`, `other_expenses`, `discount` e total comercial separado;
- `confirm_cart_order_v2` torna a confirmação replay-safe por carrinho e chave de idempotência, evitando pedido duplicado quando a resposta do primeiro commit se perde;
- índice único garante no máximo um pedido por carrinho e chave idempotente única quando informada;
- Bling ganha gates próprios em `automation_config`: `bling_order_sync_enabled=false`, `bling_order_homologation_only=true`, `bling_order_max_per_run=1` por padrão;
- criada allowlist server-only `bling_order_homologation_allowlist`; a fila não pode ser criada/claimada em homologação sem pedido explicitamente allowlisted e não expirado;
- `claim_order_sync_jobs` passa a falhar fechado enquanto o gate Bling estiver desligado e limita o lote pelo teto configurado;
- fila Bling recebe guard transacional de estoque local antes do insert em `order_sync_jobs`;
- criada timeline server-only `order_status_events` e RPC `update_order_status_v1` com transições controladas, incluindo `delivered`, `cancelled` e `returned`;
- wrapper `run-bling-order-homologation-v1.mjs` exige confirmação literal `PEDIDO_UNICO_CONTROLADO` e força `ORDER_LIMIT=1` em `--apply`;
- o writer existente continua tratando resposta de criação incerta como `review`, sem retry cego de POST ambíguo;
- CI novo valida gates fail-closed, allowlist, idempotência, pedido único, estoque e tratamento de ambiguidade;
- nenhuma chamada real ao Bling foi executada, nenhum pedido real foi criado e nenhum cenário Bling do Make foi reativado.

### Arquivos da rodada

- `supabase/migrations/20260908030000_order_bling_homologation_foundation_v2.sql`
- `supabase/migrations/20260908030100_order_bling_stock_guard_v1.sql`
- `scripts/run-bling-order-homologation-v1.mjs`
- `scripts/test-order-bling-homologation-foundation-v2.mjs`
- `.github/workflows/dona-antonia-order-bling-foundation.yml`

### Critério restante exclusivamente externo/real

- homologar **um único pedido real controlado** no Bling, allowlisted, validando contato, itens/componentes, diferença fiscal, estoque, retorno do `bling_order_id` e conciliação de status;
- isso não será executado sem autorização explícita futura para homologação real Bling.

### Rollback

1. manter `bling_order_sync_enabled=false` para bloquear qualquer claim;
2. remover/desabilitar allowlist de homologação se houver incidente;
3. reverter as migrations/PR somente se necessário; as novas tabelas/gates nascem dormentes e server-only;
4. nunca reexecutar POST ambíguo no Bling sem reconciliação;
5. não alterar o canary WhatsApp de 1% durante qualquer rollback.

## Próxima etapa

**ETAPA 3 — Núcleo omnichannel e evento normalizado.**

A próxima rodada deve começar pela primeira parte programável da Etapa 3 depois de confirmar que esta PR está verde/integrada e que as migrations dormentes da Etapa 2 estão aplicadas/validadas. Não é necessário aguardar a homologação real Bling para programar o núcleo omnichannel; o teste real permanece como pendência externa da Etapa 2 para a execução 12.
