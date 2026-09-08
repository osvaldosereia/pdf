# Decisão oficial — Arquitetura Operacional Final V1

Atualizado em 08/09/2026.

Status: **COMPLEMENTO OFICIAL AO ROADMAP DE 20 ETAPAS — NÃO MUDA A ORDEM NEM AUTORIZA ATIVAÇÃO**.

Este documento registra a auditoria arquitetural final autorizada pelo proprietário após revisão do projeto inteiro, anotações paralelas e lacunas funcionais. Ele deve ser lido junto com `ROADMAP-FINAL-DONA-ANTONIA-20-ETAPAS.md` e `ROADMAP-20-ETAPAS-PROGRESS.md`.

Não criar novas etapas numeradas só para estes itens. Incorporá-los como submódulos/critério de saída das etapas indicadas, preservando modularidade, gates e rollout independente.

## Princípio operacional final

A Dona Antônia deve operar como uma plataforma integrada:

```text
canais/CRM
→ carrinho
→ Order Promise
→ pedido
→ reservas/controle de mudanças
→ WMS: pick/check/pack
→ READY
→ rota/load/driver
→ entrega
→ pagamento/conciliação
→ FISCAL_READY/NF-e
→ pós-venda/CRM/marketing/analytics
```

Toda complexidade deve ficar no backend. Telas de funcionário devem permanecer simples e task-oriented.

---

## ETAPA 10 — acrescentar Gestor de Inteligência da Atendente

Incorporar formalmente `PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md`.

Criar no Admin, de forma versionada e testável:

- Knowledge/fatos canônicos;
- Guidance/comportamento;
- Procedures/roteiros flexíveis;
- regras determinísticas e proibições;
- catálogo de respostas/mídias oficiais;
- vínculo com AI Action Registry;
- Roteirista Inteligente em linguagem natural → draft;
- comparação entre versões;
- simulador antes de publicar;
- regressão de casos esperados;
- rollback;
- custo/tokens/latência por bloco;
- recuperação semântica somente quando apropriada; lookup SQL para dados vivos pequenos/estruturados.

Prompts nunca substituem preço, estoque, margem, entrega, pagamento, fiscal ou política determinística.

---

## ETAPA 11 — acrescentar capacidade, cutoff e manifesto operacional

Além da logística já implementada:

- capacidade diária de entrega configurável;
- disponibilidade real de 1 ou 2 entregadores, sem obrigar uso dos dois;
- cutoff configurável;
- manifesto de rota;
- scan de todos os volumes antes de liberar saída;
- scan/retorno de volumes não entregues;
- SLA/aging de READY sem rota;
- fallback manual/provider indisponível;
- correlação ponta a ponta pedido→job→rota→stop.

---

## ETAPA 12 — ampliar Verdade Comercial + OMS/WMS

### 12A — Order Promise / ATP-CTP leve

Antes de prometer data ao cliente, avaliar deterministicamente:

- estoque/lote livre e fisicamente verificado;
- validade compatível com a entrega;
- reservas/compromissos existentes;
- capacidade de separação;
- capacidade de entrega;
- entregadores disponíveis;
- cutoff;
- endereço/região quando a base de cobertura estiver madura.

Sem dado de capacidade confiável: `review`, nunca promessa inventada.

### 12B — Order Change Control

- pedido materializado no WMS não pode ser alterado silenciosamente;
- versionamento otimista;
- Change Request estruturado;
- reconciliação de reservas/picking/preço;
- reconferência quando necessário;
- alteração avançada durante picking exige revisão até homologação própria.

### 12C — Substitution Engine

- grupos de equivalência autorizados;
- preferência por cliente: não substituir / perguntar / permitir dentro da regra;
- validação de preço, margem, estoque e validade;
- substituição de componente de cesta respeita preço comercial próprio da cesta;
- IA pode explicar/sugerir, backend valida.

### 12D — Cycle Counting e acuracidade

