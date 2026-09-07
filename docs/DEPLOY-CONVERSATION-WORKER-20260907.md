# Deploy controlado — Conversation Worker / Sala / Admin

Data: 2026-09-07

## Estado aplicado em produção

- PR #143 incorporado ao `main` por squash no commit `ab3bf89358b57afa1d4c793e948bae5163a7fc93`.
- Migration `conversation_worker_v1` aplicada em produção.
- Migration `customer_birthday_preferences_v1` aplicada em produção.
- `shopping-room-v1` publicada como versão 4 com `verify_jwt=false`, preservando autenticação própria por token/CORS.
- `admin-ops-v1` publicada como versão 3 com `verify_jwt=true`, preservando `getUser` + `admin_users`.
- Flags verificadas após o deploy: `automation_enabled=true`, `outbound_enabled=true`, `ai_enabled=false`, `conversation_worker_enabled=false`.
- 99 produtos fisicamente verificados; fila `ai_jobs` permanecia vazia na última checagem anterior ao deploy.
- Nenhuma chamada paga à OpenAI foi executada nesta implantação.
- Nenhuma mensagem Meta nem pedido Bling real foi disparado nesta implantação.

## O que entrou em produção

- polling leve de mensagens na Sala de Compra;
- estados de processamento de mídia e preservação do player de áudio;
- correção de MIME com codecs;
- cadastro opcional de aniversário dia/mês;
- consentimento de marketing separado e auditável;
- filtros do Admin por validade/categoria/marca/gôndola/prateleira e ordenação;
- Conversation Worker e trilha de uso/custo preparados, mas bloqueados pelo gate próprio.

## Camada comercial preparada, ainda não publicada

- PR #144 incorporado ao `main` por squash no commit `a9d41e120d17014342f6e3349b6f63a33d38118a`.
- CI `Test Dona Antonia conversation worker` run #6 concluído com `success`.
- Entrou no código um endpoint `sales_move_preview`, limitado e somente leitura, que consulta `plan_next_sales_move` sem registrar uma oferta e sem consumir `proactive_offer_count`.
- Entrou no código um endpoint genérico de `sales_event` limitado a eventos passivos (`viewed`, `added`, `rejected`, `ignored`, `accepted_category`), source fixo `shopping_room` e contexto sanitizado.
- O navegador não pode registrar `offered` nem `declined_all` por esse endpoint genérico.
- Teste de invariantes garante que preview não altera carrinho/mensagens nem consome orçamento de ofertas.
- **A Edge Function com esta camada NÃO foi publicada em produção nesta rodada.** Produção continua em `shopping-room-v1` versão 4.

## Segurança operacional

Não alterar `ai_enabled` nem `conversation_worker_enabled` até homologação controlada. Não liberar jobs `held` em massa. O simulador de validade continua apenas como preview e não altera preços do carrinho/checkout.

Antes de publicar a próxima versão da Sala, revisar novamente o endpoint de eventos passivos, incluindo proteção adicional contra excesso/repetição de eventos e validação semântica do evento `added` contra o estado real do carrinho. A gravação `offered` deve permanecer exclusivamente server-side no fluxo que efetivamente exibir uma iniciativa proativa.

## Próximo ponto exato

1. Endurecer e testar `sales_event` (rate limit/dedupe e validação de `added` contra carrinho real), ainda sem deploy.
2. Integrar o preview do `plan_next_sales_move` à experiência da Sala de maneira controlada; somente depois criar o passo server-side que registra `offered` quando a sugestão realmente for mostrada.
3. Homologar frontend da Sala/Admin contra as funções atuais, mantendo IA desligada.
4. Preparar uma única mensagem controlada para homologar o Conversation Worker com orçamento pequeno e flags temporárias, voltando a desligá-las após o teste.
5. Concluir TTS e ponte inbound/outbound WhatsApp somente após essa homologação.

Este arquivo complementa `docs/RETOMADA-DONA-ANTONIA.md` até a próxima consolidação desse documento principal.
