# Etapa 8 — Orquestrador channel-aware V1

Status: fundação programável, dormente e fail-closed.

Este bloco fecha a integração entre o `CAPABILITY_REGISTRY` omnichannel e o Experience Orchestrator sem ativar Flow, Sala de Compra, Instagram, Messenger ou novos outbounds.

## Entregas

- registry server-only `experience_channel_capabilities` por canal/experiência;
- todas as capabilities operacionais nascem `enabled=false`;
- política central de budgets (`experience_orchestrator_policy`);
- RPC `get_channel_experience_readiness_v1()` para Admin/observabilidade;
- RPC `plan_channel_experience_v2(...)` com precedência absoluta de handoff humano;
- fallback fail-closed por capacidade do canal;
- módulo puro Node `lib/omnichannel/experience-routing-v1.mjs` para contratos/testes;
- CI específico com PGlite.

## Invariantes preservadas

- `experience_orchestrator_enabled=false` não é alterado;
- `whatsapp_flow_data_exchange_enabled=false` não é alterado;
- `whatsapp_flow_send_enabled=false` não é alterado;
- canary WhatsApp não é alterado;
- Bling não é alterado;
- handoff humano aberto sempre vence qualquer escolha automática;
- capabilities `supported=true` significam apenas compatibilidade técnica, nunca autorização de uso;
- `enabled=false` em todas as linhas impede uso até etapa de homologação/rollout explicitamente autorizada.

## Política de custo

Este bloco não adiciona OpenAI, Make, Maps ou qualquer API paga. O roteamento é determinístico e executado em backend/Node. Make continua reservado às pontes realtime já justificadas.

## Próximo bloco da Etapa 8

Após integração e migration auditada, ainda permanecem dormentes: aplicação real de retorno do Flow no carrinho, envio/abertura de Sala pelo runtime e homologação allowlisted. Nenhuma dessas ações deve ser ativada nesta etapa sem autorização correspondente.
