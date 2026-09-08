# Etapa 13D + Copiloto Humano — Fundação V1

Data: 08/09/2026

Este bloco é amplo, porém dividido em dois domínios independentes e ambos dormentes:

1. **HUMAN_COPILOT** para a Central de Atendimento Humano;
2. **Etapa 13D — conciliação financeira abstrata + Central Financeira/Admin**.

Nenhum provider externo, banco, adquirente, Pix real, Bling financeiro, OpenAI ou Meta adicional é ativado por este bloco.

## HUMAN_COPILOT

A conversa passa a aceitar os modos:

```text
AI
HUMAN
HUMAN_COPILOT
PAUSED
```

`HUMAN_COPILOT` continua sendo controle humano: somente o operador fala com o cliente. O copiloto pode consultar contexto, resumir, calcular uma Next Best Action determinística e preparar um rascunho editável.

### Guardrails

- handoff precisa estar `claimed` pelo operador atual;
- `human_required=true` continua obrigatório;
- `queue_operator_reply_v1` aceita `human` e `human_copilot`, mas continua exigindo ownership;
- nenhum endpoint do copiloto chama `operator_reply`, dispatcher ou transporte do canal;
- nenhum endpoint do copiloto chama OpenAI/Gemini nesta versão;
- provider futuro passa por `preview_safe_commercial_action_v3` e Cost Policy;
- ferramenta `HUMAN_COPILOT_GENERATE` nasce `enabled=false`, `execution_mode=off`;
- `allowed_during_handoff=true` é permitido somente porque a ferramenta é `read_only` e não envia nada;
- sugestões registradas são `draft` e `external_side_effect=false`.

### Contexto determinístico

`preview_human_copilot_context_v1` monta um snapshot server-side limitado com:

- conversa/canal/estágio/janela;
- handoff/ownership/SLA;
- CRM básico;
- últimas mensagens;
- carrinho atual e itens;
- último pedido;
- estado de pagamento/fiscal sem inferência;
- ledger operacional/reconciliado somente para contexto;
- riscos explícitos.

A IA não recebe acesso livre ao banco.

### Next Best Action

`preview_human_copilot_nba_v1` usa regras determinísticas de prioridade antes de qualquer geração textual. Exemplos: janela fechada, pagamento pendente, identidade ausente, carrinho ativo e checkout.

A sugestão determinística pode ser inserida no composer, mas o botão **Enviar resposta** continua sendo uma ação explícita do operador.

## Etapa 13D — conciliação abstrata

Novos componentes:

- `financial_provider_adapters`;
- `financial_external_events`;
- `financial_match_evaluations`;
- gates adicionais em `financial_runtime_config`;
- matcher determinístico;
- read model financeiro/Admin;
- Edge Function `admin-financial-v1` somente leitura.

### Adapters

Adapters definem contrato/mapeamento, mas nascem:

```text
enabled=false
execution_mode=off
ingest_mode=off
external_poll_enabled=false
```

Nenhuma chamada externa existe nesta versão.

### Eventos externos

Somente payload normalizado é persistido. O evento possui `payload_hash`, `provider_event_id` e chave única por adapter/provider, garantindo idempotência sem armazenar segredo bruto.

### Matcher determinístico

Resultados possíveis:

```text
matched
unmatched
ambiguous
review_required
```

Ordem de evidência:

1. referência externa exata ligada a lançamento observado;
2. `order_id_hint` explícito + valor/método compatíveis;
3. valor+método sem referência forte apenas gera candidato/revisão;
4. múltiplos candidatos => `ambiguous`.

Nenhuma avaliação executa `INSERT/UPDATE` em `financial_ledger_entries`, `order_fiscal_controls`, pedidos ou NF-e.

## Central Financeira/Admin

A UI nasce atrás de:

```text
financialAdminUiEnabled=false
financial_admin_read_enabled=false
```

Ela mostra apenas:

- ledger;
- expectativas;
- eventos externos;
- avaliações do matcher;
- casos abertos;
- detalhe financeiro do pedido.

Não existe action de conciliar, confirmar pagamento ou alterar pedido nesta versão.

## Runtime inicial obrigatório

```text
human_copilot.enabled=false
human_copilot.execution_mode=off
human_copilot.mode_switch_enabled=false
human_copilot.context_preview_enabled=false
human_copilot.deterministic_nba_enabled=false
human_copilot.provider_generation_enabled=false
human_copilot.suggestion_recording_enabled=false
human_copilot.canary_percent=0

financial.enabled=false
financial.execution_mode=off
external_reconciliation_enabled=false
external_event_recording_enabled=false
reconciliation_preview_enabled=false
reconciliation_recording_enabled=false
financial_admin_read_enabled=false
batch_reconciliation_audit_enabled=false
fiscal_projection_enabled=false
```

## Critérios de segurança

- WhatsApp permanece `live=1%`;
- Flow/Data Exchange e Experience Orchestrator permanecem OFF;
- Instagram/Messenger/Ads permanecem OFF;
- Bling order sync e emissão fiscal permanecem OFF;
- handoff humano continua prevalecendo;
- pagamento observado não equivale a pagamento fiscal confirmado;
- conciliação não altera ledger automaticamente;
- IA não é autoridade de saldo, pagamento, preço, estoque, margem, rota ou fiscal.
