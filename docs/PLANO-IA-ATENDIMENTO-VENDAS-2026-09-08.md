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

- categoria do recurso;
- custo estimado;
- janela da conversa;
- provedor;
- custo adicional;
- política comercial;
- alternativa equivalente mais barata.

Regras fail-closed:

- custo adicional <= limite autorizado -> permitir;
- custo adicional > limite autorizado -> bloquear;
- custo desconhecido ou regra desatualizada -> bloquear e exigir validação;
- alternativa equivalente mais barata -> preferir alternativa;
- recurso novo Meta -> nasce bloqueado até validação de custo e regra vigente.

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

Função conceitual:

`next_best_action = decide(customer, intent, state, cart, history, inventory, pricing, delivery, commercial_rules, channel_cost, available_tools)`

Pipeline obrigatório:

1. receber mensagem/evento;
2. identificar cliente e recuperar contexto;
3. detectar intenção principal;
4. detectar estágio do funil;
5. avaliar comportamento atual do cliente;
6. consultar dados internos necessários;
7. gerar próximas ações possíveis;
8. eliminar ações proibidas por custo/política;
9. ranquear por chance de resolver e avançar a venda;
10. comprimir a resposta;
11. executar ou pedir somente o dado indispensável que falta;
12. registrar resultado para análise futura.

A IA pode interpretar intenção, linguagem, ambiguidade e contexto. Preço, estoque, margem, promessa de entrega, benefício, pedido e demais regras críticas continuam determinísticos e governados por Action Registry/guardrails.

## 4. Compressão comercial — P1

Antes de enviar, o agente deve avaliar se consegue resolver na mesma mensagem algo que geraria mais duas ou três interações.

A resposta consolidada deve continuar curta, clara e acionável.

Níveis conceituais:

- `A0`: responder diretamente;
- `A1`: responder + antecipar informações úteis;
- `A2`: executar ação reversível/segura + confirmar resultado;
- `A3`: resolver comercialmente com cálculo determinístico, alternativas e proposta concreta.

## 5. Classificação operacional do agente

Intenções iniciais:

`saudacao`, `consultar_preco`, `consultar_produto`, `consultar_cesta`, `comparar_cestas`, `criar_pedido`, `personalizar_cesta`, `alterar_pedido`, `repetir_pedido`, `consultar_entrega`, `consultar_status`, `reclamacao`, `cancelamento`, `pos_venda`, `falar_com_humano`.

Estágios comerciais:

`DESCOBERTA`, `INTERESSE`, `CONSIDERAÇÃO`, `MONTAGEM`, `NEGOCIAÇÃO`, `FECHAMENTO`, `SEPARAÇÃO`, `ENTREGA`, `PÓS-VENDA`, `RECOMPRA`.

Comportamento atual, nunca como rótulo permanente:

`OBJETIVO`, `INDECISO`, `SENSÍVEL_A_PREÇO`, `RECORRENTE`, `FALANTE`, `POUCO_DIGITAL`, `APRESSADO`, `DETALHISTA`, `NEGOCIADOR`, `INSATISFEITO`.

Memória comercial útil:

- marcas preferidas/rejeitadas;
- produtos frequentes;
- cestas e alterações anteriores;
- ticket/frequência/dia típico de compra;
- bairro/endereço confirmado;
- preferência texto/áudio;
- aceitação de links/Sala de Compra;
- sensibilidade a preço;
- reclamações anteriores.

## 6. Regras absolutas

- não perguntar o que o sistema já sabe;
- não pedir autorização para consultar histórico, estoque, preços, endereço ou alternativas internas;
- não pedir autorização para calcular solução;
- não finalizar/cancelar/comprometer o cliente sem confirmação quando irreversível ou obrigacional;
- não inventar estoque, preço, prazo, produto, endereço ou política;
- não fingir certeza diante de ambiguidade de produto, imagem ou áudio;
- não enviar várias mensagens quando uma só resolve;
- não fazer upsell desconectado da intenção atual;
- não obrigar troca de canal;
- não usar ferramenta acima da política de custo.

## 7. Cenários de comportamento que devem virar testes

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
- cross-sell comprimido -> no máximo uma sugestão altamente relacionada no resumo final.

## 8. Biblioteca versionada de treinamento e regressão — P2

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
- resposta ideal
- condição para handoff
- próximas respostas prováveis
- resultado esperado

Essa biblioteca deve alimentar CI/regressão e, futuramente, AutoQA da Etapa 18.

## 9. Métricas obrigatórias por conversa

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
- motivo de falha.

O objetivo é descobrir com dados reais quais respostas, ferramentas e estratégias aumentam conversão e reduzem custo, sem permitir que IA altere preço, segurança, custo, estoque ou finalização crítica por conta própria.

## 10. Prioridades técnicas

### P0

1. política de custo/whitelist de ferramentas;
2. estado de conversa e intenção;
3. contexto do cliente/CRM;
4. carrinho transacional;
5. catálogo + estoque + preço;
6. motor `next_best_action`.

### P1

1. compressão comercial;
2. Sala de Compra;
3. áudio e imagem com confidence/confirmação seletiva;
4. handoff humano com contexto completo.

### P2

1. substituições por preço, cross-sell, orçamento-alvo e recompra;
2. analytics de atendimento;
3. biblioteca de cenários/testes.

## 11. Mapeamento no roadmap oficial de 20 etapas

Este plano é transversal e deve ser incorporado sem reordenar etapas já aprovadas:

- Etapas 3–8: contexto omnichannel, CRM, adapters, Sala e canais;
- Etapa 9: Action Registry limita o que o agente pode executar;
- Etapa 10: Automation Engine executa workflows governados;
- Etapa 11: entrega e promessa entram como contexto determinístico;
- Etapa 12: margem, estoque, FEFO, substituição e benefícios entram como verdade comercial;
- Etapa 13: recebimento/conciliação passa a fazer parte do contexto comercial sem confundir `DELIVERED` com `PAID`;
- Etapa 15: cancelamento/pós-venda ganham ações governadas;
- Etapa 16: recorrência, recompra, afinidades, CRM preditivo e marketing permitido;
- Etapa 18: biblioteca de cenários vira base do AutoQA;
- Etapa 19: next-best-action e métricas alimentam Gerente IA/workload manager.

O núcleo P0 pode e deve evoluir incrementalmente durante as próximas etapas, sempre atrás de feature gates e sem ativação automática em produção.

## 12. Critérios de aceite transversais

- `quanto estão as cestas?` mostra imediatamente as opções relevantes;
- `quero igual da outra vez` recupera último pedido e apresenta cópia pronta;
- lista grande não gera confirmação item a item;
- dados internos podem ser consultados sem pedir permissão;
- ações irreversíveis continuam exigindo confirmação;
- cliente que rejeita link conclui pelo WhatsApp;
- nenhum caminho automatizado consegue acionar ferramenta acima do limite de custo;
- custo estimado/real e número de mensagens são registrados;
- handoff preserva contexto, carrinho e histórico;
- respostas são curtas, objetivas e orientadas à próxima decisão.

## 13. Invariantes de produção atuais

Este documento não autoriza ativação.

Continuam valendo:

- WhatsApp `live=1%` sem aumento sem autorização explícita;
- Flow/Data Exchange OFF;
- Experience Orchestrator OFF;
- Bling OFF/homologation-only;
- features novas nascem OFF;
- handoff humano tem precedência;
- preço, estoque, margem, pedido, prazo/entrega e finanças são determinísticos;
- recursos de custo desconhecido falham fechados.
