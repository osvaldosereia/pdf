# Roadmap final reorganizado — Dona Antônia em 20 etapas

Atualizado em 08/09/2026.

Status: **PLANEJAMENTO OFICIAL REORGANIZADO — IMPLEMENTAÇÃO MODULAR, DORMENTE E ATIVAÇÃO GRADUAL**.

Este documento passa a ser a referência de **sequência** para a evolução do projeto. Ele consolida e reorganiza `ROADMAP-FINAL-DONA-ANTONIA-12-ETAPAS.md`, `ROADMAP-AUTONOMIA-EMPRESARIAL-ETAPAS-13-20.md` e `ANALISE-LOGISTICA-ROTEIRIZACAO-ENTREGAS-V1.md`.

As decisões técnicas detalhadas dos documentos anteriores continuam válidas quando não conflitarem com esta ordem. A reorganização não autoriza ativar canais, Bling, Flow, Ads, compras, pagamentos, logística real ou qualquer gasto externo. Todos os módulos novos nascem desligados.

## Objetivo final

Transformar a Dona Antônia em uma **empresa operada por exceção**:

- OpenAI entende, conversa, analisa, planeja, prioriza e seleciona ações;
- backend/Supabase/Bling/provedores determinísticos validam e executam fatos críticos;
- automações resolvem o fluxo normal;
- pessoas entram somente em risco, baixa confiança, conflito, limite financeiro, questão legal/fiscal ou decisão estratégica;
- o Admin é o centro de configuração, simulação, observabilidade, custo, autonomia, ativação e rollback;
- GitHub Actions é a primeira opção para batch/periódico/não urgente; Make só quando o custo-benefício e a natureza realtime/webhook justificarem.

---

# Princípios invariáveis

1. Um único CRM e uma única verdade transacional.
2. Canais são adapters/renderers; não existem cérebros separados por canal.
3. OpenAI nunca é fonte de verdade de preço, estoque, margem matemática, saldo, impostos, status, rota ou ETA.
4. Todo módulo nasce `OFF` e deve poder evoluir: `OFF → OBSERVE/DRY-RUN → DRAFT → HOMOLOGATION → CANARY → LIVE`.
5. Toda função possível deve ser editável/configurável no Admin, com RBAC, histórico, versão, preview e rollback.
6. Toda ação externa relevante exige idempotência, dedupe, budget, kill switch, auditoria e estado de revisão para resultado incerto.
7. GitHub Actions primeiro para batch, relatórios, auditorias, snapshots, manutenção, scoring, reconciliação não urgente e geração de arquivos.
8. Supabase/backend para evento transacional, regras, banco, realtime e baixa latência.
9. Make somente quando a ponte externa/no-code reduzir custo total ou complexidade de forma clara; não usar Make como polling pago.
10. Custos de OpenAI, Make, Maps, mensageria, e-mail e outras APIs devem ser medidos por automação e confrontados com receita, margem e horas humanas economizadas.
11. Testes não ficam para o fim: cada etapa precisa sair com CI, dry-run, gates e regressão. A etapa 20 é homologação integrada e rollout real, não o primeiro momento de teste.

---

# Estado já concluído — etapas 1 a 6

As etapas 1–6 permanecem como já executadas/documentadas no marcador de progresso.

## ETAPA 1 — Fundação, limpeza e consolidação operacional
Concluída.

## ETAPA 2 — Pedido real ponta a ponta + Bling
Parte programável concluída; homologação real permanece protegida para fase autorizada.

## ETAPA 3 — Núcleo omnichannel e evento normalizado
Concluída.

## ETAPA 4 — Adapters, renderers e gates independentes
Concluída.

## ETAPA 5 — CRM unificado, identidades e inbox única
Concluída.

## ETAPA 6 — Instagram Direct + comentários/private reply — fundação dormente
Parte programável segura concluída; transporte/conta real continuam não ativados.

---

# NOVA ORDEM OFICIAL — ETAPAS 7 A 20

## ETAPA 7 — Facebook Messenger + centralização Meta

**Por que permanece agora:** o núcleo omnichannel e Instagram já foram preparados. Messenger reutiliza a mesma fundação e fecha a camada de canais Meta antes de avançar para automação transversal.

