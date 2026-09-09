# Plano de auditoria do Admin V2

Nenhuma reconstrução administrativa deve começar por copiar telas ou corrigir botões isoladamente. O admin atual será tratado como fonte de requisitos e regras de negócio, não como base estrutural.

## 1. Inventário obrigatório

Antes de programar o Admin V2, levantar:

- todas as abas e subabas;
- todos os botões e ações;
- todos os modais, drawers, filtros e seletores;
- funções globais e funções sobrescritas;
- módulos externos carregados;
- chamadas ao Firebase, GitHub, Make, Bling e arquivos JSON;
- chaves de cache e localStorage;
- fluxos de produto, estoque, validade, banners, kits, cestas, pedidos e configurações;
- dependências entre telas;
- permissões e riscos de escrita;
- código morto, duplicado, legado ou incompatível.

## 2. Mapa de responsabilidades

Cada função encontrada será classificada em uma única camada:

1. interface;
2. estado;
3. validação;
4. domínio;
5. leitura de dados;
6. gravação de dados;
7. publicação;
8. integração externa;
9. auditoria e logs.

Funções que misturam mais de uma responsabilidade deverão ser divididas no Admin V2.

## 3. Estratégia de navegação

O Admin V2 será organizado por áreas funcionais:

- Visão geral;
- Produtos;
- Estoque e validade;
- Cadastros auxiliares;
- Cestas e kits;
- Banners e campanhas;
- Compra rápida;
- Pedidos e operação;
- Integrações;
- Publicação;
- Configurações;
- Diagnóstico e auditoria.

Cada área terá ações primárias claras, ações perigosas separadas e estado de carregamento explícito.

## 4. Regras de interface

- nenhum botão sem estado de carregamento, sucesso e erro;
- nenhuma ação de escrita sem validação prévia;
- ações destrutivas sempre confirmadas;
- origem dos dados sempre visível;
- formulários curtos por contexto, sem telas gigantes;
- desktop e mobile tratados separadamente quando necessário;
- filtros persistentes somente quando fizer sentido;
- nenhuma função essencial escondida em menus confusos;
- componentes reutilizáveis para cards, tabelas, filtros, modais e alertas.

## 5. Segurança de dados

- Firebase como fonte oficial;
- snapshots do GitHub somente como derivados;
- bloquear publicação vazia;
- bloquear queda anormal de produtos;
- comparar quantidade antes e depois;
- registrar operador, horário, origem e resultado;
- separar salvar dados de publicar catálogo;
- impedir token sensível exposto no navegador;
- permitir rollback de publicação.

## 6. Ordem de reconstrução

1. auditoria completa do admin atual;
2. documento de requisitos por módulo;
3. mapa de dependências;
4. arquitetura do Admin V2;
5. painel somente leitura;
6. edição de produtos;
7. estoque e validade;
8. cadastros auxiliares;
9. cestas, kits e Compra rápida;
10. banners;
11. pedidos;
12. publicação segura;
13. integrações;
14. testes de permissão, falha e recuperação.

## 7. Critério para substituir o admin atual

O Admin V2 somente poderá substituir o atual quando:

- todas as funções usadas estiverem mapeadas;
- nenhum fluxo crítico estiver ausente;
- as gravações tiverem confirmação e logs;
- publicação vazia estiver tecnicamente bloqueada;
- testes de Firebase, GitHub e falha de rede passarem;
- operação em celular e desktop estiver aprovada;
- houver procedimento de rollback documentado.
