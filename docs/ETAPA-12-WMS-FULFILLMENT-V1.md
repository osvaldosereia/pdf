# Etapa 12 — WMS/Fulfillment leve v1

Fundação dormente para transformar `pedido confirmado → separação → conferência → READY → logística` em um fluxo rastreável e barcode-first, adequado à operação pequena da Dona Antônia sem perder princípios profissionais de centro de distribuição.

## Contrato operacional

`orders.status` continua sendo o estado comercial/transacional. O estado físico vive em `fulfillment_orders` e não polui o ciclo comercial.

Fluxo físico preparado:

`pending → picking → picked → checking → checked → packing/packed → ready → loading → loaded`.

`READY` passa a significar pedido fisicamente separado e conferido, apto a entrar na logística da Etapa 11. O backend `release_fulfillment_ready_v1` é o único caminho desta fundação que pode promover o pedido comercial para `ready`, e nasce bloqueado por `fulfillment_runtime_config.ready_release_enabled=false`.

## Estruturas

- `warehouse_locations`: zona/gôndola/prateleira/posição + `pick_sequence` determinística;
- `product_location_assignments`: produto→posição, com uma posição primária ativa;
- `inventory_lots`: lote, validade, saldo e reserva, preparado para FEFO;
- `warehouse_staff`: picker/checker/loader/supervisor;
- `fulfillment_orders` e `fulfillment_items`: verdade da execução física;
- `fulfillment_scan_events`: trilha imutável por leitura e `client_event_id` idempotente;
- `order_packages`: volumes identificáveis para carregamento/entrega.

## Barcode-first

Picking e checking trabalham por GTIN ou SKU conhecido. Produto incorreto e excesso geram eventos explícitos; quantidade não pode ultrapassar o pedido. Conferência independente é obrigatória por padrão (`require_independent_checker=true`). Override manual nasce desligado.

## FEFO

A fundação contém `inventory_lots` e seleção determinística do lote mais próximo do vencimento que ainda seja elegível. `fefo_enforced=false` por padrão; a expansão completa de validade/estoque/margem continua sendo a Etapa 12 e será feita em blocos seguintes.

## Mobile/PWA

`warehouse-app/` é a casca mobile-first para celulares/tablets/leitores que emulam teclado. Nasce `enabled=false`; possui cache PWA e fila local para leituras offline, mas a API operacional real não foi publicada nesta versão. Não há side effect externo.

## Segurança

Todas as tabelas têm RLS e privilégios de `anon`/`authenticated` revogados; funções mutáveis ficam restritas a `service_role`. O runtime nasce OFF, canary 0 e todos os gates independentes desligados.

## Fora do escopo desta fundação

- nenhuma operação real de estoque é ativada;
- nenhuma baixa/reserva física é aplicada a dados reais;
- nenhum Bling/SEFAZ/Make/Maps/OpenAI é chamado;
- nenhuma Edge Function do WMS é deployada;
- carregamento por rota e vínculo com o app do entregador serão integrados após os contratos de FEFO/estoque e picking/checking estabilizarem.