Entregas principais:
- Page/Messenger Platform preparada sem ativação real;
- adapter/webhook/normalização;
- observe/humano/canary independentes;
- renderer para quick replies, botões, templates/cards e mídia;
- Conversations API quando viável;
- atribuição Facebook/Meta Ads;
- contas e transportes reais protegidos por gates.

Critério: Messenger tecnicamente encaixado no mesmo CRM/inbox, ainda fail-closed até autorização externa.

---

## ETAPA 8 — Sala de Compra + WhatsApp Flow + Orquestrador channel-aware

**Por que vem antes da automação geral:** precisamos fechar como o motor escolhe a experiência do cliente antes de permitir que workflows e agentes chamem essas experiências como ações reutilizáveis.

Entregas:
- finalizar fundação/homologação técnica do Flow;
- state machine/Data Exchange protegido;
- Sala consolidada;
- orquestrador escolhe conversa, resposta determinística, quick replies, carrossel, Flow, Sala ou humano;
- capability registry respeitado por canal;
- budget por sessão, fallback e handoff humano;
- tudo configurável no Admin e desligado por padrão.

Critério: experiência comercial é uma capacidade reutilizável e neutra ao canal.

---

## ETAPA 9 — AI Action Registry + Governança de Autonomia

**Mudança principal da revisão:** a biblioteca de ações vem ANTES do Motor Geral de Automações e muito antes do Gerente IA.

Motivo: agentes profissionais trabalham sobre ações predefinidas, com dados, permissões e guardrails. Primeiro definimos o que a IA pode fazer; depois permitimos que workflows/agentes encadeiem essas ações.

Entregas:
- catálogo central de ações (`get_customer`, `get_order`, `search_products`, `create_cart`, `change_delivery_address`, `cancel_order`, `reschedule_delivery`, `create_return`, `create_purchase_draft`, etc.);
- schema de entrada/saída;
- pré-condições;
- side effects;
- confirmação necessária;
- nível de autonomia A/B/C/D;
- limites financeiros;
- canais/papéis permitidos;
- idempotency key;
- compensação/rollback quando possível;
- auditoria e custo;
- simulador de ação no Admin;
- políticas de ação editáveis sem hardcode sempre que seguro.

Níveis:
- A: automático;
- B: executa após confirmação do cliente;
- C: automático dentro de limite;
- D: humano obrigatório.

Critério: nenhuma IA precisa de acesso genérico ao banco; ela opera somente por ações registradas e governadas.

---

## ETAPA 10 — Motor Geral de Automações + Builder no Admin

**Mudança principal:** a antiga etapa 13 sobe para o núcleo da plataforma.

Objetivo: criar o “Flow operacional da Dona Antônia” para que os módulos seguintes não dependam de programação ad hoc.

Modelo:

`TRIGGER → CONDITIONS → ACTIONS`

Entregas:
- triggers de pedido, cliente, estoque, validade, entrega, pagamento, conversa, campanha, fornecedor, schedule e anomalia;
- conditions por estado, valor, margem, consentimento, canal, região, score, estoque, risco etc.;
- actions referenciam o AI Action Registry ou ações determinísticas;
- Builder visual;
- Builder em linguagem natural com OpenAI transformando instruções em workflow revisável;
- templates de automação;
- dry-run/simulador;
- execução/versões/falhas/custo;
- on/off, observe, canary, budget, cooldown, limite e kill switch por workflow;
- `execution_strategy` configurável: GitHub Action, Supabase realtime, cron, Edge Function, Make ou revisão manual;
- recomendador de custo: preferir GitHub Actions quando não houver necessidade de realtime.

Critério: novas automações simples podem ser criadas e alteradas pelo Admin, sem nova programação para cada regra.

---

## ETAPA 11 — Logística: Roteirização Automática + Gerenciador de Entregas + App do Entregador

**Mudança principal:** logística deixa de ficar apenas em documento paralelo e entra cedo no roadmap porque é necessidade operacional prioritária e fecha o ciclo pedido → entrega.

Dependência: usa eventos/actions/workflows das etapas 9–10, evitando construir uma automação logística isolada.

