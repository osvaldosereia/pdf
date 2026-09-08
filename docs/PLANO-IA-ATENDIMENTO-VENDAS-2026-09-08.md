# Plano oficial — IA de Atendimento e Vendas Dona Antônia

Atualizado em 08/09/2026.

Status: **DIRETRIZ TRANSVERSAL OFICIAL DE PROGRAMAÇÃO**.

Este documento consolida para o repositório as decisões do planejamento de IA comercial fornecido pelo proprietário em 08/09/2026. Ele não substitui o roadmap de 20 etapas: funciona como especificação transversal do comportamento do agente comercial, do orquestrador e dos testes das etapas atuais e futuras.

## 1. Regra central

Quando a intenção do cliente estiver clara, o agente deve agir imediatamente. Não deve perguntar se pode mostrar, consultar ou calcular algo que o sistema já pode executar com segurança.

Perguntas só entram quando uma informação realmente faltar e impedir uma ação correta.

Princípios obrigatórios:

- reduzir ao mínimo as mensagens da empresa sem empobrecer o atendimento;
- antecipar, na mesma resposta, informações que provavelmente serão necessárias para a próxima decisão;
- nunca perguntar novamente algo que já exista em cadastro, histórico, carrinho, estoque, endereço ou contexto da conversa;
- usar WhatsApp como canal de conversa/orientação;
- usar a Sala de Compra para manipulações complexas, sem obrigar o cliente a sair do WhatsApp;
- manter a compra 100% possível pelo WhatsApp;
- confirmar ações irreversíveis ou que criem obrigação para o cliente;
- handoff humano quando solicitado, em reclamação grave, exceção comercial ou falha repetida da IA.

Modelo operacional:

`CLIENTE FALA -> IA ENTENDE -> SISTEMA CONSULTA/EXECUTA -> IA MOSTRA RESULTADO -> CLIENTE DECIDE`

## 2. Política de custo de canal e ferramentas — P0

A política de custo precisa existir em código, não apenas no prompt.

Requisito conceitual:

`policy.can_use(tool, context)`

Deve validar, no mínimo:

- canal;
- categoria do recurso;
- custo estimado atual;
- moeda/unidade de cobrança;
- janela da conversa;
- provedor;
- custo adicional;
- validade temporal da tabela de preços;
- política comercial;
- alternativa equivalente mais barata.

Exemplo conceitual — **os valores são configuração, nunca hardcode**:

```yaml
channel: whatsapp
category: service
current_cost: configurable
allowed: true

channel: whatsapp
category: marketing
current_cost: configurable
allowed: false
```

Regras fail-closed:

- custo adicional <= limite autorizado -> permitir;
- custo adicional > limite autorizado -> bloquear;
- custo desconhecido, vencido ou regra desatualizada -> bloquear e exigir validação;
- alternativa equivalente mais barata -> preferir alternativa;
- recurso novo Meta/BSP -> nasce bloqueado até validação de custo e regra vigente.

A IA nunca recebe liberdade para contratar/acionar recurso mais caro fora da whitelist.

Whitelist inicial conceitual:

- `WHATSAPP_STANDARD_TEXT`
- `WHATSAPP_STANDARD_IMAGE`
- `WHATSAPP_STANDARD_AUDIO`
- `WHATSAPP_STANDARD_DOCUMENT`
- `WHATSAPP_STANDARD_BUTTONS`
- `WHATSAPP_STANDARD_LIST`
- `WHATSAPP_STANDARD_PRODUCT_PRESENTATION`
- `SALA_DE_COMPRA`
- `CATALOGO`
- `CRM`
- `CARRINHO`
- `ESTOQUE`
- `ENTREGA`
- `BLING_INTERNO`
- `IA_INTERNA`
- `HUMAN_HANDOFF`

Bloqueios padrão incluem recursos Meta/BSP com cobrança adicional não autorizada, custo desconhecido ou sem necessidade técnica.

## 3. Motor de decisão comercial — P0

O agente deve evoluir para um motor de `next_best_action`, reutilizando o AI Action Registry, Automation Engine e os domínios determinísticos já existentes.

