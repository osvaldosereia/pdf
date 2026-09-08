# Admin — categorias de produtos

Data: 2026-09-08

## Decisão funcional

Na tela `Produtos conferidos` do Admin oficial:

- a coluna `EAN / SKU` da listagem passa a ser usada como `Categoria`;
- cada produto recebe um dropdown pequeno para trocar a categoria sem abrir o card/modal;
- as categorias que chegam junto com os próprios produtos do banco novo são preservadas e entram automaticamente na lista disponível;
- no início da página existe um gerenciador simples para renomear categorias e incluir novas;
- renomear uma categoria atualiza em conjunto todos os produtos que usam aquele nome e registra histórico em `product_changes`;
- novas categorias podem existir mesmo sem produto associado e ficam disponíveis nos dropdowns;
- não há dependência do Firebase antigo para esse recurso.

## Backend

- tabela: `public.product_categories`;
- view administrativa: `public.admin_product_categories`;
- RPC: `rename_product_category`;
- RPC defensiva: `delete_product_category` (backend preparado, mas a UI atual não oferece exclusão);
- Edge Function autenticada: `admin-product-categories-v1`;
- migration de produção: `20260908220923_product_category_registry_v1`.

## Segurança

A tabela fica com RLS habilitado, sem acesso direto para `anon`/`authenticated`. As operações passam pela Edge Function autenticada e respeitam os papéis do `admin_users`.