Entregas:
- `READY` como fronteira idempotente pedido→logística;
- coordenadas/snapshot de entrega;
- delivery jobs, drivers, vehicles, routes, stops, events, notifications;
- provider abstrato de roteirização/ETA;
- otimização automática de rotas;
- atribuição de entregador;
- app/PWA do entregador, offline-first;
- realtime Central↔App;
- GPS somente durante rota;
- “você é a próxima entrega”;
- ETA configurável de aproximação (piloto ~3 min);
- bloqueio da próxima parada já avisada;
- ocorrências, tentativas, reotimização e prova de entrega configurável;
- custo de Maps/provider medido;
- Admin com fila, mapa, rotas, drivers, capacidade, thresholds e intervenção manual excepcional.

Critério: pedido `READY` pode seguir até `DELIVERED` com mínima digitação/intervenção humana.

---

## ETAPA 12 — Verdade Comercial: Lotes, Validade, FEFO, Ofertas, Benefícios e Guardião de Margem

Objetivo: consolidar a verdade de estoque/margem antes de automatizar compras e crescimento em escala.

Entregas:
- estoque por lote/validade;
- FEFO;
- políticas de desconto por validade configuráveis;
- bloqueio de vencidos/incompatíveis com data de entrega;
- ofertas, cupons, brindes, aniversário e benefícios;
- margem mínima e orçamento por promoção;
- guardião de margem reutilizável por marketing, recompra, crédito e Ads;
- recomendações ligadas a compras entregues reais;
- regras administráveis com versão/rollback;
- relatórios de margem, giro, validade e ruptura.

Critério: nenhuma automação comercial pode oferecer algo inválido ou economicamente inviável.

---

## ETAPA 13 — Financeiro Operacional, Recebimentos e Conciliação

**Mudança:** financeiro sobe antes de compras autônomas e pós-venda financeiro.

Motivo: autonomia de compras, créditos e reembolsos precisa de uma base confiável de dinheiro/limites.

Entregas:
- ledger operacional;
- valor esperado/recebido, forma e referência;
- fechamento de rota/entregador;
- conciliação Pix/cartão/dinheiro/Bling conforme APIs disponíveis;
- divergências viram exceção;
- GitHub Actions para reconciliações batch;
- limites de ajuste automático;
- `review_required` para estado externo incerto;
- dashboards e políticas editáveis no Admin.

Critério: “entregue” deixa de ser confundido com “recebido e conciliado”.

---

## ETAPA 14 — Compras, Fornecedores, Reposição, Demanda e Qualidade

Dependências: estoque/margem (12), limites financeiros (13), ações/workflows (9–10).

Entregas:
- CRM operacional de fornecedores;
- lead time, preços, múltiplos, mínimos, frete, condições, qualidade e histórico;
- estoque mínimo/máximo e safety stock configuráveis;
- previsão de demanda por modelo apropriado; OpenAI interpreta, não calcula sozinho;
- sugestão/criação automática de pedido de compra draft;
- autoaprovação apenas abaixo de limite configurável;
- cotação e comparação de fornecedores;
- NF-e/recebimento evoluído;
- divergência automática de quantidade/preço;
- quality checkpoints;
- OpenAI Vision como auxiliar de inspeção quando útil;
- barcode-first em recebimento/armazenagem/separação/conferência/carregamento/devolução;
- GitHub Actions para previsão, scoring, análise histórica e rotinas não urgentes.

Critério: reposição rotineira pode ocorrer em modo automático controlado; pessoa vê exceções e compras acima de limite.

---

## ETAPA 15 — Pós-venda Autônomo: Cancelamento, Trocas, Devoluções, Crédito e Recuperação

Dependências: AI Actions (9), workflows (10), logística (11), margem (12) e financeiro (13).

Entregas:
- casos estruturados de pós-venda;
- cancelamento elegível;
- item faltante/errado/avariado;
- troca/devolução/reentrega;
- cobrança incorreta;
- OpenAI para triagem, conversa e evidências;
- backend aplica política/limite;
- ledger de Crédito Dona Antônia;
- service recovery;
- prova de entrega como evidência;
- humano apenas para fraude, conflito, valor alto ou caso sensível;
- todas as políticas editáveis no Admin.

Critério: pós-venda normal deixa de depender de operador.

---

## ETAPA 16 — CRM Preditivo + Fidelidade + Recorrência + Marketing Omnicanal

**Reorganização:** juntar inteligência de ciclo de vida com marketing, em vez de disparar marketing amplo antes de maturar segmentação, margem e pós-venda.

