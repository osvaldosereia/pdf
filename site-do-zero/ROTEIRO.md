# Novo site Dona Antônia — roteiro técnico definitivo

## 1. Objetivo

Reescrever a loja do zero em um projeto separado, simples, rápido e fácil de manter.

O site principal será desenvolvido em um único `index.html`, com HTML, CSS e JavaScript juntos, sem copiar a programação atual e sem framework.

### Prioridades

1. visual leve e quase todo branco;
2. fotos grandes;
3. pouco texto;
4. uso simples no celular;
5. Firebase como única fonte de dados;
6. pedido rápido pelo WhatsApp;
7. integração com Firebase, Make e Bling;
8. SEO e Merchant Center exclusivamente para cestas básicas;
9. produtos e kits fora do Google;
10. produção atual preservada até a aprovação.

---

## 2. Fonte única de dados

O Firebase Realtime Database será a única fonte oficial do novo site.

Não haverá:

- catálogo alternativo no GitHub;
- arquivo de produtos como segunda fonte;
- fallback para uma base antiga;
- sincronização entre duas bases;
- dados de demonstração apresentados ao cliente.

Caminhos previstos:

```text
/produtos
/cestas
/kits
/cupons
/banners
/config_site
/pedidos
```

O navegador salvará somente dados locais do usuário, como carrinho, favoritos, preferências e formulário. Preço, estoque, validade, oferta e cadastro sempre virão do Firebase.

Se o Firebase falhar, o site mostrará uma mensagem objetiva, botão para tentar novamente e contato pelo WhatsApp. Não exibirá catálogo velho como se estivesse atualizado.

---

## 3. Estrutura do projeto

```text
/site-do-zero/
  index.html              aplicação principal em HTML único
  ROTEIRO.md              documentação do projeto
  /cestas/                páginas públicas de SEO das cestas, geradas depois
  sitemap-cestas.xml      somente páginas de cestas
  merchant-cestas.xml     somente cestas básicas
```

O aplicativo continuará concentrado em um HTML. A única exceção necessária será a geração de páginas públicas individuais das cestas, pois uma SPA com hash não entrega o melhor resultado possível para SEO e Merchant Center.

Produtos avulsos, kits, categorias, busca, ofertas e favoritos funcionarão dentro da aplicação, mas não terão páginas indexáveis.

---

## 4. Organização interna do HTML único

1. metadados gerais;
2. CSS;
3. cabeçalho;
4. conteúdo principal;
5. barra móvel;
6. carrinho;
7. checkout;
8. objeto `CONFIG`;
9. utilitários;
10. comunicação com Firebase;
11. normalização dos dados;
12. estado central;
13. índices de busca;
14. rotas;
15. cards e páginas;
16. carrinho e favoritos;
17. cestas e kits;
18. checkout;
19. pedido e WhatsApp;
20. Firebase e Make;
21. eventos;
22. inicialização.

O código será separado por comentários grandes e funções pequenas, mesmo estando em um arquivo único.

---

## 5. Configuração central

No começo do JavaScript haverá apenas um objeto editável com:

- nome da loja;
- domínio;
- número do WhatsApp;
- URL do Firebase;
- caminhos do Firebase;
- webhook do Make;
- webhook de consulta de CPF;
- pedido mínimo;
- cidades atendidas;
- horário limite da entrega no mesmo dia;
- datas disponíveis;
- descontos;
- versão do site;
- modo de teste;
- recursos habilitados.

Nenhum endereço, número ou regra importante ficará espalhado pelo código.

---

## 6. Carregamento rápido

O site fará uma leitura principal de `/produtos.json` e leituras menores de cestas, kits, cupons e configurações.

Depois da leitura:

- os registros serão normalizados uma vez;
- produtos inativos serão descartados;
- serão criados índices em memória por ID, Firebase key, código, EAN e slug;
- busca e filtros trabalharão sobre os índices;
- o Firebase não será consultado novamente em cada clique;
- listas longas serão renderizadas progressivamente.

Na primeira versão não haverá listener em tempo real. Isso evita consumo, atualizações desnecessárias e instabilidade visual. A atualização será feita ao abrir ou recarregar a loja.

### Recursos de desempenho

