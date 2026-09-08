# Progresso — Roadmap Dona Antônia 12 etapas

Atualizado em 08/09/2026 UTC.

Este arquivo é o marcador persistente de execução do `docs/ROADMAP-FINAL-DONA-ANTONIA-12-ETAPAS.md`. A próxima rodada deve ler também `docs/RETOMADA-DONA-ANTONIA.md` e continuar da primeira etapa numerada ainda não concluída abaixo.

## ETAPA 1 — Fundação, limpeza e consolidação operacional

**Status programável: concluída nesta rodada.**

### Concluído

- PR #179 (`painel dormente de ciclo de vida da chave WhatsApp Flow`) validada com CI verde e integrada em `main`; nenhum par de chaves foi gerado e nenhum gate Flow foi ativado.
- Canary real reaudidado em produção: `whatsapp_release_mode=live`, `whatsapp_live_canary_percent=1`, inbound/auto-reply/IA/worker ativos; `experience_orchestrator_enabled=false`, `whatsapp_flow_data_exchange_enabled=false`, `whatsapp_flow_send_enabled=false`.
- Handoffs humanos reaudidados e preservados; existem conversas `human_control` com `needs_human`, `mode=human`, `human_required=true` e handoff aberto `live_canary_human_control`. Nenhum foi assumido/fechado/retomado.
- Supabase Security Advisor reexecutado: permanecem INFOs `RLS Enabled No Policy` em tabelas server-only e o WARN de conta `Leaked Password Protection Disabled`; os WARNs anteriores das quatro trigger functions SECURITY DEFINER não reapareceram.
- Inventário Make real revisado. Permanecem ativos por necessidade realtime: `6779824` WhatsApp Inbound Controlado v1 e `7290488` WhatsApp Outbound Event-Driven v3.
- Foram desativados de forma reversível por serem temporários/teste/Bling e representarem risco de disparo acidental: `7274385`, `7274320`, `7274337`, `7268750`, `7269163`, `7272741`.
- O outbound legado `7290290` já estava inativo e permanece apenas como referência.
- Inventário versionado em `ops/dona-antonia/make-scenarios-v1.json`, com classificação, estado esperado, motivo para permanência no Make e alvo de migração.
- Política de custo formalizada: batch/periódico deve preferir GitHub Actions; Make fica como ponte fina de realtime/webhook/conector quando houver ganho claro.
- Adicionado `scripts/audit-make-inventory-v1.mjs` para impedir que cenários temporários/teste/legado sejam versionados como esperadamente ativos e para exigir justificativa dos cenários mantidos no Make.
- Adicionado workflow `.github/workflows/dona-antonia-ops-inventory.yml` para executar essa auditoria em PR/push e manualmente.

### Classificação Make / migração

- Manter no Make: inbound WhatsApp oficial em tempo real e outbound event-driven/TTS/upload Meta, pois são pontes realtime e não polling batch.
- Migrar/preparar fora do Make: import/sync Bling batch para GitHub Actions/API direta; testes on-demand deixam de ser rotas operacionais; cenários temporários permanecem inativos.
- Não desligar produção realtime existente antes de adapter substituto comprovado.

### Rollback operacional da etapa 1

1. Se a consolidação documental/CI causar problema, reverter somente os commits/PR desta etapa; ela não altera schema nem gates runtime.
2. Cenários Make desativados podem ser reativados individualmente somente em homologação explícita; não reativar Bling/testes por conveniência.
3. Em incidente WhatsApp, preservar handoff humano antes de qualquer tentativa de retomada de IA.
4. Não elevar canary acima de 1% durante rollback.
5. Flow continua fail-closed; não gerar/registrar chave para resolver incidentes não relacionados.

### Pendências externas não bloqueantes

- `Leaked Password Protection` do Supabase Auth depende de decisão/configuração de conta e não bloqueia o avanço programável das próximas etapas.
- Nenhuma chave Flow foi gerada/registrada na Meta; isso pertence à homologação controlada futura e não bloqueia a Etapa 2 programável.

## Próxima etapa

**ETAPA 2 — Pedido real ponta a ponta + Bling.**

A próxima rodada deve programar o máximo seguro da Etapa 2, mantendo Bling real desligado fora de homologação explicitamente autorizada. Preparar idempotência, contrato ERP, reconciliação, estados e testes sem executar pedido real no Bling.
