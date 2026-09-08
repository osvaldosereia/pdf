# Implementação — WhatsApp cestas básicas

Data: 2026-09-08

## Implementado nesta rodada
- lista determinística com as 9 cestas ativas do banco;
- seleção da cesta por lista interativa do WhatsApp;
- geração de link individual para `/cesta/?t=<token>`;
- catálogo externo mobile com foto grande, composição sem preço individual e quantidade editável;
- botão `Adicionar mais produtos` abre seleção das categorias reais do cadastro;
- vitrine filtrada somente pelas categorias escolhidas, em 3 colunas no mobile;
- produtos extras usam apenas cadastro fisicamente conferido, ativo, com preço e estoque;
- total comercial = preço fixo da cesta + produtos extras;
- retorno ao WhatsApp para encomendar;
- cliente cadastrado confirma dados; cliente incompleto informa `Nome | Rua | Quadra | Casa | Bairro | Localizador` em uma mensagem;
- regra de entrega usa `America/Cuiaba`: até 11h mesmo dia; após 11h próximo dia útil;
- taxa de entrega = R$ 0;
- formas de pagamento cadastradas exatamente conforme decisão do proprietário;
- perguntas de horário da entrega informam rota/bairro e transferem para humano;
- encomenda final é registrada em `whatsapp_basket_order_requests` e transferida para humano;
- Bling não participa deste fluxo nesta etapa.

## Produção / gates preservados
- canary WhatsApp não foi aumentado;
- Flow/Data Exchange não foram ativados;
- Bling não foi ativado;
- regras críticas foram implementadas de forma determinística antes da geração livre da IA.
