# Decisão — NF-e somente após entrega + pagamento confirmados

Atualizado em **08/09/2026**.

Status: **APROVADO COMO REGRA DE ARQUITETURA; TRANSPORTE BLING/SEFAZ DORMENTE**.

## Contexto

A configuração fiscal da empresa no Bling já está definida para **NF-e** e operação de **venda pela internet**. Este projeto não deve duplicar, reinterpretar ou alterar CFOP, natureza da operação, tributação ou demais parâmetros fiscais configurados no Bling.

Na operação da Dona Antônia, a maior parte dos pedidos é paga na entrega. Alguns pedidos podem ser pagos antecipadamente por PIX ou link. Uma saída para rota não significa que a venda foi efetivamente concluída: cliente ausente, desistência, recusa, problema de pagamento, reagendamento ou retorno podem ocorrer.

## Regra oficial

Entrega e pagamento são fatos independentes.

```text
PEDIDO
→ SEPARAÇÃO
→ READY
→ EM ROTA
→ ENTREGA CONFIRMADA
→ PAGAMENTO CONFIRMADO
→ FISCAL_READY
→ NF-e (integração Bling futura, gated)
→ CONCLUÍDO
```

A ordem entre `ENTREGA CONFIRMADA` e `PAGAMENTO CONFIRMADO` pode variar. Um PIX/link antecipado pode deixar o pagamento confirmado antes da rota, mas **não torna o pedido FISCAL_READY enquanto a entrega não estiver confirmada**.

Somente a conjunção determinística abaixo libera elegibilidade fiscal:

```text
order.status = delivered
AND delivery_status = delivered
AND delivery_confirmed_at IS NOT NULL
AND payment_status = confirmed
AND payment_confirmed_at IS NOT NULL
AND settled_amount = order.total (tolerância técnica de R$ 0,01)
AND order não cancelado/retornado
```

Divergência de valor vai para `review_required`; não é corrigida por IA.

## Entrega sem sucesso

Os seguintes caminhos não podem gerar NF-e automaticamente:

- cliente ausente;
- cliente recusou;
- cliente desistiu;
- problema de pagamento;
- endereço incorreto;
- reagendamento;
- entrega falhou;
- pedido cancelado;
- retorno/devolução antes da conclusão fiscal.

Falha logística continua sendo registrada em `delivery_incidents`/`delivery_events`, mas não cria elegibilidade fiscal.

## Implementação programável

Migration:

```text
20260908112400_stage11_delivery_payment_fiscal_gate_v1.sql
```

Objetos:

- `fiscal_runtime_config`: kill switches e modos do módulo fiscal;
- `order_fiscal_controls`: estado separado de entrega, pagamento e elegibilidade fiscal;
- `fiscal_issue_jobs`: intenção idempotente de futura emissão, sempre `held` nesta versão;
- `refresh_order_fiscal_readiness_v1`: reconciliador determinístico;
- `confirm_order_payment_v1`: confirmação determinística de pagamento;
- `preview_bling_invoice_eligibility_v1`: preview sem side effect;
- `prepare_bling_invoice_issue_job_v1`: preparação gated, sem dispatcher;
- `driver_deliver_stop_v2`: entrega explícita com contexto de pagamento opcional.

## Métodos de pagamento reconhecidos pelo contrato

- `cash`;
- `pix`;
- `card`;
- `payment_link`;
- `prepaid_pix`;
- `prepaid_link`;
- `other`.

O método não decide sozinho a elegibilidade fiscal. O evento de pagamento precisa estar confirmado e o valor precisa reconciliar deterministicamente com o pedido.

## Idempotência e auditoria

Cada emissão futura terá versão fiscal por pedido e chave de idempotência. `fiscal_issue_jobs` possui unicidade por `(order_id, fiscal_version)` e por `idempotency_key`.

Nesta versão:

```text
external_side_effect = false
max_attempts = 1
dispatcher_implemented = false
```

Nenhum retry cego contra Bling/SEFAZ é permitido.

## Gates de segurança

Defaults obrigatórios:

```text
fiscal_runtime_config.enabled = false
execution_mode = off
bling_invoice_prepare_enabled = false
bling_invoice_send_enabled = false
canary_percent = 0
```

Mesmo que um pedido fique `FISCAL_READY`, a preparação do job fiscal falha fechado enquanto esses gates estiverem OFF.

Ativar preparação não significa autorizar envio. `bling_invoice_prepare_enabled` e `bling_invoice_send_enabled` são gates independentes.

## Bling

O projeto assume a configuração fiscal já existente no Bling como fonte da parametrização da NF-e. O futuro adapter deve apenas:

1. receber um pedido já `FISCAL_READY`;
2. validar novamente entrega, pagamento, valor e idempotência;
3. usar o pedido de venda existente no Bling;
4. solicitar a geração/emissão da NF-e conforme a configuração já cadastrada no Bling;
5. guardar IDs/retornos e estado SEFAZ;
6. nunca emitir novamente o mesmo `(order_id, fiscal_version)`.

Nenhuma chamada real ao Bling ou SEFAZ é implementada/ativada por esta decisão.

## IA

IA pode analisar exceções ou resumir ocorrências, mas não decide:

- se uma entrega ocorreu;
- se um pagamento ocorreu;
- quanto foi pago;
- se o valor confere;
- se o pedido está fiscalmente elegível;
- número/status da NF-e;
- resultado SEFAZ.

Essas decisões permanecem determinísticas e auditáveis.

## Relação com o roadmap

Este contrato é um hardening da **Etapa 11 — Logística + Roteirização + App do Entregador** criado antes da Etapa 12, pois fecha corretamente a fronteira entre conclusão logística e futura emissão fiscal. A **Etapa 12 continua sendo a próxima etapa numerada ainda não concluída** após a integração e validação deste bloco.
