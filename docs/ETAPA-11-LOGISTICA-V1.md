# Etapa 11 — Logística, Roteirização e App do Entregador V1

Atualizado em **08/09/2026**.

Status: **FUNDAÇÃO PROGRAMÁVEL SEGURA — DORMENTE POR PADRÃO**.

Esta etapa implementa a arquitetura aprovada em `docs/ANALISE-LOGISTICA-ROTEIRIZACAO-ENTREGAS-V1.md` e no roadmap de 20 etapas. Ela não autoriza rotas reais, GPS real, provider pago de Maps/Routes, mensagens logísticas, ativação do app do entregador ou alteração do canary WhatsApp.

## 1. Separação de verdades

O desenho mantém entidades diferentes para não misturar responsabilidades:

- `orders`: verdade comercial;
- `delivery_jobs`: execução logística de um pedido `READY`;
- `delivery_routes`: plano operacional;
- `delivery_stops`: sequência executável;
- `driver_locations`: posição observada do entregador;
- ETA: previsão derivada de provider, nunca estado comercial;
- `delivery_notifications`: intenção/recibo de comunicação ao cliente.

Geofence não conclui entrega. ETA não muda pedido. OpenAI não altera rota.

## 2. Banco e domínio

Migrations da Etapa 11:

```text
20260908112000_stage11_logistics_foundation_v1.sql
20260908112100_stage11_driver_actions_v1.sql
20260908112200_stage11_logistics_policy_v2.sql
20260908112300_stage11_route_drafts_notifications_v3.sql
```

Objetos principais:

- `logistics_runtime_config`;
- `drivers`;
- `vehicles`;
- `delivery_jobs`;
- `delivery_routes`;
- `delivery_stops`;
- `delivery_route_versions`;
- `delivery_events`;
- `delivery_incidents`;
- `driver_locations`;
- `delivery_notifications`;
- `routing_provider_calls`;
- `logistics_audit_events`.

Todas as tabelas operacionais nascem com RLS e são server-only. As RPCs críticas revogam `PUBLIC`, `anon` e `authenticated`, deixando execução para `service_role`; clientes acessam somente Edge Functions autenticadas e restritas.

## 3. READY → delivery_job

`preview_delivery_job_from_ready_order_v1(order_id)` valida deterministicamente um pedido `ready` sem side effect.

`create_delivery_job_from_ready_order_v1(order_id,idempotency_key)` é a fronteira idempotente `READY → delivery_job`. Em produção ela nasce bloqueada por:

```text
enabled=false
execution_mode=off
job_creation_enabled=false
```

A execução logística guarda snapshot de endereço, coordenadas e origem/confiança quando presentes, valor a receber, volumes, prioridade, janela, observações e `ready_at`.

## 4. Rotas

`lib/logistics/route-planner-v1.mjs` monta um rascunho determinístico por prioridade/janela/READY, mas marca explicitamente:

```text
geographically_optimized=false
requires_provider_optimization=true
```

Isto evita chamar uma ordenação comercial de “rota otimizada”.

`create_delivery_route_draft_v1(...)`:

- aceita somente jobs roteáveis;
- exige coordenadas confirmadas;
- verifica capacidade de paradas do veículo quando informada;
- cria versão/auditoria;
- não chama provider;
- não publica rota.

`publish_delivery_route_v1(...)` existe somente como contrato backend futuro e falha fechado sem todos os gates de homologação. A Edge Function administrativa **não expõe publicação de rota** nesta versão.

Paradas `locked_next` ou ativas não podem mudar silenciosamente de posição; `applyLockedNextInvariant(...)` e a máquina de estado exigem preservação ou intervenção explícita.

## 5. Provider de rota e ETA

`lib/logistics/routing-provider-v1.mjs` abstrai:

- `optimize_routes`;
- `compute_eta`;
- `geocode`.

O provider padrão é `NullRoutingProvider`, sempre `held` e com:

```text
external_call_performed=false
```

Existe apenas um placeholder `GoogleRoutingProviderDormant`; ele lança `google_maps_provider_not_released`. Não há chave, secret, endpoint pago, `fetch` ou cobrança de Maps nesta etapa.

Cada futura chamada paga já possui modelo de auditoria/custo em `routing_provider_calls`, com limites por rota configuráveis.

## 6. ETA e avisos

O aviso de aproximação exige simultaneamente:

- rota ativa;
- GPS recente;
- ETA calculado;
- ETA dentro do threshold configurável;
- confiança mínima configurável.

Não usa distância em linha reta como verdade de ETA.

`prepare_delivery_notification_v1(...)` cria somente um registro `held` e informa `dispatcher_implemented=false`.

Uma parada **não é bloqueada quando a mensagem é apenas preparada**. O lock da próxima parada só ocorre em `mark_delivery_notification_receipt_v1(...)` quando há recibo real `sent` ou `delivered`. Isso preserva a regra operacional: cliente avisado → próxima parada protegida.

Nenhum dispatcher logístico é liberado nesta etapa; a futura implementação deverá reutilizar o outbound WhatsApp oficial existente, sem criar um segundo sender.

## 7. App/PWA do entregador

`driver-app/` contém fundação offline-first com:

- login Supabase;
- vínculo `drivers.auth_user_id`;
- leitura somente da rota atribuída ao próprio entregador;
- COMEÇAR ROTA;
- CHEGUEI;
- ENTREGUEI;
- FALHA/ocorrência;
- abertura de navegação externa por coordenada;
- fila offline com `client_event_id` idempotente;
- sincronização após reconexão;
- service worker/cache;
- GPS somente com rota ativa e gates de app/GPS habilitados.

Defaults estáticos:

```text
driver-app enabled=false
driver-app gpsEnabled=false
```

No backend, GPS também exige `enabled`, `driver_app_enabled`, `gps_tracking_enabled`, modo de execução liberado e rota ativa pertencente ao entregador. Assim, alterar HTML/JS sozinho não libera rastreamento.

A retenção de `driver_locations` é configurável e existe `purge_driver_locations_v1(...)` para limpeza futura.

## 8. Prova de entrega

`proof_of_delivery_mode` é configurável:

- `driver_confirmation` — default;
- `photo_optional`;
- `photo_required`;
- `signature_optional`;
- `signature_required`.

O backend bloqueia `photo_required`/`signature_required` sem referência da prova. A UI de captura e storage de foto/assinatura deve ser homologada antes de alterar o default; nesta versão o app envia apenas confirmação explícita do entregador.

A sequência normal é:

```text
rota published
→ COMEÇAR ROTA
→ pedido/job out_for_delivery
→ CHEGUEI
→ ENTREGUEI
→ stop + delivery_job + order delivered
```

Tudo dentro de RPCs transacionais e idempotentes por evento do cliente.

## 9. Incidentes e recursos

Falhas estruturadas incluem ausência do cliente, endereço, pagamento, veículo, atraso, dano, segurança e outros.

Eventos sensíveis podem ir para `review_required`. Rotas finalizadas/canceladas liberam motorista e veículo por trigger backend.

## 10. Central de Logística no Admin

A UI `LOGÍSTICA` está preparada, porém escondida com:

```text
logisticsUiEnabled=false
```

Ela mostra:

- fila de delivery jobs;
- rotas e estados;
- entregadores;
- veículos/capacidade;
- ocorrências;
- métricas;
- ETA/GPS/cooldown;
- retenção de localização;
- limites de provider/custo;
- prova de entrega;
- kill switch.

Também permite selecionar jobs com coordenadas válidas e montar **rascunho interno de rota**. Não há operação de publicação/ativação de rota no Admin.

Entregadores e veículos criados por essa UI são forçados a `inactive`. Salvar política força novamente todos os gates para OFF.

## 11. Gates de produção esperados

```text
enabled=false
execution_mode=off
job_creation_enabled=false
routing_enabled=false
driver_app_enabled=false
gps_tracking_enabled=false
notifications_enabled=false
external_provider_enabled=false
provider_name=none
canary_percent=0
logisticsUiEnabled=false
driver-app enabled=false
driver-app gpsEnabled=false
```

## 12. Segurança/custo

- sem Google Maps API paga;
- sem Make novo;
- sem OpenAI na verdade logística;
- sem cron de rota/GPS;
- sem dispatcher de notificações;
- GPS não opera fora de rota ativa;
- delivery exige confirmação explícita, não geofence;
- offline actions são idempotentes;
- sem retry cego de side effect externo;
- provider calls têm trilha de custo;
- próximo cliente só é protegido após recibo real da comunicação;
- Edge Functions administrativa e do entregador exigem JWT.

## 13. Testes/CI

`.github/workflows/stage11-logistics.yml` executa:

- assertions estáticas de fail-closed;
- planner/provider determinísticos;
- aplicação real das quatro migrations em PGlite;
- teste de `READY → job` bloqueado e idempotente;
- rascunho de rota;
- publicação bloqueada por gate;
- notificação `held` e lock somente após receipt;
- GPS bloqueado por default;
- kill switch;
- sintaxe JavaScript;
- `deno check` das duas Edge Functions.

## 14. Fora da liberação desta etapa

Continuam dependentes de homologação/autorização posterior:

- ativar `READY → delivery_job` automático;
- vincular usuários reais de entregador;
- tornar drivers/vehicles `available` para uma rota real;
- mostrar a Central de Logística no Admin;
- ativar o PWA;
- ativar GPS;
- contratar/configurar provider de Maps;
- publicar rota real;
- enviar WhatsApp logístico;
- capturar foto/assinatura real;
- aumentar canary WhatsApp;
- ativar Bling/Flow/Instagram/Messenger/Ads.

## 15. Critério de conclusão programável

A Etapa 11 pode ser marcada como programaticamente concluída quando:

1. CI da PR estiver verde;
2. migrations forem aplicadas em produção mantendo todos os gates OFF;
3. Edge Functions, se implantadas, permanecerem protegidas por JWT + gates OFF;
4. contagens de jobs/rotas/locations/notifications/provider calls continuarem zero;
5. canary WhatsApp permanecer 1%, os 3 handoffs permanecerem intactos e Bling/Flow/orquestrador continuarem OFF;
6. Security Advisor não registrar novo WARN decorrente da Etapa 11.