Entregas:
- próxima compra provável, churn, frequência, CLV e afinidades quando houver dados suficientes;
- favoritos;
- compra/cesta recorrente ou lembrete programado;
- níveis/fidelidade/indicação/crédito simples;
- marketing pós-compra e recompra por WhatsApp/e-mail/canais permitidos;
- consentimento, suppression, bounce, complaint, opt-out;
- SPF/DKIM/DMARC;
- segmentação determinística + preditiva;
- escolha do canal por custo/eficiência permitido;
- guardião de margem antes de benefício;
- atribuição campanha→conversa→pedido→margem;
- GitHub Actions para elegibilidade batch, scoring, snapshots e campanhas não realtime;
- Admin configura frequência, limite, segmentação, orçamento e autonomia.

Critério: relacionamento e recompra são automáticos, relevantes e economicamente controlados.

---

## ETAPA 17 — Central de Crescimento: Social + Meta Ads + Google + Orçamento Controlado

**Mudança:** crescimento pago fica depois de margem, financeiro, CRM e atribuição, para não otimizar clique/receita sem saber lucro e qualidade operacional.

Entregas:
- calendário/social/content manager;
- biblioteca de mídia/criativos;
- IA para briefing, legenda, CTA e variações;
- publicação/agendamento dentro de gates;
- Meta Ads: leitura, drafts, campanhas/conjuntos/anúncios/criativos/insights;
- Welcome Message Flows e Click-to-Message quando autorizados;
- Search Console, Merchant Center, GA4, Perfil da Empresa, PageSpeed e Google Ads;
- atribuição first touch/last touch/conversion channel;
- CPA, receita e margem atribuída;
- budget diário/mensal;
- limite de alteração percentual;
- sugestões OpenAI;
- execução automática somente dentro de limites configurados;
- kill switch financeiro;
- GitHub Actions para relatórios/auditorias/snapshots e geração não realtime.

Critério: crescimento pode ser otimizado com base em margem e custo real, não apenas métricas de mídia.

---

## ETAPA 18 — AutoQA + Voz do Cliente + Melhoria Contínua

**Por que antes do Gerente IA:** antes de dar autonomia ampla ao supervisor, precisamos de uma camada independente que avalie qualidade dos agentes, workflows e processos.

Entregas:
- AutoQA de conversas;
- rubricas configuráveis;
- detecção de alucinação, repetição, looping, handoff inadequado, resolução e custo;
- QA operacional de workflows/pedidos/rotas/campanhas/fornecedores;
- Voz do Cliente: reclamações, pedidos não atendidos, abandono, cancelamento, problemas de produto/lote/bairro;
- knowledge gaps;
- OpenAI propõe FAQ/guidance/procedures/workflows;
- testes/regressão gerados;
- mudanças seguras podem seguir fluxo de aprovação/autopublicação configurada;
- custo/amostragem/modelo configuráveis;
- GitHub Actions como opção principal para avaliação batch.

Critério: o sistema consegue medir e melhorar a própria qualidade com evidências.

---

## ETAPA 19 — Gerente IA + Central “Precisa de Você” + Workload Manager

**Por que perto do final:** Gerente IA só deve supervisionar a empresa depois que existem ações governadas, workflows, logística, dinheiro, compras, pós-venda, marketing, crescimento e QA.

Entregas:
- visão consolidada de vendas, atendimento, pedidos, estoque, fornecedores, entrega, financeiro, campanhas, custos e erros;
- detecção determinística/estatística de anomalias;
- OpenAI interpreta impacto e prioriza;
- dispara playbooks autorizados;
- cria rascunho de workflow/campanha/compra;
- Central `PRECISA DE VOCÊ` mostra somente exceções reais;
- cartões com evidência, impacto, valor em risco e opções;
- workload manager distribui separação, conferência, entregas, handoffs e exceções;
- briefing diário/semana gerado automaticamente;
- limites de autonomia editáveis;
- gerente não pode ultrapassar Action Registry/guardrails.

Critério: a gestão diária deixa de exigir inspeção manual de vários painéis.

---

## ETAPA 20 — Homologação Integrada, Autorizações Externas, Segurança, Custo e Rollout Final

Objetivo: comprovar a empresa autônoma completa, módulo por módulo e depois integrada.

