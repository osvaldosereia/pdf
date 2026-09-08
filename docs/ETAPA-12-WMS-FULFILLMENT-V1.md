# Etapa 12 — Fundação WMS/Fulfillment + Lotes/FEFO v1

Status: **programação preparatória, dormente e fail-closed**.

Esta fundação fecha a lacuna operacional entre pedido comercial confirmado e `orders.status='ready'`. O conceito de `READY` passa a significar: **pedido fisicamente separado, conferido por regra independente, embalado/identificado e liberado para expedição**.

## Escopo deste bloco

- estoque por lote com validade, saldo físico, reserva e status;
- FEFO determinístico por validade/data de entrega;
- endereçamento normalizado de estoque por zona/gôndola/prateleira/posição;
- compatibilidade com os campos legados `products.gondola` e `products.shelf`, sem migrar nem alterar os produtos existentes;
- fila de fulfillment separada do estado comercial do pedido;
- tarefas de picking ordenadas por `pick_sequence`;
- GTIN/EAN/SKU como identificadores de leitura;
- rejeição de produto não esperado e excesso de quantidade;
- trilha de scans com `client_event_id` idempotente;
- exceções operacionais estruturadas;
- conferência independente configurável, impedindo por padrão que o mesmo usuário separe e confira;
- volumes/pacotes identificados por barcode interno;
- gate backend-only para `READY` após separação + conferência + pacote selado;
- funcionários operacionais server-only com permissões por função;
- PWA mobile para tablets/celulares/leitores que emulam teclado;
- fila offline local no dispositivo;
- API Edge Function autenticada com JWT e validação de `operations_staff`;
- CI em PostgreSQL isolado/PGlite + contrato estático + `deno check`.

## Segurança e ativação

Defaults obrigatórios:

```text
fulfillment_runtime_config.enabled = false
execution_mode = off
order_creation_enabled = false
picking_enabled = false
checking_enabled = false
packaging_enabled = false
loading_enabled = false
ready_release_enabled = false
require_independent_checker = true
barcode_required = true
fefo_required = true
allow_manual_barcode_override = false
canary_percent = 0
```

`operations_staff.active` também nasce `false`. Nenhum funcionário é criado/ativado por migration.

A PWA nasce com `DA_FULFILLMENT_CONFIG.enabled=false`. A Edge Function é apenas versionada neste bloco e não deve ser deployada/ativada automaticamente.

## Fluxo alvo

```text
CONFIRMED / PROCESSING
  -> fulfillment pending
  -> PICKING
  -> PICKED
  -> CHECKING (conferente independente)
  -> CHECKED
  -> PACKED (>=1 volume selado)
  -> READY
  -> Etapa 11: delivery_job / rota / carregamento / entrega
  -> payment confirmed
  -> FISCAL_READY
  -> NF-e
```

A liberação `READY` falha se houver tarefa incompleta, exceção aberta, ausência de pacote selado ou mudança incompatível do estado comercial.

## Lotes e FEFO

`inventory_lots` não substitui nem altera `products.stock` neste bloco. Ele cria a verdade detalhada futura por lote. Nenhum lote é criado automaticamente a partir dos 318 produtos existentes.

`preview_fefo_for_product_v1` seleciona somente lotes `available`, não vencidos para a data de entrega, com saldo livre, ordenando por:

1. `expiry_date` crescente;
2. `received_at` crescente;
3. `id` como desempate determinístico.

A função é preview/read-only. Reserva/baixa definitiva de lote será adicionada em bloco posterior da Etapa 12 após consolidar política de estoque e regressão com pedidos reais de homologação.

## Endereçamento

`product_pick_location_v1` prioriza o novo endereçamento normalizado. Na ausência dele, lê `products.gondola` / `products.shelf`, preservando o cadastro atual. Isso permite evoluir sem uma migração destrutiva.

A sequência física de separação é controlada por `warehouse_locations.pick_sequence`, não pela ordem comercial dos itens do pedido.

## Cestas básicas

Esta fundação trabalha sobre `order_items`, que deve representar a verdade física do pedido. Para cesta personalizada, a expansão definitiva do snapshot da cesta em linhas físicas precisa continuar ocorrendo antes do fulfillment. Não se deve inferir componentes a partir do template atual depois que o pedido já foi fechado, pois isso poderia perder alterações personalizadas.

## Hardware

O aplicativo foi desenhado para:

- celular;
- tablet;
- leitor USB/Bluetooth que funcione como teclado HID;
- câmera/barcode nativo futuramente, se custo-benefício justificar.

Não é necessária API paga para picking, conferência ou FEFO.

## Próximos blocos da Etapa 12

1. validar/aplicar estas migrations somente após CI verde;
2. normalizar/administrar posições e lotes sem alterar produção automaticamente;
3. reserva/baixa de lote transacional e política de validade mínima por data de entrega;
4. carregamento da rota por scan e integração com os `delivery_jobs` da Etapa 11;
5. ofertas/benefícios e guardião de margem sobre a verdade de estoque/validade.
