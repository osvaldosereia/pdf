# Sala de Compra + Motor Comercial v1

Data: 2026-09-07

## Objetivo

Fechar a etapa 1 do fluxo comercial da Sala de Compra com recomendação contextual, baixa pressão e rastreabilidade, sem depender de OpenAI e sem permitir que o navegador invente ofertas ou conversões.

## Estado de produção

- PR #145 incorporado ao `main` no commit `478f954cc1fd4bc3f1cb214efe1d0cab90677e9b` após CI integralmente verde.
- `shopping-room-sales-v1` publicada em produção como versão 1, `ACTIVE`, com `verify_jwt=false` por desenho público protegido por token/CORS/rate limit.
- `shopping-room-v1` permanece em produção na versão 4; não foi republicada nesta etapa.
- `admin-ops-v1` permanece em produção na versão 3.
- `ai_enabled=false` e `conversation_worker_enabled=false` foram reconfirmados depois do deploy.
- No momento da checagem pós-deploy havia zero registros em `sales_offer_events`; portanto nenhum cliente real recebeu oferta deste motor durante a implantação.
- `supabase/config.toml` passou a versionar explicitamente o estado `verify_jwt` das Edge Functions existentes para evitar mudanças acidentais em deploys futuros.

## Componentes

- `shopping-room-v1`: catálogo, carrinho, checkout, conversa e mídia.
- `shopping-room-sales-v1`: serviço comercial isolado, público apenas por token aleatório da Sala + CORS + rate limit.
- `plan_next_sales_move(...)`: decide se deve ajudar a escolher, sugerir um complemento ou seguir para checkout.
- `record_sales_offer_event(...)`: registra oferta e resposta do cliente.
- `comprar/sales-intelligence.js`: apresenta no máximo uma sugestão por vez e encaminha o cliente ao produto.

## Regras comerciais

1. Produto já no carrinho nunca entra como sugestão.
2. Cliente que rejeitou upsell ou mostrou pressa vai para checkout.
3. No máximo 2 iniciativas proativas por conversa.
4. Uma oferta pendente é reutilizada por até 30 minutos; refresh não consome nova iniciativa.
5. `offered` é criado somente no servidor, depois de `plan_next_sales_move` escolher o item.
6. O navegador só pode enviar `viewed`, `added`, `rejected` ou `ignored` para um produto realmente oferecido naquela conversa.
7. `added` só é aceito se o produto estiver de fato no carrinho draft com quantidade maior que zero.
8. Eventos terminais são idempotentes: uma mesma oferta não pode reduzir pressão ou converter mais de uma vez.
9. “Agora não” encerra a sugestão naquela página; não é substituído imediatamente por outra oferta.
10. A sugestão nunca altera o carrinho sozinha. “Ver produto” leva à busca; adicionar continua sendo uma ação explícita do cliente.

## UX

A sugestão aparece somente quando existe carrinho com item e antes do checkout. O card mostra produto, motivo, preço e duas ações: `Ver produto` e `Agora não`. No mobile ocupa uma faixa compacta acima da barra do carrinho; no desktop vira um card flutuante lateral.

O vínculo comercial é preservado mesmo depois de tocar em `Ver produto`, permitindo medir corretamente `oferecido → visto → adicionado`. Se o cliente sair sem responder, o sistema pode registrar `ignored`. Se escolher `Agora não`, a pressão de venda é reduzida e nenhuma nova sugestão é apresentada imediatamente naquela página.

## Segurança

- `verify_jwt=false` somente porque a função é pública por desenho, igual à Sala; o acesso é restrito por token de sessão de 64 hex, CORS e rate limit.
- Nenhuma service role ou segredo vai para o navegador.
- Não há OpenAI, Meta ou Bling nessa função.
- Todo evento é vinculado à `conversation_id` obtida do token da sessão, nunca recebida do cliente.
- IDs de produto são validados e conversões são conferidas no banco.
- Eventos terminais são verificados contra a última oferta e não podem ser reaplicados para reduzir pressão ou contabilizar conversões repetidas.

## Testes

CI cobre:
- invariantes do motor comercial anterior;
- comportamento DOM da Sala;
- serviço comercial isolado;
- renderização do card e handoff para busca;
- validações de idempotência e `product_not_in_cart`;
- preservação do vínculo `viewed → added`;
- sintaxe JS;
- `deno check` das três Edge Functions principais.

## Conclusão da etapa 1

A etapa **Sala de Compra + motor comercial determinístico** está concluída em código, CI e backend de produção. Ela não depende da IA global e não liga automações OpenAI/Meta/Bling.

O próximo bloco do projeto passa a ser a homologação controlada do Conversation Worker/OpenAI, começando por uma janela pequena de teste de texto, áudio e imagem, mantendo as flags desligadas fora da homologação.
