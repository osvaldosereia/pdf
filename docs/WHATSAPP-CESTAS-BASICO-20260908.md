# WhatsApp — fluxo básico de venda de cestas

Data: 2026-09-08

## Escopo desta versão
Somente venda básica de cestas pelo WhatsApp e catálogo externo mobile. Bling permanece fora desta etapa.

## Fluxo obrigatório
1. Qualquer pergunta sobre cestas envia a lista das 9 cestas ativas para seleção.
2. Ao escolher uma cesta, o atendimento envia o link da cesta selecionada.
3. O catálogo externo mostra foto grande da cesta, preço comercial da cesta e composição sem preços individuais.
4. Quantidades dos componentes podem ser ajustadas; alterações ficam registradas para conferência humana e não revelam margem/custo/preço individual.
5. O botão `Adicionar mais produtos` abre a lista de categorias reais existentes no cadastro de produtos conferidos.
6. O cliente pode selecionar uma ou várias categorias. A vitrine é criada somente com produtos dessas categorias.
7. A vitrine é mobile-first, grade de 3 colunas, card vertical, foto, nome abreviado, preço e seletor de quantidade. Toque no card amplia o produto.
8. A barra inferior mostra o total comercial da cesta somado aos produtos extras e envia o cliente de volta ao WhatsApp.
9. Ao encomendar, cliente cadastrado confirma os dados. Cliente sem cadastro completo informa em uma única mensagem: `Nome | Rua | Quadra | Casa | Bairro | Localizador`.
10. Pedido feito até 11:00 no horário de Cuiabá: entrega no mesmo dia. Após 11:00: próximo dia útil.
11. Não há taxa de entrega.
12. Depois de registrar a encomenda para conferência, a conversa é transferida para humano.
13. Nenhum pedido é enviado ao Bling nesta etapa.

## Formas de pagamento
- Cartão de Crédito em 3x sem juros
- Cartão de Débito
- Pix e Dinheiro
- Cartão Alimentação Alelo, Sodexo, Puxee, Cajur, Flash e Ifood.
- Por enquanto não vendemos pra 30 dias ou no Boleto.

## Horário da entrega
Quando o cliente perguntar o horário exato da entrega, responder que as entregas são por rota e o horário depende do bairro; em seguida transferir para atendimento humano.

## Segurança operacional
- Canary do WhatsApp permanece em 1%.
- Flow/Data Exchange continuam desligados.
- Bling continua desligado.
- Regras simples de cestas, pagamento, taxa e horário de entrega são determinísticas e não dependem de geração livre da IA.
- Produtos extras vêm apenas de produtos fisicamente conferidos, ativos, com preço e estoque.
