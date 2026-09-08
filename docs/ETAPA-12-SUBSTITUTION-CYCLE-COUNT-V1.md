# Etapa 12C/12D — Substitution Engine + Cycle Counting V1

Atualizado em 08/09/2026.

Status: **FUNDAÇÃO DORMENTE / SEM APLICAÇÃO AUTOMÁTICA / SEM AJUSTE DE ESTOQUE**.

## Objetivo

Completar dois critérios da decisão operacional final da Etapa 12 sem criar uma nova fonte de verdade e sem ativar operação real:

1. substituições de produtos somente podem ser sugeridas dentro de grupos de equivalência autorizados, respeitando preferência do cliente, estoque/validade, preço e margem;
2. contagem cíclica deve detectar risco/divergência e registrar contagens auditáveis, mas nesta versão não pode alterar estoque, lote ou Bling.

## 12C — Substitution Engine

### Estruturas

- `substitution_groups`: grupo de equivalência versionável (`draft → active → retired`);
- `substitution_group_items`: produtos autorizados dentro do grupo; item também nasce `draft`;
- `customer_substitution_preferences`: preferência por produto, cesta ou grupo;
- `substitution_evaluations`: trilha de decisões, sempre `applied=false` nesta versão.

### Preferências

Precedência determinística:

`produto específico → cesta → grupo → padrão ask`.

Valores:

- `no_substitute`: bloqueia;
- `ask`: candidato válido ainda exige confirmação do cliente;
- `allow_rule`: backend pode classificar como `allow` se todas as validações determinísticas passarem.

Nenhuma IA pode tornar produtos equivalentes por conta própria. A IA futuramente pode explicar/sugerir; o backend só aceita pares presentes em grupo `active` com ambos os itens `active`.

### Estoque e validade

O candidato reutiliza `preview_fefo_allocation_v1`, portanto só conta lote:

- `available`;
- fisicamente verificado;
- com saldo livre `quantity_available - quantity_reserved`;
- compatível com a data da entrega.

Sem estoque/validade suficiente: `block`.

### Preço e margem

A política do grupo é JSON versionável e pode definir:

- `minimum_margin_percent`;
- `standalone_price_strategy` (`preserve_original_price` ou `candidate_price`);
- `max_customer_price_increase_percent` quando o candidato usar seu próprio preço.

Se dado de preço/custo/política necessário estiver ausente, o resultado é `review`, nunca um cálculo inventado.

### Regra especial das cestas

A cesta mantém seu preço comercial próprio. A substituição de componente **não transforma o preço da cesta na soma dos itens** e promoção do componente não recalcula automaticamente o preço da cesta.

Para `basket_id` válido, o preview usa:

- `basket_templates.base_price` como receita comercial;
- custo estimado dos componentes atuais;
- troca apenas do custo do componente substituído;
- `evaluate_margin_guard_v1` sobre a cesta resultante.

Resposta inclui `strategy=preserve_basket_price` e `component_promotion_does_not_reprice_basket=true`.

### Gates

Adicionados a `commercial_truth_runtime_config`, todos `false` por padrão:

- `substitution_preview_enabled`;
- `substitution_recording_enabled`;
- `substitution_apply_enabled`.

**Não existe função de apply nesta versão**, mesmo se o último gate fosse alterado por engano.

## 12D — Cycle Counting

A implementação antiga de inventário físico existente no projeto foi deliberadamente **não reutilizada como executor**, pois ela atualiza `products.stock` e cria `bling_commands`. Esta V1 cria uma camada nova e segura para contagem cíclica.

### Estruturas

- `cycle_count_tasks`;
- `cycle_count_observations`;
- `cycle_count_events`.

### Política

Usa `commercial_policy_versions` com `policy_key='cycle_count'`.

Campos suportados:

- `minimum_priority_score`;
- `expiry_window_days`;
- `absolute_quantity_threshold`;
- `difference_percent_threshold`;
- `weights.physically_unverified`;
- `weights.never_counted`;
- `weights.low_stock`;
- `weights.inventory_divergence`;
- `weights.picking_exception`;
- `weights.expiry_risk`.

Sem política ativa, o preview retorna `review` e não inventa score mínimo.

### Sinais determinísticos

Podem elevar a prioridade:

- produto ainda não verificado fisicamente;
- nunca contado;
- estoque em/abaixo do mínimo;
- divergência em contagem anterior;
- exceção aberta de picking/lote;
- lote dentro da janela de risco de validade.

### Blind count

Tarefa nasce com `blind_count=true` por padrão. O backend salva snapshot esperado para comparação posterior, mas a UI futura não deve expor esse valor ao contador quando blind count estiver ativo.

### Observação e tolerância

A observação calcula:

- quantidade esperada no snapshot;
- quantidade contada;
- diferença absoluta;
- diferença percentual;
- `within_tolerance` ou `review_required` conforme política ativa.

Mesmo `within_tolerance` **não ajusta estoque** nesta versão.

### KPI

`cycle_count_kpis_v1` produz `inventory_accuracy_percent` com definição explícita:

`linhas de contagem dentro da tolerância configurada / linhas avaliadas`.

### Gates

Adicionados a `commercial_truth_runtime_config`, todos `false` por padrão:

- `cycle_count_planning_enabled`;
- `cycle_count_recording_enabled`;
- `cycle_count_adjustment_enabled`.

**Não existe executor de ajuste de estoque nesta V1.**

## Segurança e isolamento

Todas as tabelas usam RLS e têm acesso `public`, `anon` e `authenticated` revogado. RPCs ficam somente para `service_role`.

Não há:

- OpenAI;
- Maps;
- Make;
- Bling;
- WhatsApp;
- HTTP externo;
- alteração de `orders`/`order_items`;
- alteração de `products.stock`;
- alteração de quantidade de lote;
- criação de `bling_commands`.

## Próxima evolução segura

Após CI e aplicação dormente desta fundação:

1. montar UI Admin escondida por gate para grupos/preferências/política de cycle count;
2. integrar sugestões de substituição ao WMS como `review/ask`, sem apply automático;
3. criar fila mobile de cycle count task-oriented;
4. só depois projetar reconciliador transacional de substituição e ajuste de estoque, com autorização/homologação separadas.
