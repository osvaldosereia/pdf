# Conversation worker — entrega e homologação

Código preparado em 07/09/2026, com produção ainda não alterada nesta rodada.

## Componentes

- `scripts/lib/conversation-core-v1.mjs`: intenções permitidas, validação do retorno da IA, respostas e validação de mídia.
- `scripts/conversation-worker-v1.mjs`: REST Supabase + OpenAI, no máximo uma chamada por job, execução manual, sem retry cego.
- `.github/workflows/conversation-worker-v1.yml`: workflow manual em `dry-run` por padrão, até três jobs no `apply`.
- `20260907163802_conversation_worker_v1.sql`: fila, reserva de orçamento de chamadas, uso e conclusão atômica.
- `20260907164342_customer_birthday_preferences_v1.sql`: aniversário, consentimento e simulador de validade.
- Sala: polling de mensagens separado de catálogo/carrinho, pausa em aba oculta, backoff, estados de mídia e players preservados.
- Admin: filtro de validade/categoria/marca/gôndola/prateleira e ordenação; paginação de 40, imagens lazy e descarte de respostas antigas de busca.

## Funcionamento e limites reais

`conversation_worker_enabled=false` é uma trava nova e independente. Processamento exige também `automation_enabled=true`, `ai_enabled=true`, conversa em modo `ai` e Sala aberta. A flag existente `outbound_enabled` não libera este worker.

Transcrição usa `gpt-4o-mini-transcribe`; visão/classificação usa `gpt-4o-mini`, ambos substituíveis por variáveis de ambiente. Conferir disponibilidade na conta antes de homologação. Áudio consome uma chamada de transcrição e depois roteamento determinístico; pedidos de áudio complexos podem exigir esclarecimento. Visão/texto usam JSON Schema estrito e validação local. As respostas são geradas por regras, não livremente pelo modelo.

O worker aceita mídia privada da própria mensagem/Sala, até 10 MiB, e não aceita URLs de download fornecidas pelo cliente. Processa JPEG/PNG/WebP e áudio WebM/MP3/M4A. OGG/AAC/HEIC/HEIF continuam precisando de conversão antes do processamento; retornam erro controlado. Não há conversão nesta rodada.

Mensagens WhatsApp, TTS, edição de carrinho por linguagem natural, recomendação proativa integrada a `plan_next_sales_move` e execução contínua ainda são próximos passos. Uma transcrição não é confirmação de pedido. Nenhuma mensagem deste worker entra na fila outbound Meta. Atendimento humano/pausa e fechamento da sessão suprimem resposta na conclusão.

A reserva de chamadas é conservadora: tentativas com erro também contam, evitando cobranças repetidas. Jobs `held` não são liberados em massa ao ligar flags. Jobs `error` não são retentados automaticamente. Uma falha após chamar a IA, antes de salvar a conclusão, exige revisão; `processing` vencido não é reexecutado cegamente.

`ai_usage_events` registra modelo, request ID e tokens/duração quando retornados. `estimated_cost_usd` permanece nulo sem tabela de preços versionada; nulo significa **não calculado**, não custo zero. Falhas de transporte podem ter custo desconhecido. Logs do workflow mostram apenas contagens.

## Validação realizada

- 13 testes Node: gates, dry-run, chamada única, timeout, falha de conclusão, intenções restritas, recusa, limites e escopo de mídia, request OpenAI e destino fixo de credenciais.
- PostgreSQL isolado (PGlite) com snapshot **somente de estrutura**, sem dados reais: aplicação das duas migrations, permissões/RLS, claim/dedupe/lease, resposta única, recusa, limites 61/60/31/30/0/vencido/sem data, aniversário 29/02 e consentimento/revogação.
- DOM (JSDOM): player de áudio preservado, transcrição/status, botão da resposta assíncrona, aniversário sem opt-in implícito e fechamento com endereço salvo.
- Sintaxe JavaScript e TypeScript.
- `deno check` completo ficou limitado pelo acesso ao registro JSR neste ambiente; o CI incluído o executará no GitHub.

Não houve teste pago com OpenAI, envio Meta, pedido Bling nem alteração de dados reais. Teste de DOM não substitui homologação visual em celular real.

Reproduzir localmente:

```bash
npm ci --prefix tests/conversation --ignore-scripts
node --test scripts/conversation-worker-v1.test.mjs
TEST_RUNTIME="$PWD/tests/conversation" node scripts/test-conversation-local-db-v1.mjs
TEST_RUNTIME="$PWD/tests/conversation" node scripts/test-shopping-room-dom-v1.mjs
```

## Implantação pendente — ordem obrigatória

A revisão automática rejeitou a aplicação de DDL no Supabase conectado por ausência de autorização explícita para alterar schema de produção. Nenhuma das duas migrations foi aplicada. Não contornar por SQL direto, CLI, Make ou workflow. Solicitar autorização sobre este conjunto concreto.

Depois da autorização:

1. Conferir CI/branch, schema e flags atuais; ler novamente o código das funções implantadas para evitar sobrescrever alterações concorrentes.
2. Aplicar `20260907163802_conversation_worker_v1.sql` e depois `20260907164342_customer_birthday_preferences_v1.sql` via mecanismo aprovado. Preservar `conversation_worker_enabled=false`.
3. Conferir permissões, advisors e uma consulta read-only de `preview_expiry_offer`; validar ausência de exposição pública.
4. Publicar `shopping-room-v1` mantendo autenticação própria por token/CORS (`verify_jwt=false`, como versão 3) e `admin-ops-v1` mantendo `verify_jwt=true` + `getUser` + `admin_users`.
5. Só então incorporar/publicar o frontend da branch. O formulário de aniversário depende da nova RPC; não publicar somente a interface antes do backend.
6. Validar cadastro e filtros; revisar logs. A função `preview_expiry_offer` é **simulação**, não altera preço nem ativa descontos.
7. Configurar/verificar secrets privados e fazer dry-run do worker. Separadamente, aprovar janela de homologação com uma mensagem de teste e orçamento pequeno. Não ligar automação comercial em massa.

## Rollback

Enquanto não houver homologação paga, manter a nova flag desligada é suficiente para impedir processamento. Reverter frontend e Edge Functions se necessário; não apagar consentimentos/uso. Campos e tabelas novos podem permanecer sem uso até correção. Antes de qualquer rollback de schema, conferir dependências e dados existentes.
