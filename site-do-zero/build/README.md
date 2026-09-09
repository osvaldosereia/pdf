# Gerador SEO e Merchant das cestas

Este diretório contém ferramentas de construção do novo site. Elas não fazem parte do HTML entregue ao cliente e não alteram o Firebase.

## Objetivo

Ler os dados atuais do Firebase e gerar arquivos estáticos exclusivos para cestas básicas:

- página `/cestas/`;
- página individual de cada cesta;
- `merchant.xml` somente com cestas;
- `sitemap.xml` somente com home, cestas e páginas institucionais;
- `robots.txt`;
- `relatorio.json` com inconsistências encontradas.

Produtos avulsos e kits não são incluídos no Merchant nem recebem páginas indexáveis.

## Segurança

O arquivo `gerar-seo-cestas.mjs`:

- usa somente requisições `GET`;
- não possui `PUT`, `POST`, `PATCH` ou `DELETE` para o Firebase;
- não recebe credencial de escrita;
- não corrige registros automaticamente;
- não cria novos caminhos no banco;
- grava somente em `site-do-zero/generated/` no ambiente onde for executado.

## Requisitos

- Node.js 20 ou superior;
- acesso de leitura aos caminhos públicos usados pelo site;
- dados de produtos em `/produtos`;
- dados de cestas em `/cestas`.

## Execução padrão

```bash
node site-do-zero/build/gerar-seo-cestas.mjs
```

## Configurações opcionais

```bash
FIREBASE_URL="https://cedar-chemist-310801-default-rtdb.firebaseio.com" \
FIREBASE_PRODUCTS_PATH="produtos" \
FIREBASE_BASKETS_PATH="cestas" \
PUBLIC_BASE_URL="https://donaantonia.com.br" \
OUTPUT_DIR="site-do-zero/generated" \
node site-do-zero/build/gerar-seo-cestas.mjs
```

Essas variáveis alteram somente de onde o gerador lê e onde grava os arquivos locais. Elas não ativam escrita no Firebase.

## Validação das cestas

Uma cesta só é publicada quando possui:

- identificador;
- nome;
- preço maior que zero;
- imagem;
- composição;
- todos os produtos da composição encontrados;
- produtos ativos;
- estoque suficiente para a quantidade da composição;
- preço válido nos produtos;
- status ativo.

Quando uma cesta não passa na validação, ela é ignorada e registrada em `relatorio.json`.

O gerador nunca altera a cesta ou o produto para fazê-los passar.

## Merchant Center

O feed gerado contém apenas cestas aprovadas e inclui:

- identificador estável;
- título;
- descrição;
- URL canônica;
- imagem principal;
- disponibilidade;
- condição;
- preço em BRL;
- marca;
- MPN;
- tipo de produto;
- categoria Google;
- etiquetas de entrega e segmentação.

As configurações de entrega e política de devolução ainda devem ser conferidas no Merchant Center antes da publicação definitiva.

## Publicação

Durante o desenvolvimento, os arquivos gerados não devem substituir os arquivos públicos da raiz.

A publicação definitiva só ocorrerá depois de:

1. validar o relatório;
2. revisar todas as páginas de cesta;
3. testar dados estruturados;
4. testar o feed no Merchant Center;
5. testar PageSpeed;
6. confirmar que produtos e kits continuam fora da indexação;
7. aprovar a troca do site.