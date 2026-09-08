# Roadmap de Autonomia Empresarial — Dona Antônia — Etapas 13 a 20

Atualizado em 08/09/2026.

Status: **PLANEJAMENTO APROVADO PARA EVOLUÇÃO FUTURA, COM IMPLEMENTAÇÃO DORMENTE E ATIVAÇÃO GRADUAL**.

Este documento complementa `docs/ROADMAP-FINAL-DONA-ANTONIA-12-ETAPAS.md` e deve ser seguido somente depois das etapas 1–12 ou quando uma fundação aqui puder ser preparada sem ativar produção, alterar canary, gerar gasto real, disparar mensagens, movimentar dinheiro ou executar ações externas irreversíveis.

O objetivo desta fase é levar a Dona Antônia de uma plataforma de comércio conversacional para uma **empresa operada por exceção**: automações, regras determinísticas e OpenAI executam o fluxo normal; pessoas entram apenas quando houver risco, baixa confiança, conflito, exceção financeira/comercial, exigência legal ou decisão estratégica.

---

# PRINCÍPIOS INVARIÁVEIS DE AUTONOMIA

## 1. Módulos sempre ativáveis/desativáveis

Todo módulo novo deve nascer **desligado** e possuir gates próprios. Nunca uma única flag deve liberar toda a empresa.

Padrão mínimo conceitual por módulo:

```text
module_enabled = false
observe_mode = true/false
auto_execute_enabled = false
canary_percent = 0
kill_switch = false
daily_budget_cents = 0
max_action_value_cents = 0
requires_confirmation_above_cents = 0
autonomy_level = A|B|C|D
provider = ...
schedule = ...
```

Modos de maturidade recomendados:

```text
OFF
→ OBSERVE / DRY-RUN
→ DRAFT / SUGGEST
→ HOMOLOGATION / ALLOWLIST
→ CANARY
→ LIVE
```

Ativar uma função nunca deve ativar outra por efeito colateral.

## 2. Admin como centro de configuração

Sempre que tecnicamente seguro, preferir configuração editável pelo Admin em vez de valores hardcoded.

O Admin deve permitir editar, com RBAC e auditoria:

- thresholds;
- horários e agendas;
- prioridades;
- regras de elegibilidade;
- limites financeiros;
- budgets;
- autonomia por ação;
- canais;
- modelos/provedores autorizados;
- políticas de fallback;
- textos/templates controlados;
- critérios de risco;
- políticas de reposição;
- estoque mínimo/máximo;
- lead times;
- margem mínima;
- frequência de campanhas;
- cooldown;
- retenção;
- SLA;
- alertas;
- feature flags/canary;
- critérios de aprovação humana.

Toda configuração relevante deve ter versão, histórico, autor, instante de alteração, preview/dry-run quando aplicável e rollback.

## 3. GitHub Actions primeiro para batch/periódico

Antes de criar ou ampliar qualquer cenário Make, avaliar obrigatoriamente:

1. GitHub Actions consegue executar de forma segura e econômica?
2. Supabase/SQL/cron/Edge Function resolve melhor?
3. É necessário realtime ou resposta síncrona a evento externo?
4. Make reduz complexidade suficiente para justificar o custo recorrente?

Diretriz:

```text
batch / periódicos / relatórios / auditorias / geração de arquivos /
recalculo de score / snapshots / reconciliação não urgente /
rotinas de manutenção / testes / avaliação de campanhas
→ GitHub Actions preferencialmente
```

```text
evento transacional imediato / webhook / operação de baixa latência /
realtime / ação que precisa responder ao cliente agora
→ Supabase / backend / serviço adequado
```

```text
integração externa em que Make seja claramente a ponte mais simples,
confiável e barata em custo total
→ Make, com justificativa documentada
```

Não usar Make como polling pago se GitHub Actions ou backend direto resolverem.

## 4. Custo-benefício obrigatório

Cada automação relevante deve possuir telemetria de custo e valor.

Métricas desejáveis:

```text
runs
successful_runs
failed_runs
human_minutes_saved
estimated_human_cost_saved
openai_cost
make_cost
external_api_cost
maps_cost
email_cost
messaging_cost
revenue_attributed
margin_attributed
cost_per_successful_action
cost_per_order
```

O Admin deve permitir identificar automações caras e pouco úteis.

Decisão de fornecedor/provedor deve considerar:

- custo por execução;
- custo por resultado;
- latência;
- confiabilidade;
- dificuldade de manutenção;
- lock-in;
- segurança;
- necessidade real de IA.

