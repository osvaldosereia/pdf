# Homologação real WhatsApp — 07/09/2026

Documento de auditoria da Etapa 3 real, executada somente em telefone de teste allowlisted. Não contém chaves, tokens nem telefone completo.

## Estado de segurança

Durante toda a homologação:

- `whatsapp_release_mode=homologation`;
- allowlist com 1 telefone de teste;
- nenhum cliente fora da allowlist podia entrar no core de ingest;
- Bling ficou fora do fluxo;
- pedidos e `order_sync_jobs` permaneceram zerados;
- IA foi ligada apenas para o teste explícito e desligada novamente depois;
- nenhum retry cego foi permitido em envio incerto.

## 1. Primeira entrada real — proteção da allowlist

A primeira mensagem real chegou corretamente à Meta e ao Make, mas foi bloqueada antes de criar cliente/conversa porque o telefone configurado na allowlist tinha um dígito divergente.

Resultado esperado da segurança:

`homologation_phone_blocked`

Depois a allowlist foi corrigida usando o número real informado pela própria Meta. O telefone permanece mascarado neste documento.

## 2. `Oi` + menu determinístico

Mensagem real:

`Oi`

Fluxo validado:

```text
WhatsApp real
→ Meta Cloud API
→ Make inbound 6779824
→ whatsapp-ingest-make-v1
→ whatsapp-ingest
→ customer/conversation/session
→ welcome_menu determinístico
→ Make
→ Meta
→ WhatsApp real
```

Conversation real de homologação:

`ff5c1e73-f3ed-4b88-8eba-b6e3a9883941`

O menu foi entregue com:

- Ver cestas;
- Pagamento;
- Ofertas.

Nenhuma chamada OpenAI foi feita para a saudação.

## 3. Hotfix dos campos do Make

A homologação encontrou incompatibilidade entre o cenário Make atual, que envia campos genéricos, e o adaptador antigo, que esperava aliases separados.

Campos atuais:

- `media_id`;
- `caption`;
- `interactive_id`;
- `interactive_title`.

O adaptador passou a aceitar os campos atuais e manter aliases legados.

PR #147 incorporada ao `main`.

`whatsapp-ingest-make-v1` foi publicado em produção na **v2**.

Essa correção também protege os próximos testes de áudio/imagem.

## 4. Hotfix para saudação em conversa existente

Um novo `Oi` em conversa já aberta era persistido, mas com IA desligada retornava `should_reply=false`, deixando o usuário em silêncio.

Correção:

- `oi`, `olá`, `bom dia`, `boa tarde`, `boa noite`;
- `menu`, `início`, `iniciar`, `começar`;

reabrem o `welcome_menu` determinístico sem gastar IA.

PR #148 incorporada ao `main`.

Migration:

`20260907201500_whatsapp_greeting_menu_v1.sql`

## 5. Botão Pagamento

Evento real recebido:

`interactive_id=menu_pagamento`

Resposta determinística validada e aceita pela Meta:

`O pagamento é feito somente na entrega. Se quiser, posso continuar e montar seu pedido agora.`

## 6. IA real em texto — SUCESSO

Mensagem real do telefone de teste:

`Quero uma cesta básica e também preciso de arroz`

Inbound message row:

`e107c219-7581-40a0-8a91-891ef105f277`

AI job:

`e31ce832-e780-4888-8681-a84bc4c61b1c`

Tipo:

`conversation`

Antes do processamento foi confirmado que era o único job `pending/processing`.

### Worker one-shot

PR #149 adicionou temporariamente um workflow fail-closed que:

1. exigia exatamente 1 job pending;
2. exigia o ID exato acima;
3. exigia `job_type=conversation`;
4. usava `AI_JOB_LIMIT=1`;
5. rodava os testes antes do provider;
6. executava o worker uma vez;
7. exigia o mesmo job como `done` ao final.

GitHub Actions:

- run `34159364103`;
- resultado `success`.

O workflow temporário deve ser removido após a homologação.

### OpenAI

Modelo:

`gpt-4o-mini`

Provider request ID:

`req_f7b1d3da0599432bbd366f08b45d2dcf`

Uso registrado:

- input tokens: `194`;
- output tokens: `31`;
- attempts: `1`;
- status: `done`.

`estimated_cost_usd` permaneceu `NULL`; não hardcodar preço de API neste documento.

Interpretação:

```json
{
  "intent": "baskets",
  "description": "Pedido de cesta básica e arroz."
}
```

Resposta determinística criada a partir da intenção:

`Claro. Posso te mostrar as cestas disponíveis e ajudar a personalizar os itens.`

Reply message row:

`910690f4-ea6a-417a-92cd-3c448d6bc005`

Outbound job:

`83c966ea-59b4-43d2-bebf-d2f36db558bc`

## 7. Outbound real event-driven — SUCESSO

Make oficial:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Execution:

`916fafa0ee5a4e6c8c8c8e3141f19f4f`

Fluxo executado:

- webhook recebido;
- mensagem de texto enviada pela conexão oficial Meta;
- Meta devolveu `wamid` real;
- Webhook Response devolveu `job_id`, `provider_message_id` e `delivery_mode=text`;
- `pg_net`/Postgres reconciliaram a resposta;
- outbound job ficou `sent`;
- `dispatch_response_status=200`;
- `review_required=0`.

Provider message ID real ficou registrado no banco. Não há necessidade de repeti-lo neste documento.

## 8. Rastreabilidade encontrada e corrigida

A entrega real revelou uma dívida interna: o `outbound_job` recebia corretamente o `provider_message_id`, mas a linha de `messages` correspondente ainda não recebia:

- `whatsapp_message_id`;
- `delivery_status=sent`;
- atualização de `conversations.last_outbound_at`.

Correção versionada em:

`20260907203500_whatsapp_outbound_message_receipt_v1.sql`

O `finish_outbound_job` passa a persistir esses metadados sem transformar uma falha de metadata em retry de uma mensagem que já pode ter sido entregue.

Também existe backfill genérico para envios `seller_message` já confirmados.

## Estado após o teste de IA texto

A IA foi novamente fechada:

```text
ai_enabled = false
conversation_worker_enabled = false
ai_jobs pending = 0
ai_jobs processing = 0
ai_jobs error = 0
outbound pending = 0
outbound processing = 0
outbound review_required = 0
```

A homologação do telefone de teste permanece temporária e expira automaticamente pelo cron.

## Próxima etapa

Depois de incorporar/aplicar o hotfix de rastreabilidade:

1. testar áudio real inbound;
2. download da mídia Meta → Storage privado;
3. `gpt-4o-mini-transcribe`;
4. interpretação/resposta;
5. resposta por texto primeiro;
6. depois testar resposta em áudio com `dona_antonia_marin_b_v1`;
7. testar foto real → visão;
8. fechar homologação e auditar;
9. somente depois avaliar liberação gradual.

Bling continua fora até o WhatsApp texto/áudio/imagem estar fechado ponta a ponta.
