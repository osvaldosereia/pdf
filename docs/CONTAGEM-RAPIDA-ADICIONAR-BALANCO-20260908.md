# Contagem rápida — ADICIONAR e BALANÇO

Data: 2026-09-08

## Objetivo

A aba **⚡ Leitura rápida** possui dois modos operacionais de estoque, escolhidos antes das leituras.

### ➕ ADICIONAR

Uso principal: entrada de mercadoria recebida.

Regra:

- cada leitura soma `+1` à quantidade da sessão para aquele EAN;
- ao salvar, o total lido é **somado ao estoque atual** do produto no Supabase;
- a soma é transacional e bloqueia a linha do produto durante a atualização, evitando perda de unidades em leituras simultâneas;
- somente produtos já existentes no catálogo operacional novo podem receber ADICIONAR;
- EAN fora do catálogo novo permanece em pendências e não altera estoque;
- erros nunca interrompem a continuidade do leitor.

Exemplo: estoque atual 12, produto lido 5 vezes -> estoque final 17.

### 📦 BALANÇO

Uso principal: inventário físico.

Regra:

- cada leitura soma `+1` à quantidade contada para aquele EAN;
- ao salvar, o total lido passa a ser o **novo estoque** daquele produto;
- se o produto não existir no Supabase, mas for identificado no catálogo legado/Firebase, ele é adotado/cadastrado no catálogo operacional e a quantidade lida vira seu estoque inicial;
- EAN não identificável permanece em pendências;
- produtos que não foram lidos não são zerados automaticamente nesta versão, evitando perda de estoque por omissão acidental.

Exemplo: estoque anterior 12, produto lido 8 vezes -> estoque final 8.

## Continuidade do scanner

Depois de escolhido o modo, erros de EAN, consultas ao legado, falhas de rede ou pendências não bloqueiam o leitor. A leitura segue continuamente e os casos problemáticos são acumulados para revisão.

## Auditoria

A operação registra por item:

- modo (`add` ou `balance`);
- quantidade lida;
- estoque anterior;
- estoque final;
- usuário;
- sessão de contagem;
- data/hora;
- item de contagem e comando de sincronização associado.

A função transacional é `public.save_fast_inventory_batch_v1`.

A Edge Function autenticada é `inventory-fast-stock-v1` (`verify_jwt=true`).

## Bling

Nenhuma escrita real no Bling foi ativada. O writer continua dormente/manual e dry-run por padrão. Os comandos gerados ficam pendentes conforme a arquitetura atual até autorização explícita para ativação futura.
