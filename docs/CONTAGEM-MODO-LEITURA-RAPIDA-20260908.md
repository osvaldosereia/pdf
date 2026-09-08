# Contagem física — Modo Leitura Rápida

Implementado em 08/09/2026.

## Objetivo

Adicionar uma segunda forma de trabalho à ferramenta `/contagem/`, otimizada para leitor físico de código de barras e grande volume de itens, sem remover ou alterar o modo detalhado já existente.

## Alternância

No topo da tela, após login, existe o botão:

- `⚡ Leitura rápida`
- quando ativo, o mesmo botão passa a `☰ Contagem detalhada`

A preferência fica salva no aparelho.

## Fluxo do modo rápido

1. Ao entrar no modo, `inventory-fast-v1` entrega ao navegador um catálogo compacto dos produtos do Supabase.
2. O catálogo fica indexado em memória e também em cache local para permitir leitura rápida e tolerância a perda de conexão.
3. O leitor físico mantém foco permanente no campo EAN.
4. Produto já existente no banco novo:
   - reconhecimento local, sem ida ao Bling/Firebase;
   - mostra somente o nome do produto e a quantidade acumulada;
   - cada nova leitura do mesmo produto soma `+1`;
   - feedback visual e vibração curta quando suportada.
5. Produto ausente do catálogo novo:
   - a leitura não bloqueia o operador;
   - entra imediatamente na lista de pendências;
   - em segundo plano o sistema tenta localizar o EAN no Supabase novamente e no Firebase legado;
   - se o legado identificar o produto, a pendência recebe nome e foto;
   - se não houver identificação, mantém o EAN e placeholder de imagem.
6. A lista de produtos lidos permite correção manual com `−` e `+`.
7. A lista de pendências permite remover uma leitura indevida.
8. `Salvar contagem` consolida uma única contagem por produto, usando o backend oficial `inventory-count-v2`.

## Decisão de performance e auditoria

O sistema **não grava uma linha de inventário a cada bip**. Fazer isso prejudicaria a velocidade e criaria múltiplos registros/comandos para o mesmo produto.

Durante a leitura:

- quantidades ficam acumuladas no aparelho (`localStorage`);
- cada bip de produto conhecido é praticamente uma operação local;
- uma queda de internet não perde a leitura já acumulada.

Na finalização:

- uma contagem consolidada é enviada por produto;
- cada produto gera a trilha normal de `inventory_count_items` e a fila operacional já existente;
- o modo rápido reutiliza `start/save/close` de `inventory-count-v2`, evitando uma segunda regra de estoque.

## Segurança / Bling

- `inventory-fast-v1` é **somente leitura**;
- JWT Supabase obrigatório;
- valida `admin_users.is_active`;
- não contém credencial Bling;
- não chama Bling;
- não usa Make;
- não cria produto automaticamente no Bling;
- a fila Bling existente continua sob as regras e workers já existentes, sem ativação nova.

## Arquivos

- `contagem/index.html`
- `contagem/fast-mode.js`
- `contagem/fast-mode.css`
- `supabase/functions/inventory-fast-v1/index.ts`
- `.github/workflows/test-contagem-v2.yml`

## Edge Function

`inventory-fast-v1`

Ações:

- `catalog`: retorna até 5.000 produtos do Supabase em páginas internas de 1.000 registros, com apenas campos necessários ao scanner e à posterior consolidação;
- `lookup`: consulta pontual por GTIN, `firebase_key` ou SKU quando uma leitura não estiver no cache carregado.

A função foi implantada com `verify_jwt=true`.

## Comportamento esperado do leitor

Compatível com leitores USB/Bluetooth que funcionam como teclado e normalmente enviam `Enter` ou `Tab` após o código. Há também autoenvio após pausa curta para leitores sem sufixo configurado.

O foco retorna automaticamente ao campo de leitura depois de ações na interface.

## Próxima validação física recomendada

Fazer um teste simples com leitor real:

1. ler 3 unidades do mesmo EAN conhecido;
2. confirmar que a tela mostra `× 3` sem abrir foto/modal;
3. ler um segundo EAN conhecido;
4. ler um EAN que não esteja no Supabase e confirmar a fila de pendências;
5. corrigir uma quantidade com `−/+`;
6. tocar `Salvar contagem`;
7. conferir no Admin/contagem que foi criado apenas um registro consolidado por produto.
