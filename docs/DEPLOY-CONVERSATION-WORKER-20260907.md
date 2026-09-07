# Deploy controlado — Conversation Worker / Sala / Admin

Data: 2026-09-07

## Estado aplicado

- PR #143 incorporado ao `main` por squash no commit `ab3bf89358b57afa1d4c793e948bae5163a7fc93`.
- Migration `conversation_worker_v1` aplicada em produção.
- Migration `customer_birthday_preferences_v1` aplicada em produção.
- `shopping-room-v1` publicada como versão 4 com `verify_jwt=false`, preservando autenticação própria por token/CORS.
- `admin-ops-v1` publicada como versão 3 com `verify_jwt=true`, preservando `getUser` + `admin_users`.
- Flags verificadas após o deploy: `automation_enabled=true`, `outbound_enabled=true`, `ai_enabled=false`, `conversation_worker_enabled=false`.
- 99 produtos fisicamente verificados; fila `ai_jobs` permanecia vazia na última checagem anterior ao deploy.
- Nenhuma chamada paga à OpenAI foi executada nesta implantação.
- Nenhuma mensagem Meta nem pedido Bling real foi disparado nesta implantação.

## O que entrou

- polling leve de mensagens na Sala de Compra;
- estados de processamento de mídia e preservação do player de áudio;
- correção de MIME com codecs;
- cadastro opcional de aniversário dia/mês;
- consentimento de marketing separado e auditável;
- filtros do Admin por validade/categoria/marca/gôndola/prateleira e ordenação;
- Conversation Worker e trilha de uso/custo preparados, mas bloqueados pelo gate próprio.

## Segurança operacional

Não alterar `ai_enabled` nem `conversation_worker_enabled` até homologação controlada. Não liberar jobs `held` em massa. O simulador de validade continua apenas como preview e não altera preços do carrinho/checkout.

## Próximo ponto exato

1. Homologar frontend publicado da Sala/Admin contra as novas funções, sem IA.
2. Preparar integração segura de `plan_next_sales_move` + `sales_offer_events` na Sala, inicialmente apenas leitura/preview e sem disparo proativo em massa.
3. Depois preparar uma única mensagem controlada para homologar o Conversation Worker com orçamento pequeno e flags temporárias, voltando a desligá-las após o teste.
4. Concluir TTS e ponte inbound/outbound WhatsApp somente após essa homologação.

Este arquivo complementa `docs/RETOMADA-DONA-ANTONIA.md` até a próxima consolidação desse documento principal.
