# Dona Antônia — Arquitetura de Atendimento Cost-First

Data: **09/09/2026**

## Objetivo

Evoluir o atendimento do WhatsApp para o princípio:

> **programação resolve o previsível; IA interpreta o que realmente exige linguagem/raciocínio.**

A mudança não troca a stack e não exige nova assinatura. Continua usando WhatsApp Cloud API, Make como ponte operacional, Supabase/Postgres como fonte de verdade e OpenAI como fallback inteligente.

## Fluxo alvo

```text
WhatsApp
  ↓
Make inbound
  ↓
Supabase ingest/jobs
  ↓
Cost-First Router
  ├─ gatilho seguro → bloco de mensagem / ação determinística → outbound
  ├─ produto com match forte → ação determinística → outbound
  ├─ botão/estado já homologado → worker v3 determinístico
  └─ linguagem aberta/ambiguidade → worker v3 + OpenAI
  ↓
Make outbound
  ↓
WhatsApp
```

## O que foi programado nesta rodada

### 1. Motor de gatilhos configurável

Novas entidades server-only:

- `service_trigger_rules`;
- `service_message_blocks`;
- `service_trigger_events`;
- `product_aliases`.

Gatilhos suportam:

- correspondência exata;
- contém;
- regex;
- etapa da conversa;
- sempre;
- prioridade;
- `stop_on_match`;
- execução uma vez por conversa;
- cooldown;
- escopo de intenção/etapa/canal;
- requisito de modo IA.

### 2. Blocos de mensagem

Mensagens comuns deixam de depender do modelo para manter cordialidade.

Variáveis disponíveis incluem, entre outras:

- `{{name_suffix}}`;
- `{{product_name}}`;
- `{{quantity}}`;
- `{{cart_total}}`.

Blocos iniciais incluem boas-vindas, pagamento, entrega/pedido mínimo, handoff, produto adicionado/removido e endereço.

### 3. Nome do cliente

O worker cost-first usa o nome já existente no cliente/CRM e extrai um primeiro nome conservador. Valores que parecem empresa, identificador ou rótulo genérico não são usados como vocativo.

### 4. Resolvedor local de produtos

`resolve_whatsapp_product_candidates_v2` usa somente catálogo `counter_verified`, ativo, com preço válido e estoque.

Prioridades:

1. GTIN/SKU exato;
2. nome exato;
3. nome completo presente na mensagem;
4. alias publicado;
5. marca/categoria/embalagem;
6. sobreposição de termos.

O worker só pula a IA para produto quando o primeiro candidato tem confiança forte e distância suficiente do segundo candidato. Ambiguidade volta para o worker v3/OpenAI.

### 5. Aliases configuráveis

`product_aliases` permite ensinar linguagem real do cliente sem treinar modelo ou criar embeddings.

Exemplos:

```text
água sanitária → agua sanitaria
óleo → oleo
```

A lista deve crescer com evidência das conversas reais, não por adivinhação.

### 6. Seleção dinâmica da inteligência

`get_service_intelligence_bundle_v2` separa:

- **CORE**: cordialidade, confiança, segurança, nome, marca e baixo esforço;
- **dinâmico**: regras da intenção/etapa atual;
- conhecimento por tópico;
- procedimentos relevantes.

O orçamento inicial do bundle v2 é conservador:

```text
CORE guidance       <= 7
Dynamic guidance    <= 5
Knowledge           <= 5
Procedures          <= 3
```

### 7. Contexto compacto para OpenAI

`build_whatsapp_sales_context_v1` mantém o contrato existente, mas ganhou um caminho `compact_dynamic_v2` atrás do gate `dynamic_selection_enabled`.

Com o gate ON:

- `raw_event` não é enviado ao modelo;
- histórico cai para até 6 mensagens / 90 minutos;
- candidatos de produto caem para até 6;
- inteligência usa bundle v2;
- intenção/tópico são inferidos deterministicamente antes da chamada.

Com o gate OFF, permanece `legacy_v1`.

### 8. Worker v4 cost-first

O `conversation-worker-v4` **não contém chave OpenAI e não chama OpenAI diretamente**.

