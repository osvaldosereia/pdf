# SEO, Merchant, PageSpeed e buscas com IA

## Escopo

A camada externa de descoberta será dedicada às cestas básicas.

Devem ser indexáveis:

- página inicial;
- página de todas as cestas;
- página individual de cada cesta;
- sobre a empresa;
- contato;
- política de entrega;
- política de troca e devolução;
- política de privacidade;
- termos de uso.

Devem ficar fora da indexação e do Merchant Center:

- produtos avulsos;
- kits promocionais;
- ofertas;
- categorias;
- marcas;
- busca;
- favoritos;
- carrinho;
- checkout;
- páginas administrativas.

Os kits continuam visíveis e compráveis no site, porém não serão enviados ao Google nem ao Merchant Center.

---

## Página inicial definida

A home será muito leve e seguirá esta ordem:

1. cabeçalho com logo, busca, favoritos, carrinho e menu;
2. área inicial curta, sem texto longo;
3. quatro cestas básicas em cards verticais;
4. botão largo `VER TODAS AS CESTAS`;
5. banner grande de ofertas, com chamada de descontos de até 50% e botão `VER OFERTAS`;
6. quatro kits promocionais em cards verticais;
7. botão largo `VER TODOS OS KITS`;
8. avisos discretos de entrega e pagamento;
9. lista de botões de categorias no final da página;
10. rodapé institucional completo e discreto.

### Grade

- desktop: no máximo quatro colunas;
- mobile: duas colunas;
- cards sempre verticais;
- fotos grandes;
- nomes em até duas linhas;
- preço em destaque;
- pouco texto auxiliar.

---

## Core Web Vitals e PageSpeed

Metas oficiais usadas no projeto:

- LCP: até 2,5 segundos;
- INP: abaixo de 200 milissegundos;
- CLS: abaixo de 0,1.

### Decisões para LCP

- HTML, CSS e JavaScript no mesmo arquivo principal;
- nenhuma fonte externa obrigatória;
- nenhum framework;
- cabeçalho e estrutura visual disponíveis antes do Firebase;
- primeira imagem importante descoberta cedo;
- `fetchpriority="high"` somente para a imagem realmente candidata a LCP;
- demais imagens com carregamento preguiçoso;
- recursos críticos hospedados no mesmo domínio sempre que possível;
- banner sem vídeo ou biblioteca pesada;
- conteúdo inicial pequeno.

### Decisões para INP

- eventos delegados;
- busca com atraso curto;
- normalização dos dados somente uma vez;
- índices `Map` em memória;
- no máximo quatro cestas e quatro kits renderizados na home;
- listas maiores somente nas páginas internas;
- nenhum recálculo completo do catálogo a cada clique;
- nenhum listener em tempo real na primeira versão;
- funções curtas e operações longas divididas quando necessário.

### Decisões para CLS

- todas as imagens com largura, altura ou `aspect-ratio` definidos;
- cards com estrutura previsível;
- espaço reservado para preços, validade e botões;
- cabeçalho com altura estável;
- banner com proporção definida antes de carregar;
- barra inferior respeitando a área segura;
- nenhum bloco inserido acima do conteúdo depois do carregamento;
- imagens quebradas substituídas sem mudar o tamanho do card.

### Testes

Cada publicação de homologação deverá ser testada:

- PageSpeed Insights mobile;
- PageSpeed Insights desktop;
- Lighthouse local;
- relatório de Core Web Vitals no Search Console depois de haver dados de campo;
- rede lenta e aparelho intermediário;
- carregamento com imagem quebrada;
- carregamento com Firebase lento ou indisponível.

A pontuação de laboratório será acompanhada, mas a prioridade será a experiência real medida pelas Core Web Vitals.

---

## SEO para cestas básicas

Cada cesta deverá ter uma página pública própria, renderizada no HTML inicial e não apenas por JavaScript.

### Elementos obrigatórios

- URL limpa e permanente;
- `<title>` exclusivo;
- metadescrição exclusiva;
- canonical apontando para a própria página;
- H1 único;
- imagem principal grande;
- preço visível;
- disponibilidade visível;
- composição visível em texto;
- quantidade de produtos e unidades;
- área de entrega;
- forma de compra;
- informações de frete e pagamento;
- links para políticas e empresa;
- breadcrumbs;
- Open Graph;
- dados estruturados no HTML inicial.