Objeto conceitual de decisão:

- `customer`
- `intent`
- `conversation_state`
- `funnel_stage`
- `cart`
- `history`
- `catalog`
- `inventory`
- `pricing`
- `delivery`
- `commercial_rules`
- `channel_cost`
- `available_tools`
- `action_risk`
- `confidence`
- `missing_information`

Função conceitual:

`next_best_action = decide(customer, intent, state, cart, history, inventory, pricing, delivery, commercial_rules, channel_cost, available_tools, action_risk, confidence)`

Pipeline obrigatório:

1. receber mensagem/evento;
2. identificar cliente e recuperar contexto;
3. detectar intenção principal;
4. detectar estágio do funil;
5. avaliar comportamento atual do cliente;
6. identificar o que já sabemos e o que realmente falta;
7. consultar dados internos necessários;
8. gerar próximas ações possíveis;
9. eliminar ações proibidas por custo/política/risco;
10. ranquear por probabilidade de resolver corretamente a necessidade e avançar a venda;
11. aplicar política de confiança;
12. comprimir a resposta sem aumentar carga cognitiva;
13. executar ou pedir somente o dado indispensável que falta;
14. registrar decisão, custo, confiança, resultado e eventual correção humana.

A IA pode interpretar intenção, linguagem, ambiguidade e contexto. Preço, estoque, margem, promessa de entrega, benefício, pedido e demais regras críticas continuam determinísticos e governados por Action Registry/guardrails.

## 4. Compressão comercial — P1

**Minimizar interações não significa maximizar informação por mensagem.**

O objetivo é:

> **menor número de mensagens necessárias + menor carga cognitiva possível.**

Antes de enviar, o agente deve avaliar se consegue resolver na mesma mensagem algo que geraria mais duas ou três interações, mas não deve despejar informações que não ajudam a próxima decisão.

Exemplo correto:

- cliente pergunta preço de cesta -> mostrar as principais cestas com nome, preço, imagem e próxima ação;
- não anexar composição extensa, política inteira de entrega e informações irrelevantes na mesma mensagem.

A resposta consolidada deve continuar curta, clara e acionável.

Níveis conceituais:

- `A0`: responder diretamente;
- `A1`: responder + antecipar informações úteis;
- `A2`: executar ação reversível/segura + confirmar resultado;
- `A3`: resolver comercialmente com cálculo determinístico, alternativas e proposta concreta.

## 5. Ações seguras e ações que exigem confirmação

A classificação de risco da ação deve existir em código/Action Registry e nunca depender somente do texto gerado pelo modelo.

### Pode executar automaticamente quando autorizado e reversível

- consultar estoque;
- consultar preço;
- recuperar histórico;
- montar simulação;
- comparar alternativas;
- criar carrinho provisório/rascunho;
- calcular economia;
- localizar produto;
- sugerir substituição;
- consultar capacidade/entrega;
- consultar preferências já conhecidas.

### Exige confirmação explícita

- finalizar venda;
- enviar pedido ao Bling;
- cancelar pedido;
- alterar pedido já confirmado;
- alterar endereço definitivo;
- aplicar desconto excepcional;
- confirmar entrega;
- qualquer ação financeira/fiscal irreversível ou que gere obrigação.

A política deve considerar também autonomia A/B/C/D do AI Action Registry, reversibilidade, valor financeiro, idempotência e estado atual do pedido.

## 6. Política de confiança

A IA deve produzir/consumir confiança para identificação de intenção, produto, referência histórica, imagem, áudio e interpretação de pedidos implícitos.

Os limiares são **configuráveis/versionados**. Valores iniciais sugeridos para homologação:

```text
confidence >= 0.90
→ agir se a ação for segura/reversível

0.60 <= confidence < 0.90
→ agir apenas quando reversível, mostrando claramente o que foi entendido e oferecendo correção rápida

confidence < 0.60
→ perguntar somente o ponto ambíguo
```

Exemplo:

