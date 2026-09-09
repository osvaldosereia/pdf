# Dona Antônia V2

Nova versão paralela do site e do admin. Esta pasta não substitui a produção atual.

## Objetivos

- Firebase Realtime Database como fonte oficial dos dados operacionais.
- Arquivos do GitHub tratados apenas como snapshots derivados e contingência.
- Site e admin usando a mesma camada de normalização, validação e identificação de produtos.
- Bloqueio de catálogo vazio e de quedas anormais de quantidade.
- Módulos separados, sem framework pesado.
- Homologação isolada antes da migração.

## Estrutura

- `site/`: nova vitrine e checkout.
- `admin/`: novo painel administrativo.
- `shared/`: configuração, catálogo, cache, validações e utilitários compartilhados.
- `docs/`: decisões técnicas, contratos de dados e plano de migração.

## Fonte de verdade

1. Firebase `/produtos` é a fonte oficial para preço, estoque, situação, validade e cadastro.
2. `produtos-home.json` é somente um snapshot compacto para acelerar a primeira abertura.
3. Compra rápida, cestas e kits devem guardar referências de produtos, nunca cópias permanentes de preço e estoque.
4. Nenhum snapshot vazio pode substituir um catálogo válido.

## Fases

1. Fundação compartilhada e ambiente de homologação.
2. Catálogo, busca, categorias, favoritos e carrinho.
3. Checkout, WhatsApp, Firebase e fila de contingência.
4. Cestas, kits, ofertas, banners e Compra rápida.
5. Admin modular, auditoria e publicação segura.
6. Testes de carga, rede lenta, falhas e migração controlada.

## Segurança operacional

A branch `rebuild-v2` deve permanecer separada de `main` até a aprovação. A migração final só deve ocorrer após testes completos e backup da produção.