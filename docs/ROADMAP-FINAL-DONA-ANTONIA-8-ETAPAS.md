# Roadmap final — Dona Antônia em 8 etapas

Revisão global em 08/09/2026.

Este documento organiza o caminho restante até considerar o projeto Dona Antônia **completo, homologado e liberado para uso real**.

Ele complementa `RETOMADA-DONA-ANTONIA.md`, `EVOLUCAO-COMERCIAL-DONA-ANTONIA.md` e `DECISAO-MARKETING-OMNICANAL-10-DIAS-V1.md`.

Em caso de conflito sobre cadência de marketing, a decisão mais recente é **10 dias**, reiniciados a partir de cada nova compra válida.

---

# Diagnóstico atual

## Já existe e está avançado

- Supabase como base operacional atual;
- produtos/cestas/carrinho/pedidos e fila de sync modelados;
- Sala de Compra;
- motor comercial e recomendações;
- customer intelligence e `customer_product_stats`;
- aniversário e consentimento inicial;
- atendimento WhatsApp inbound/outbound pela Cloud API/Make;
- Worker V2 com OpenAI;
- texto, áudio, visão e TTS Marin homologados em testes reais anteriores;
- fallback/handoff humano;
- canary real `live=1%`;
- segurança/replay/state machine da fundação WhatsApp Flow;
- Edge Functions Flow publicadas com gates desligados;
- hardening dos trigger RPCs `SECURITY DEFINER`;
- testes Node/PGlite/Deno relevantes em CI;
- Admin com operação, atendimento e fundações de inteligência.

## Estado que impede chamar o projeto de finalizado

Na auditoria desta revisão:

```text
orders = 0
customer_product_stats = 0
marketing_consents = 0
customers_marketing_opt_in = 0
```

Ou seja: a infraestrutura existe, mas ainda não existe histórico real suficiente no novo núcleo para provar o ciclo comercial completo.

Também foi confirmado:

- `customers` ainda não possui e-mail estruturado;
- não existem tabelas de campanha, entrega de campanha ou e-mail marketing;
- não existem tabelas de lote/validade por lote;
- não existem views finais de relatório/BI;
- não existe cenário de marketing no Make;
- WhatsApp Flow continua sem chave e sem homologação Meta;
- Bling continua propositalmente fora do canary atual;
- PR #179 do painel dormente de chave Flow está aberta e validada, pendente de integração;
- há cenários antigos de teste/temporários ainda ativos no Make e eles devem sair do ambiente operacional antes da liberação final;
- há PRs antigas/paralelas no mesmo repositório que não pertencem ao caminho atual da Dona Antônia e precisam ser classificadas/encerradas para reduzir confusão operacional.

---

# ETAPA 1 — Fechar a fundação operacional e eliminar dívida de homologação

**Status atual: avançada, mas ainda não encerrada.**

## Objetivo

Transformar o estado atual de canary em uma base limpa e previsível antes de adicionar mais caminhos de produção.

## Entregas

1. Integrar/revisar a PR #179 do ciclo de vida da chave Flow mantendo a UI dormente.
2. Continuar monitorando `live=1%` até obter eventos suficientes para validar o cohort automático e o cohort humano.
3. Preservar todos os handoffs humanos existentes.
4. Revisar Security Advisor e corrigir apenas avisos relevantes; avaliar `Leaked Password Protection` do Supabase Auth.
5. Inventariar cenários Make e separar:
   - produção oficial;
   - homologação;
   - temporários;
   - legados.
6. Desativar/arquivar antes do go-live final os cenários de teste/temporários que não devem receber eventos reais.
7. Classificar PRs antigas/paralelas e fechar as que não fazem parte do produto atual.
8. Consolidar documentação autoritativa e runbooks.
9. Definir backups, restore testado e política de retenção de logs.

## Critério de saída

Nenhum caminho legado/temporário pode processar produção por engano; canary e fallback humano estáveis; CI verde; documentação e ambiente sem ambiguidades.

---

# ETAPA 2 — Fechar pedido real ponta a ponta + Bling

**Status atual: estrutura pronta em boa parte; homologação real ainda pendente.**

