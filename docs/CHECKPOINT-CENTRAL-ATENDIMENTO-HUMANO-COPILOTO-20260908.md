# Checkpoint — Central de Atendimento Humano + Copiloto IA

Data: **08/09/2026**

Este checkpoint é uma **diretriz transversal**. Não altera a sequência do roadmap: a Etapa 13 financeira continua sendo a primeira etapa numerada incompleta.

## Decisão oficial incorporada

Referência integral:

- `docs/CENTRAL-ATENDIMENTO-HUMANO-COPILOTO-IA-2026-09-08.md`

A Central deve evoluir a Inbox existente. Não criar sistema paralelo.

Modos alvo:

```text
AI
HUMAN
HUMAN_COPILOT
```

Regra invariável: handoff humano tem precedência absoluta. Resolver handoff não retoma IA automaticamente. Copiloto sugere/contextualiza, mas não envia ao cliente sem ação explícita do operador.

## Implementação concluída nesta rodada

PR #222 — `Dona Antônia: Central de Atendimento Humano + fundação de copiloto`

Merge:

```text
2b49f1f62fd70637c9f96d83fee38d78f672a42b
```

Entrou no `main`:

- fundação responsiva em três colunas na própria rota de Atendimento;
- coluna de conversas com busca, filtros, canal, prioridade, ownership e SLA;
- coluna central com timeline e composer real;
- contexto lateral de CRM e riscos operacionais;
- ações `claim_handoff`, `operator_reply` e `resolve_handoff` reutilizando `admin-whatsapp-ops-v1`;
- composer habilitado somente para handoff `claimed`, pertencente ao operador atual e conversa em `mode=human`;
- área de Copiloto IA preparada, porém dormente;
- feature gates frontend:

```text
humanServiceCenterUiEnabled=false
humanCopilotEnabled=false
```

- carregamento da nova UI só ocorre quando `humanServiceCenterUiEnabled=true`;
- nenhum provider OpenAI/Gemini chamado por essa fundação;
- nenhuma ação `resume_ai` é chamada pela Central;
- nenhuma migration ou mudança de schema foi necessária;
- nenhuma Edge Function nova foi implantada;
- nenhum canal Meta adicional foi ativado.

## CI

Verdes:

- `Human Service Center`;
- `Test Dona Antonia conversation worker`;
- `Stage 10 Automation Engine`;
- `Stage 11 Logistics`;
- `Stage 12 Commercial Central`.

O workflow legado `Testar Admin V2 definitivo` continua vermelho por falhas históricas relacionadas a Admin V2/Caneca Fácil/Caneca Print. A validação de sintaxe/imports/contratos dentro dele passou antes do agregador legado. Não afrouxar gates da Dona Antônia para silenciar esse workflow.

## Baseline de produção auditado após o merge

Supabase:

```text
whatsapp_release_mode=live
whatsapp_live_canary_percent=1
whatsapp_inbound_enabled=true
whatsapp_auto_reply_enabled=true
ai_enabled=true
conversation_worker_enabled=true
conversation_worker_dispatch_enabled=true
experience_orchestrator_enabled=false
whatsapp_flow_send_enabled=false
whatsapp_flow_data_exchange_enabled=false
bling_order_sync_enabled=false
bling_order_homologation_only=true
```

Handoffs no momento da auditoria:

```text
open=11
claimed=0
```

`operator_reply_jobs`:

```text
total=0
review_required=0
```

Nenhum desses estados foi alterado pela PR #222.

## Próximos blocos seguros da Central

P0/P1 futuros, sem ativação automática:

1. formalizar no backend o estado interno `HUMAN_COPILOT` sem permitir envio autônomo;
2. criar endpoint server-side de contexto do copiloto com custo/política/gates;
3. resumo, Next Best Action e sugestão de resposta editável;
4. contexto de pedido atual/último pedido e carrinho provisório;
5. anexos/áudio/imagem para operador somente após contratos de transporte e auditoria;
6. manter Instagram/Messenger sem transporte humano real até autorização específica.

## Proibições preservadas

- não aumentar WhatsApp acima de 1%;
- não ativar Flow/Data Exchange;
- não ativar Experience Orchestrator;
- não ativar Instagram/Messenger/Ads;
- não ativar Bling order sync;
- não introduzir recurso Meta com tarifa adicional acima da política definida pelo proprietário;
- não permitir que Copiloto envie automaticamente no modo humano;
- não usar IA como autoridade de preço, estoque, margem, pagamento, fiscal, rota ou saldo.
