# Progresso — Roadmap Dona Antônia 20 etapas

Atualizado em 08/09/2026.

Este é o marcador de sequência para `docs/ROADMAP-FINAL-DONA-ANTONIA-20-ETAPAS.md`.

Ler sempre junto com `docs/RETOMADA-DONA-ANTONIA.md`. Os documentos antigos de 12 etapas e autonomia 13–20 permanecem como histórico/detalhamento, mas a ordem 7–20 deste roadmap reorganizado prevalece em caso de conflito.

## Estado preservado na reorganização

- WhatsApp: `live=1%` e não aumentar sem autorização explícita;
- Flow/Data Exchange: desligados;
- Experience Orchestrator: desligado;
- Bling order sync: desligado;
- contas Instagram/Messenger reais: nenhuma ativa;
- nenhum módulo novo deve ser ativado só porque foi programado;
- Make WhatsApp inbound/outbound realtime permanecem pontes justificadas;
- novas rotinas batch/periódicas devem preferir GitHub Actions quando adequado.

## ETAPA 1 — Fundação, limpeza e consolidação operacional
**CONCLUÍDA.**

## ETAPA 2 — Pedido real ponta a ponta + Bling
**PARTE PROGRAMÁVEL CONCLUÍDA.** Homologação real protegida para fase autorizada.

## ETAPA 3 — Núcleo omnichannel e evento normalizado
**CONCLUÍDA.**

## ETAPA 4 — Adapters, renderers e gates independentes
**CONCLUÍDA.**

## ETAPA 5 — CRM unificado, identidades e inbox única
**CONCLUÍDA.**

## ETAPA 6 — Instagram Direct + comentários/private reply
**PARTE PROGRAMÁVEL SEGURA CONCLUÍDA E DORMENTE.** Transporte/conta real não liberados.

## ETAPA 7 — Facebook Messenger + centralização Meta
**PRÓXIMA ETAPA.** Desenvolver somente fundação segura/dormente enquanto credenciais/contas reais não estiverem autorizadas.

## ETAPA 8 — Sala de Compra + WhatsApp Flow + Orquestrador channel-aware
**PENDENTE.**

## ETAPA 9 — AI Action Registry + Governança de Autonomia
**PENDENTE.**

## ETAPA 10 — Motor Geral de Automações + Builder no Admin
**PENDENTE.**

## ETAPA 11 — Logística + Roteirização + App do Entregador
**PENDENTE.** Prioridade operacional alta.

## ETAPA 12 — Lotes + Validade + FEFO + Ofertas + Guardião de Margem
**PENDENTE.**

## ETAPA 13 — Financeiro Operacional + Recebimentos + Conciliação
**PENDENTE.**

## ETAPA 14 — Compras + Fornecedores + Reposição + Demanda + Qualidade
**PENDENTE.**

## ETAPA 15 — Pós-venda Autônomo + Trocas + Devoluções + Crédito
**PENDENTE.**

## ETAPA 16 — CRM Preditivo + Fidelidade + Recorrência + Marketing Omnicanal
**PENDENTE.**

## ETAPA 17 — Social + Meta Ads + Google + Crescimento
**PENDENTE.**

## ETAPA 18 — AutoQA + Voz do Cliente + Melhoria Contínua
**PENDENTE.**

## ETAPA 19 — Gerente IA + Central de Exceções + Workload Manager
**PENDENTE.**

## ETAPA 20 — Homologação Integrada + Autorizações + Rollout Final
**PENDENTE.**

## Regra para cada rodada

1. Continuar da primeira etapa ainda não concluída.
2. Programar o maior bloco seguro/coerente possível.
3. Não transformar pendência externa em bloqueio para componentes independentes.
4. Todo módulo novo nasce desligado e configurável no Admin quando seguro.
5. Testar/regredir/documentar em cada etapa; não esperar a etapa 20 para testar.
6. Preservar idempotência, auditoria, RLS/RBAC, budgets, canary e rollback.
7. Antes de usar Make/OpenAI/Maps/API paga, registrar por que alternativa determinística/GitHub Actions/Supabase não resolve melhor ou mais barato.
8. Nunca ativar produção, gasto ou side effect real sem autorização/gates correspondentes.
