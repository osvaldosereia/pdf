# Firebase em modo somente leitura

## Regra obrigatória desta branch

O projeto novo pode consultar o Firebase atual, mas não pode alterar, remover, reorganizar ou migrar nenhum dado existente enquanto o site atual estiver em uso.

## Caminhos protegidos

Nenhuma gravação poderá ser executada nos caminhos atuais, incluindo:

- `/produtos`
- `/pedidos`
- `/kits`
- `/cestas`
- `/config_site`
- `/cupons`
- `/banners`
- qualquer outro caminho já usado pelo site, admin, Make ou Bling

## Operações permitidas durante o desenvolvimento

Somente requisições HTTP `GET` para leitura e validação.

São permitidos:

- carregar produtos;
- carregar cestas;
- carregar kits;
- carregar categorias;
- conferir preços, estoque, imagens e composição;
- gerar páginas SEO e feed Merchant em arquivos locais;
- validar os dados sem alterar a origem.

## Operações proibidas

Enquanto esta proteção estiver ativa, ficam proibidos:

- `PUT` no Firebase;
- `POST` no Firebase;
- `PATCH` no Firebase;
- `DELETE` no Firebase;
- criação de novos nós;
- correção automática de registros;
- migração de estrutura;
- atualização de estoque;
- salvamento de pedido do site novo;
- alteração das regras do Realtime Database.

## Pedidos durante os testes

O checkout do projeto novo pode abrir o WhatsApp com a mensagem do pedido.

Ele não deve:

- registrar o pedido no Firebase;
- disparar o webhook do Make;
- criar contato ou pedido no Bling;
- baixar estoque.

Essas integrações só serão ativadas depois da aprovação da versão de testes e com uma estratégia que não interfira no site atual.

## SEO e Merchant

O gerador de páginas e feeds poderá ler o Firebase, mas salvará os resultados somente em arquivos dentro do projeto.

A geração nunca escreverá dados de volta no Firebase.

## Regra de segurança no código

Toda ferramenta de desenvolvimento deve seguir estes princípios:

1. aceitar apenas URL do Firebase para leitura;
2. usar exclusivamente o método `GET`;
3. rejeitar URLs que não terminem em `.json`;
4. não receber token de escrita;
5. não conter função de atualização ou exclusão;
6. falhar sem tentar corrigir os dados automaticamente;
7. gerar relatórios de inconsistência em vez de alterar registros.

## Ativação futura

Antes de qualquer escrita futura, será necessário:

1. identificar exatamente quais caminhos o site atual usa;
2. definir um caminho isolado para a nova aplicação, quando necessário;
3. testar em ambiente separado;
4. revisar regras e permissões;
5. aprovar explicitamente a ativação;
6. manter rollback documentado.

Até essa aprovação, o Firebase atual é uma fonte de consulta intocável.