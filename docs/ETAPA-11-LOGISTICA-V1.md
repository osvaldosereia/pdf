# Etapa 11 — Logística, Roteirização e App do Entregador V1

Atualizado em 08/09/2026.

Status: **FUNDAÇÃO PROGRAMÁVEL SEGURA — DORMENTE POR PADRÃO**.

Esta etapa implementa a base logística aprovada no roadmap reorganizado de 20 etapas e em `docs/ANALISE-LOGISTICA-ROTEIRIZACAO-ENTREGAS-V1.md`. Ela **não autoriza** rotas reais, GPS real, Google Maps/Routes/Route Optimization, mensagens logísticas, ativação do app do entregador ou alteração do canary WhatsApp.

## Escopo implementado

### Banco / domínio

Foram preparados:

- `logistics_runtime_config` com gates independentes e defaults `OFF`;
- `drivers` e `vehicles`;
- `delivery_jobs` separados de `orders`;
- `delivery_routes`, `delivery_stops` e `delivery_route_versions`;
- `delivery_events` append-oriented;
- `delivery_incidents`;
- `driver_locations`;
- `delivery_notifications` idempotentes;
- `routing_provider_calls` com auditoria/custo e `external_call_performed=false` por padrão;
- `logistics_audit_events`.

Todos os objetos server-side usam RLS e privilégios restritos. RPCs críticos são backend/service-role only.

### READY → delivery_job

`preview_delivery_job_from_ready_order_v1(order_id)` valida deterministicamente um pedido `ready` sem side effect.

`create_delivery_job_from_ready_order_v1(order_id,idempotency_key)` existe como fronteira idempotente, mas falha fechado enquanto `enabled=false`, `job_creation_enabled=false` ou `execution_mode=off`.

A execução logística guarda snapshot do endereço, coordenadas/origem/confiança quando disponíveis, valor a receber, volumes, prioridade, janela e `ready_at`. Pedido e entrega permanecem entidades diferentes.

### Máquinas de estado

Foram criadas transições backend-only para job, rota e parada. A próxima parada notificada pode ficar bloqueada; reprogramação de parada bloqueada exige motivo explícito. Geofence não conclui entrega automaticamente.

### Entregador

A fundação do PWA inclui:

- autenticação Supabase;
- vínculo obrigatório `drivers.auth_user_id`;
- leitura apenas da rota atribuída;
- ações idempotentes por `client_event_id`;
- COMEÇAR ROTA, CHEGUEI, ENTREGUEI e FALHA;
- fila offline local e sincronização posterior;
- GPS somente quando rota está ativa e gate específico está habilitado;
- service worker/cache PWA.

O app nasce com `enabled=false` e `gpsEnabled=false` em `driver-app/config.js`.

### Roteamento / ETA

`lib/logistics/routing-provider-v1.mjs` define o contrato abstrato do provider. O provider inicial é `NullRoutingProvider`, que nunca chama rede e responde `held/provider_not_released`.

Nenhum endpoint do Google Maps ou outro fornecedor foi adicionado. Não há chave, secret, cobrança ou chamada externa.

O gatilho de aproximação exige:

- rota ativa;
- GPS recente;
- ETA disponível;
- confiança mínima configurável;
- threshold configurável.

Não usa distância em linha reta como verdade de ETA.

### Admin

A Central `LOGÍSTICA` foi preparada com:

- readiness/fila/rotas/entregadores/veículos/ocorrências;
- drafts inativos de entregador e veículo;
- política de ETA/GPS/custo editável sem ativação;
- kill switch unilateral.

A UI permanece invisível por `logisticsUiEnabled=false`. A API administrativa não possui operação de ativação do runtime ou provider externo.

## Gates default

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

## Segurança e custo

- sem Maps/API paga;
- sem Make novo;
- sem OpenAI na verdade logística;
- route/ETA/status/GPS determinísticos;
- GPS não opera fora de rota ativa;
- idempotência no evento offline do entregador;
- sem retry cego de efeitos externos;
- provider calls possuem trilha de custo;
- política de retenção de localização já tem configuração dedicada;
- Edge Functions administrativa e de entregador exigem JWT.

## CI

`.github/workflows/stage11-logistics.yml` valida:

- tabelas/RLS/defaults OFF;
- idempotência `READY → delivery_job`;
- máquinas de estado;
- bloqueio da parada avisada;
- app offline/GPS gated;
- provider nulo sem rede;
- Admin dormente;
- autenticação das Edge Functions;
- sintaxe JS e `deno check`.

## Fora de escopo desta fundação

Continuam protegidos para homologação/autorizações futuras:

- ativar `READY → delivery_job` automático em produção;
- cadastrar/vincular entregadores reais;
- publicar Edge Functions para runtime real;
- ligar app do entregador;
- rastrear GPS real;
- contratar/configurar Google Maps Platform;
- otimizar/publicar rotas reais;
- enviar WhatsApp logístico;
- aumentar canary;
- ativar Bling/Flow/Instagram/Messenger/Ads.

## Critério da rodada

A parte programável de fundação, domínio, Admin, provider abstrato e PWA está preparada. Antes de considerar a Etapa 11 encerrada programaticamente, a migration deve ser aplicada/auditada de forma dormente e o CI/regressão deve ficar verde. A ativação logística real permanece fora desta etapa segura.
