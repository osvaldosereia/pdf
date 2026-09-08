# Dona Antônia — WhatsApp MVP — checkpoint de prontidão

Data: 2026-09-08

## Estado desta rodada

O atendimento conversacional do WhatsApp está na fase final de homologação e tecnicamente pronto para uso controlado dentro do canary já autorizado.

### Validações concluídas

- PR #237 `WhatsApp MVP: homologação final de prontidão` mergeada após CI verde.
- CI do MVP validou:
  - contratos estáticos;
  - PostgreSQL/PGlite isolado para catálogo, carrinho e inteligência;
  - JavaScript do Admin e writer;
  - `deno check` do `conversation-worker-v3` e do Admin de inteligência;
  - regressão crítica do worker existente.
- Busca de produto corrigida para aceitar mensagens sem acento, por exemplo `oleo` = `óleo`, `acucar` = `açúcar`.
- Fluxo de quantidade explícita permanece obrigatório antes de adicionar produto selecionado.
- Checkout pede endereço antes da única confirmação final.
- Quando `sales_state.awaiting=delivery_address`, o endereço recebido retoma o checkout e não vale como confirmação do pedido.
- Mensagem atual continua tendo prioridade sobre intenção antiga do histórico.
- Handoff humano continua com precedência sobre IA.

### Dados de prontidão observados

- 319 produtos fisicamente conferidos, ativos, com preço e estoque, disponíveis para o vendedor IA.
- 9 cestas ativas no WhatsApp, todas com preço válido e imagem.
- 8 conhecimentos publicados.
- 8 orientações publicadas.
- 3 procedimentos publicados.
- 18 casos de regressão ativos.
- Busca comum validada para arroz, feijão, óleo, açúcar, café, macarrão, sabão e leite.
- Make Inbound e Outbound ativos, sem execuções incompletas observadas na auditoria desta rodada.
- Nenhum erro outbound observado após as correções desta rodada.

## Gates que NÃO foram alterados

- `whatsapp_release_mode=live`
- `whatsapp_live_canary_percent=1`
- `whatsapp_inbound_enabled=true`
- `whatsapp_auto_reply_enabled=true`
- `whatsapp_sales_mvp_enabled=true`
- `whatsapp_sales_order_submit_enabled=true`
- `whatsapp_sales_bling_submit_enabled=false`
- `whatsapp_flow_data_exchange_enabled=false`
- `whatsapp_flow_send_enabled=false`

Não aumentar o canary acima de 1% sem autorização explícita do proprietário.
Não ativar Bling, Flow/Data Exchange ou outros módulos dormentes apenas por este checkpoint.

## Próximo passo seguro

Usar o atendimento em tráfego real controlado no canary de 1%, observar conversas reais e corrigir somente regressões concretas. Depois de evidência operacional suficiente, pedir autorização explícita antes de qualquer aumento do canary.