- JavaScript puro;
- nenhum framework;
- nenhum carrossel de terceiros;
- fonte do próprio sistema;
- CSS no HTML;
- eventos delegados;
- busca com pequeno atraso;
- imagens com dimensões fixas;
- `loading="lazy"` fora da primeira tela;
- prioridade alta somente nas primeiras imagens;
- imagens WebP ou AVIF quando disponíveis;
- poucas animações;
- sem service worker na primeira fase;
- sem reconstruir o campo de busca a cada tecla.

---

## 7. Direção visual

O visual deve parecer uma loja simples, organizada e confiável.

### Regras

- fundo branco ou cinza quase branco;
- uma cor principal da Dona Antônia;
- quase nenhum degradê;
- sem excesso de banners;
- sem blocos coloridos competindo com os produtos;
- fotos grandes e quadradas;
- nomes curtos nos cards;
- preços grandes;
- textos auxiliares pequenos;
- muito espaço entre seções;
- botões evidentes;
- ícones simples;
- cantos discretamente arredondados;
- sombras leves ou nenhuma sombra.

### Mobile

- duas colunas de produtos;
- cestas com foto ainda maior;
- botões com pelo menos 44 px;
- navegação inferior;
- checkout em tela inteira;
- sem conteúdo escondido por barras fixas;
- nenhuma rolagem horizontal acidental.

### Desktop

- quatro produtos por linha;
- cestas em cards largos ou três colunas;
- conteúdo centralizado;
- carrinho lateral;
- sem áreas vazias exageradas;
- sem carrosséis obrigatórios.

---

## 8. Páginas e rotas internas

```text
#/                         início
#/ofertas                  ofertas
#/categorias               categorias
#/categoria/{slug}         categoria
#/subcategoria/{slug}      subcategoria
#/marca/{slug}             marca
#/busca/{termo}            busca
#/produto/{referencia}     produto
#/favoritos                favoritos
#/cestas                   cestas
#/cesta/{referencia}       cesta dentro do aplicativo
#/kits                     kits
#/kit/{referencia}         kit
#/checkout                 checkout
#/informacoes              informações
```

Ao mudar de rota:

- somente o conteúdo principal muda;
- carrinho e favoritos permanecem;
- a página volta ao topo;
- menus fecham;
- o botão voltar funciona;
- o título do navegador é atualizado.

---

## 9. Página inicial

A home terá poucas seções e será focada em venda.

Ordem inicial:

1. apresentação curta;
2. cestas básicas em destaque;
3. condições de entrega e pagamento;
4. ofertas de hoje;
5. categorias;
6. produtos essenciais;
7. kits promocionais;
8. rodapé.

As cestas aparecerão antes dos produtos avulsos e terão mais destaque visual.

Se uma seção não tiver dados válidos, ela não aparece.

---

## 10. Card de cesta básica

O card principal de cesta terá:

- foto grande;
- nome;
- quantidade total de produtos ou unidades;
- preço;
- texto muito curto;
- botão `Ver cesta`;
- botão `Adicionar cesta` quando aplicável.

Não haverá lista completa dos produtos dentro do card. A composição aparecerá somente ao abrir a cesta.

---

## 11. Card de produto

Cada produto terá:

- foto quadrada grande;
- embalagem;
- nome em até duas linhas;
- validade, quando houver;
- preço normal riscado, quando necessário;
- preço atual em destaque;
- desconto;
- favorito;
- botão adicionar;
- seletor de quantidade depois da adição.

Textos longos e códigos não aparecerão no card.

---

## 12. Busca inteligente

A busca aceitará:

- nome;
- marca;
- categoria;
- subcategoria;
- código;
- EAN;
- termos sem acento;
- várias palavras.

Prioridade dos resultados:

1. código ou EAN exato;
2. nome iniciado pelo termo;
3. todas as palavras encontradas;
4. marca ou categoria.

O campo não será recriado durante a digitação, evitando o problema de apagar espaços.

---

## 13. Página do produto dentro da loja

A página interna terá:

- foto grande;
- nome;
- embalagem;
- preço;
- oferta;
- validade;
- estoque;
- descrição curta;
- quantidade;
- adicionar;
- produtos relacionados.

Ela receberá `noindex,follow` quando houver uma URL pública intermediária. Não entrará em sitemap nem Merchant Center.

---

## 14. Carrinho

O carrinho ficará no navegador e terá:

- adicionar;
- aumentar;
- diminuir;
- remover;
- limpar;
- limite pelo estoque;
- ordem de adição;
- total instantâneo;
- descontos separados;
- pedido mínimo;
- identificação de itens vindos de cesta ou kit.

Antes do pedido, todos os itens serão comparados novamente com o catálogo carregado do Firebase.

---

## 15. Cestas básicas

A cesta será um registro próprio no Firebase com:

```text
id
codigo
nome
slug
descricao_curta
imagem
preco
preco_original
ativo
produtos[]
seo
merchant
```

Cada item de `produtos[]` terá código, quantidade e substitutos opcionais.

### Funcionamento

1. abrir a cesta;
2. localizar cada produto pelo índice em memória;
3. mostrar foto, nome e quantidade;
4. verificar estoque;
5. usar substituto configurado quando necessário;
6. permitir ajuste quando a cesta for personalizável;
7. recalcular o valor conforme a regra definida;
8. adicionar todos os itens ao carrinho;
9. registrar a origem `cesta`;
10. descrever alterações no pedido.

Uma cesta indisponível não será enviada ao Google nem ao Merchant.

---

## 16. Kits

Os kits continuarão funcionando na loja, mas serão exclusivamente comerciais dentro do site.

Eles terão:

- período;
- composição;
- preço promocional;
- estoque calculado;
- limite;
- status.

Regras externas:

- não indexar;
- não criar páginas SEO;
- não incluir no sitemap;
- não incluir no Merchant;
- não criar dados estruturados públicos de produto.

---

## 17. Ofertas e descontos

Ordem do cálculo:

1. preço normal;
2. oferta ativa;
3. cupom;
4. desconto por validade e quantidade;
5. atacado;
6. ajuste da cesta;
7. ajuste do kit;
8. arredondamento;
9. total final.

Toda diferença entre a soma dos itens e o total será enviada ao Make de forma compatível com o Bling.

---

## 18. Checkout

O checkout será curto e sem conta.

### Etapas

1. revisar compra;
2. revisar valores;
3. informar cupom;
4. informar CPF;
5. escolher data;
6. preencher entrega;
7. escolher pagamento;
8. abrir WhatsApp.

### Campos

- nome;
- CPF;
- WhatsApp;
- e-mail;
- CEP;
- cidade;
- bairro;
- rua;
- quadra;
- número;
- referência;
- entrega;
- pagamento;
- observação.

Cidades iniciais: Cuiabá e Várzea Grande.

---

## 19. WhatsApp e integrações

Fluxo final:

1. validar formulário;
2. construir pedido;
3. construir mensagem;
4. salvar cópia local temporária;
5. abrir WhatsApp imediatamente pelo clique;
6. gravar pedido no Firebase;
7. enviar ao Make;
8. Make processar contato e venda no Bling;
9. registrar resultado no pedido.

Firebase ou Make não podem impedir a abertura do WhatsApp.

O pedido usará chave de idempotência para evitar duplicidade.

---

## 20. SEO exclusivo das cestas básicas

### O que o Google poderá indexar

- página inicial com foco em cestas básicas;
- página `/cestas/`;
- página individual de cada cesta;
- política de privacidade;
- termos;
- páginas institucionais relevantes.

### O que ficará fora do Google

- produtos avulsos;
- kits;
- ofertas;
- busca;
- categorias de produtos;
- marcas;
- favoritos;
- carrinho;
- checkout;
- páginas administrativas.

### Regras técnicas

- sitemap conterá somente páginas permitidas;
- produtos e kits usarão `noindex`;
- links internos poderão usar `nofollow` onde fizer sentido operacional;
- canonical somente para páginas de cestas;
- nenhum produto avulso terá `Product` schema público;
- cada cesta terá título e descrição próprios;
- cada cesta terá URL limpa;
- cada cesta terá imagem grande e exclusiva;
- cada cesta terá breadcrumbs;
- cada cesta terá dados estruturados `Product`, `Offer`, `BreadcrumbList` e organização;
- disponibilidade e preço virão do Firebase na geração;
- conteúdo desatualizado não será publicado.

### Estrutura da página pública de cesta

- título principal com nome da cesta;
- foto grande;
- preço;
- disponibilidade;
- entrega em Cuiabá e Várzea Grande;
- lista da composição;
- quantidade de itens;
- perguntas frequentes curtas;
- botão para abrir a cesta na aplicação;
- botão de WhatsApp;
- dados estruturados completos;
- canonical;
- Open Graph;
- texto original, sem repetição artificial de palavras-chave.

