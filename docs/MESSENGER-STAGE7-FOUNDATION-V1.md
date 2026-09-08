# Facebook Messenger + centralização Meta — Etapa 7

Status: fundação programável dormente. Nenhuma conta, subscription, token, webhook ou transporte Meta é ativado por este bloco.

## Escopo implementado

- parser puro de Page/Messenger webhook para message, echo, postback e referral;
- normalização por PSID sem inferir identidade por nome, telefone ou e-mail;
- gates independentes de webhook, observação de mensagens, referrals, leitura Conversations API e transporte;
- renderer determinístico para texto, quick replies, Button Template, Generic Template/carrossel e mídia;
- extração de atribuição Meta Ads/referral sem executar Ads;
- controles server-only com RLS e defaults `false`;
- tabela comum de atribuição Meta para Instagram/Messenger;
- readiness server-only declarando `transport_implemented=false`;
- CI dedicado com teste de runtime e invariantes SQL.

## Segurança e ativação

O módulo nasce fail-closed. `transport_send_enabled=false`, policy Meta não verificada e `max_outbound_per_minute=0`. Mesmo que uma conta fosse criada futuramente com outbound habilitado, o contrato atual termina em `transport_not_implemented` e não chama Graph/Send API.

Não há criação automática de `channel_accounts`. A migration não altera contas existentes, WhatsApp, Flow, Bling ou handoffs humanos.

## Make x GitHub Actions

Não foi criado cenário Make. Messenger webhook/realtime, quando homologado, deve entrar diretamente pela Edge Function/backend porque é evento transacional de baixa latência. GitHub Actions permanece preferido para auditorias, relatórios, reconciliação e snapshots; Make só deverá ser considerado se um conector trouxer vantagem operacional comprovada.

## Pendências externas deliberadamente não executadas

- vincular Facebook Page/Business e permissões do app;
- revisar permissões/políticas vigentes da Messenger Platform;
- definir/registrar callback e verify token;
- assinar eventos da Page;
- configurar token seguro fora do GitHub;
- homologar Conversations API, Send API e regras de janela/messaging type;
- ativar conta/canary/transporte somente após autorização explícita.

Até isso ocorrer, a etapa pode ser considerada concluída apenas na sua parte programável segura.
