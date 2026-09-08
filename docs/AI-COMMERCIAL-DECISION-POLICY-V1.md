# IA Comercial — Cost Policy + Safe Action + Confidence V1

Status: fundação P0 dormente.

## Objetivo

Implementar em código três regras oficiais do plano de IA comercial:

1. custo de ferramenta é configuração versionada, nunca hardcode;
2. ações seguras/reversíveis podem avançar com menos atrito;
3. ações de compromisso/irreversíveis continuam exigindo confirmação, independentemente da confiança da IA.

## Cost Policy Engine

A arquitetura separa:

- `commercial_tool_registry`: o que a ferramenta é;
- `channel_cost_policy_versions`: quanto custa e qual é o teto autorizado naquele período.

Nenhum preço atual da Meta é criado nesta migration.

A política aprovada precisa informar:

- canal;
- categoria;
- provider;
- versão;
- modelo de custo;
- custo unitário atual;
- teto autorizado;
- status do custo;
- vigência;
- data de verificação;
- referência da fonte quando aplicável.

Fail-closed:

- sem política aprovada -> bloquear;
- custo desconhecido -> bloquear;
- custo sem verificação -> bloquear;
- vigência ausente quando expiração é obrigatória -> bloquear;
- custo acima do teto -> bloquear;
- custo dentro do teto -> permitir.

Assim, mudança de preço futura exige atualização de configuração/versionamento, não mudança de arquitetura.

## Safe Action

`ai_action_registry` ganhou classificação de risco:

- `read_only`;
- `reversible_write`;
- `commitment`;
- `irreversible`.

Também ganhou `confidence_autorun_allowed`.

Ações explicitamente representadas no registry incluem consultas seguras, simulações e ações que sempre exigem confirmação, como finalizar venda, enviar pedido ao Bling, confirmar entrega e aplicar desconto excepcional.

Todos continuam `disabled/off`.

`create_cart` passa a representar carrinho provisório/reversível e não exige confirmação por si só. Finalização é ação separada.

## Confidence Policy

`decision_confidence_policy_versions` é versionada.

A sugestão inicial 0,60/0,90 foi registrada apenas como **draft**, não aprovada.

Com uma política aprovada, o comportamento esperado é:

- abaixo do limiar baixo -> `ask_clarification`;
- faixa intermediária + ação reversível/autorizada -> `execute_with_disclosure`;
- confiança alta + ação segura/autorizada -> `approved`;
- ação de compromisso/irreversível sem confirmação -> `awaiting_confirmation`;
- handoff humano aberto -> `awaiting_human`.

Confiança nunca ignora confirmação obrigatória.

## Integração com AI Action Registry

Quando uma ferramenta referencia `ai_action_key`, a decisão final também passa por `simulate_ai_action_v1`.

Portanto, liberar ferramenta no Cost Policy não libera uma ação desativada no Action Registry. As duas governanças precisam permitir.

## Ordem de objetivos

A configuração registra a ordem oficial:

1. `resolve_correctly`;
2. `make_purchase_easy`;
3. `close_sale`;
4. `increase_ticket_when_relevant`.

Essa ordem será consumida pelo futuro Next Best Action.

## Estado inicial

- runtime OFF;
- canary 0;
- ferramentas OFF;
- zero políticas de custo aprovadas;
- zero políticas de confiança aprovadas;
- zero avaliações reais;
- nenhum transporte Meta/OpenAI/Make/Bling;
- nenhum preço atual hardcoded.

## Próximo passo

O próximo bloco do plano de IA deve usar esta fundação para o `Next Best Action` e para a política de compressão/carga cognitiva, sem ativar o Experience Orchestrator em produção.
