# WhatsApp — Fase 1 — checkpoint final controlado — 08/09/2026

## Objetivo da rodada

Fechar a primeira fase do atendimento WhatsApp da Dona Antônia com foco em cestas básicas, vitrine externa, carrinho, retorno ao WhatsApp, cadastro/endereço, regra das 11h e handoff humano, sem ampliar rollout.

## Estado incorporado no `main`

Commit auditado: `1dfbfd1a6849e3ffe8f73fd51d37e6e5358b4b58`.

PRs relevantes já incorporadas:

- #240 — pre-gate de release antes dos fast paths;
- #241 — vitrine inicial: logo, fotos, retirar, quantidade e total dinâmico;
- #242 — guardas finais de preço e troca sem botão inexistente;
- #243 — retorno direto ao WhatsApp e correção do ingest interativo;
- #244 — cidade obrigatória e área de entrega Cuiabá/Várzea Grande.

## Gates de produção auditados

```text
whatsapp_release_mode=live
whatsapp_live_canary_percent=1
whatsapp_inbound_enabled=true
whatsapp_auto_reply_enabled=true
whatsapp_sales_mvp_enabled=true
whatsapp_sales_order_submit_enabled=true
bling_order_sync_enabled=false
whatsapp_sales_bling_submit_enabled=false
whatsapp_flow_data_exchange_enabled=false
whatsapp_flow_send_enabled=false
experience_orchestrator_enabled=false
```

Nenhum gate proibido foi ampliado nesta rodada.

## Simulações executadas no Supabase

### Lista de cestas

- `whatsapp_simple_basket_list_interactive_v1()` retornou 9 cestas;
- texto inicial correto para seleção da cesta.

### Regra das 11h — America/Cuiaba

Teste determinístico:

- 10:59 -> entrega no mesmo dia, taxa 0;
- 11:01 -> próximo dia útil, taxa 0.

### Cadastro/endereço

Teste executado dentro de transação com `ROLLBACK`:

- `Cuiaba` -> normalizado para `Cuiabá`, cadastro considerado completo;
- cidade fora da área, exemplo `Rondonopolis` -> bloqueada com `delivery_city_not_supported`;
- cidades permitidas: Cuiabá e Várzea Grande.

Nenhum dado de teste foi persistido.

### Outbound

Nas últimas 6 horas auditadas:

```text
outbound_jobs sent=24
outbound_jobs pending/error=0
```

## Make

Cenários ativos autorizados para WhatsApp continuam:

- Dona Antônia - WhatsApp Inbound Controlado v1;
- Dona Antônia - WhatsApp Outbound Event-Driven v3.

O outbound recente auditado está concluindo com sucesso.

No inbound, houve uma sequência de `Internal Server Error` antes da correção da PR #243. Após a correção, as execuções mais recentes voltaram a `success`, inclusive entradas posteriores à incorporação do fix.

Não foi ativado cenário novo.

## GitHub Actions

A suíte `Dona Antonia WhatsApp Sales MVP` do commit atual do `main` terminou com `conclusion=success` (run #54).

Foi observado um workflow agendado separado de SEO/dados públicos com falha posterior. Ele não pertence ao caminho transacional desta fase do WhatsApp e não bloqueia este checkpoint; deve ser tratado separadamente para evitar misturar escopos.

## Handoff humano

O comportamento permanece fail-safe:

- conversas fora do canary entram em `human_control`;
- o pre-gate impede fast path automático antes da decisão de release;
- handoffs `live_canary_human_control` permanecem abertos quando aplicável;
- nenhuma conversa fora do cohort autorizado é promovida para IA por esta rodada.

## Avaliação de prontidão

A primeira fase está **pronta para operação controlada no canary de 1%** para o escopo de cestas básicas implementado.

Fluxo validado:

```text
mensagem WhatsApp
-> ingest controlado
-> intenção de cestas
-> lista com 9 cestas
-> seleção interativa
-> sessão/vitrine externa
-> editar quantidade / retirar componentes
-> adicionar extras
-> total comercial atualizado
-> retorno direto ao WhatsApp
-> cadastro/endereço com cidade
-> regra de entrega das 11h
-> registro da encomenda
-> handoff humano para conferência/conclusão
```

## Pendências reais antes de ampliar rollout

1. manter observação do inbound por volume real antes de qualquer aumento acima de 1%;
2. componentes legados sem delta/preço confiável continuam corretamente em `A confirmar`/revisão humana — cadastrar deltas confiáveis gradualmente;
3. continuar teste real em dispositivos/navegadores diferentes para o retorno da vitrine ao WhatsApp, embora a rota direta `wa.me` tenha substituído a tentativa dependente de gesto tardio;
4. não ativar Bling nesta fase; a conclusão humana continua sendo o ponto seguro final;
5. não ativar Flow/Data Exchange nem Experience Orchestrator;
6. tratar separadamente o workflow legado/agendado de SEO/dados públicos que falhou, pois não é bloqueador desta fase WhatsApp.

## Regras que devem ser preservadas

- canary global = 1%;
- Bling order sync = OFF;
- WhatsApp Flow/Data Exchange = OFF;
- Experience Orchestrator = OFF;
- preço comercial da cesta não é soma automática dos componentes;
- preço individual dos componentes da cesta não é exposto;
- incerteza de preço/delta -> revisão humana, nunca valor inventado;
- entrega somente Cuiabá/Várzea Grande;
- pagamento/fiscal permanecem fora desta primeira fase;
- handoff humano tem precedência.

## Próximo passo recomendado

Usar esta fase em operação controlada mantendo 1% e acompanhar erros/latência/conversões reais. Corrigir apenas regressões observadas. Não ampliar rollout até nova autorização explícita do proprietário.