Importante: cada etapa já terá seus testes. A etapa 20 concentra as dependências reais/externas e o rollout integrado.

Entregas:
- regressão Node/PGlite/Deno/E2E;
- RLS/Vault/secrets/rate limit/replay/idempotência;
- recuperação/rollback/disaster drills;
- Meta App Review/Advanced Access/Business Verification;
- Bling real allowlisted;
- Flow/Data Exchange real controlado;
- Instagram/Messenger real em observe→canary;
- DNS/e-mail;
- Maps/routing com budget real;
- conciliação financeira controlada;
- compras autônomas somente em limite piloto;
- pós-venda automático em casos simples;
- marketing/Ads em baixo volume;
- análise de custo-benefício de Make/OpenAI/Maps/mensageria/e-mail;
- revisão de automações que podem migrar para GitHub Actions;
- teste mobile/desktop/PWA/offline;
- monitorar qualidade, opt-out, erro, custo, margem e intervenção humana;
- relatório final de pendências;
- rollout independente por módulo;
- declaração de produção completa somente após período estável.

Critério: plataforma estável, reversível, auditável e operada predominantemente por automações/IA, com humano por exceção.

---

# Por que esta ordem é melhor

## 1. Ações antes de agentes autônomos

Primeiro definir ações, schemas, limites e guardrails; depois permitir que OpenAI e workflows escolham/encadeiem ações. Evita agente com acesso genérico e reduz retrabalho.

## 2. Motor de automação antes dos módulos operacionais novos

Logística, compras, marketing, pós-venda e financeiro passam a usar o mesmo padrão de trigger/condition/action e a mesma observabilidade.

## 3. Logística sobe por prioridade operacional

Roteirização/app do entregador é necessidade imediata declarada e fecha o ciclo de pedido. Não deve ficar escondida depois de Ads ou crescimento.

## 4. Financeiro antes de compras/pós-venda autônomos

Para dar autonomia a compra, crédito, reembolso e fechamento de entregador, primeiro precisa existir uma verdade estruturada de recebimentos/divergências/limites.

## 5. Crescimento pago só depois de margem/atribuição

Evita automatizar orçamento de Ads antes de saber margem real, custo por pedido, devolução e qualidade operacional.

## 6. AutoQA antes do Gerente IA

O supervisor autônomo deve ser medido por uma camada de qualidade independente e configurável.

## 7. Testes contínuos + homologação final integrada

Não existe mais a ideia de “programar tudo e só testar na etapa 12”. Cada módulo sai testado/dormente; o final serve para credenciais, canais reais, gastos reais e rollout.

---

# Ordem resumida oficial

1. Fundação/limpeza — concluída
2. Pedido + Bling — fundação concluída
3. Núcleo omnichannel — concluída
4. Adapters/renderers/gates — concluída
5. CRM/inbox/identidades — concluída
6. Instagram Direct/comentários — fundação concluída
7. Messenger + Meta centralizada
8. Sala + Flow + Orquestrador
9. AI Action Registry + Governança
10. Motor Geral de Automações + Builder
11. Logística + Roteirização + App Entregador
12. Lotes + Validade + Ofertas + Margem
13. Financeiro + Recebimentos + Conciliação
14. Compras + Fornecedores + Reposição + Demanda + Qualidade
15. Pós-venda Autônomo + Trocas + Crédito
16. CRM Preditivo + Fidelidade + Recorrência + Marketing
17. Social + Meta Ads + Google + Crescimento
18. AutoQA + Voz do Cliente + Self-improvement
19. Gerente IA + Central de Exceções + Workload
20. Homologação Integrada + Autorizações + Rollout

---

# Regra de execução para próximas rodadas

- continuar da primeira etapa ainda não concluída;
- avançar o máximo possível na parte programável segura;
- fundações futuras devem permanecer dormentes;
- não aguardar credencial externa para desenvolver componentes independentes;
- não ativar canal/gasto/efeito real só porque o código ficou pronto;
- priorizar módulos que serão reutilizados pelas etapas seguintes;
- avaliar custo-benefício antes de escolher Make/OpenAI/API paga;
- preferir configuração Admin a hardcode;
- preservar o canary e demais invariantes definidos em `RETOMADA-DONA-ANTONIA.md`.
