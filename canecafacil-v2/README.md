# CanecaFácil V2 — loja própria

Nova base isolada do Admin Canecas antigo e da Loja Integrada.

## Objetivo desta fase

- storefront próprio, ultraleve, sem framework;
- uma caneca ativa por visor/tela, com o fundo do site assumindo a cor do produto;
- mockup principal em PNG transparente, podendo conter duas canecas, sombra e elementos gráficos externos;
- contraste automático de textos que ficam diretamente sobre a cor do produto;
- favoritos em `localStorage`;
- compartilhamento por Web Share API com fallback para copiar link;
- busca e modo explorar;
- personalização integrada em overlay sem quebrar a linguagem visual;
- “Minhas canecas” local no dispositivo, reaproveitando os CF-IDs do personalizador atual;
- admin novo, simples e modular;
- páginas SEO estáticas geradas automaticamente;
- sem pagamento nesta fase.

## Estrutura de dados

Nó Firebase novo e independente:

`canecafacil_v2`

### `canecafacil_v2/config`

```json
{
  "preco_padrao": 24.9,
  "marca": "CanecaFácil"
}
```

### `canecafacil_v2/produtos/{id}`

```json
{
  "nome": "Descanso entre séries",
  "slug": "descanso-entre-series",
  "ativo": true,
  "categoria": "Academia",
  "subcategoria": "Humor",
  "preco": 0,
  "mockup_png": "https://.../mockup.png",
  "arte_horizontal": "https://.../arte-horizontal.png",
  "fundo": "#FF6B1A",
  "personalizavel": true,
  "personalizador_modelo_key": "chave-do-produto-antigo",
  "descricao_curta": "...",
  "ordem": 10,
  "criado_em": "ISO",
  "atualizado_em": "ISO"
}
```

`preco = 0` significa usar o preço global.

## Mockup

O contrato visual está em `MOCKUP-CONTRACT-V1.md`.

Resumo da automação planejada:

1. gerar a arte horizontal de impressão;
2. gerar uma única composição mestre em PNG transparente;
3. escolher a cor sólida do fundo;
4. o site pinta o viewport e calcula automaticamente texto preto ou branco;
5. GitHub Actions pode gerar WebP/AVIF derivados do PNG sem nova chamada de IA.

## Admin

O Admin V2 começa somente com Canecas e Configurações. Os módulos futuros ficam desacoplados.

Uma caneca marcada como ativa precisa ter URLs válidas para `mockup_png` e `arte_horizontal`. Se for personalizável, precisa também de `personalizador_modelo_key`. Isso impede publicação de produto incompleto sem transformar o cadastro em um formulário grande.

## Personalização

O novo site reutiliza o personalizador existente em um overlay. O Admin possui `personalizador_modelo_key`, ligando a caneca V2 ao modelo já existente sem exigir migração imediata.

A URL embutida recebe:

`https://donaantonia.com.br/loja-integrada/personalizar/?model={key}&embed=1&store_v2=1`

O modo `store_v2=1` muda a ação final de **APROVAR E COMPRAR** para **SALVAR MINHA CANECA**. Ele não abre o carrinho da Loja Integrada e não inicia pagamento. A criação aprovada continua registrada pelo CF-ID e é enviada ao storefront via `postMessage`.

O storefront mantém até 50 criações recentes em `localStorage` para o módulo “Minhas canecas”. Isso é provisório até existir login/conta do cliente; os dados mestres da criação continuam no Firebase antigo `canecas/personalizadas` durante a transição.

Depois podemos migrar o editor e as criações para módulos nativos V2 sem mudar a experiência pública.

## Cor e contraste

O produto controla `fundo`. O front calcula a luminância e escolhe automaticamente entre texto quase preto e branco conforme o maior contraste. As barras flutuantes continuam brancas.

## SEO

A experiência principal pode ser dinâmica sem sacrificar indexação. `scripts/build-canecafacil-v2-seo.mjs` lê o catálogo V2 no Firebase e gera HTML estático para:

- `/p/{slug}/` por produto;
- `/categoria/{categoria}/`;
- `/categoria/{categoria}/{subcategoria}/`;
- `sitemap.xml`;
- `robots.txt`;
- `seo-manifest.json`.

As páginas de produto incluem canonical, Open Graph, `Product` JSON-LD e `BreadcrumbList`. O workflow `.github/workflows/build-canecafacil-v2-seo.yml` roda a cada 15 minutos ou manualmente e só grava no `main` quando o conteúdo gerado mudou.

Importante: esse workflow só passa a executar após a branch ser incorporada ao `main`; durante o desenvolvimento, a validação é feita pelo CI do PR.

## Pagamento

Deliberadamente não implementado nesta fase. O futuro módulo Mercado Pago deve ser backend-only para credenciais privadas e desacoplado do storefront.

## Segurança

Esta primeira versão do Admin usa a mesma API REST do Firebase já utilizada no projeto e deve ser tratada como protótipo operacional. Antes de publicar o Admin em URL pública, incluir Firebase Auth + regras de escrita restritas. Nenhum token de pagamento deve ser colocado no front-end.
