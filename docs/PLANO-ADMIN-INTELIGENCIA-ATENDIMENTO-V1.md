# PLANO — Admin de Inteligência de Atendimento V1

Data: 07/09/2026

Status: **decisão arquitetural / planejamento somente**. Este documento não autoriza implementação automática.

## Decisão principal

Criar futuramente um **Gestor de Inteligência de Atendimento** no Admin da Dona Antônia.

A arquitetura recomendada é **híbrida**: não usar uma árvore gigante e rígida para toda a conversa e também não jogar todo o conhecimento em um prompt enorme deixando a IA totalmente livre.

O padrão observado em plataformas maduras de atendimento em 2026 é separar:

1. conhecimento/fatos;
2. orientações de comportamento;
3. procedimentos flexíveis;
4. fluxos determinísticos para casos críticos;
5. ações/ferramentas com dados vivos;
6. testes, métricas e controle de publicação.

Referências pesquisadas: Intercom Fin (Knowledge, Guidance, Workflows), Zendesk AI Agents (Knowledge, Use Cases, Generative Procedures, Scripted Dialogues), Botpress (Knowledge Bases, Autonomous Nodes, Standard Nodes), ManyChat (AI Steps, Flow Builder, Conditions).

## Princípio de controle em quatro níveis

### Nível 1 — Conhecimento

Informações factuais que a IA pode consultar para responder com flexibilidade.

Exemplos:
- identidade da empresa;
- regiões atendidas;
- horários;
- política de entrega;
- política de personalização de cestas;
- perguntas frequentes;
- regras gerais de pós-venda.

Não carregar todo esse conteúdo em toda chamada. Recuperar apenas os trechos relevantes para a pergunta atual.

### Nível 2 — Guidance / orientações

Instruções de comportamento em linguagem natural.

Exemplos:
- ser cordial, curta e natural;
- quando faltar contexto, fazer uma pergunta por vez;
- não inventar preço, estoque ou prazo;
- não pressionar depois de uma recusa;
- quando o cliente demonstrar pressa, reduzir perguntas e avançar para fechamento;
- quando houver conflito ou reclamação sensível, oferecer humano.

Guidance deve ser pequena, segmentada e aplicável somente aos casos em que faça sentido.

### Nível 3 — Procedimentos

Processos com uma sequência desejada, porém permitindo adaptação da IA.

Exemplos:
- montar pedido de cesta personalizada;
- confirmar endereço;
- descobrir necessidade do cliente;
- tratar produto indisponível;
- confirmar se uma dúvida foi resolvida;
- preparar handoff para humano.

O Admin deve permitir descrever o procedimento em linguagem natural e, futuramente, apresentar uma visualização em etapas/ramificações para revisão.

### Nível 4 — Regras determinísticas / respostas amarradas

Usar quando a resposta, mídia ou ação precisa ser exata e não deve depender da criatividade do modelo.

Exemplos:
- preço atual de cesta/produto;
- estoque;
- lista oficial de formas de pagamento;
- imagem oficial de uma cesta específica;
- cards/carrossel de cestas;
- política fiscal;
- criação/alteração de pedido;
- descontos válidos;
- entrega e taxa calculada;
- ações no Bling.

Nestes casos a IA identifica a intenção e o backend executa uma ação estruturada ou busca dados oficiais. A IA não deve inventar o conteúdo.

## Organização recomendada do Admin

### 1. Perfil da atendente

Campos para:
- nome/identidade do atendimento;
- tom de voz;
- estilo textual;
- tamanho preferido das respostas;
- uso de emojis;
- regras para áudio;
- idioma;
- frases/termos preferidos e proibidos.

### 2. Conhecimento da empresa

Conteúdo organizado por assunto e com status rascunho/publicado:
- empresa;
- cestas;
- produtos;
- entregas;
- pagamentos;
- atendimento;
- trocas/substituições;
- cancelamentos;
- promoções;
- pós-venda;
- dúvidas frequentes.

Cada item deve ter título, conteúdo canônico, tags/assuntos, prioridade, data de validade/revisão e canal aplicável.

### 3. Perguntas e respostas

FAQ canônico, sem necessidade de cadastrar centenas de variações de uma mesma pergunta.

Campos sugeridos:
- pergunta principal;
- resposta oficial;
- exemplos de formas como o cliente pode perguntar;
- assunto/intenção;
- fonte dos dados;
- se a resposta pode ser livre, controlada ou exata;
- validade;
- prioridade.

As variantes servem para teste e classificação; a recuperação semântica deve lidar com outras formas de perguntar.

### 4. Regras e orientações

Editor de instruções do tipo:

“Quando o cliente perguntar X, faça Y.”

Cada regra deve permitir classificar o nível de controle:
- orientação flexível;
- procedimento;
- regra obrigatória;
- bloqueio/proibição;
- escalonamento.

Também deve permitir escopo por canal, assunto, horário, tipo de cliente ou situação.

### 5. Respostas estruturadas e mídias

Catálogo de respostas/mídias oficiais vinculáveis a intenções e ações:
- imagem;
- galeria/carrossel;
- lista;
- botões;
- texto fixo;
- link para Sala de Compra;
- card de produto/cesta.

Exemplos:
- “valor das cestas” → buscar cestas atuais e enviar cards/imagens oficiais com valores atuais;
- “formas de pagamento” → enviar lista gerada a partir das formas de pagamento ativas;
- “foto da cesta grande” → enviar o asset oficial da cesta grande;
- “ofertas” → consultar ofertas vigentes, nunca uma lista fixa desatualizada.

### 6. Procedimentos / Roteirista Inteligente

É recomendável criar futuramente um **Roteirista Inteligente** no Admin.