---

## 21. Merchant Center exclusivo das cestas

O feed conterá somente cestas básicas ativas e disponíveis.

Campos principais:

```text
id
title
description
link
canonical_link
image_link
additional_image_link
availability
condition
price
brand
mpn
identifier_exists
product_type
shipping
shipping_label
custom_label_0...4
```

### Regras

- nenhum produto avulso no feed;
- nenhum kit no feed;
- link apontando para página pública da cesta;
- preço idêntico ao da página;
- imagem idêntica à principal;
- disponibilidade real;
- descrição da cesta, não descrição genérica;
- título sem promoções exageradas;
- composição e quantidade coerentes;
- atualização sempre que preço, imagem, disponibilidade ou composição mudar;
- cesta inativa ou indisponível removida do feed.

---

## 22. Sitemap e robots

O sitemap novo terá somente:

- home;
- `/cestas/`;
- páginas individuais de cestas;
- páginas institucionais permitidas.

O `robots.txt` bloqueará áreas administrativas e indicará o sitemap de cestas.

Produtos e kits não dependerão apenas de `robots.txt`; receberão `noindex`, porque bloquear rastreamento não é suficiente para garantir remoção do índice.

---

## 23. Testes obrigatórios

1. Firebase é a única fonte;
2. nenhuma chamada para catálogo alternativo;
3. primeira tela estável;
4. fotos grandes sem salto de layout;
5. mobile em duas colunas;
6. busca aceita espaço e acento;
7. produto abre por ID, código, EAN e slug;
8. carrinho respeita estoque;
9. carrinho persiste;
10. oferta vencida não entra;
11. cesta resolve todos os componentes;
12. cesta indisponível não pode ser comprada;
13. total confere;
14. pedido mínimo funciona;
15. checkout valida campos;
16. WhatsApp abre mesmo se integração falhar;
17. Firebase recebe pedido completo;
18. Make recebe contrato correto;
19. Bling recebe uma única venda;
20. somente cestas aparecem no sitemap;
21. somente cestas aparecem no Merchant;
22. produtos e kits retornam `noindex`;
23. preço do Merchant é igual ao da página;
24. disponibilidade do Merchant é real;
25. páginas das cestas possuem dados estruturados válidos;
26. barra móvel não cobre conteúdo;
27. produção não foi alterada;
28. rollback continua possível.

---

## 24. Programação por fases

### Fase 0 — preparação

- pasta separada;
- roteiro;
- branch separada;
- produção intacta.

### Fase 1 — loja básica funcional

- HTML único;
- visual leve;
- Firebase `/produtos`;
- índices;
- home;
- busca;
- categorias;
- produto;
- favoritos;
- carrinho;
- checkout básico;
- WhatsApp.

### Fase 2 — cestas como prioridade

- Firebase `/cestas`;
- cards grandes;
- página da cesta;
- composição;
- estoque;
- personalização;
- carrinho da cesta;
- mensagem detalhada.

### Fase 3 — recursos comerciais internos

- ofertas;
- cupons;
- kits;
- recomendações;
- banners mínimos.

### Fase 4 — integrações definitivas

- pedido no Firebase;
- consulta de CPF;
- Make;
- Bling;
- idempotência;
- novas tentativas;
- logs.

### Fase 5 — SEO e Merchant das cestas

- páginas públicas geradas;
- dados estruturados;
- sitemap exclusivo;
- Merchant exclusivo;
- robots;
- canonical;
- validação no Search Console;
- validação no Merchant Center.

### Fase 6 — testes e publicação

- teste mobile e desktop;
- teste de pedido real;
- teste de falhas;
- auditoria de velocidade;
- auditoria de SEO;
- URL de homologação;
- troca da raiz somente após aprovação.

---

## 25. Critério final

O novo projeto estará pronto quando carregar rápido, mostrar fotos grandes, exigir pouca leitura, permitir comprar sem dificuldade e manter as integrações corretas.

Externamente, o Google e o Merchant Center deverão enxergar a Dona Antônia como especialista em cestas básicas. Produtos avulsos e kits existirão somente para melhorar a compra dentro da loja.