## Objetivo

Provar uma compra completa, desde conversa/Sala até pedido final no ERP, sem erro fiscal ou duplicidade.

## Entregas

1. Finalizar criação/edição do carrinho e cesta personalizada.
2. Confirmar cadastro/resolução do cliente.
3. Validar endereço e entrega.
4. Criar pedido no Supabase de forma idempotente.
5. Para cestas:
   - preço comercial próprio;
   - componentes individualizados para Bling;
   - preço individual dos componentes oculto ao cliente;
   - diferença positiva em Outras Despesas;
   - diferença negativa em desconto.
6. Ativar Bling somente em homologação allowlisted.
7. Testar um único pedido real controlado.
8. Validar criação de contato/pedido, itens, estoque, valores, status e retorno do `bling_order_id`.
9. Tratar timeout/incerteza sem retry cego.
10. Implementar status posteriores: entregue, cancelado, devolvido e correções das estatísticas.
11. Somente compra válida deve atualizar perfil de compra/recompra.
12. Confirmar pedido ao cliente no WhatsApp somente após estado confiável do backend/ERP.

## Critério de saída

Pedido real completo e conciliado em Supabase + Bling; idempotência provada; cancelamento/devolução não contaminam faturamento ou perfil de compra.

---

# ETAPA 3 — Finalizar experiência comercial: conversa + Sala + WhatsApp Flow

**Status atual: Sala e orquestrador têm fundação; Flow está dormente.**

## Objetivo

Entregar a experiência final para diferentes perfis de cliente sem obrigar todos a usar a mesma interface.

## Entregas

1. Gerar/rotacionar chave Flow pelo endpoint owner-only.
2. Registrar somente a chave pública na Meta.
3. Validar assinatura/readiness da Meta.
4. Criar e publicar o primeiro Flow real de personalização de cesta em ambiente controlado.
5. Testar Data Exchange criptografado real.
6. Permitir aplicar alterações da cesta ao carrinho de forma transacional somente após homologação read-only.
7. Implementar dedupe/replay/timeout/expiração de sessão.
8. Fazer o orquestrador escolher entre:
   - conversa;
   - resposta determinística;
   - carrossel;
   - Flow;
   - Sala de Compra;
   - humano.
9. Manter takeover humano soberano.
10. Testar mobile e WhatsApp Web.
11. Medir custo e quantidade de mensagens/tokens por experiência.

## Critério de saída

Cliente consegue montar e personalizar compra por conversa, Sala ou Flow, com estado consistente, sem perder carrinho e sem exposição de preço interno de cesta.

---

# ETAPA 4 — CRM, cadastro e inteligência de cliente completos

**Status atual: fundação parcial existe; falta fechar identidade e dados omnicanal.**

## Objetivo

Ter um registro único do cliente capaz de alimentar atendimento, relatórios e marketing profissional.

## Entregas

1. Criar cadastro estruturado de e-mail (`customer_emails` ou equivalente).
2. Importar/conciliar e-mails existentes do Bling quando houver, com regras de origem e confiabilidade.
3. Separar consentimento por canal e finalidade:
   - WhatsApp atendimento;
   - WhatsApp marketing;
   - e-mail marketing.
4. Implementar opt-in/opt-out auditável e supressões.
5. Consolidar aniversário, endereços, telefones, e-mails e preferências.
6. Evoluir `customer_product_stats` com compras válidas reais.
7. Calcular recência, frequência, valor, intervalo mediano, categorias, marcas e itens recorrentes.
8. Registrar aceitação/recusa de complementos e ofertas.
9. Criar views/serviços de relatório sem enviar histórico completo para LLM.
10. Criar painel CRM com:
    - cliente;
    - compras;
    - produtos favoritos/recorrentes;
    - recomendações;
    - consentimentos;
    - próximo contato elegível;
    - histórico de campanhas;
    - handoffs/reclamações.

## Critério de saída

Cada cliente possui identidade e consentimentos confiáveis; novas compras atualizam automaticamente o perfil; recomendações são explicáveis e auditáveis.

---

# ETAPA 5 — Estoque por lote, ofertas, benefícios e regras comerciais

