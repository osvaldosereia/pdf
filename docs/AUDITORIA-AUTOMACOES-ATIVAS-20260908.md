# Auditoria de automações ativas — 08/09/2026

Objetivo: manter automações automáticas somente quando pertencem ao novo projeto Dona Antônia ou são infraestrutura atual necessária.

## Make — ativos preservados

- `6779824` — Dona Antônia - WhatsApp Inbound Controlado v1
- `7290488` — Dona Antônia - WhatsApp Outbound Event-Driven v3
- `6379567` — consultar no cpf — preservado por decisão explícita do proprietário

Demais cenários auxiliares/legados auditados nesta rodada foram desativados. O cenário `6508939 — POSTAR PRIMEIRO CARROSSEL KIT NOVO` permanece inativo.

## GitHub Actions — agendamento preservado

- `.github/workflows/update-public-data.yml`
  - permanece automático porque gera/publica SEO de cestas, Merchant, sitemap e dados públicos do site Dona Antônia atual;
  - é parte da infraestrutura pública do projeto.

## GitHub Actions — automações legadas desativadas

Os arquivos abaixo permanecem versionados para rastreabilidade, mas não possuem mais gatilho automático. Quando mantido `workflow_dispatch`, a execução é exclusivamente manual.

- `.github/workflows/limpar-artes-expiradas.yml` — antigo CanecaFácil; cron removido.
- `.github/workflows/limpar-personalizacoes-expiradas.yml` — personalizações antigas; cron removido.
- `.github/workflows/restaurar-status-manual.yml` — cadeia antiga de ofertas; `workflow_run` e cron removidos.
- `.github/workflows/processar-ofertas.yml` — motor antigo de ofertas; schedule, push e repository_dispatch removidos e workflow neutralizado. A arquitetura oficial de ofertas/FEFO será consolidada na Etapa 12.
- `.github/workflows/reparar-catalogo-apos-ofertas.yml` — cadeia automática pós-ofertas removida e workflow neutralizado.
- `.github/workflows/sincronizar-bling.yml` — sincronizador legado Firebase→Bling removido de schedule/push/repository_dispatch e neutralizado. O novo projeto mantém Bling fail-closed/homologation-only.
- `.github/workflows/verificar-admin-producao.yml` — health-check legado do Admin/Criador de Canecas removido de schedule/push e neutralizado.

## CI

Workflows de teste/CI acionados por PR/push de arquivos relevantes não foram desativados. Eles não são rotinas periódicas de negócio e continuam necessários para impedir regressões no novo projeto.

## Invariantes preservados

Esta limpeza não altera:

- WhatsApp canary `live=1%`;
- Flow/Data Exchange desligados;
- Experience Orchestrator desligado;
- Bling order sync do novo núcleo desligado;
- AI Actions e workflows do Automation Engine permanecem OFF;
- handoffs humanos existentes não são alterados.
