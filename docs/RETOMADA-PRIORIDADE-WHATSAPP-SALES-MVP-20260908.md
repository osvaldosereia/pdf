# RETOMADA PRIORITÁRIA — WhatsApp Sales MVP

Atualizado em **08/09/2026**.

> **Prioridade operacional temporária.** Enquanto este checkpoint estiver aberto, ele prevalece sobre a instrução genérica de avançar a Etapa 13 em `docs/RETOMADA-DONA-ANTONIA.md`. A Etapa 13 continua sendo a próxima etapa oficial do roadmap, mas a homologação do atendimento/venda WhatsApp deve ser concluída antes de voltar ao roadmap normal.

## Objetivo imediato

Homologar com segurança o fluxo mínimo:

```text
WhatsApp inbound
→ release/canary existente
→ ai_job
→ dispatcher autenticado
→ conversation-worker-v3
→ catálogo counter_verified
→ carrinho
→ ajustes
→ endereço
→ confirmação explícita
→ pedido interno confirmado
→ fila LOCAL de retaguarda
```

O cliente deve receber somente a confirmação comercial do pedido. **Bling é invisível na experiência e continua sem sync real autorizado.**

## Código integrado

### PR #226 — MVP WhatsApp

Merge commit:

```text
b4f5abbf824e90c74fd953185b1da30b24912800
```

Inclui:

- catálogo do atendimento somente do banco próprio `counter_verified`;
- `conversation-worker-v3`;
- conhecimento/orientações/procedimentos/mídia/testes do atendimento;
- carrinho e estado multietapa;
- confirmação explícita;
- pedido interno antes do Bling;
- fila local de retaguarda;
- outbound preparado para texto/áudio/imagem/lista/botões, sem carrossel;
- Admin de Inteligência do Atendimento;
- testes dedicados.

### PR #227 — correção do dispatcher v3

Merge commit:

```text
51bd6303f6579a9a35ac0cb66b456ff8b93763b4
```

Problema encontrado durante a homologação: o Edge Function v3 estava implantado, mas a função PostgreSQL ativa `dispatch_conversation_worker_job_v2` havia sido restaurada por uma definição posterior e ainda apontava para `/conversation-worker-v2`.

Correção:

- migration `20260908210900_conversation_worker_v3_dispatch_target_v1.sql`;
- endpoint interno passou a apontar para `conversation-worker-v3`;
- autenticação `x-da-worker-key`, Vault, retries e auditoria preservados;
- regressão adicionada para impedir restauração futura do v2.

Validação de runtime após migration:

```text
targets_v3=true
targets_v2=false
```

### PR #228 — ranking do catálogo conversacional

Merge commit:

```text
6f84b14385c6549c6d83f9b9b5b2a68ce76553b3
```

Migration:

```text
20260908210910_whatsapp_sales_search_ranking_v2.sql
```

Motivo: busca genérica por `arroz` podia priorizar nomes onde a palavra aparecia incidentalmente, como macarrão/sopão.

Após correção, termos próximos ao início do nome recebem score superior. Exemplo real pós-DDL:

```text
Urbano Arroz ... -> score 90
Urbano Macarrão de Arroz ... -> score 80
Sopão ... com Arroz -> score 80
```

A verdade comercial continua determinística e exclusivamente do catálogo fisicamente conferido.

## Supabase / Edge Functions

Projeto:

```text
ssbesxgaijknwsjbsbcz
```

Implantados:

```text
conversation-worker-v3 version=1 status=ACTIVE verify_jwt=false
admin-service-intelligence-v1 version=1 status=ACTIVE verify_jwt=true
```

`conversation-worker-v3` usa autenticação customizada porque o dispatcher PostgreSQL não envia JWT:

```text
header: x-da-worker-key
Vault: conversation_worker_webhook_key_v2
system_secrets: conversation_worker_webhook_v2
SHA-256 Vault ↔ hash armazenado = confirmado
```

Healthcheck pós-deploy e pós-correção:

```text
HTTP 200
worker_version=3
provider_configured=true
```

O `verify_jwt=false` do worker não significa endpoint aberto: a chave customizada é obrigatória e validada antes do processamento.

