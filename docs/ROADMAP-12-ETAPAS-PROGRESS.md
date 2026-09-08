# Progresso — Roadmap Dona Antônia 12 etapas

Atualizado em 08/09/2026 UTC.

Este arquivo é o marcador persistente de execução do `docs/ROADMAP-FINAL-DONA-ANTONIA-12-ETAPAS.md`. A próxima rodada deve ler também `docs/RETOMADA-DONA-ANTONIA.md` e continuar da primeira etapa numerada ainda não concluída abaixo.

## ETAPA 1 — Fundação, limpeza e consolidação operacional

**Status programável: concluída e integrada em `main` pela PR #182.**

Consolidado: canary WhatsApp `live=1%`; Flow/orquestrador desligados; handoffs humanos preservados; Security Advisor revisado; cenários Make temporários/teste/Bling inativos; Make mantido somente como ponte fina realtime quando justificado; inventário e CI de custo versionados.

## ETAPA 2 — Pedido real ponta a ponta + Bling

**Status programável: concluída e integrada em `main` pela PR #183. Homologação Bling real permanece pendência externa deliberadamente bloqueada.**

### Implementado e validado

- preservada a arquitetura de carrinho/cesta com `fiscal_subtotal`, `other_expenses`, `discount` e total comercial separado;
- `confirm_cart_order_v2` torna a confirmação replay-safe por carrinho e chave de idempotência; índices únicos impedem pedido duplicado por carrinho/chave;
- gates Bling próprios: `bling_order_sync_enabled=false`, `bling_order_homologation_only=true`, `bling_order_max_per_run=1`;
- allowlist server-only `bling_order_homologation_allowlist`; fila e claim de homologação revalidam gate/allowlist;
- guard transacional de estoque em `order_sync_jobs` por `trg_guard_order_sync_stock_v1`;
- timeline server-only `order_status_events` e RPC de transição com `delivered`, `cancelled` e `returned`;
- wrapper `run-bling-order-homologation-v1.mjs` exige confirmação literal `PEDIDO_UNICO_CONTROLADO` em `--apply` e força lote 1;
- writer existente mantém POST ambíguo em `review`, sem retry cego;
- CI da PR #183 verde, incluindo contrato da Etapa 2, regressão Node/PGlite, Shopping Room, Deno check das Edge Functions e teste criptográfico Flow;
- PR #183 integrada em `main` no commit squash `e8519d6e417704e86444a57f98928f593dea64b2`.

### Produção — migrations dormentes aplicadas

- `20260908024746 order_bling_homologation_foundation_v2`;
- `20260908024845 order_bling_stock_guard_v1`.

Auditoria pós-DDL:

- `whatsapp_release_mode=live` e `whatsapp_live_canary_percent=1` preservados;
- `experience_orchestrator_enabled=false`, `whatsapp_flow_data_exchange_enabled=false`, `whatsapp_flow_send_enabled=false`;
- `bling_order_sync_enabled=false`, `bling_order_homologation_only=true`, `bling_order_max_per_run=1`;
- `claim_order_sync_jobs('stage2-audit',10)` retornou zero enquanto Bling está desligado;
- `orders=0`, `order_sync_jobs=0`, allowlist Bling=0 e `order_status_events=0`: nenhuma chamada/pedido real Bling foi criada nesta execução;
- `bling_order_homologation_allowlist` e `order_status_events` estão com RLS habilitado e sem policy pública, no desenho server-only;
- trigger de estoque `trg_guard_order_sync_stock_v1` está habilitado;
- Security Advisor pós-DDL não apresentou novo WARN de função exposta; permanecem os INFOs esperados `RLS Enabled No Policy` das tabelas server-only e o WARN de conta `Leaked Password Protection Disabled`.

### Handoffs e Make pós-DDL

- agora existem **três** handoffs humanos `live_canary_human_control` abertos, buckets `89`, `68` e `10`; todos permanecem `needs_human`, `mode=human`, `human_required=true` e não podem ser retomados automaticamente;
- Make continua com WhatsApp inbound `6779824` e outbound realtime `7290488` ativos; cenários Bling/teste permanecem inativos.

### Critério restante exclusivamente externo/real

- homologar **um único pedido real controlado** no Bling, allowlisted, validando contato, componentes, diferença fiscal, estoque, retorno do `bling_order_id` e conciliação de status;
- não executar esse teste sem autorização explícita futura. Registrar como pendência externa para o fechamento da Etapa 12, sem bloquear programação das próximas etapas.

### Rollback

1. manter `bling_order_sync_enabled=false` para impedir qualquer claim;
2. manter allowlist vazia/desabilitada fora da homologação;
3. nunca reexecutar POST ambíguo no Bling sem reconciliação;
4. preservar handoffs humanos antes de qualquer recuperação operacional;
5. não alterar o canary WhatsApp de 1% durante rollback.

## Próxima etapa

**ETAPA 3 — Núcleo omnichannel e evento normalizado.**

A próxima execução deve começar diretamente pela Etapa 3: ampliar o modelo de canal com segurança, criar contas/identidades por canal e contrato de evento normalizado/idempotente, mantendo Instagram/Messenger totalmente dormentes e sem depender da homologação real Bling.
