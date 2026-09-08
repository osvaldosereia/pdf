# Etapa 12 — WMS/Fulfillment leve v2

Status: **fundação integrada à Verdade Comercial, dormente e fail-closed**.

Objetivo: transformar `pedido confirmado → separação → conferência → embalagem → READY → logística` em fluxo físico rastreável e barcode-first, adequado à operação pequena da Dona Antônia e inspirado em princípios profissionais de centro de distribuição.

## Uma única verdade de lote

A tabela `inventory_lots` pertence à fundação **Verdade Comercial** da Etapa 12 (`stage12_commercial_truth_foundation_v1`). O WMS não cria uma segunda tabela de lotes e não mantém saldo paralelo.

O WMS consome:

- `inventory_lots.expires_at`;
- `quantity_available` / `quantity_reserved`;
- `status`;
- `physically_verified`;
- `preview_fefo_allocation_v1` como algoritmo FEFO determinístico oficial.

Um item pode ser dividido em vários `fulfillment_items` quando a quantidade precisa sair de mais de um lote FEFO.

## Contrato operacional

`orders.status` continua sendo o estado comercial/transacional. O estado físico vive em `fulfillment_orders`.

Fluxo físico preparado:

`pending → picking → picked → checking → checked → packing/packed → ready → loading → loaded`.

`READY` significa: **pedido fisicamente separado, conferido, sem exceção aberta, com todos os volumes selados e liberado para expedição**. Somente `release_fulfillment_ready_v2`, atrás de `ready_release_enabled`, pode promover o pedido comercial para `ready` por esta fundação.

## Endereçamento e rota interna de picking

- `warehouse_locations`: zona/gôndola/prateleira/posição e `pick_sequence`;
- `product_location_assignments`: posição normalizada do produto;
- `product_pick_location_v1`: prioriza a posição normalizada e usa `products.gondola/shelf` como fallback compatível enquanto o cadastro físico é migrado gradualmente;
- a ordem de picking é física/determinística, não a ordem em que os itens aparecem no pedido.

Nenhum dos 318 produtos existentes é alterado ou migrado automaticamente.

## Barcode-first e conferência

`fulfillment_scan_events` registra leituras idempotentes por `client_event_id`. O backend rejeita produto não esperado e quantidade excedente. Divergências abrem `fulfillment_exceptions` e bloqueiam a finalização até serem resolvidas.

`require_independent_checker=true` por padrão. O separador não pode ser o mesmo conferente quando essa regra estiver ativa.

`warehouse_staff` nasce sem funcionários; cada registro nasce operacionalmente inativo, e as competências `can_pick`, `can_check`, `can_pack`, `can_load`, `can_resolve_exceptions` nascem `false`.

## Volumes

`order_packages` identifica os volumes por barcode interno e `package_no/package_count`. O pedido só pode chegar a `READY` quando a quantidade de volumes selados coincide com o total declarado.

O carregamento por rota será conectado aos `delivery_jobs/routes/stops` da Etapa 11 em bloco posterior, para garantir que um volume só seja carregado no veículo/rota corretos.

## Mobile/PWA

`warehouse-app/` é mobile-first para celulares, tablets e leitores USB/Bluetooth em modo teclado HID.

A versão v2 prepara:

- autenticação Supabase;
- fila de pedidos por papel operacional;
- separação e conferência por barcode;
- quantidade por leitura;
- indicação de gôndola/prateleira/lote/validade;
- fila offline local para scans;
- vibração/feedback em erro;
- PWA/cache local.

Ela continua `enabled=false` e sem URL/chave publicável preenchidas no repositório.

## API operacional

`warehouse-ops-v1` é versionada com `verify_jwt=true`. Depois do JWT, a função resolve `warehouse_staff` pelo `auth_user_id` e aplica autorização por competência antes de chamar RPCs server-only.

A Edge Function **não deve ser deployada automaticamente neste bloco**. Versionar a função não ativa o WMS.

## Segurança e defaults

```text
fulfillment_runtime_config.enabled = false
execution_mode = off
order_creation_enabled = false
picking_enabled = false
checking_enabled = false
packing_enabled = false
ready_release_enabled = false
loading_enabled = false
fefo_enforced = false
barcode_required = true
require_independent_checker = true
allow_manual_barcode_override = false
canary_percent = 0
warehouse-app.enabled = false
```

Tabelas/RPCs WMS são server-only com RLS e privilégios revogados de `anon`/`authenticated`.

## Testes obrigatórios

O CI aplica primeiro `stage12_commercial_truth_foundation_v1` e depois o WMS em PostgreSQL isolado. A regressão prova:

1. runtime OFF não escreve;
2. FEFO ignora lote não verificado;
3. um pedido pode ser dividido em dois lotes FEFO;
4. barcode incorreto é rejeitado;
5. excesso é rejeitado;
6. conferente independente é obrigatório;
7. pedido sem pacote não vira `READY`;
8. somente pedido 100% separado + conferido + embalado pode virar `READY`;
9. WMS não recria `inventory_lots`;
10. `warehouse-ops-v1` exige JWT.

## Fora do escopo de ativação

- nenhum estoque real é reservado/consumido por este bloco;
- nenhum funcionário, lote, localização ou pedido WMS real é criado automaticamente;
- nenhuma Edge Function WMS é deployada;
- nenhum Bling, SEFAZ, Make, Maps ou OpenAI é chamado;
- nenhuma logística real é ativada.

Próximos blocos seguros: reserva/liberação/consumo de lote idempotentes, Admin de posições/lotes/fulfillment e scan de carregamento vinculado à rota da Etapa 11.