## Estado atual de produção — preservar

Após a validação do dispatcher e ranking, o MVP textual foi religado somente no canary já autorizado:

```text
whatsapp_release_mode=live
whatsapp_live_canary_percent=1

whatsapp_sales_mvp_enabled=true
whatsapp_sales_order_submit_enabled=true
whatsapp_sales_images_enabled=false
whatsapp_sales_interactive_enabled=false
whatsapp_sales_bling_submit_enabled=false

bling_order_sync_enabled=false
bling_order_homologation_only=true

service_intelligence.enabled=true
service_intelligence.execution_mode=homologation
service_intelligence.knowledge_enabled=true
service_intelligence.guidance_enabled=true
service_intelligence.procedures_enabled=true
service_intelligence.media_enabled=false
```

**Não aumentar o canary acima de 1%.**

## Segurança / efeitos externos

Permanece proibido nesta homologação:

- aumentar WhatsApp acima de 1%;
- habilitar Bling order sync;
- habilitar `whatsapp_sales_bling_submit_enabled`;
- habilitar imagens/listas/botões antes de validar o fluxo textual;
- habilitar Flow/Data Exchange;
- ativar Experience Orchestrator;
- alterar configuração fiscal do Bling;
- disparar NF-e/SEFAZ;
- remover ou sobrepor handoff humano.

O checkout interno sempre conclui a venda primeiro. A fila do Bling é apenas local; a função de claim do Bling exige os dois gates externos e continua bloqueada.

## Auditoria após ativação mínima

No momento do checkpoint:

```text
orders=0
active_bling_queue=0
novos ai_jobs nos 30 minutos anteriores=0
```

Os handoffs humanos existentes devem ser preservados. A contagem operacional observada nesta rodada chegou a 17 abertos/claimed; não limpar automaticamente.

## Make autorizado

O cenário outbound já foi auditado:

```text
Dona Antônia - WhatsApp Outbound Event-Driven v3
scenario_id=7290488
status=active
```

Rotas separadas por `delivery_mode`:

- text;
- audio;
- image;
- interactive/button;
- interactive/list.

Conexões WhatsApp e OpenAI reportadas como `ok`. Não há carrossel.

Mesmo com as rotas preparadas, imagens e interativos permanecem OFF no Supabase durante esta primeira homologação textual.

## CI

PR #227:

```text
Dona Antonia WhatsApp Sales MVP = success
Test Dona Antonia conversation worker = success
```

PR #228:

```text
Dona Antonia WhatsApp Sales MVP = success
Test Dona Antonia conversation worker = success
```

O workflow legado Admin V2/Caneca não faz parte do gate deste MVP.

## Próxima ação ao receber “continue”

1. auditar primeiro este checkpoint, `main`, Supabase e Make se necessário;
2. confirmar que canary continua exatamente 1%;
3. conferir novos `ai_jobs`, erros de dispatch, outbound jobs e handoffs desde este checkpoint;
4. observar/testar uma conversa real do cohort de 1% pelo fluxo textual;
5. validar: busca → carrinho → quantidade/remoção/troca → endereço → resumo → confirmação explícita → pedido interno;
6. confirmar que a resposta final ao cliente é somente `Pedido confirmado. Total: ...`;
7. confirmar que, após o pedido, existe apenas fila LOCAL de retaguarda e **nenhum envio real ao Bling**;
8. se o fluxo textual ficar estável, avaliar separadamente a homologação de imagem/lista/botões, sem aumentar o canary;
9. só após homologação técnica completa e nova autorização explícita do proprietário considerar um único pedido controlado no Bling;
10. depois de concluir esta prioridade, voltar à Etapa 13 oficial.

## Regra de rollback

Se surgir erro de processamento, resposta errada recorrente, dispatch incerto ou risco de efeito externo:

```text
whatsapp_sales_mvp_enabled=false
whatsapp_sales_order_submit_enabled=false
```

Manter o canary de WhatsApp em 1% e preservar o atendimento/handoff já existente. Não tentar compensar erro ativando Bling, Flow ou outro executor.
