# Instagram Direct — policy guards v1

Revisado em 08/09/2026.

Este documento registra o contrato de segurança usado pela fundação da ETAPA 6. A fonte primária revisada foi a documentação oficial atual da Meta para Instagram API / Send API / Private Replies, incluindo o workspace oficial da Meta no Postman. As regras devem ser revalidadas imediatamente antes de qualquer homologação real, App Review ou ativação, pois políticas da plataforma podem mudar.

## Estado operacional nesta etapa

- nenhuma conta Instagram é cadastrada automaticamente;
- `channel_accounts` continua sendo o gate autoritativo por conta;
- nenhum webhook é inscrito na Meta;
- `instagram-webhook-v1` é somente código versionado e **não deve ser implantado nesta etapa**;
- nenhum token Meta é criado ou armazenado;
- nenhum private reply, Direct, quick reply, botão, template ou carrossel é enviado;
- nenhuma flag de inbound/IA/auto-reply/outbound é ligada;
- nenhum canary Instagram é aberto;
- WhatsApp permanece independente e limitado ao canary autorizado de 1%.

## Pré-requisitos externos para homologação futura

1. Instagram profissional (Business ou Creator) correto da Dona Antônia;
2. app/business Meta correto e verificado conforme exigência vigente;
3. permissões aplicáveis de mensagens/comentários conforme o tipo de login/API utilizado;
4. configuração de webhook oficial e validação do endpoint;
5. `META_INSTAGRAM_VERIFY_TOKEN` e `META_APP_SECRET` configurados fora do repositório;
6. criação manual/controlada de `channel_accounts` com `status=dormant` primeiro;
7. observe mode antes de qualquer IA/auto-reply;
8. homologação humana allowlisted antes de canary IA independente.

## Guardrails de private reply

O snapshot `meta_instagram_private_reply_2026_09_08_v1` codifica de maneira conservadora as regras atuais revisadas:

- máximo de **um** private reply por comentário;
- comentário elegível no máximo até **7 dias** após sua criação;
- comentário de Live permanece bloqueado sem verificação explícita de transmissão ainda ativa;
- private reply é apenas abertura da conversa: follow-up automático fica bloqueado até o destinatário responder quando a política exigir;
- após resposta do destinatário, o núcleo registra janela conservadora de **24 horas**;
- somente intenções `purchase_interest`, `question` e `support` podem virar candidato de private reply nesta fundação;
- `spam`, `unknown` e `other` ficam bloqueados para evitar abordagem privada indevida;
- entrega incerta nunca deve receber retry cego;
- não existe dispatcher Meta nesta etapa.

## Revisão humana sem envio

A migration `20260908043200_instagram_private_reply_review_hardening_v1.sql` adiciona revisão operacional server-only:

- `review_instagram_private_reply_v1` exige admin ativo `owner` ou `operator`;
- aprovação revalida intenção, janela, Live e gates `observe/inbound/outbound`;
- aprovação grava `status=approved`, mas mantém `blocked_reason=dispatcher_not_released`;
- resposta do RPC declara explicitamente `sent=false`;
- cancelamento é terminal para o rascunho;
- `instagram_private_reply_review_v1` fornece fila de revisão;
- `get_instagram_stage6_metrics_v1` expõe métricas com `transport_released=false` fixo.

A aprovação administrativa **não envia nada** e não contém transporte Graph/HTTP.

## Direct inbound humano primeiro

Quando, futuramente, uma conta Instagram estiver explicitamente em `observe`/`active` com `inbound_enabled=true`:

1. o webhook valida assinatura HMAC antes de processar qualquer evento;
2. evento entra em `normalized_channel_events`;
3. IGSID é apenas `observed` até vínculo legítimo com cliente;
4. Direct abre/reutiliza conversa `channel=instagram`;
5. conversa entra em `status=needs_human`, `mode=human`, `human_required=true` e cohort `human_control`;
6. um `human_handoff` é criado se ainda não existir;
7. IA não é retomada automaticamente;
8. outbound continua bloqueado por gate próprio do Instagram.

## Comentário → intenção → candidato privado

Comentários são normalizados e classificados inicialmente por regras determinísticas sem custo:

- `purchase_interest`;
- `question`;
- `support`;
- `spam`;
- `other`.

A classificação não envia mensagem. Ela alimenta `instagram_comment_events` e pode criar apenas um candidato idempotente em `instagram_private_reply_jobs`. Nesta etapa não existe caminho capaz de transformar o candidato em chamada Meta.

## Contratos de apresentação do Instagram

`supabase/functions/_shared/instagram-send-contract-v1.mjs` e o wrapper Node correspondente preparam somente JSON puro para uso futuro:

- texto;
- private reply por `comment_id`;
- quick replies com no máximo 13 itens e títulos limitados a 20 caracteres;
- Generic Template/carrossel com botões normalizados;
- compartilhamento de post próprio via `MEDIA_SHARE`, exigindo confirmação explícita de que a mídia pertence à conta profissional.

O módulo declara `transportReleased=false` e não contém `fetch`, `net.http_post`, token Bearer ou URL Graph.

## Atribuição conversa → pedido

`channel_attribution_events` preserva comentário/Direct/post/Reel/Story/Live/ad e IDs de campanha quando disponíveis.

A migration `20260908043100_channel_order_attribution_link_v1.sql` cria `order_channel_attribution_links` e aplica last-touch somente quando:

- o pedido possui `conversation_id`;
- o touchpoint pertence à mesma conversa;
- o touchpoint ocorreu antes do pedido;
- o touchpoint está dentro da janela conservadora de 30 dias.

Não existe fallback por nome, telefone, e-mail ou `customer_id` isolado. Triggers locais cobrem tanto pedido novo quanto touchpoint recebido fora de ordem, sem rede externa.

## Autenticação do webhook futuro

Como a Meta não envia JWT do Supabase, `supabase/config.toml` declara `verify_jwt=false` para `instagram-webhook-v1`. Isso **não** torna o endpoint operacionalmente aberto: o handler rejeita POST sem `x-hub-signature-256` HMAC-SHA256 válido contra `META_APP_SECRET`, exige objeto `instagram`, só aceita contas previamente cadastradas no banco e nunca auto-cria `channel_accounts`.

## Regra de mudança

Antes de qualquer deploy/subscription/primeira mensagem real:

- revisar novamente documentação e permissões atuais da Meta;
- validar App Review/Advanced Access/Business Verification aplicáveis;
- executar CI e `deno check` atuais;
- criar conta em `dormant`, depois `observe`;
- testar somente humano;
- confirmar que Instagram/Messenger não compartilham gate global;
- obter nova autorização explícita antes de qualquer auto-reply/canary real.
