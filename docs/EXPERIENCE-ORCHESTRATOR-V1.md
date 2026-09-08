# Dona Antônia — Experience Orchestrator V1

Data: 08/09/2026

Status: **FUNDAÇÃO IMPLEMENTADA, DORMENTE POR PADRÃO**.

Esta camada transforma em código a decisão arquitetural registrada em `ANALISE-WHATSAPP-FLOWS-COMERCIO-CONVERSACIONAL-V1.md`.

## Objetivo

O atendimento não deve depender de uma única interface. A próxima experiência pode ser:

- conversa natural;
- resposta determinística;
- carrossel;
- WhatsApp Flow;
- Sala de Compra;
- atendimento humano.

Princípio:

> A IA entende o cliente; o orquestrador escolhe a interface; o backend controla fatos, candidatos, regras e transações.

## Segurança de lançamento

`automation_config.experience_orchestrator_enabled` nasce `false`.

Mesmo que uma definição exista, nenhuma nova sessão pode ser criada enquanto:

1. o kill switch global estiver desligado;
2. a feature estiver desligada;
3. o rollout estiver em 0%;
4. a definição não estiver `ready` ou `active`;
5. a conversa estiver em takeover humano.

Nenhuma feature desta migration nasce ligada.

## Feature flags iniciais

- `flow_personalize_basket`;
- `flow_build_purchase`;
- `flow_upsell`;
- `carousel_recommendations`;
- `shopping_room_personalized`.

Todas começam com:

```text
enabled = false
rollout_percent = 0
```

## Definições iniciais

### `flow-personalizar-cesta-v1`

Missão: editar componentes permitidos da cesta.

Regra comercial obrigatória:

```text
preço da cesta = preço comercial próprio
preço individual dos componentes = nunca exposto ao cliente
```

### `flow-montar-compra-v1`

Missão: transformar uma necessidade ampla em produtos genéricos + quantidades.

A escolha de marca fica para uma etapa visual posterior quando necessário.

### `flow-upsell-v1`

Missão: complemento opcional.

Nunca pode bloquear checkout. Se cliente demonstrou pressa, recusou upsell ou entrou em fast checkout, o planner suprime a oferta.

## Planner determinístico

RPC:

`plan_next_experience_v1(...)`

Não cria sessão, não chama OpenAI, não envia WhatsApp e não toca no Bling.

Regras principais:

- humano tem precedência absoluta;
- pagamento, entrega, horários, checkout e fatos críticos usam resposta determinística;
- personalização de cesta prefere Flow quando habilitado e pronto;
- fallback pode usar Sala de Compra;
- poucas recomendações podem usar carrossel;
- muitas opções ou necessidade visual podem usar Sala;
- upsell respeita `fast_checkout` e `upsell_declined`;
- qualquer interface não habilitada recua para conversa.

## Sessões de experiência

Tabela: `experience_sessions`.

Características:

- idempotency key obrigatória;
- status explícito;
- conversa/cliente/definição/cart vinculáveis;
- expiração;
- resultado estruturado;
- provider session opcional;
- conclusão idempotente.

Eventos são auditados em `experience_events`.

## Contrato do Flow de cesta

RPC:

`build_basket_flow_context_v1(conversation_id,basket_id)`

Payload permitido por componente:

- `product_id`;
- nome;
- imagem;
- quantidade;
- removível ou não;
- editável ou não;
- mínimo/máximo;
- disponibilidade booleana;
- ordenação.

Campos deliberadamente ausentes:

- preço unitário;
- line total;
- custo;
- estoque numérico.

O payload da cesta contém apenas o preço comercial da própria cesta.

### Validação de retorno

RPC:

`validate_basket_flow_selection_v1(basket_id,selection)`

O retorno do Flow é tratado como dado não confiável. A validação rejeita:

- produto que não pertence à cesta;
- UUID inválido;
- duplicidade;
- quantidade fora do limite;
- remoção de item não removível;
- alteração de item não editável;
- produto indisponível;
- snapshot incompleto.

A função é **somente validação** nesta fase. Não altera carrinho.

## Admin

Nova Edge Function:

`admin-experience-orchestrator-v1`

Recursos preparados:

- dashboard;
- preview sem efeitos;
- configuração JSON de rascunho;
- edição de definição de experiência;
- readiness do contrato Flow;
- kill switch global owner-only com confirmação de alto atrito.

O módulo visual `admin-v3/experience-orchestrator.js` está pré-integrado, porém:

```text
experienceOrchestratorUiEnabled = false
```

Portanto não aparece no Admin até ativação consciente posterior.

Não existe botão de ativação global nesta fase.

## O que NÃO foi implementado ainda

- transporte criptográfico oficial do WhatsApp Flow / Data Exchange;
- publicação de Flow na Meta;
- template/provider ID real;
- envio de mensagem Flow pelo Make;
- aplicação das alterações de Flow no carrinho;
- Flow 2 de upsell em produção;
- alteração do Worker V2 para despachar automaticamente interfaces;
- ativação de qualquer feature.

Antes dessas etapas, validar a documentação oficial vigente da Meta.

## Relação com o canary atual

Esta camada é isolada do `live=1%` atual.

Não alterar:

- `whatsapp_release_mode`;
- canary;
- Make inbound/outbound;
- Worker V2 atual;
- Bling.

O canary deve continuar sendo observado separadamente.

## Teste automatizado

`scripts/test-experience-orchestrator-v1.mjs` cobre:

- kill switch default off;
- todas as features default off;
- seleção Flow quando explicitamente habilitado em fixture;
- carrossel vs Sala;
- precedência humana;
- supressão de upsell;
- idempotência de sessão e conclusão;
- bloqueio de sessão com kill switch off;
- contrato de cesta sem vazamento de preços/custo/estoque;
- validação de quantidade e snapshot completo.

## Próximos passos, sem atropelar o canary

1. manter o orquestrador dormente;
2. observar canary real de 1%;
3. validar documentação Meta Flows atual;
4. criar o Flow real de personalização no provider;
5. cadastrar provider ID como `ready`, sem ativar feature;
6. homologar Data Exchange allowlisted;
7. homologar retorno → validação → carrinho em ambiente controlado;
8. medir IA sem Flow vs IA + Flow;
9. somente depois avaliar rollout percentual da feature.