O administrador descreve em português o comportamento desejado, por exemplo:

“Quando a pessoa perguntar sobre entrega, descubra o bairro. Se já souber o bairro na conversa, não pergunte de novo. Verifique se atendemos a região, informe prazo/taxa e, se não atendermos, explique com educação.”

O sistema deve sugerir a classificação correta:
- conhecimento;
- guidance;
- procedimento;
- regra rígida;
- ação/ferramenta.

Depois deve mostrar uma prévia visual do procedimento, detectar contradições e permitir teste antes de publicar.

Não obrigar o administrador a desenhar uma árvore enorme manualmente.

### 7. Dados vivos / ferramentas

Preço, estoque, produto, carrinho, pedido, cliente, entrega, promoções e horários calculáveis devem vir de dados oficiais/funções, e não de texto colocado no prompt.

A IA deve receber somente o resultado necessário para a pergunta atual.

### 8. Escalonamento humano

Configurar casos como:
- cliente pede humano;
- reclamação grave;
- dúvida não resolvida após tentativas;
- conflito de informação;
- suspeita de fraude;
- pedido/financeiro fora das regras;
- conteúdo sensível;
- erro operacional.

### 9. Simulador e testes

Antes de publicar conhecimento/regra/procedimento:
- simular perguntas;
- mostrar quais fontes/regras foram usadas;
- mostrar ação que seria executada;
- mostrar mídia que seria enviada;
- estimar tokens;
- detectar contradições;
- permitir casos de teste com resultado esperado;
- executar regressão após mudanças.

### 10. Métricas e custo

Painel futuro:
- conversas resolvidas;
- handoffs;
- perguntas sem resposta;
- regras acionadas;
- conteúdos mais usados;
- falhas de procedimento;
- tokens por conversa;
- tokens por tipo de chamada;
- custo estimado por canal/cliente/intenção;
- cache de prompt quando disponível;
- latência;
- uso de visão/transcrição/TTS.

## Estratégia de tokens / custo

Não montar um prompt gigante com todo o manual da empresa.

Estratégia recomendada:

```text
instruções globais pequenas e estáveis
+ contexto resumido da conversa
+ somente conhecimento relevante recuperado
+ somente dados vivos necessários
+ saída curta para WhatsApp
```

Metas de projeto sugeridas, não limites rígidos:
- instruções globais: manter compactas;
- recuperar poucos trechos relevantes por pergunta;
- resumir conversa antiga e preservar apenas fatos úteis;
- evitar repetir catálogos/listas grandes dentro do prompt;
- usar IDs e respostas estruturadas para mídia;
- colocar conteúdo estável no início do prompt e conteúdo variável no fim para favorecer prompt caching;
- registrar usage/cached tokens por chamada para otimização posterior.

Conhecimento longo pode usar recuperação semântica/RAG. Dados pequenos e estruturados devem preferir lookup direto no Postgres em vez de embeddings.

## Árvore completa vs IA livre

**Não usar nenhum dos extremos.**

Árvore rígida é adequada para:
- processos regulados/financeiros;
- decisões com várias condições exatas;
- ações com side effects;
- mensagens ricas específicas;
- checkout/pedido;
- casos em que a IA não pode se desviar.

IA flexível é adequada para:
- entender linguagem natural;
- perguntas abertas;
- reformular informação;
- esclarecer contexto;
- conversar naturalmente;
- identificar intenção.

Procedimentos híbridos cobrem o meio.

## Caso especial — foto de cartão

Não incentivar o cliente a enviar foto completa do cartão.

Uma imagem de cartão pode conter PAN, nome, validade e CVV. Imagens digitais com dados de cartão entram no escopo PCI DSS, e CVV não pode ser armazenado após autorização. Portanto, o desenho atual de mídia privada comum não deve ser usado sem tratamento específico para fotos de cartão.

Diretriz futura:
- preferir perguntar a bandeira por texto ou botões (Visa, Mastercard, Elo etc.);
- manter no Admin a lista estruturada de bandeiras/formas de pagamento aceitas;
- se uma foto de cartão chegar espontaneamente, tratá-la como **mídia sensível**;
- não persistir número completo/CVV;
- não registrar esses dados em logs, transcript, análise ou histórico;
- avaliar quarentena efêmera, detecção/redação e descarte imediato;
- armazenar no máximo o resultado necessário, por exemplo `bandeira=Elo`, se juridicamente/PCI aceitável;
- validar o desenho final com requisitos PCI/acquirer antes de ativar esse recurso.

## Itens essenciais de conhecimento para Dona Antônia

Priorizar futuramente:
- o que a empresa vende e o que não vende;
- regiões de entrega;
- dias/horários;
- prazo e regras de entrega;
- pagamento somente na entrega;
- formas de pagamento e bandeiras aceitas;
- personalização/troca de itens das cestas;
- preço próprio da cesta e regra de não mostrar preço individual dos componentes;
- estoque/preço sempre vindos do backend;
- ofertas vigentes;
- substituições de itens;
- alteração/cancelamento de pedido;
- indisponibilidade;
- reclamações e pós-venda;
- handoff humano;
- privacidade e mídia sensível;
- política para áudio/foto;
- aniversário/CRM somente quando essa fase for ativada.

## Conclusão

**Deve ser feito**, mas como um gestor híbrido de conhecimento + guidance + procedimentos + regras determinísticas + ferramentas, e não como um campo de prompt gigante ou uma árvore única.

O “Roteirista Inteligente” é viável e recomendável, desde que funcione como uma camada de autoria/validação que transforma instruções humanas em estruturas controláveis, testáveis e versionadas.

Implementação fica para etapa futura após definição detalhada de UX, modelo de dados, prioridades e critérios de publicação.