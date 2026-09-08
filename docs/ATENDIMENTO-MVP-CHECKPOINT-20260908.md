# Checkpoint — Atendimento WhatsApp MVP — 08/09/2026

## Escopo desta rodada
Finalização do atendimento automatizado/IA do WhatsApp, sem avançar financeiro/logística e sem aumentar rollout.

## Estado confirmado em produção
- `whatsapp_release_mode=live`
- `whatsapp_live_canary_percent=1`
- inbound e auto-reply habilitados
- `whatsapp_sales_mvp_enabled=true`
- imagens e interativos habilitados
- criação interna do pedido habilitada
- envio do pedido ao Bling continua `false`
- Flow/Data Exchange continua `false`
- limites: 40 jobs IA/h, 10 novas conversas/h, 40 outbound/h

## Inteligência de atendimento consolidada
A base publicada foi reduzida para evitar regras redundantes e diminuir contexto/tokens. O bundle operacional ficou com 7 orientações publicadas, 8 conhecimentos e 3 procedimentos.

Orientações publicadas essenciais:
1. endereço antes da confirmação final;
2. atendimento rápido e objetivo;
3. interativos/mídia apenas quando reduzem passos;
4. catálogo próprio como fonte de verdade e preço comercial de cesta;
5. ordem de objetivos + ações reversíveis sem confirmação intermediária;
6. mensagem atual com prioridade sobre histórico;
7. não inventar promessas/dados.

Regras redundantes foram arquivadas, não apagadas, preservando auditoria.

## Regressões
A suíte de casos cadastrados foi ampliada de 9 para 16 cenários, incluindo:
- produto sem quantidade não presume 1 unidade;
- alteração de quantidade no carrinho;
- checkout sem endereço;
- checkout com endereço conhecido;
- personalização/remoção em cesta sem expor preço interno;
- promessa de entrega desconhecida deve conferir/handoff;
- nova intenção substitui assunto anterior.

## Correção crítica encontrada nesta rodada
A migration `20260908210980_whatsapp_checkout_address_first_v1.sql` ainda não estava aplicada em produção e continha `priority=110`, incompatível com o constraint `0..100` de `service_guidance_rules`.

Correção realizada:
- migration corrigida no GitHub para `priority=100`;
- migration aplicada com sucesso no Supabase;
- função `whatsapp_checkout_address_first_outbound_v1()` confirmada;
- trigger `trg_checkout_address_first_outbound_v1` confirmado;
- regra `checkout_address_before_confirmation` publicada.

Resultado esperado: quando o cliente pede para finalizar sem endereço, o sistema pede somente o endereço primeiro; depois apresenta o resumo e uma única confirmação final. Endereço já conhecido evita pergunta repetida.

## Quantidade explícita
A fundação determinística de quantidade está presente em produção:
- `prepare_whatsapp_sales_product_quantity_v1`;
- `whatsapp_quantity_prompt_v1`;
- `apply_whatsapp_sales_product_quantity_v1`.
Selecionar produto não deve significar automaticamente 1 unidade; a quantidade é obtida antes de alterar o carrinho.

## Segurança
Advisors executados após a migration. Não surgiu alerta novo específico desta alteração. Permanecem os INFO de RLS sem policy no padrão server-only já adotado e o WARN conhecido de leaked-password protection do Auth. Não alterar Auth automaticamente.

## Próximo passo para liberar uso mais amplo
Executar homologação conversacional real no WhatsApp com os 16 cenários críticos e observar eventos/respostas. Corrigir qualquer regressão encontrada. Somente depois, e com autorização explícita do proprietário, avaliar aumento do canary acima de 1%.

## Gates que permanecem intocados
- NÃO aumentar canary >1% sem autorização;
- NÃO ativar envio ao Bling;
- NÃO ativar WhatsApp Flow/Data Exchange;
- NÃO ativar módulos financeiros/logísticos/fiscais;
- handoff humano mantém precedência absoluta.