- `"2 daquele arroz de sempre"` + histórico muito consistente -> alta confiança; adicionar ao carrinho provisório e informar qual produto foi usado;
- `"aquele sabão azul"` + quatro candidatos plausíveis -> baixa confiança; perguntar qual deles.

Nenhum limiar deve permitir bypass de confirmação em ação irreversível.

## 7. Classificação operacional do agente

Intenções iniciais:

`saudacao`, `consultar_preco`, `consultar_produto`, `consultar_cesta`, `comparar_cestas`, `criar_pedido`, `personalizar_cesta`, `alterar_pedido`, `repetir_pedido`, `consultar_entrega`, `consultar_status`, `reclamacao`, `cancelamento`, `pos_venda`, `falar_com_humano`.

Estágios comerciais:

`DESCOBERTA`, `INTERESSE`, `CONSIDERAÇÃO`, `MONTAGEM`, `NEGOCIAÇÃO`, `FECHAMENTO`, `SEPARAÇÃO`, `ENTREGA`, `PÓS-VENDA`, `RECOMPRA`.

Comportamento atual, nunca como rótulo permanente:

`OBJETIVO`, `INDECISO`, `SENSÍVEL_A_PREÇO`, `RECORRENTE`, `FALANTE`, `POUCO_DIGITAL`, `APRESSADO`, `DETALHISTA`, `NEGOCIADOR`, `INSATISFEITO`.

## 8. Memória comercial útil

O sistema deve guardar **memória comercial útil e sustentada por evidência**, não simplesmente tudo o que o cliente diz.

Exemplos úteis:

- marcas preferidas/rejeitadas;
- produtos frequentes;
- cestas e alterações anteriores;
- ticket/frequência/dia típico de compra;
- bairro/endereço confirmado;
- preferência texto/áudio;
- aceitação de links/Sala de Compra;
- sensibilidade a preço;
- reclamações anteriores;
- intervalo típico entre compras;
- aceitação de substituições;
- categorias frequentemente combinadas;
- preferência por quantidade/tamanho em vez de marca.

Cada memória deve ter, quando aplicável:

- fonte/evidência;
- força/confiança;
- data da última confirmação;
- número de ocorrências;
- possibilidade de expirar/enfraquecer;
- escopo: cliente/produto/categoria/canal.

Comentário ocasional não vira preferência permanente automaticamente.

## 9. Pedido implícito e intenção acionável

O agente deve reconhecer linguagem que indica uma necessidade comercial mesmo sem verbo explícito de compra.

Exemplos:

- `"tá faltando óleo aqui em casa"` -> consultar histórico/catalogo/estoque e apresentar o óleo habitual ou alternativa apropriada, com ação de adicionar;
- `"mês passado comprei uma cesta boa aí"` -> recuperar pedido/cesta provável e mostrar o resultado;
- `"acabou meu sabão"` -> oferecer opção histórica ou relevante, sem responder apenas com empatia vazia.

Pedido implícito continua sujeito a política de confiança e risco. Se a referência for ambígua, pergunta-se somente o ponto necessário.

## 10. Ordem oficial de objetivos do agente

O agente deve otimizar nesta ordem:

1. **resolver corretamente a necessidade**;
2. **tornar a compra fácil**;
3. **fechar a venda**;
4. **aumentar ticket quando fizer sentido**.

Upsell/cross-sell nunca pode prejudicar verdade, conveniência, orçamento declarado, margem mínima, disponibilidade ou confiança do cliente.

Se o cliente declara orçamento, o sistema deve tentar maximizar adequação dentro daquele orçamento em vez de insistir em produto mais caro.

Se não houver estoque ou capacidade para entrega, deve informar a verdade e oferecer alternativa possível; nunca prometer algo inviável para fechar a venda.

## 11. Regras absolutas

