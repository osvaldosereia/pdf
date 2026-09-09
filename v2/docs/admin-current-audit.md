# Auditoria estrutural inicial do admin atual

Arquivo analisado: `producao/index.html` da branch `main`.

## Diagnóstico geral

O admin atual funciona como uma aplicação monolítica dentro de um único HTML. O mesmo arquivo concentra:

- estilos globais e responsivos;
- navegação principal e menu lateral duplicado;
- formulários de produtos, NF-e, leitura rápida, cestas, kits, anotações, cadastros, integrações e arquivos;
- estado global da aplicação;
- acesso a Firebase, GitHub e Make;
- montagem de payloads de IA, banners, produtos e kits;
- renderização de cards, listas, modais e tabelas;
- regras de preço, estoque, validade e qualidade cadastral;
- importação e exportação de JSON;
- ações em massa e salvamento geral.

Isso cria alto acoplamento: alterar uma função ou tela pode afetar áreas sem relação direta.

## Problemas estruturais identificados

### 1. Navegação duplicada

As mesmas abas aparecem na barra principal e novamente no menu lateral. Isso duplica marcação, estado visual e pontos de manutenção.

### 2. Ações sensíveis misturadas

No mesmo espaço convivem:

- recarregar produtos;
- salvar produtos;
- salvar tudo;
- reajustar preços em massa;
- gerar imagens com IA;
- otimizar imagens;
- exportar e importar JSON;
- abrir configurações.

Não existe uma separação forte entre leitura, edição, publicação e integração externa.

### 3. Estado global

Produtos, kits, cestas, configurações, filtros e integrações compartilham o mesmo estado e as mesmas funções utilitárias. Isso aumenta o risco de uma atualização de tela alterar dados de outro módulo.

### 4. Integrações dentro da interface

Chamadas ao Make, montagem de payloads, caminhos do GitHub e regras de banners estão diretamente no código da interface. A UI conhece detalhes que deveriam pertencer a serviços separados.

### 5. Regras duplicadas ou espalhadas

Normalização de produtos, busca por código, cálculo de preços, leitura de imagens, validação de identidade da IA e atualização de cards aparecem em pontos diferentes do arquivo.

### 6. Layout sem hierarquia funcional

O sistema cresceu por inclusão de novos recursos. Abas, botões, filtros e modais foram adicionados sem uma arquitetura única de navegação, permissões e fluxo operacional.

### 7. Salvamento amplo

A existência de ações como `Salvar geral` indica operações de grande alcance. Na V2, cada domínio deverá salvar apenas seus próprios dados e apresentar uma prévia antes de publicar.

## Áreas atuais identificadas

- Produtos
- Entrada de NF-e
- Leitura rápida
- Cestas básicas
- Kits promocionais
- Anotações
- Cadastros auxiliares
- Integrações
- Arquivos JSON
- Estoque baixo
- Reajuste em massa
- IA de textos
- IA de imagens
- Otimização de imagens
- Banners
- Configurações

## Arquitetura obrigatória para o Admin V2

```text
admin/
  index.html
  app.js
  styles.css
  modules/
    dashboard/
    products/
    inventory/
    expiry/
    registrations/
    baskets/
    kits/
    banners/
    quick-purchase/
    orders/
    integrations/
    publishing/
    diagnostics/
  services/
    firebase-admin-service.js
    github-publishing-service.js
    make-integration-service.js
    audit-service.js
  components/
    navigation.js
    data-table.js
    filters.js
    modal.js
    confirmation.js
    status-banner.js
```

## Regras para a reconstrução

1. Nenhum módulo pode acessar diretamente elementos de outro módulo.
2. Nenhuma tela pode publicar automaticamente ao editar.
3. Toda gravação deve validar, mostrar diferenças e pedir confirmação.
4. Firebase será a fonte operacional dos produtos.
5. GitHub receberá apenas snapshots e arquivos derivados.
6. Make será chamado apenas por serviços de integração.
7. Botões terão uma ação única e nomes claros.
8. Operações em massa terão prévia, quantidade afetada e possibilidade de cancelamento.
9. O admin continuará somente leitura até a camada de escrita estar testada.
10. O arquivo atual não será usado como base por cópia integral; apenas regras válidas serão migradas conscientemente.
