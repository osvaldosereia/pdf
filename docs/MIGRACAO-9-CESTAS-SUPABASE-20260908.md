# Migração controlada das 9 cestas para o Supabase — 08/09/2026

## Objetivo

Migrar as 9 cestas básicas oficiais e os produtos usados em suas composições para o novo núcleo operacional em Supabase, sem depender do Make e sem escrever nada no Bling.

Fonte autoritativa da composição e do preço comercial:

- `site/produtos-cesta-basica.json`
- páginas SEO oficiais das cestas / catálogo legado apenas para identidade visual dos produtos.

## Regras preservadas

- o preço comercial da cesta é independente da soma dos preços individuais;
- nenhum estoque foi inventado ou copiado para produtos ainda não contados fisicamente;
- produto já fisicamente verificado no Supabase não foi sobrescrito;
- produtos trazidos apenas para permitir a montagem das cestas entram com `physically_verified=false`, `is_active=false`, `is_whatsapp_active=false`, `source_system=legacy_basket_migration` e `sync_status=imported_unverified`;
- as 9 cestas foram deixadas `is_active=false` e `is_whatsapp_active=false` enquanto houver componentes ainda não verificados;
- não houve POST/PUT/PATCH/DELETE no Bling;
- não foi usado Make para a gravação dessa migração.

## Resultado no banco

Após a carga e auditoria:

```text
basket_templates = 9
basket_template_items = 222 linhas
produtos únicos usados pelas cestas = 30
produtos já fisicamente verificados = 3
produtos aguardando verificação física = 27
```

Cestas:

| Ordem | Cesta | Preço | Produtos | Unidades |
|---:|---|---:|---:|---:|
| 1 | Economica Bonini | R$ 92,00 | 14 | 14 |
| 2 | Mini Bonini | R$ 175,00 | 23 | 27 |
| 3 | Mini Koblenz | R$ 180,00 | 23 | 27 |
| 4 | Pequena Bonini | R$ 230,00 | 27 | 34 |
| 5 | Pequena Koblenz | R$ 240,00 | 27 | 34 |
| 6 | Média Koblenz | R$ 350,00 | 27 | 44 |
| 7 | Média Bonini | R$ 340,00 | 27 | 44 |
| 8 | Grande Koblenz | R$ 420,00 | 27 | 52 |
| 9 | Grande Bonini | R$ 410,00 | 27 | 52 |

A `Cesta Econômica` provisória que já existia no Admin foi reaproveitada como `Economica Bonini`, evitando duplicata.

## Comportamento da contagem física

Foi conferida a função `save_verified_inventory_count`.

Quando um produto migrado for contado posteriormente, o fluxo procura primeiro por `firebase_key` e depois por `gtin`. Encontrando o registro migrado, atualiza o mesmo `products.id`, grava estoque/validade/localização reais, muda `source_system` para `firebase_verified` e marca `physically_verified=true`. Portanto, a migração foi desenhada para não criar duplicatas durante a adoção física normal.

## Atenção operacional

O item `P447 — Remmus Desinfetante Amazon Verde Unidade` aparece no legado sem GTIN confiável nas fontes consultadas. Não inventar EAN. Na contagem física, confirmar o código de barras real da embalagem; se o produto realmente não possuir GTIN, adaptar o fluxo de contagem para uma identidade interna controlada antes de considerá-lo verificado.

## Próximo passo seguro

Continuar contando fisicamente os 27 produtos pendentes. Conforme cada item for conferido, o cadastro migrado será enriquecido com estoque, validade, gôndola/prateleira, preço/custo disponíveis na fonte da contagem e status de verificação. Somente depois de todos os componentes necessários de uma cesta estarem confiáveis deve-se liberar `is_active` / `is_whatsapp_active` dessa cesta.