## 5. OpenAI onde cria valor; cálculo crítico continua determinístico

OpenAI deve ser usada intensamente para:

- entender linguagem;
- resumir;
- classificar;
- planejar;
- priorizar;
- recomendar;
- interpretar exceções;
- gerar rascunhos;
- conversar/negociar dentro das regras;
- detectar padrões e anomalias;
- avaliar qualidade;
- transformar linguagem natural em workflows/configurações revisáveis;
- explicar decisões determinísticas.

Não delegar ao LLM como fonte de verdade:

- preço;
- estoque;
- margem matemática;
- impostos;
- saldo financeiro;
- estado de pedido;
- rota/ETA;
- autorização de gasto fora de limites;
- disponibilidade real;
- criação de ações externas sem validação do backend.

Princípio:

> **IA interpreta e decide contexto dentro de limites. O sistema valida, calcula e executa fatos críticos.**

## 6. Empresa operada por exceção

A tela principal futura deve priorizar:

```text
PRECISA DE VOCÊ
```

em vez de obrigar o proprietário a procurar problemas módulo por módulo.

O fluxo normal deve se resolver automaticamente. O humano recebe somente:

- decisão acima do limite financeiro;
- risco relevante;
- baixa confiança;
- conflito de dados;
- fraude/suspeita;
- exceção jurídica/fiscal;
- cliente sensível ou reclamação grave;
- falha sem recuperação automática segura.

## 7. Níveis de autonomia por ação

Toda ação automatizável deve ser classificada.

### Nível A — totalmente automático

Exemplos: consultar dados, classificar, montar recomendação, gerar relatório, enviar aviso logístico já permitido, recalcular score.

### Nível B — automático após confirmação do cliente

Exemplos: alterar endereço quando permitido, reagendar entrega, cancelar pedido elegível, usar crédito.

### Nível C — automático dentro de limite configurável

Exemplos: crédito até R$ X, brinde até R$ X, compra de fornecedor até R$ X, ajuste de mídia paga até X%.

### Nível D — humano obrigatório

Exemplos: decisão jurídica, compra elevada, reembolso excepcional, fraude relevante, mudança estrutural do negócio.

Esses níveis devem ser editáveis no Admin por ação, papel e ambiente.

## 8. Toda automação com segurança operacional

Exigir quando aplicável:

- idempotência;
- dedupe;
- rate limit;
- budget;
- timeout;
- circuit breaker;
- kill switch;
- dry-run;
- audit trail;
- versionamento;
- rollback;
- provider receipt;
- estado `review_required` para resultado externo incerto;
- sem retry cego em ações que podem duplicar dinheiro, pedido, mensagem ou publicação.

---

# ETAPA 13 — Motor Geral de Automações + Builder no Admin

Objetivo: criar o **Shopify Flow da Dona Antônia**, unificando automações hoje espalhadas entre código, Make, Actions e regras específicas.

## Núcleo

Modelo conceitual:

```text
TRIGGER
→ CONDITIONS
→ ACTIONS
```

Triggers iniciais:

- pedido criado/confirmado/ready/entregue/cancelado/devolvido;
- cliente criado/identificado/inativo/recomprou;
- estoque abaixo/acima de limite;
- validade entrando em faixa;
- entrega com ocorrência;
- rota concluída;
- pagamento recebido/pendente/divergente;
- campanha terminou;
- conversa aberta/resolvida/handoff;
- evento de fornecedor;
- execução agendada;
- webhook/evento normalizado;
- anomalia detectada.

Condições:

- campos e estados;
- segmentos;
- histórico de compra;
- margem;
- risco;
- canal;
- horário;
- consentimento;
- valor;
- estoque;
- região;
- capacidade;
- score;
- resultado de ação determinística.

Ações:

- consultar/atualizar dados autorizados;
- chamar AI Action;
- criar tarefa/exceção;
- gerar rascunho;
- disparar mensagem permitida;
- criar catálogo/campanha draft;
- criar sugestão/pedido de compra draft;
- atualizar score/tag;
- chamar integração;
- executar GitHub Action/workflow autorizado;
- agendar próxima avaliação;
- notificar operador.

## Builder em linguagem natural com OpenAI

Admin pode escrever:

> Quando um cliente tiver pelo menos 3 pedidos entregues e estiver 20 dias sem comprar, se tiver consentimento de marketing, monte uma oferta de recompra com produtos recorrentes e envie pelo canal mais econômico permitido.

OpenAI converte para workflow estruturado, mas não publica automaticamente. Exibir:

- gatilho;
- condições;
- ações;
- dados usados;
- custos estimados;
- efeitos externos;
- nível de autonomia;
- cenários de teste.

Depois permitir salvar como draft, simular e publicar conforme RBAC.

## Admin

Painéis:

- Automações;
- Templates;
- Execuções;
- Falhas;
- Custo/benefício;
- Versões;
- Simulador;
- Exceções;
- Providers.

Cada workflow:

- on/off;
- observe;
- canary;
- prioridade;
- agendamento;
- budget;
- owner;
- tags;
- timeout;
- limite de execuções;
- cooldown;
- autonomia;
- rollback/versionamento.

## Estratégia de execução

O builder deve escolher/registrar `execution_strategy`:

- `github_action`;
- `supabase_realtime`;
- `supabase_cron`;
- `edge_function`;
- `make`;
- `manual_review`.

O sistema deve sugerir GitHub Actions quando a tarefa não precisar de realtime.

Critério de saída: novas automações simples deixam de exigir programação ad hoc e podem ser criadas/ajustadas no Admin com teste, custo e governança.

---

# ETAPA 14 — AI Action Registry + Autoatendimento Autônomo

Objetivo: transformar OpenAI de “respondente” em **agente capaz de executar ações reais seguras**.

## AI Action Registry

Criar catálogo central de ações, por exemplo:

```text
get_customer
get_order
search_products
get_stock
create_cart
add_item
remove_item
change_quantity
change_delivery_address
cancel_order
reschedule_delivery
create_return
issue_store_credit
create_repurchase_draft
create_supplier_purchase_draft
create_delivery_exception
open_human_case
```

Cada ação deve definir:

- schema de entrada/saída;
- pré-condições;
- dados permitidos;
- papel/canal;
- nível A/B/C/D;
- limite financeiro;
- confirmação necessária;
- idempotency key;
- side effects;
- rollback/compensação;
- logs/auditoria;
- mensagens de erro seguras.

## Autoatendimento via WhatsApp/Instagram/Messenger/Sala

Cliente pode, quando permitido:

- consultar pedido;
- consultar entrega;
- repetir compra;
- alterar endereço antes do corte;
- cancelar pedido elegível;
- reagendar;
- consultar crédito;
- usar crédito;
- iniciar troca/devolução;
- atualizar preferências/consentimentos;
- pedir humano.

OpenAI entende linguagem e chama ações. Backend autoriza.

## Confirmações

Ações irreversíveis precisam de confirmação explícita quando configurado.

Exemplo:

```text
IA: Posso cancelar o pedido #123 agora. Quer confirmar?
cliente: sim
backend revalida estado
→ cancela
```

Critério de saída: grande parte do suporte administrativo deixa de exigir operador humano.

---

# ETAPA 15 — Compras, Fornecedores, Reposição, Demanda e Qualidade

Objetivo: automatizar a retaguarda de abastecimento.

## Central de fornecedores

Cadastro operacional:

- fornecedor;
- contatos;
- produtos/SKUs fornecidos;
- preço atual/histórico;
- unidade/caixa/múltiplo;
- lead time prometido e observado;
- pedido mínimo;
- frete;
- condições de pagamento;
- atraso médio;
- divergências;
- qualidade;
- última compra;
- fornecedor preferencial/alternativo.

## Reposição automática

Calcular necessidade usando:

```text
estoque atual
- estoque reservado
+ compras em trânsito
+ demanda prevista
+ estoque de segurança
+ lead time
+ múltiplo de caixa
+ pedido mínimo
+ validade
```

OpenAI explica/prioriza; cálculo é determinístico.

Modos:

```text
observe
→ sugerir compra
→ criar pedido de compra draft
→ autoaprovar até limite
```

## Previsão de demanda

Produzir previsão por SKU/categoria considerando histórico e sazonalidade quando houver dados suficientes.

Não usar LLM como modelo matemático principal da previsão; OpenAI interpreta e transforma previsão em decisão/explicação.

## Cotação inteligente

Fluxo futuro:

- identificar fornecedores possíveis;
- preparar/emitir solicitação de cotação quando canal/provedor permitir;
- receber respostas;
- OpenAI extrair e normalizar proposta;
- backend comparar custo total, prazo, pedido mínimo e margem;
- gerar recomendação ou pedido draft.

## NF-e/recebimento

Aproveitar capacidade existente do Admin e evoluir para:

- correspondência automatizada;
- divergência de preço/quantidade;
- lote/validade;
- qualidade;
- atualização de fornecedor;
- fechamento da compra;
- exceção somente quando houver conflito.

## Quality Control

Criar pontos de qualidade por produto/categoria/fornecedor:

- validade mínima;
- embalagem íntegra;
- temperatura/condição quando aplicável;
- foto obrigatória em casos definidos;
- divergência recorrente.

OpenAI Vision pode auxiliar em fotos; backend decide aceite segundo regra.

## Barcode-first

Expandir scan em:

- recebimento;
- armazenagem;
- separação;
- conferência;
- carregamento;
- devolução.

Critério de saída: reposição rotineira e recebimento normal exigem pouca intervenção humana; operador recebe só divergências e compras acima de limite.

---

# ETAPA 16 — Pós-venda Autônomo, Trocas, Devoluções, Crédito e Recuperação

Objetivo: resolver pós-venda normal sem operador.

## Casos estruturados

Criar entidade de pós-venda separada do simples status de pedido.

Campos conceituais:

```text
case_type
order_id
customer_id
items
quantities
reason
media_refs
evidence
policy_decision
refund_or_credit
restock_decision
resolution
status
```

Casos:

- cancelamento;
- item faltante;
- item errado;
- avaria/vazamento;
- troca;
- devolução;
- reentrega;
- recusa;
- cobrança incorreta;
- reclamação operacional.

## Triagem com OpenAI

OpenAI:

- entende o relato;
- solicita somente evidência necessária;
- resume caso;
- classifica motivo;
- identifica urgência/sentimento sem inferir atributos sensíveis;
- recomenda ação dentro da política.

Backend valida regra e limite.

## Crédito Dona Antônia

Criar ledger de crédito, não simples campo de saldo.

Usos:

- compensação;
- devolução;
- benefício;
- fidelidade;
- recuperação de experiência.

Crédito deve ser auditável, expirar somente se política permitir e respeitar limites/autonomia.

## Prova de entrega

Evoluir logística com prova configurável:

- timestamp;
- GPS;
- recebedor;
- OTP opcional;
- foto opcional e minimizada;
- ocorrência.

Não tornar geofence imprecisa em prova única.

## Service recovery

Cliente insatisfeito pode entrar em playbook automático:

- reconhecer problema;
- coletar fatos;
- resolver dentro de limite;
- gerar crédito/reentrega quando permitido;
- solicitar avaliação depois que problema estiver realmente resolvido.

Critério de saída: pós-venda rotineiro se resolve automaticamente; humano fica com exceções financeiras, fraude, conflito e casos graves.

---

# ETAPA 17 — Financeiro Operacional, Recebimentos e Conciliação

Objetivo: separar “pedido entregue” de “dinheiro corretamente recebido e conciliado”.

## Ledger operacional

Registrar de forma estruturada:

- valor esperado;
- forma de pagamento;
- valor recebido;
- instante;
- recebedor/entregador;
- referência de provedor;
- conciliação;
- diferença;
- estorno/crédito;
- vínculo Bling.

## Fechamento de rota/entregador

Ao terminar a rota:

```text
entregas realizadas
valor dinheiro esperado
valor Pix
valor cartão
valor pendente
ocorrências
```

Se tudo bater, fechar automaticamente.

Se divergir, criar exceção.

## Reconciliação

Automatizar quando APIs/dados permitirem:

- Pix;
- cartão;
- dinheiro entregue à empresa;
- pedido;
- lançamento/conta no Bling;
- reembolso/crédito.

GitHub Actions deve ser preferido para reconciliações batch que não exijam realtime.

## Guardrails

- sem retry cego de movimentação;
- estado externo incerto → `review_required`;
- limite de ajuste automático;
- diferenças sempre auditadas.

Critério de saída: o proprietário não precisa conferir manualmente cada pedido recebido; vê somente divergências.

---

# ETAPA 18 — Gerente IA, Central de Exceções e Operação Autônoma

Objetivo: criar uma camada de supervisão empresarial contínua.

## Gerente IA

Consumir métricas e eventos de:

- vendas;
- atendimento;
- pedidos;
- estoque;
- fornecedores;
- compras;
- entregas;
- financeiro;
- marketing;
- Ads;
- custos de APIs/IA/Make;
- erros técnicos.

Funções:

- resumir operação;
- priorizar problemas;
- detectar anomalias;
- propor próxima ação;
- disparar playbook autorizado;
- abrir exceção;
- criar rascunho de workflow/campanha/compra;
- explicar impacto/custo.

## Central “Precisa de você”