**Status atual: regras conceituais e alguns motores existem; lote real e editor final faltam.**

## Objetivo

Centralizar promoções e benefícios no backend, com margem, estoque e validade controlados.

## Entregas

1. Implementar lote/quantidade/validade e FEFO.
2. Bloquear venda de produto vencido e entrega posterior à validade.
3. Implementar regras solicitadas de validade:
   - 31–60 dias: 20%;
   - 0–30 dias: 30%;
   - vencido: bloqueio.
4. Não aplicar automaticamente desconto de componente ao preço comercial da cesta.
5. Criar editor de regras no Admin:
   - oferta;
   - desconto;
   - brinde;
   - aniversário;
   - limites;
   - orçamento;
   - prioridade;
   - cumulatividade.
6. Simulador antes de publicação.
7. Guard de margem e estoque.
8. Versionamento/auditoria/reversão.
9. Benefício de aniversário: desconto ou brinde, uma concessão por período definido.
10. Integrar essas regras ao carrinho, pedido, marketing e Bling.

## Critério de saída

Preço, lote, estoque, benefício e fiscal convergem no mesmo resultado em Admin, Sala, pedido e Bling.

---

# ETAPA 6 — Marketing omnicanal automatizado e personalizado

**Status atual: requisito oficial; motor ainda não implementado.**

Documento específico: `DECISAO-MARKETING-OMNICANAL-10-DIAS-V1.md`.

## Objetivo

Criar recompra e relacionamento automáticos usando perfil individual, com controle de consentimento, pressão comercial, custo e resultado.

## 6A. WhatsApp marketing

1. Cadência base: **10 dias**.
2. Cada nova compra válida reinicia a contagem.
3. Seleção diária/periódica de candidatos — nunca cron individual por cliente.
4. Somente clientes com consentimento atual.
5. Usar WhatsApp Cloud API da Meta.
6. Mensagem iniciada pela empresa somente com **template aprovado**.
7. Formato preferencial: template **MARKETING tipo carrossel** para produtos relacionados.
8. Cards selecionados pelo perfil, estoque e regra comercial.
9. Dedupe/idempotência/cap diário/kill switch.
10. Respeitar opt-out imediatamente.
11. Não enviar campanha durante handoff/reclamação/pedido problemático.
12. Registrar delivery/provider IDs e atribuição.

## 6B. E-mail marketing

1. Cadência base: **10 dias** por cliente elegível.
2. Nova compra válida reinicia a contagem.
3. Cadastro de e-mail + consentimento próprio.
4. Escolher provedor com adapter substituível.
5. Configurar SPF/DKIM/DMARC.
6. Template HTML responsivo e profissional.
7. Produtos relacionados ao perfil do cliente.
8. Unsubscribe obrigatório e simples.
9. Bounce/complaint/suppression por webhook.
10. Links rastreáveis e CTA para Sala/WhatsApp.
11. Custo e entrega auditáveis.

## 6C. Inteligência de campanhas

- escolher produtos por afinidade/recorrência/estoque;
- no máximo poucos produtos de descoberta;
- evitar repetir recusas;
- aniversário compete com recompra;
- experimentar grupos de controle;
- medir margem e opt-out, não somente clique;
- painel de campanhas no Admin;
- IA pode criar rascunho/copy, mas backend decide elegibilidade e envio.

## Critério de saída

Piloto allowlisted comprova consentimento, dedupe, entrega, opt-out, atribuição, custo e ausência de spam antes de qualquer escala.

---

# ETAPA 7 — Homologação final, segurança e testes de produção

**Status atual: muitos testes unitários/integrados já existem; bateria final completa ainda não foi executada.**

## Objetivo

Validar o sistema como produto único antes de liberar toda a operação.

## Bateria obrigatória

### Atendimento

- texto;
- áudio/transcrição;
- Marin TTS;
- imagem/visão;
- localização;
- mensagens não suportadas;
- cliente pedindo humano;
- falha OpenAI;
- orçamento de tokens;
- emergência/kill switch.

### Compra