- não perguntar o que o sistema já sabe;
- não pedir autorização para consultar histórico, estoque, preços, endereço ou alternativas internas;
- não pedir autorização para calcular solução;
- não finalizar/cancelar/comprometer o cliente sem confirmação quando irreversível ou obrigacional;
- não inventar estoque, preço, prazo, produto, endereço ou política;
- não fingir certeza diante de ambiguidade de produto, imagem ou áudio;
- não enviar várias mensagens quando uma só resolve;
- não transformar uma mensagem em um relatório gigante apenas para economizar interações;
- não fazer upsell desconectado da intenção atual;
- não insistir acima do orçamento declarado;
- não obrigar troca de canal;
- não usar ferramenta acima da política de custo.

## 12. Cenários de comportamento que devem virar testes

Casos prioritários:

- pergunta de preço das cestas -> mostrar opções imediatamente, sem pergunta intermediária;
- escolha por valor -> identificar cesta única, selecionar e oferecer `FECHAR/PERSONALIZAR`;
- repetir compra -> recuperar último pedido, recalcular e criar rascunho;
- consulta de produto -> mostrar opções relevantes, preços e tamanhos;
- pedido com preferência histórica -> usar preferência forte conhecida e permitir troca;
- lista grande por texto -> adicionar itens de alta confiança e perguntar ambiguidades em bloco;
- lista por áudio -> transcrever, cruzar histórico e montar pedido;
- compra por orçamento -> gerar primeira proposta concreta sem questionário longo;
- orçamento com restrição -> respeitar restrição já explícita;
- objeção de preço -> buscar substituições, calcular economia e apresentar proposta;
- troca de composição -> simular substituição e mostrar novo total;
- personalização grande -> sugerir Sala de Compra, sem obrigar;
- cliente não quer link -> concluir integralmente no WhatsApp;
- foto de lista -> extrair itens legíveis e perguntar somente ambiguidades;
- área de entrega -> responder sim/não sem pedir endereço completo prematuramente;
- entrega hoje -> usar endereço conhecido/capacidade/estoque antes de perguntar;
- endereço recorrente -> mostrar endereço salvo e permitir alteração;
- promoções -> apresentar ofertas atuais permitidas imediatamente;
- cross-sell contextual -> vender sem tirar o cliente do fluxo;
- cross-sell comprimido -> no máximo uma sugestão altamente relacionada no resumo final;
- pedido implícito -> converter necessidade em próxima ação quando confiança permitir;
- baixa confiança -> perguntar somente o termo ambíguo;
- ação irreversível -> sempre exigir confirmação mesmo com confiança alta;
- custo desconhecido -> bloquear ferramenta e escolher alternativa segura/barata.

## 13. Biblioteca versionada de treinamento e regressão — P2

Criar biblioteca de 100–200 cenários comerciais versionados.

Estrutura mínima por cenário:

- `scenario_id`
- entrada do cliente
- contexto conhecido
- intenção esperada
- estágio do funil
- comportamento detectado
- dados consultáveis
- ações permitidas
- ações proibidas
- ferramenta preferida
- limite de custo
- nível de risco da ação
- confiança mínima esperada
- resposta ideal
- carga cognitiva máxima/forma de apresentação esperada
- condição para handoff
- próximas respostas prováveis
- resultado esperado.

Essa biblioteca deve alimentar CI/regressão e, futuramente, AutoQA da Etapa 18.

## 14. Métricas obrigatórias por conversa e aprendizado futuro

- venda concluída;
- tempo para primeira resposta;
- mensagens enviadas pela empresa;
- mensagens recebidas;
- perguntas desnecessárias;
- intervenção humana;
- ticket;
- margem;
- upsell/cross-sell;
- custo WhatsApp/Meta;
- custo de IA;
- abandono;
- tempo até fechamento;
- motivo de falha;
- confiança das decisões;
- correções do cliente depois de uma ação por confiança;
- sugestões aceitas/rejeitadas;
- substituições aceitas/rejeitadas;
- produtos comprados em conjunto;
- canal/modalidade de resposta com melhor resultado por contexto;
- custo operacional por venda válida.

O aprendizado futuro deve usar evidência real para descobrir:

- quais respostas fecham mais vendas;
- em quais pontos clientes abandonam;
- quais sugestões e substituições são aceitas;
- quais produtos vendem juntos;
- quais clientes/contextos funcionam melhor com áudio/texto;
- momento mais eficiente de recompra;
- estratégias que aumentam conversão sem deteriorar margem, custo ou satisfação.

