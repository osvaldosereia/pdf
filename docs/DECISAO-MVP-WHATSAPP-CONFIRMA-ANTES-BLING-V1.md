# Decisão — MVP WhatsApp confirma a venda antes do Bling v1

Data: 2026-09-08
Status: decisão operacional do proprietário

## Regra principal

Para o MVP da Dona Antônia, o caminho crítico da venda termina no WhatsApp:

`ATENDIMENTO → CARRINHO → AJUSTES/TROCAS → RESUMO → CONFIRMAÇÃO EXPLÍCITA DO CLIENTE → PEDIDO INTERNO CONFIRMADO → CONFIRMAÇÃO FINAL NO WHATSAPP`

Somente depois disso começa a retaguarda:

`PEDIDO INTERNO CONFIRMADO → FILA PENDING_BLING → GITHUB ACTION EM LOTE → BLING PEDIDO DE VENDA`

O cliente não deve aguardar, acompanhar ou receber mensagens sobre o tempo de sincronização do Bling.

## Agenda do Bling

- executor: GitHub Actions;
- frequência: a cada 10 minutos;
- janela operacional: 07:00 até 18:00;
- timezone: `America/Cuiaba`;
- concorrência global serializada (`bling-api-global`);
- uma indisponibilidade do Bling não invalida nem desfaz uma venda já confirmada;
- falha ambígua de efeito externo vai para revisão, sem retry cego que possa duplicar pedido/produto.

## Fonte de verdade comercial

O atendimento não usa o cadastro de produtos do Bling como catálogo.

A fonte oficial para nome, preço, estoque, disponibilidade e foto é o banco próprio da Dona Antônia, alimentado/conferido pelo contador físico (`products.physically_verified=true`).

Quando um produto vendido ainda não possui `bling_product_id`, o writer de retaguarda pode criar um produto técnico mínimo no Bling a partir do banco próprio e persistir apenas o ID retornado. Esse vínculo existe para permitir o Pedido de Venda no Bling; ele não transforma o Bling em fonte de verdade comercial.

## Semântica dos estados

- `customer_sale_status=confirmed`: venda concluída para o cliente;
- `sync_status=pending_bling`: tarefa interna de retaguarda;
- `sent_to_bling`: sincronização de retaguarda concluída;
- erro/revisão do Bling nunca deve retornar a conversa comercial para “não confirmada”.

## Resposta ao cliente

A confirmação final deve comunicar somente o que interessa ao cliente, por exemplo:

> Pedido confirmado. Total: R$ X.

Não deve dizer “aguarde o Bling”, “enviando ao sistema” ou tornar o pedido dependente da API do Bling.

## Segurança

- confirmação do pedido exige manifestação explícita do cliente;
- efeitos do Bling ficam atrás dos gates `bling_order_sync_enabled` e `whatsapp_sales_bling_submit_enabled`;
- o agendamento automático só entra em efeito no branch padrão após merge;
- canary do WhatsApp não deve ultrapassar 1% sem nova autorização.
