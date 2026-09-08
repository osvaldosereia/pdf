# Checkpoint final — WhatsApp cestas, vitrine externa e trocas

Data: 2026-09-08

## Estado

A frente básica de venda de cestas pelo WhatsApp está programada até o ponto de homologação real com cliente, mantendo o canary em 1% e sem ativar Bling ou WhatsApp Flow.

PR principal: #239 — `WhatsApp cestas: vitrine externa dinâmica e troca de produtos`
Merge: `00df7ec193e7b58e4cec09194b5e8f110c9f8adc`

## Regra central

A personalização da cesta acontece fora do WhatsApp.

O WhatsApp serve para:
- identificar intenção;
- apresentar as 9 cestas;
- gerar um link temporário por conversa/pedido;
- orientar o cliente a usar a vitrine;
- receber o retorno para continuar checkout/cadastro/handoff.

A troca/substituição de um componente da cesta nunca é efetivada dentro do chat.

## Vitrine externa

URL base: `/cesta/?t=<token>`.

A mesma página dinâmica suporta:
1. `basket_basic_v1` — composição da cesta;
2. `basket_extras_v1` — produtos adicionais;
3. `basket_replace_v1` — substituição de componente.

### Cesta
- foto grande;
- nome e preço comercial da cesta;
- componentes sem valor individual;
- quantidade editável;
- botão `Trocar` em cada componente;
- substituições já escolhidas ficam visíveis como status para o cliente;
- alterações ficam marcadas para conferência humana.

### Produtos adicionais
- cliente escolhe uma ou várias categorias reais habilitadas;
- sistema cria vitrine temporária apenas com essas categorias;
- mobile com 3 colunas;
- foto, nome abreviado, preço e seletor de quantidade;
- card amplia ao toque;
- total comercial = preço fixo da cesta + extras;
- retorno para o mesmo pedido/carrinho.

### Troca de componente
- se o WhatsApp entende `trocar X por Y`, identifica o item da cesta e busca candidatos para Y;
- se houver candidato, gera imediatamente a vitrine externa de substituição;
- se o destino estiver incerto, a própria vitrine mostra as categorias reais para o cliente marcar;
- cliente escolhe o substituto somente na vitrine;
- preço individual do substituto não é exibido;
- preço comercial base da cesta não é recalculado silenciosamente;
- substituição é gravada no item original e segue para conferência humana no fechamento;
- retorno ocorre para a mesma cesta/token/carrinho.

## Admin

Na tela de categorias dos produtos, o Admin controla apenas regras comerciais da vitrine:
- `Mostrar na vitrine`;
- `Nome para o cliente`;
- `Ordem`.

O layout não é configurável no Admin; permanece automático para reduzir manutenção e erro.

Todas as categorias atualmente usadas pelos produtos estão registradas no gerenciador. Em produção, 19 categorias estão habilitadas por padrão após a migration.

## Banco / segurança

Migration aplicada em produção: `whatsapp_basket_showcase_swap_admin_v1`.

Novas RPCs principais:
- `create_whatsapp_basket_replacement_session_v1`;
- `set_whatsapp_basket_replacement_categories_v1`;
- `choose_whatsapp_basket_replacement_v1`.

As RPCs de substituição estão negadas para `anon` e `authenticated` e liberadas apenas para `service_role`.

Triggers ativos:
- `trg_00_route_whatsapp_basket_swap_v1` — intercepta pedidos de troca antes do worker livre e envia para a vitrine externa;
- `trg_enrich_whatsapp_basket_order_substitutions_v1` — leva a substituição para o snapshot final da encomenda.

Casos de regressão ativos:
- `basket_swap_external_showcase_v1`;
- `basket_swap_unknown_target_categories_v1`.

## Edge Functions

Produção:
- `basket-shop-v1` — versão 4, `verify_jwt=false`, acesso protegido por token público de sessão com 64 hex, sessão aberta e validade;
- `admin-product-categories-v1` — versão 3, `verify_jwt=true`, usuário autenticado e autorização em `admin_users`.

## Homologação técnica

PR #239:
- `Dona Antonia WhatsApp Sales MVP` passou integralmente;
- `Test Dona Antonia conversation worker` passou integralmente;
- teste específico `test-whatsapp-basket-showcase-swap-v1.mjs` passou;
- Node syntax da vitrine/Admin passou;
- Deno check das Edge Functions passou.

Após merge:
- `Dona Antonia WhatsApp Sales MVP` run #41 passou no `main`;
- GitHub Pages `pages build and deployment` run #36763 passou;
- publicação da nova `/cesta/` concluída.

Um workflow legado `Testar Admin V2 definitivo` permaneceu vermelho por contratos antigos de Caneca Fácil/Caneca Print, pinpad/checklist e release-cache não relacionados a esta frente. As esteiras específicas e o código alterado passaram.

## Autoteste de produção

Foi executado um teste sintético sem cliente real:
1. criou conversa temporária usando conta WhatsApp válida do sistema;
2. abriu uma cesta ativa;
3. criou vitrine de substituição filtrada por categoria;
4. escolheu um candidato;
5. confirmou `basket_price_unchanged=true`;
6. confirmou retorno ao mesmo token da cesta;
7. confirmou gravação de `substitution` no item da cesta;
8. apagou toda a conversa/carrinho/sessões do teste.

Verificação posterior: zero conversas sintéticas restantes.

## Make

- `Dona Antônia - WhatsApp Inbound Controlado v1` (6779824): ativo, sem execuções incompletas;
- `Dona Antônia - WhatsApp Outbound Event-Driven v3` (7290488): ativo, sem execuções incompletas;
- módulo de texto usa `preview_url=true` para tornar o link da vitrine facilmente clicável.

## Gates preservados

- `whatsapp_release_mode=live`;
- `whatsapp_live_canary_percent=1`;
- inbound ON;
- auto reply ON;
- AI ON;
- Sales MVP ON;
- pedido interno ON;
- Bling submit OFF;
- Bling sync OFF;
- WhatsApp Flow/Data Exchange OFF.

## Próximo passo seguro

Não abrir novas frentes para esta funcionalidade.

Próximo passo é uma homologação real controlada no WhatsApp, dentro do canary atual de 1%, percorrendo:
`perguntar cestas -> escolher cesta -> abrir vitrine -> trocar componente -> adicionar extras por múltiplas categorias -> encomendar -> confirmar/cadastrar endereço -> handoff humano`.

Qualquer falha encontrada deve ser corrigida nesta mesma frente antes de aumentar canary ou ativar Bling.
