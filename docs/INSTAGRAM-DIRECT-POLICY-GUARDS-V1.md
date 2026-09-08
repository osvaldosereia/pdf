# Instagram Direct — policy guards v1

Revisado em 08/09/2026.

Este documento registra o contrato de segurança usado pela fundação da ETAPA 6. A fonte primária revisada foi a documentação oficial atual da Meta para Instagram API / Send API / Private Replies, incluindo as coleções oficiais de referência da Meta. As regras devem ser revalidadas imediatamente antes de qualquer homologação real, App Review ou ativação, pois políticas da plataforma podem mudar.

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
3. permissões aplicáveis, incluindo `instagram_business_manage_messages` e `instagram_business_manage_comments` quando requeridas pelo fluxo;
4. configuração de webhook oficial e validação do endpoint;
5. `META_INSTAGRAM_VERIFY_TOKEN` e `META_APP_SECRET` configurados fora do repositório;
6. criação manual/controlada de `channel_accounts` com `status=dormant` primeiro;
7. observe mode antes de qualquer IA/auto-reply;
8. homologação humana allowlisted antes de canary IA independente.

## Guardrails de private reply

O snapshot `meta_instagram_private_reply_2026_09_08_v1` codifica de maneira conservadora:

- máximo de **um** private reply por comentário;
- comentário elegível no máximo até **7 dias** após sua criação;
- comentário de Live permanece bloqueado enquanto o estado ativo da transmissão não tiver sido verificado;
- private reply é apenas abertura da conversa: automação posterior fica bloqueada até o destinatário responder quando a política exigir;
- após resposta do destinatário, o núcleo registra uma janela conservadora de **24 horas** para continuação;
- entrega incerta nunca deve receber retry cego;
- nesta etapa, candidato de private reply só pode ficar `held` ou `draft`; não existe dispatcher Meta.

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

A classificação não envia mensagem. Ela alimenta `instagram_comment_events` e cria, quando tecnicamente elegível, apenas um registro de candidato em `instagram_private_reply_jobs`. O texto é um rascunho e o dispatcher permanece inexistente/dormente.

## Atribuição

`channel_attribution_events` preserva, quando presentes no evento, referências de:

- comentário/Direct;
- post/Reel/Story/Live;
- anúncio;
- `campaign_id`;
- `adset_id`;
- `ad_id`;
- `creative_id`.

Ao surgir um Direct da mesma identidade, atribuições recentes sem conversa podem ser ligadas à conversa sem inventar identidade de cliente. A ligação CRM só usa identidade previamente verificada.

## Autenticação do webhook futuro

Como a Meta não envia JWT do Supabase, `supabase/config.toml` declara `verify_jwt=false` para `instagram-webhook-v1`. Isso **não** torna o endpoint público sem autenticação: o handler rejeita POST sem `x-hub-signature-256` HMAC-SHA256 válido contra `META_APP_SECRET`, exige objeto `instagram`, só aceita contas previamente cadastradas no banco e nunca auto-cria `channel_accounts`.

## Regra de mudança

Antes de qualquer deploy/subscription/primeira mensagem real:

- revisar novamente documentação e permissões atuais da Meta;
- validar App Review/Advanced Access/Business Verification aplicáveis;
- executar CI e `deno check` atuais;
- criar conta em `dormant`, depois `observe`;
- testar somente humano;
- confirmar que Instagram/Messenger não compartilham gate global;
- obter nova autorização explícita antes de qualquer auto-reply/canary real.
