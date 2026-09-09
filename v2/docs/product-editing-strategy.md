# Estratégia de edição de produtos - Admin V2

## Princípio

Nenhuma alteração deve ir diretamente para dados oficiais.

Fluxo:

Produto atual
↓
Alteração proposta
↓
Validação
↓
Revisão humana
↓
Aprovação
↓
Gravação controlada

## Campos críticos

Alterações em preço, custo, estoque, NCM, categoria e EAN exigem revisão.

## Histórico obrigatório

Cada alteração futura deve registrar:

- produto;
- usuário;
- data/hora;
- valor anterior;
- valor novo;
- origem da alteração.

## Proibido

- salvar todos os produtos em lote sem revisão;
- alterar múltiplos módulos ao mesmo tempo;
- publicar automaticamente sem validação.