### Dados estruturados

Cada página individual usará, quando os dados forem verdadeiros e visíveis:

- `Product`;
- `Offer`;
- `BreadcrumbList`;
- `Organization` ou `OnlineStore`;
- política de frete da loja;
- política de devolução da loja.

O objeto `Offer` deverá refletir exatamente:

- preço exibido;
- moeda BRL;
- disponibilidade;
- condição nova;
- URL da cesta.

Não serão inventadas avaliações, notas, depoimentos, GTIN ou qualquer atributo que a cesta não possua.

### Conteúdo

O texto será útil e original, sem repetição artificial de palavras-chave. As páginas explicarão objetivamente:

- para quem a cesta é indicada;
- composição completa;
- quantidade;
- diferença entre tamanhos;
- entrega em Cuiabá e Várzea Grande;
- como pedir;
- política de substituição quando aplicável.

---

## Merchant Center exclusivo das cestas

O feed conterá apenas cestas ativas, disponíveis e com página pública válida.

### Coerência obrigatória

O feed, a página e o Firebase deverão ter os mesmos valores para:

- ID;
- título;
- descrição;
- preço;
- disponibilidade;
- imagem;
- composição principal;
- URL.

### Campos previstos

- `id`;
- `title`;
- `description`;
- `link`;
- `canonical_link`;
- `image_link`;
- `additional_image_link`, quando existir;
- `availability`;
- `condition`;
- `price`;
- `brand`;
- `mpn` ou identificador próprio;
- `identifier_exists`;
- `product_type`;
- `shipping`;
- `shipping_label`;
- `minimum_order_value`, quando aplicável;
- `handling_cutoff_time`, quando aplicável;
- `custom_label_0` a `custom_label_4`.

As imagens principais serão preparadas com resolução mínima de 500 × 500 pixels para atender antecipadamente à exigência anunciada para 31 de janeiro de 2027.

Se título ou descrição do feed forem gerados por IA, será analisado o uso dos atributos estruturados e da identificação exigida pelo Merchant Center. Imagens geradas por IA deverão manter os metadados exigidos pelo Google.

---

## Descoberta nas buscas com IA

Não será criado arquivo `llms.txt`, marcação especial de “IA”, páginas artificiais para cada pergunta ou textos repetidos.

A estratégia seguirá os fundamentos de SEO:

- permitir rastreamento das páginas de cestas;
- manter conteúdo importante em texto HTML;
- usar links internos claros;
- apresentar dados locais e comerciais consistentes;
- manter Merchant Center e Perfil da Empresa atualizados;
- usar fotos reais e de alta qualidade;
- garantir que os dados estruturados correspondam ao conteúdo visível;
- criar conteúdo original e útil;
- manter informações institucionais e políticas confiáveis;
- evitar produção em massa de páginas sem valor.

Para consultas feitas em linguagem natural, as páginas das cestas terão respostas diretas e curtas para perguntas reais, como tamanho, composição, quantidade, entrega, pagamento e substituição. Isso ajuda pessoas e mecanismos de busca sem transformar a página em texto excessivo.

---

## Páginas institucionais

As páginas relacionadas ao Merchant e à confiança da empresa serão mantidas, revisadas e ligadas no rodapé:

- Sobre nós;
- Contato;
- Política de entrega;
- Política de troca e devolução;
- Política de privacidade;
- Termos de uso.

Visual dessas páginas:

- mesmo cabeçalho da loja;
- fundo claro;
- largura de leitura confortável;
- títulos objetivos;
- cards discretos;
- nenhum excesso de elementos;
- dados comerciais visíveis;
- navegação para cestas e WhatsApp;
- rodapé completo.

---

## Fontes oficiais consultadas

- Google Search Central — Core Web Vitals;
- Google Search Central — Page Experience;
- Google Search Central — Merchant Listing structured data;
- Google Merchant Center — Product data specification;
- Google Merchant Center — Structured data;
- Google Search Central — AI features and your website;
- Google Search Central — Guide to optimizing for generative AI features;
- web.dev — Optimize LCP, INP and CLS.