Admin deve destacar apenas decisões humanas reais.

Exemplos:

```text
Compra de fornecedor acima do limite
Reembolso excepcional
Endereço crítico inconsistente
Divergência financeira
Fornecedor com atraso grave
Anomalia de conversão
Campanha com gasto anormal
```

Cada cartão deve mostrar:

- resumo IA;
- evidências;
- impacto;
- valor em risco;
- opções recomendadas;
- ação segura possível.

## Detecção de anomalia

Identificar automaticamente mudanças relevantes:

- conversão caiu;
- estoque rompeu;
- erro Bling subiu;
- ETA piorou;
- devolução aumentou;
- produto gerou reclamações;
- custo OpenAI/Make subiu;
- campanha consumiu orçamento sem resultado;
- inbox acumulou;
- fornecedor atrasou.

Modelos estatísticos/regras determinísticas detectam; OpenAI interpreta/explica.

## Workload manager

Distribuir trabalho humano restante:

- separação;
- conferência;
- entregas;
- exceções;
- handoffs.

Considerar capacidade, prioridade e SLA.

Critério de saída: gestão diária passa a ser exceção orientada pela IA, e não inspeção manual de vários painéis.

---

# ETAPA 19 — AutoQA, Voz do Cliente e IA que Melhora a Própria Operação

Objetivo: avaliar automaticamente a qualidade e transformar problemas recorrentes em melhoria do sistema.

## AutoQA de conversas

Avaliar amostra ampla ou total conforme custo configurado:

- resposta correta;
- aderência às regras;
- invenção de preço/estoque;
- cliente precisou repetir;
- looping;
- frustração;
- oportunidade perdida;
- handoff correto/incorreto;
- clareza;
- resolução;
- custo/token;
- latência.

Admin define rubricas e peso.

## AutoQA operacional

Avaliar também:

- falhas de workflow;
- rota com comportamento anormal;
- pedido travado;
- retry excessivo;
- campanha com resultado ruim;
- fornecedor com recorrência de problema.

## Voz do Cliente

Agrupar conversas e casos para descobrir:

- principais reclamações;
- produtos procurados não disponíveis;
- dúvidas recorrentes;
- motivos de abandono;
- motivos de cancelamento;
- problemas por produto/lote;
- bairros com problema logístico;
- oportunidades de novas categorias.

## Knowledge gap / self-improvement

Quando houver falha recorrente:

- coletar exemplos;
- OpenAI propõe FAQ/guidance/procedure/workflow;
- detectar contradição com conhecimento atual;
- gerar testes;
- simular impacto;
- publicar automaticamente somente alterações classificadas como seguras e autorizadas;
- demais ficam para aprovação.

Nunca permitir que a IA altere sozinha regra financeira/fiscal/comercial crítica sem política explícita.

## Custo de QA

Admin deve permitir:

- percentual de amostragem;
- modelo;
- limite diário;
- prioridades;
- avaliação completa somente em casos de risco/baixa nota.

Critério de saída: qualidade passa a ser monitorada continuamente e o conhecimento melhora com evidências reais.

---

# ETAPA 20 — CRM Preditivo, Fidelidade, Recorrência, Risco, Margem e Crescimento Autônomo

Objetivo: transformar histórico em ações preditivas e recorrentes, mantendo margem e risco sob controle.

## Inteligência preditiva de cliente

Quando houver dados suficientes:

- próxima data provável de compra;
- risco de churn;
- ticket provável;
- categorias/produtos prováveis;
- CLV estimado;
- frequência observada;
- afinidades reais.

Não usar inferências sensíveis.

## Compra recorrente / cesta programada

Cliente pode definir:

> quero repetir todo mês

Sistema cria lembrete/pedido sugerido, sempre revalidando preço, estoque, entrega e preferências antes da confirmação.

Modos:

- lembrete;
- cesta draft;
- confirmação rápida;
- autoação somente se futuramente houver regra legal/comercial e autorização explícita adequada.

## Favoritos

Cliente pode salvar produtos/cestas.

Favoritos podem alimentar:

- recompra;
- alerta de reposição;
- oferta relevante;
- personalização.

## Fidelidade, indicação e crédito

Admin configurável para:

- níveis/VIP;
- recompensas;
- crédito;
- indicação;
- aniversário;
- frequência;
- ticket;
- limites de custo/margem.

Começar simples, sem criar complexidade de pontos desnecessária.

## Guardião de margem

Antes de promoção/cupom/brinde/campanha/recompra/Ads:

- calcular margem real conhecida;
- custo de canal;
- custo de mídia;
- custo de benefício;
- margem mínima configurada.

OpenAI pode sugerir alternativa mais eficiente; backend bloqueia benefício inviável.

## Gestão autônoma de orçamento

Permitir, quando amadurecido:

- Redistribuição de orçamento dentro de limites;
- ajuste percentual máximo por período;
- limite diário/mensal;
- kill switch;
- aprovação humana acima de threshold.

OpenAI recomenda; backend aplica somente dentro da política.

## Risco e abuso

Score baseado em fatos operacionais:

- pedidos recusados/repetidamente não recebidos;
- abuso de cupom/crédito;
- devoluções anormais;
- endereços inconsistentes;
- duplicidade comprovada;
- tentativas operacionais suspeitas.

Evitar decisões discriminatórias ou inferências de atributos sensíveis.

Ações por risco devem ser transparentes internamente, auditáveis e com possibilidade de revisão.

## LGPD operacional

Centralizar:

- consentimentos;
- exportação de dados;
- solicitação de correção;
- solicitação de exclusão quando aplicável;
- retenção;
- anonimização;
- expiração de mídias;
- trilha de auditoria.

OpenAI pode classificar/explicar solicitação, mas política de retenção e execução deve ser determinística e juridicamente definida.

Critério de saída: crescimento, recompra e fidelização tornam-se proativos e automatizados sem sacrificar margem, privacidade ou controle financeiro.

---

# PADRÃO DE ADMIN PARA TODAS AS ETAPAS 13–20

Cada módulo deve, quando aplicável, oferecer no Admin:

## Estado

- desligado;
- observe;
- draft;
- homologação;
- canary;
- live;
- emergency stop.

## Configuração

- regras;
- limites;
- schedules;
- budgets;
- autonomia;
- modelo/provedor;
- fallback;
- canal;
- segmentos;
- thresholds;
- mensagens/templates;
- retenção.

## Simulação

- dados de teste;
- dry-run;
- efeitos previstos;
- chamadas externas previstas;
- custo estimado;
- ações que seriam executadas;
- confirmação de side effects.

## Observabilidade

- execução;
- tempo;
- custo;
- sucesso/falha;
- economia estimada de trabalho humano;
- valor/margem atribuída;
- erros;
- retries;
- provider receipts.

## Auditoria

- quem configurou;
- quem aprovou;
- versão;
- antes/depois;
- ativação;
- desativação;
- rollback.

---

# MATRIZ DE EXECUÇÃO E CUSTO

Antes de implementar cada automação, registrar uma decisão semelhante a:

| Necessidade | Primeira escolha | Quando não usar |
|---|---|---|
| Batch/periódico | GitHub Actions | se precisar realtime/baixa latência |
| Regras no banco | SQL/Supabase | se depender de serviço externo complexo |
| Evento realtime | Supabase/Edge/Realtime | se puder ser batch barato |
| Integração visual/no-code externa | Make | se API direta/Action for mais barata e simples |
| Linguagem/decisão contextual | OpenAI | se regra determinística resolver melhor |
| Rota/ETA | Maps/provider de routing | nunca LLM |
| Verdade financeira/comercial | backend/Bling/ledger | nunca LLM como fonte |

O objetivo não é eliminar Make ou OpenAI; é **usar cada ferramenta onde gera mais valor por real gasto e por hora humana economizada**.

---

# OBJETIVO FINAL

Arquitetura operacional alvo:

```text
CLIENTE
  ↓
OPENAI + MOTOR COMERCIAL
  ↓
PEDIDO
  ↓
ESTOQUE / PRODUÇÃO
  ↓
ROTEIRIZAÇÃO / ENTREGA
  ↓
RECEBIMENTO / CONCILIAÇÃO
  ↓
CRM APRENDE
  ↓
RECOMPRA / FIDELIDADE

paralelamente:

VENDAS → PREVISÃO DE DEMANDA → REPOSIÇÃO → FORNECEDOR → COMPRA → NF-e → ESTOQUE

E acima de tudo:

GERENTE IA
  ↓
CENTRAL DE EXCEÇÕES
  ↓
HUMANO SOMENTE QUANDO REALMENTE NECESSÁRIO
```

A meta final não é “colocar IA em todo lugar”.

A meta é:

> **automatizar todo fluxo repetitivo seguro, usar OpenAI onde compreensão e julgamento contextual criam valor, manter fatos críticos determinísticos e permitir que o proprietário opere a empresa principalmente por exceções.**
