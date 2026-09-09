# Dona Antônia — WhatsApp Flow Cestas Comercial V1

Data: 09/09/2026

Status: **IMPLEMENTAÇÃO EM ANDAMENTO, DORMENTE, ROLLOUT 0%**.

## Objetivo

Um único WhatsApp Flow reutilizável para o funil prioritário:

1. escolher cesta básica;
2. personalizar a cesta sem exibir preço individual dos componentes;
3. adicionar produtos extras;
4. fazer upsell/cross-sell opcional e relevante;
5. revisar o pedido;
6. confirmar cliente/endereço já conhecidos;
7. escolher pagamento;
8. reservar/finalizar pedido;
9. retornar ao chat para solicitar localização.

## Decisão de catálogo

O catálogo real pode superar 1.000 produtos. O Flow **nunca** deve carregar o catálogo completo.

Política implantada:

- 6 seções macro;
- 32 termos comerciais iniciais;
- termos funcionam como buscas, não como novas categorias físicas obrigatórias;
- busca padrão retorna no máximo 12 produtos;
- limite absoluto por consulta: 20 produtos;
- intenção clara da IA pode pular seção/termo e abrir diretamente uma busca filtrada;
- preço, estoque e existência do produto continuam sendo validados pelo backend determinístico.

Exemplo:

```text
Higiene e beleza
  → Sabonetes
  → search_query=sabonete
  → somente produtos reais e disponíveis
```

## Backend implantado

Migration:

`20260909062000_whatsapp_flow_cestas_commercial_v1.sql`

Cria:

- `whatsapp_flow_search_terms`;
- `get_whatsapp_flow_sections_v1()`;
- `get_whatsapp_flow_search_terms_v1(section)`;
- `get_whatsapp_flow_product_results_v1(query,limit)`;
- `get_whatsapp_flow_commercial_snapshot_v1(conversation_id)`;
- feature `flow_basket_commercial`, desligada e rollout 0%;
- definição `flow-cestas-comercial-v1`, status draft e sem provider_id.

O snapshot reutiliza funções já homologadas do sistema:

- cestas WhatsApp;
- cadastro/endereço;
- carrinho;
- recomendações cart-aware;
- busca de produtos verificados.

## Flow JSON

Fonte inicial:

`whatsapp/flows/flow-cestas-comercial-v1.json`

Possui 10 telas, o teto definido para este desenho:

```text
CESTAS
PERSONALIZAR
SECOES
TERMOS
PRODUTOS
PRODUTO
UPSELL
REVISAO
CLIENTE
FINALIZAR
```

O JSON usa Data Exchange e permanece apenas como fonte draft até passar pelo validador da Meta e pela homologação criptográfica real.

## Limitação visual importante

WhatsApp Flow não é HTML/CSS livre. `Image` recebe bytes/base64 e há limites de mídia/payload. Portanto, a estratégia profissional não deve tentar renderizar 10–20 cards grandes com foto simultaneamente.

Estratégia escolhida:

- lista compacta de resultados;
- cliente escolhe um produto;
- tela `PRODUTO` mostra foto maior, nome, preço e quantidade;
- no máximo pequenos conjuntos visuais quando o componente oficial permitir sem exceder payload.

Isso preserva desempenho e permite aparência nativa consistente.

## Segurança preservada

Após a migration foi confirmado em produção:

```text
whatsapp_live_canary_percent = 1
experience_orchestrator_enabled = false
whatsapp_flow_data_exchange_enabled = false
whatsapp_flow_send_enabled = false
bling_order_sync_enabled = false
flow_basket_commercial.enabled = false
flow_basket_commercial.rollout_percent = 0
flow-cestas-comercial-v1.status = draft
provider_id = null
```

A migration não publica Flow, não envia mensagem Flow e não toca Bling.

## Validação inicial de dados

- 6 seções retornadas;
- 32 termos segmentados ativos;
- consulta `sabonete` retornou 10 produtos reais no teste de produção;
- limite permanece encapsulado no backend.

## Segurança Supabase

A nova tabela usa RLS e permissões somente `service_role`, seguindo o padrão server-side do projeto. O advisor do Supabase reporta `RLS enabled no policy` como INFO para várias tabelas server-only, inclusive esta; neste caso isso é intencional porque `anon` e `authenticated` foram explicitamente revogados.

## Próximos blocos

1. validar o Flow JSON no validador/Playground oficial da Meta e corrigir qualquer incompatibilidade de schema;
2. implementar handler Data Exchange específico para `flow-cestas-comercial-v1`;
3. implementar conversão segura de imagem do produto URL → base64 limitada/cached para a tela de detalhe;
4. substituir a edição textual provisória da cesta por controles estruturados de quantidade/remover/substituir;
5. implementar writes idempotentes Flow → carrinho atrás dos gates já existentes;
6. implementar outbound `interactive.type=flow` no contrato de job e no Make;
7. implementar ingestão `nfm_reply`/`response_json`;
8. gerar/registrar chave pública e configurar provider_id real;
9. homologar somente em allowlist, mantendo rollout público 0%;
10. só depois avaliar liberação controlada.