- contagem cíclica por risco/giro/divergência;
- blind count quando adequado;
- threshold de diferença;
- revisão de supervisor;
- KPI `inventory_accuracy_percent`;
- contagem disparada por divergência de picking/estoque baixo/lote/validade.

### 12E — Label Service

- etiqueta de pedido;
- volume N/M;
- barcode/QR interno;
- lote/localização quando necessário;
- reimpressão auditada;
- preparado para SSCC apenas se houver necessidade futura.

### 12F — Recall por lote

Rastreabilidade reversa obrigatória:

`lote → movimentações → fulfillment → pedido → cliente`.

Criar futuramente casos de recall com:

- bloqueio/quarentena imediata do lote;
- saldo/localização afetados;
- pedidos ainda não expedidos;
- pedidos já entregues;
- clientes afetados;
- workflow de contato/recolhimento aprovado;
- trilha de resolução.

### 12G — Control Tower operacional inicial

Read model único sem duplicar verdades:

`Pedido | Comercial | Promise | Picking | Checking | Packing | READY | Rota | Pagamento | Fiscal | Aging`.

A Control Tower inicial deve nascer antes do Gerente IA; na Etapa 19 ela evolui para gestão total por exceção.

### 12H — SLA/Aging Engine

Medir tempo por estágio e gerar exceções para:

- confirmado sem fulfillment;
- picking parado;
- conferência atrasada;
- READY sem rota;
- entrega atrasada;
- entregue sem conciliação;
- FISCAL_READY sem resultado fiscal.

Thresholds configuráveis, sem hardcode.

### 12I — políticas comerciais já decididas

Formalizar:

- validade 31–60 dias: política inicial de 20%;
- 0–30 dias: política inicial de 30%;
- vencido: bloquear;
- percentuais são configuração versionada, não constante fixa;
- aniversário dia/mês opcional, uma concessão/ano, desconto OU brinde, com estoque/limites;
- componente de cesta em promoção não recalcula automaticamente o preço comercial da cesta;
- catálogo Admin filtrável por estoque, lote, validade, margem, giro, localização, ruptura etc.

---

## ETAPA 13 — detalhar financeiro da entrega

Além do ledger/conciliação:

- caixa/float inicial por entregador quando aplicável;
- valor esperado em dinheiro;
- dinheiro recebido;
- Pix/cartão/link recebidos;
- troco previsto e troco entregue;
- fechamento da rota/entregador;
- divergência esperada × declarada;
- idempotência de recebimento;
- reconciliação externa sem retry cego;
- estados `review_required` em incerteza.

---

## ETAPA 14 — ampliar abastecimento/WMS

- UOM/packaging: unidade, fardo, caixa, múltiplos, EAN por embalagem quando aplicável;
- reposição interna de pick face por min/max/demanda;
- reserva → picking location;
- putaway dirigido após recebimento;
- slotting recomendado por giro/peso/afinidade de separação;
- mudança de slot somente após aprovação;
- wave/cluster picking apenas quando volume justificar;
- previsão/cotação/fornecedor continuam determinísticos nos cálculos;
- quality checkpoints;
- fornecedor/lote/recebimento ligados à rastreabilidade.

---

## ETAPA 15 — ampliar devoluções físicas

Produto devolvido nunca volta automaticamente a `available`.

Fluxo físico:

`RETURNED → QUARANTINE → inspeção → RESTOCKABLE | DAMAGED | EXPIRED | SUPPLIER_RETURN | DISCARD`.

Somente `RESTOCKABLE` volta ao estoque vendável.

Adicionar fraude/abuso determinístico e explicável para:

- repetição anormal de recusas/cancelamentos;
- abuso de benefícios/crédito;
- duplicidade;
- mudanças suspeitas;
- revisão humana, nunca bloqueio opaco por LLM.

---

## ETAPA 16 — incorporar integralmente decisão de marketing 10 dias

A decisão `DECISAO-MARKETING-OMNICANAL-10-DIAS-V1.md` prevalece sobre a cadência antiga de 15 dias.

Formalizar:

- `purchase_effective_at` transacional;
- nova compra válida reinicia relógio de 10 dias;
- cancelamento/devolução corrige elegibilidade;
- `customer_emails` estruturado;
- consentimento por canal/finalidade;
- `marketing_contact_state`;
- motor de campanhas/versionamento/candidatos/deliveries/suppression/templates/attribution;
- bounce/complaint/unsubscribe;
- pressão comercial compartilhada entre WhatsApp/e-mail/aniversário/recompra;
- holdout/control groups e medição de lift incremental;
- não confundir correlação pós-campanha com causalidade.

---

## ETAPA 18 — AutoQA alimenta a inteligência

AutoQA deve gerar evidências para evolução de:

- Knowledge;
- Guidance;
- Procedures;
- FAQs;
- workflows;
- testes de regressão.

Mudança sugerida pela IA continua passando por política de publicação/versionamento.

---

## ETAPA 19 — Control Tower definitiva + custo operacional

Evoluir a Control Tower para `PRECISA DE VOCÊ`:

- exceções por impacto/risco/SLA;
- correlação de toda cadeia operacional;
- workload manager para picking/checking/loading/driver/handoff;
- custo por pedido válido;
- custo por automação;
- OpenAI/Make/Maps/Meta/e-mail/provider;
- receita/margem atribuída;
- minutos humanos economizados;
- alertas de integração degradada;
- dead letters/reprocessamento seguro.

---

## ETAPA 20 — Segurança, continuidade, privacidade e contratos externos

A homologação final deve exigir, mas as fundações devem nascer antes:

### Identidade e dispositivos

- MFA obrigatório para owner e papéis sensíveis;
- step-up authentication para orçamento/autonomia/financeiro quando aplicável;
- registro de dispositivos operacionais;
- revogação de tablet/celular perdido;
- versão mínima de PWA;
- sessão/cache offline mínimo e expiração.

### Backup e Disaster Recovery

- política de backup/PITR conforme plano disponível;
- RPO/RTO definidos;
- restore drill periódico em ambiente seguro;
- backup/export de configurações críticas versionadas;
- runbook para indisponibilidade de Supabase/Meta/Bling/OpenAI/Maps/Make/e-mail.

### LGPD operacional

Reincorporar explicitamente os requisitos do roadmap antigo:

- inventário de dados pessoais;
- finalidade/base aplicável;
- retenção;
- anonimização;
- correção/exportação/exclusão quando aplicável;
- consentimento e revogação;
- acesso interno auditado;
- PII e mídia sensível;
- resposta a incidente;
- fornecedores/processadores.

### Observabilidade e contratos

- `correlation_id` ponta a ponta;
- DLQ/retry/replay governados;
- health/readiness por integração;
- monitor periódico de versões/deprecações de Meta, Bling, OpenAI, Maps, e-mail e demais APIs;
- alertar com antecedência antes de breaking change.

---

## Itens deliberadamente fora do escopo atual

Não adicionar apenas por sofisticação:

- RFID;
- robôs/esteiras;
- Kubernetes;
- Kafka;
- microserviços prematuros;
- blockchain;
- data lake sem necessidade;
- WMS/TMS enterprise externo;
- rastreamento permanente de funcionário;
- chatbot/cérebro separado por canal.

O objetivo é adotar princípios profissionais com implementação proporcional ao porte da Dona Antônia.

## Critério final

A plataforma somente estará operacionalmente madura quando conseguir:

1. prometer somente o que pode cumprir;
2. manter pedido físico e digital reconciliados;
3. saber onde está cada pedido/lote/volume;
4. detectar exceções antes de o cliente reclamar;
5. fechar entrega, dinheiro e fiscal de forma auditável;
6. rastrear lote até cliente e executar recall se necessário;
7. continuar operando de forma controlada quando um provider falhar;
8. proteger identidade, dados e dispositivos;
9. medir custo, margem, SLA e qualidade;
10. manter humano como autoridade para risco, exceção e decisões acima dos limites.