Mudanças aprendidas não podem alterar autonomamente regras críticas. Devem passar por política, testes controlados, versão e aprovação/autonomia configurada.

## 15. Prioridades técnicas

### P0

1. Cost Policy Engine configurável/versionado;
2. política de ação segura/confirmação;
3. política de confiança;
4. estado de conversa e intenção;
5. contexto do cliente/CRM;
6. carrinho transacional;
7. catálogo + estoque + preço;
8. motor `next_best_action`.

### P1

1. compressão comercial com limite de carga cognitiva;
2. Sala de Compra;
3. áudio e imagem com confidence/confirmação seletiva;
4. handoff humano com contexto completo;
5. memória comercial útil com evidência e decaimento.

### P2

1. substituições por preço, cross-sell, orçamento-alvo e recompra;
2. analytics de atendimento/aprendizado;
3. biblioteca de cenários/testes;
4. otimização baseada em evidência real, sempre dentro dos guardrails.

## 16. Mapeamento no roadmap oficial de 20 etapas

Este plano é transversal e deve ser incorporado sem reordenar etapas já aprovadas:

- Etapas 3–8: contexto omnichannel, CRM, adapters, Sala e canais;
- Etapa 9: Action Registry limita o que o agente pode executar e classifica risco/reversibilidade;
- Etapa 10: Automation Engine executa workflows governados; Cost Policy/Next Best Action devem reutilizar essa governança;
- Etapa 11: entrega e promessa entram como contexto determinístico;
- Etapa 12: margem, estoque, FEFO, substituição e benefícios entram como verdade comercial;
- Etapa 13: recebimento/conciliação passa a fazer parte do contexto comercial sem confundir `DELIVERED` com `PAID`;
- Etapa 15: cancelamento/pós-venda ganham ações governadas;
- Etapa 16: recorrência, recompra, afinidades, CRM preditivo e marketing permitido;
- Etapa 18: biblioteca de cenários, correções e métricas viram base do AutoQA;
- Etapa 19: next-best-action, custo e métricas alimentam Gerente IA/workload manager.

O núcleo P0 pode e deve evoluir incrementalmente durante as próximas etapas, sempre atrás de feature gates e sem ativação automática em produção.

## 17. Critérios de aceite transversais

- `quanto estão as cestas?` mostra imediatamente as opções relevantes sem sobrecarregar a resposta;
- `quero igual da outra vez` recupera último pedido e apresenta cópia pronta;
- lista grande não gera confirmação item a item;
- dados internos podem ser consultados sem pedir permissão;
- ações irreversíveis continuam exigindo confirmação;
- confiança alta pode automatizar apenas ações seguras/reversíveis;
- confiança baixa pergunta somente o ponto ambíguo;
- pedido implícito gera ação útil quando houver contexto confiável;
- cliente que rejeita link conclui pelo WhatsApp;
- nenhum caminho automatizado consegue acionar ferramenta acima do limite de custo;
- custo desconhecido falha fechado;
- custo estimado/real e número de mensagens são registrados;
- handoff preserva contexto, carrinho e histórico;
- respostas são curtas, objetivas e orientadas à próxima decisão;
- o agente respeita orçamento declarado e nunca promete estoque/prazo inexistente;
- upsell fica abaixo de resolução, facilidade e fechamento na ordem de objetivos.

## 18. Invariantes de produção atuais

Este documento não autoriza ativação.

Continuam valendo:

- WhatsApp `live=1%` sem aumento sem autorização explícita;
- Flow/Data Exchange OFF;
- Experience Orchestrator OFF;
- Bling OFF/homologation-only;
- features novas nascem OFF;
- handoff humano tem precedência;
- preço, estoque, margem, pedido, prazo/entrega e finanças são determinísticos;
- recursos de custo desconhecido falham fechados;
- preços e limiares de custo/confiança são configuração versionada, nunca hardcode de negócio.
