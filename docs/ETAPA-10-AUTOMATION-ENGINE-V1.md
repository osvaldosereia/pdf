# Etapa 10 — Motor Geral de Automações + Builder no Admin

Data: 08/09/2026.

## Estado

Fundação programável implementada em modo estritamente dormente. Nenhum workflow pode produzir side effect real nesta entrega.

## Arquitetura

Modelo central: `TRIGGER → CONDITIONS → ACTIONS`.

Tabelas server-only:

- `automation_workflows` — definição atual, gates, estratégia, budget, cooldown e kill switch;
- `automation_workflow_versions` — snapshots versionados para revisão/rollback;
- `automation_workflow_executions` — trilha futura de execução, idempotência, custo e revisão;
- `automation_workflow_events` — auditoria append-only do runtime futuro.

Toda ação de workflow referencia `ai_action_registry.action_key`; o simulador chama `simulate_ai_action_v1`, portanto não cria acesso genérico da IA ao banco.

## Segurança por padrão

Todo workflow nasce com:

```text
enabled=false
execution_mode=off
canary_percent=0
kill_switch=true
```

A Edge Function administrativa não possui operação para `enabled=true`, `execution_mode=live`, elevar canary ou desligar o kill switch. A única mutação operacional disponível é unilateralmente segura: `kill`, que força `enabled=false`, `execution_mode=off`, `canary_percent=0`, `kill_switch=true`.

O Admin visual também nasce atrás de `automationBuilderUiEnabled=false`.

## Estratégias e custo

Estratégias registradas:

- `github_action`;
- `supabase_realtime`;
- `supabase_cron`;
- `edge_function`;
- `make`;
- `manual_review`.

`recommend_automation_execution_strategy_v1` recomenda GitHub Actions para schedule/batch determinístico e tarefas não urgentes de inventory/expiry/anomaly/campaign/supplier. Make fica reservado a realtime com conector externo e qualquer workflow que escolha Make precisa registrar `metadata.make_justification`.

Nenhum cenário Make foi criado para o Motor Geral.

## Templates iniciais

1. `template_order_created_review` — realtime Supabase, dormente, consulta governada `get_order`.
2. `template_inventory_snapshot` — GitHub Actions first, dormente, consulta governada `search_products`.

Os dois permanecem `off` e com kill switch ligado.

## APIs administrativas

`admin-automation-builder-v1` prepara:

- listagem;
- catálogo de actions/triggers/estratégias;
- criação de draft owner-only;
- atualização limitada de draft;
- versionamento;
- recomendação de estratégia;
- validação;
- simulação sem efeitos;
- kill switch owner-only.

O deploy automático da Edge Function foi bloqueado pelo controle de segurança da ferramenta durante esta rodada; o código ficou versionado e o banco não depende do deploy para permanecer seguro/dormente.

## CI

`.github/workflows/stage10-automation-engine.yml` executa `scripts/test-automation-engine-stage10-v1.mjs`, cobrindo RLS/server-only, defaults dormentes, GitHub-first, justificativa Make, referência ao Action Registry e ausência de caminhos de ativação na API.

## Próximos incrementos ainda dentro da etapa 10

A fundação seguinte pode acrescentar compilação em linguagem natural → workflow draft revisável com OpenAI, schema mais rico de conditions, dispatcher real exclusivamente para dry-run/observe e acabamento do mount visual no Admin. Nenhum desses itens exige ativar runtime comercial.