- produto simples;
- cesta sem alteração;
- cesta personalizada;
- retirar/adicionar/alterar quantidade;
- estoque zero;
- preço alterado durante sessão;
- endereço;
- pedido duplicado;
- falha/timeout Bling;
- cancelamento/devolução;
- confirmação final.

### Experiência

- Sala mobile/desktop;
- Flow happy path;
- replay;
- stale state;
- chave inválida;
- sessão expirada;
- takeover humano durante Flow.

### Marketing

- opt-in WhatsApp;
- opt-out WhatsApp;
- template aprovado/rejeitado/pausado;
- carrossel;
- dedupe;
- compra reiniciando relógio de 10 dias;
- e-mail opt-in/unsubscribe;
- bounce/complaint;
- dois canais sem contato excessivo;
- produto esgotado entre seleção e envio;
- campanha pausada/kill switch.

### Segurança e operação

- Supabase Security Advisor;
- RLS e privilégios;
- secrets/Vault;
- logs sem PII desnecessária;
- rate limits;
- testes de carga moderada;
- limites Meta/Make/OpenAI/Bling;
- backup e restore;
- rollback;
- observabilidade e alertas;
- custos.

### Dispositivos

Testar aparelhos Android/iPhone reais, navegador móvel, desktop e WhatsApp Web.

## Critério de saída

Checklist de homologação 100% aprovado, incidentes críticos zerados e rollback provado.

---

# ETAPA 8 — Liberação controlada para uso + operação contínua

**Status atual: não iniciada como liberação total.**

## Objetivo

Passar da homologação para operação real sem big bang.

## Sequência

1. Congelar versões aprovadas e registrar release.
2. Confirmar backups e emergency stop.
3. Limpar cenários Make temporários/teste/legados.
4. Fechar PRs antigas que não pertencem mais ao caminho atual.
5. Liberar pedido+Bling inicialmente para allowlist/controlado.
6. Expandir atendimento IA gradualmente a partir do `live=1%`, somente após avaliação explícita a cada faixa.
7. Liberar Flow primeiro para grupo controlado.
8. Liberar marketing apenas depois do core de compra estável:
   - allowlist;
   - pequena amostra;
   - limite diário baixo;
   - acompanhar bloqueios/opt-outs/qualidade;
   - aumentar gradualmente.
9. Treinar operação do Admin/handoff/pedido/estoque/campanhas.
10. Criar rotina diária/semanal de saúde, custos e falhas.
11. Definir SLA de incidentes e rollback.
12. Após período estável, declarar a versão `Dona Antônia V1 — Produção Completa`.

## Critério final de projeto concluído

O projeto só deve ser chamado de completo quando estiverem simultaneamente comprovados:

```text
atendimento real estável
+ fallback humano
+ Sala/Flow estáveis
+ pedido real
+ Bling conciliado
+ estoque/preço/lote confiáveis
+ CRM atualizado por compra
+ relatórios operacionais
+ marketing WhatsApp controlado
+ e-mail marketing controlado
+ consentimento/opt-out ponta a ponta
+ testes finais aprovados
+ backups/rollback
+ monitoramento
+ operação treinada
```

---

# Ordem recomendada de execução

A ordem deve ser mantida exatamente como prioridade macro:

```text
1 Fundação/limpeza
→ 2 Pedido+Bling
→ 3 Experiência/Flow
→ 4 CRM
→ 5 Regras/lotes
→ 6 Marketing
→ 7 Testes finais
→ 8 Liberação
```

Marketing não deve atrasar o fechamento do pedido real, e não deve ser liberado antes de termos compras válidas alimentando o perfil do cliente.

---

# Decisão sobre o requisito novo

**SIM: já fazia parte do plano em versão inicial.**

O plano anterior previa recompra personalizada por WhatsApp a cada 15 dias. A decisão de 08/09/2026 altera e amplia esse requisito:

```text
15 dias → 10 dias
WhatsApp simples → preferência por template MARKETING carrossel aprovado pela Meta
cadência solta → reinicia a partir de cada compra válida
somente WhatsApp → WhatsApp + e-mail
perfil comercial → compartilhado pelos dois canais
```

Essa versão passa a ser a regra oficial de implementação futura.