Ele resolve apenas casos seguros e, quando não consegue, encaminha ao worker v3 **antes de fazer claim do job**. Isso evita perder o fallback por lock concorrente.

Rotas determinísticas iniciais:

- gatilho `send_block`;
- handoff explícito;
- gatilho de cestas;
- gatilho de carrinho;
- pergunta sobre cestas;
- consulta de carrinho;
- busca de produto com confiança forte;
- adição de produto com confiança forte.

Cliques e interações já homologadas continuam no worker v3 para evitar regressão.

### 9. Shadow mode

O novo router nasce:

```text
whatsapp_cost_first_router_enabled=false
whatsapp_cost_first_shadow_mode=true
trigger_engine_enabled=false
dynamic_selection_enabled=false
```

Portanto migrations/deploy **não ativam o novo comportamento**.

Quando o router for habilitado em `shadow_mode=true`, o worker v4 apenas registra o que teria resolvido e entrega o job ao v3. Isso permite medir cobertura e falsos positivos antes de economizar chamadas reais.

### 10. Admin

A tela de inteligência passa a ter:

1. O que saber;
2. Como atender;
3. Procedimentos;
4. Mensagens;
5. Gatilhos;
6. Apelidos.

Também existe ação de **Simular**, que mostra gatilho, produtos candidatos e se a IA seria necessária.

A API Admin v2 também expõe métricas de custo/roteamento.

## Segurança

- preço/estoque continuam determinísticos;
- aliases não criam produto inexistente;
- busca continua restrita a produtos fisicamente conferidos;
- gatilhos possuem status `draft | published | archived`;
- ações não suportadas não capturam o job;
- fallback para IA ocorre antes do claim;
- confirmação do pedido continua validada no backend;
- RLS habilitado nas novas tabelas;
- acesso direto de `public/anon/authenticated` revogado;
- `service_role` permanece apenas no servidor;
- canary existente não é alterado.

## Estratégia de ativação recomendada

### Fase A — deploy dormente

Aplicar migrations e Edge Functions, mantendo:

```text
whatsapp_cost_first_router_enabled=false
trigger_engine_enabled=false
dynamic_selection_enabled=false
```

Resultado esperado: **zero mudança no atendimento**.

### Fase B — shadow

Sem aumentar o canary atual:

```text
trigger_engine_enabled=true
whatsapp_cost_first_router_enabled=true
whatsapp_cost_first_shadow_mode=true
```

O v4 observa/mede e o v3 continua respondendo.

Medir:

- `% de conversas com rota determinística possível`;
- falso positivo por gatilho;
- falso positivo de produto;
- chamadas IA potencialmente evitadas;
- latência;
- mensagens por conversa.

### Fase C — contexto dinâmico

Após validar o bundle em simulação:

```text
dynamic_selection_enabled=true
```

Ainda pode permanecer em shadow do router. Comparar tokens de entrada contra baseline de ~6,5–6,8k tokens observado antes da mudança.

### Fase D — determinístico real

Somente após shadow limpo:

```text
whatsapp_cost_first_shadow_mode=false
```

**Não aumentar `whatsapp_live_canary_percent` nesta ativação.**

## Rollback

Rollback principal em um único gate:

```text
whatsapp_cost_first_router_enabled=false
```

O dispatcher volta imediatamente ao `conversation-worker-v3`.

O contexto dinâmico pode ser desligado independentemente:

```text
dynamic_selection_enabled=false
```

Assim as duas evoluções são reversíveis separadamente.

## O que não foi feito de propósito

- nenhum novo fornecedor pago;
- nenhum banco vetorial/RAG;
- nenhuma troca de modelo;
- nenhum aumento do canary;
- nenhuma ativação do Bling;
- nenhum WhatsApp Flow;
- nenhuma decisão de pagamento/estoque por IA;
- nenhum disparo de marketing novo.

## Próxima evidência necessária

Depois do merge/deploy dormente, usar o simulador e shadow mode em conversas reais. A decisão de ativar rotas determinísticas deve ser baseada em taxa de acerto, tokens e conversão, e não apenas em impressão subjetiva.
