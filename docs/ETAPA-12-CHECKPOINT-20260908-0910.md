# Etapa 12 — checkpoint programável 08/09/2026

Status: **VERDADE COMERCIAL + WMS/FULFILLMENT + CENTRAL ADMIN/SNAPSHOTS PROGRAMADOS E DORMENTES**.

Este checkpoint complementa `ROADMAP-20-ETAPAS-PROGRESS.md` até a próxima consolidação do marcador oficial. A sequência continua sendo a do roadmap reorganizado de 20 etapas.

## Integrado nesta rodada

### PR #209 — hardening WMS v2

Integração: `3e757353987172928d33de87e8ecc8f2527f5ddb`.

Entregas:
- gates independentes de criação de fulfillment, reserva e consumo de lotes, todos OFF por padrão;
- competências explícitas de `warehouse_staff`, todas false por padrão;
- suporte multi-lote seguindo FEFO oficial sem duplicar `inventory_lots`;
- snapshots de produto/local/lote no fulfillment;
- `fulfillment_exceptions` e `fulfillment_events`;
- scans com quantidade, `device_id` e idempotência;
- reserva/liberação/consumo de lote via ledger idempotente e gates da Verdade Comercial;
- embalagem com numeração/quantidade de volumes;
- READY somente com volumes completos;
- carregamento por barcode validando delivery job/stop/rota;
- preview de gôndola/prateleira legado sem escrita;
- `warehouse-ops-v1` versionada com JWT e autorização por `warehouse_staff`, sem deploy;
- `warehouse-app` preparada para API autenticada, mas `enabled=false` e sem endpoint/chave operacional;
- CI `Stage 12 WMS` verde após corrigir sparse checkout da migration de hardening.

As migrations de hardening permanecem apenas versionadas no GitHub neste checkpoint; não foram aplicadas ao projeto Supabase real nesta rodada, em respeito à proibição de alterar produção.

### PR #210 — Central de Verdade Comercial + snapshots

Integração: `2621c74d85c7c7710afd72da410f8d4e4c7c2a7d`.

Entregas:
- Central de Verdade Comercial montada no Admin atrás de `commercialTruthUiEnabled=false`;
- dashboard de readiness, risco por validade, políticas e promoções;
- simuladores FEFO e Guardião de Margem, somente preview;
- criação owner-only de lote e política somente como DRAFT;
- kill switch unilateral, sem caminho de ativação;
- snapshot determinístico de validade, ruptura, giro proxy e margem conhecida/incompleta;
- CLI offline para geração do snapshot a partir de JSON;
- GitHub Actions `Stage 12 Commercial Central`, sem schedule e sem acesso a produção/API paga;
- testes confirmando UI dormente, ausência de ações de ativação e tratamento de margem incompleta sem inventar custo.

A Edge Function `admin-commercial-truth-v1` continua apenas versionada e não foi deployada. A flag `commercialTruthUiEnabled` continua false.

## Auditoria pós-integração

Supabase real permaneceu sem alterações operacionais:
- WhatsApp `live=1%`;
- Flow Data Exchange OFF;
- Flow send OFF;
- Experience Orchestrator OFF;
- Bling order sync OFF/homologation-only;
- Verdade Comercial OFF;
- Fulfillment OFF;
- lotes reais = 0;
- pedidos = 0;
- fulfillment orders = 0.

Foram observados 6 handoffs humanos abertos no momento da auditoria. Nenhum foi assumido, resolvido ou fechado por esta rodada.

Make foi auditado e permaneceu inalterado. Os cenários realtime WhatsApp inbound/outbound existentes continuam ativos; nenhum cenário novo foi criado.

Security Advisor: permanece o padrão conhecido de `RLS Enabled No Policy` para tabelas server-only deliberadamente fechadas ao browser e o WARN preexistente `Leaked Password Protection Disabled`. Nenhuma regressão de segurança nova foi introduzida por esta rodada.

## Próximo bloco seguro da Etapa 12

Ainda dentro da Etapa 12, antes da Etapa 13:
- compatibilidade FEFO no checkout/fechamento comercial em modo `observe/dry_run`, sem enforcement;
- benefícios/cupons/brindes/aniversário somente como drafts/policies OFF, sem semear regra comercial ativa;
- consolidar documentação/progresso oficial e regressão integrada;
- somente depois avaliar se o critério programável da Etapa 12 está completo.

Nenhuma ativação real é autorizada por este documento.
