# Etapa 12 — WMS/Fulfillment leve v1

Fundação dormente para transformar `pedido confirmado → separação → conferência → READY → logística` em um fluxo rastreável e barcode-first, adequado à operação pequena da Dona Antônia sem perder princípios profissionais de centro de distribuição.

## Integração com a Verdade Comercial

A fonte de lotes é **exclusivamente** `inventory_lots` criada pelo bloco de Verdade Comercial da Etapa 12 (`20260908130000_stage12_commercial_truth_foundation_v1.sql`). O WMS não cria uma segunda tabela de lotes nem redefine validade/saldo. Ele consome os campos oficiais `expires_at`, `received_at`, `quantity_available`, `quantity_reserved`, `physically_verified` e `status`.

A migration do WMS é `20260908130200_stage12_wms_fulfillment_v1.sql`, deliberadamente posterior às migrations de Verdade Comercial. `inventory_lot_locations` acrescenta somente o vínculo físico lote→posição sem duplicar a verdade de saldo do lote.

## Contrato operacional

`orders.status` continua sendo o estado comercial/transacional. O estado físico vive em `fulfillment_orders` e não polui o ciclo comercial.

Fluxo físico preparado:

`pending → picking → picked → checking → checked → packing/packed → ready → loading → loaded`.

`READY` significa pedido fisicamente separado e conferido, apto a entrar na logística da Etapa 11. `release_fulfillment_ready_v1` é o caminho protegido desta fundação para promover o pedido comercial para `ready`, e nasce bloqueado por `fulfillment_runtime_config.ready_release_enabled=false`.

## Estruturas

- `warehouse_locations`: zona/gôndola/prateleira/posição + `pick_sequence` determinística;
- `product_location_assignments`: produto→posição, com uma posição primária ativa;
- `inventory_lot_locations`: lote oficial→posição física;
- `warehouse_staff`: picker/checker/loader/supervisor;
- `fulfillment_orders` e `fulfillment_items`: verdade da execução física;
- `fulfillment_scan_events`: trilha por leitura e `client_event_id` idempotente;
- `order_packages`: volumes identificáveis para carregamento/entrega.

Os campos legados `products.gondola` e `products.shelf` continuam disponíveis como origem de cadastro/migração futura, mas o runtime novo usa posições normalizadas e não retropreenche dados reais automaticamente.

## Picking e barcode-first

`preview_fulfillment_order_v1` informa se todos os itens possuem localização primária sem fazer write. A criação do fulfillment falha com `product_location_missing` se algum produto não tiver posição ativa; não existe fallback silencioso para uma posição genérica.

Picking e checking trabalham por GTIN ou SKU conhecido. Produto incorreto e excesso geram eventos explícitos; quantidade não pode ultrapassar o pedido. Conferência independente é obrigatória por padrão (`require_independent_checker=true`). Override manual nasce desligado.

A sequência de caminhada é determinística por `warehouse_locations.pick_sequence`, evitando IA/API para uma tarefa que pode ser resolvida com custo zero e previsibilidade.

## FEFO

Quando futuramente `fefo_enforced=true`, o fulfillment escolhe somente lote oficial `available`, `physically_verified=true`, com quantidade livre e validade compatível. A ordenação é `expires_at → received_at → id`, igual ao contrato da Verdade Comercial. O gate nasce `false` e nenhuma reserva/baixa de estoque é feita nesta fundação.

## Mobile/PWA

`warehouse-app/` é a casca mobile-first para celulares/tablets e leitores que emulam teclado. Nasce `enabled=false`; possui cache PWA e fila local para leituras offline. A API operacional real ainda não foi publicada, portanto não há side effect real escondido na interface.

## Segurança

Todas as novas tabelas têm RLS e privilégios de `anon`/`authenticated` revogados; funções mutáveis ficam restritas a `service_role`. O runtime nasce `OFF`, canary 0 e picking/checking/packing/READY/loading/FEFO independentes e desligados.

O CI aplica primeiro a migration de Verdade Comercial e depois a do WMS em PostgreSQL isolado, garantindo que os dois blocos não criem esquemas concorrentes. O teste também simula em ambiente isolado: posição → FEFO → picking por código de barras → rejeição de item errado → conferência por funcionário diferente → `CHECKED → READY`.

## Fora do escopo desta fundação

- nenhuma operação real de estoque é ativada;
- nenhuma baixa/reserva física é aplicada a dados reais;
- nenhum Bling/SEFAZ/Make/Maps/OpenAI é chamado;
- nenhuma Edge Function do WMS é deployada;
- a PWA continua OFF;
- carregamento por rota, etiquetas/volumes e vínculo final com o app do entregador serão ampliados em blocos seguintes da Etapa 12.
