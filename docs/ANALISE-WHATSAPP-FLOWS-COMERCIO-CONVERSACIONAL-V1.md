# Dona Antônia — Análise de WhatsApp Flows e Comércio Conversacional V1

Data: 07/09/2026

Status: **PLANEJAMENTO APROVADO PARA APERFEIÇOAMENTO FUTURO**.

Este documento registra a análise dos três relatórios fornecidos pelo proprietário:

- `relatorio-funil-flow-cesta-dona-antonia(1).pdf`;
- `relatorio-whatsapp-da-lu-magalu-dona-antonia(1).pdf`;
- `Relatório Estratégico — Comércio Conversacional na Dona Antônia(1).pdf`.

Não representa autorização para alterar o canary real atual, ativar Bling ou implementar Flow imediatamente. O canary WhatsApp `live=1%` deve continuar sendo monitorado isoladamente.

---

# 1. Decisão arquitetural

**WhatsApp Flow deve ser incorporado ao roadmap da Dona Antônia, mas como uma interface especializada — não como substituto da conversa, da Sala de Compra ou do catálogo personalizado.**

A arquitetura alvo passa a tratar cada interface como uma ferramenta com missão própria:

```text
Cliente
  ↓
WhatsApp / Sala
  ↓
Orquestrador Comercial da Dona Antônia
  ├─ conversa natural
  ├─ resposta determinística
  ├─ carrossel
  ├─ WhatsApp Flow
  ├─ Sala / vitrine personalizada
  └─ humano
  ↓
Backend determinístico
  ↓
catálogo / preços / estoque / regras / carrinho
  ↓
Bling, quando a etapa transacional for posteriormente homologada
```

Princípio central:

> **A IA entende o cliente e escolhe a melhor próxima experiência; o backend controla fatos, regras, candidatos e transações.**

O Flow entra quando uma decisão possui várias escolhas estruturadas e seria cansativa ou ambígua em uma sequência longa de mensagens.

---

# 2. O que a pesquisa confirma

Os relatórios convergem em alguns pontos importantes:

1. um chatbot que tenta fazer toda a venda por texto gera atrito em tarefas com muitas escolhas;
2. Flow é especialmente adequado para coleta estruturada, personalização, quantidades, confirmação e decisões curtas;
3. carrossel é melhor para poucas recomendações visuais e rápidas;
4. Sala/vitrine web continua superior quando existe um universo maior de produtos, marcas, fotos e comparação;
5. a IA deve reduzir o universo de escolhas antes de abrir qualquer interface visual;
6. catálogo, preços, estoque, descontos e regras comerciais não podem vir da memória do modelo;
7. rollout deve ser gradual e mensurado;
8. o valor está na orquestração entre interfaces, e não no Flow isoladamente.

A referência estratégica mais importante do estudo do Magalu é a separação entre “cérebro” e canal: o WhatsApp é uma interface comercial; as regras e a inteligência devem permanecer independentes do canal.

Essa direção combina diretamente com a arquitetura modular que já está sendo construída na Dona Antônia.

---

# 3. Não copiar o Magalu literalmente

A pesquisa do “WhatsApp da Lu” é útil como referência de produto, mas não devemos replicar sua complexidade.

Não há necessidade, neste estágio, de:

- dezenas de agentes;
- múltiplos LLMs por padrão;
- arquitetura proprietária semelhante à de um varejista nacional;
- um catálogo gigantesco dentro do WhatsApp;
- criar um Flow diferente para cada cliente.

A Dona Antônia pode alcançar a mesma ideia conceitual com uma arquitetura muito mais simples:

```text
Orquestrador leve
+ ferramentas especializadas
+ backend determinístico
+ Flow reutilizável e dinâmico
+ carrossel
+ Sala de Compra
+ memória/CRM controlados
```

Multiagentes e modelos adicionais só devem ser adicionados se métricas reais demonstrarem necessidade.

---

# 4. Matriz oficial de escolha de interface

O futuro Orquestrador Comercial deve escolher a interface de acordo com o tipo de decisão.

| Situação | Interface preferencial | Motivo |
|---|---|---|
| FAQ simples | resposta determinística / conversa | menor custo e menor latência |
| pergunta aberta ou contexto | IA conversacional | entende linguagem natural |
| 2–5 recomendações relevantes | carrossel | decisão visual rápida |
| editar cesta com vários itens/quantidades | Flow | tarefa estruturada |
| montar lista com várias categorias/quantidades | Flow | reduz dezenas de mensagens |
| comparar muitas marcas/opções | Sala/vitrine personalizada | navegação visual mais rica |
| explorar seção grande do catálogo | Sala/vitrine personalizada | Flow não deve virar catálogo gigante |
| exceção, baixa confiança ou problema | humano | segurança e confiança |
| validação final de pedido | backend determinístico | preço/estoque/regras reais |

Não definir apenas um limite numérico rígido. A seleção futura deverá considerar quantidade de opções, necessidade de fotos, complexidade da decisão, urgência, perfil do cliente e histórico de abandono.

---

# 5. Flow prioritário: personalização da cesta

O primeiro Flow que vale a pena implementar futuramente é **Personalizar Cesta**.

Ele se encaixa exatamente no problema central da empresa: clientes querem aumentar, diminuir, retirar ou trocar itens antes de encomendar.

## 5.1 Entrada

A conversa continua sendo a porta de entrada.

Exemplo:

```text
Cliente: “Somos quatro pessoas, não usamos açúcar e tomamos muito café.”
```

A IA extrai contexto, mas não calcula preço nem altera produtos sozinha.

O backend seleciona uma cesta candidata e responde com uma ação clara:

```text
[ Personalizar esta cesta ]
[ Ver outra opção ]
```

## 5.2 Conteúdo do Flow

Para as cestas da Dona Antônia, preservar as regras comerciais já definidas:

- mostrar a **foto quadrada da cesta**;
- mostrar nome dos componentes;
- mostrar quantidade de cada componente;
- permitir aumentar/diminuir/remover conforme regras;
- permitir substituições somente quando autorizadas pelo backend;
- **não mostrar preço individual dos componentes**;
- **não calcular o preço da cesta como soma dos itens**.

A cesta possui preço comercial próprio. O ajuste comercial deve usar o motor determinístico de cestas; nunca a soma visual dos componentes e nunca a IA.

## 5.3 Flow reutilizável

Não criar um novo Flow para cada cliente.

O desenho recomendado é:

```text
Flow publicado e versionado
+ sessão única
+ payload dinâmico do backend
+ dados daquela cesta/conversa
```

A sessão deve fornecer somente os itens e opções válidas para aquele caso.

---

# 6. Segundo uso: “Montar minha compra”

Além da cesta, existe um segundo caso forte para Flow: clientes que enviam uma necessidade ampla de mercado.

Exemplo:

```text
“Preciso de arroz, feijão, café, limpeza e algumas bebidas.”
```

Em vez de a IA perguntar item por item, um Flow pode coletar:

1. seções de interesse;
2. produtos genéricos;
3. quantidades;
4. preferências relevantes.

Neste estágio o cliente não precisa necessariamente escolher a marca.

Depois o sistema pode usar:

- carrossel quando há poucas alternativas;
- Sala/vitrine quando há muitas marcas/fotos/opções.

Assim o Flow resolve **estrutura**, e a vitrine resolve **descoberta/comparação**.

---

# 7. Carrossel não é Flow

Carrossel deve continuar existindo como ferramenta própria.

Uso ideal:

- poucas cestas recomendadas;
- poucas ofertas;
- alternativas de uma categoria;
- produtos complementares de alta relevância;
- escolha visual sem necessidade de formulário complexo.

Regra:

> Carrossel mostra poucas opções boas. Não reproduz um catálogo inteiro.

Se o número de opções crescer ou o cliente quiser comparar marcas livremente, migrar para a Sala/vitrine.

---

# 8. Sala de Compra continua estratégica

Os relatórios não invalidam a Sala de Compra. Pelo contrário: ajudam a definir melhor quando ela deve aparecer.

A Sala é a interface correta para:

- seções grandes;
- muitas fotos;
- dezenas de produtos;
- comparação de marcas;
- navegação mais livre;
- carrinho visual persistente;
- continuidade entre WhatsApp e web.

Conceito futuro:

```text
WhatsApp conversa
→ IA reduz intenção
→ Flow coleta escolhas estruturadas quando necessário
→ Sala apresenta somente o universo visual restante
```

A Sala deixa de ser “catálogo geral” e passa a ser uma **vitrine temporária da intenção daquele cliente**.

---

# 9. Flow 2 — upsell/cross-sell: aprovado, mas não para o primeiro piloto

A ideia de um segundo Flow de complementos é boa, mas deve entrar somente depois que o Flow principal estiver comprovado.

Missões separadas:

```text
Flow 1 = resolver a necessidade principal / conversão
Flow 2 = aumentar ticket sem prejudicar conversão
```

O segundo Flow deve ser opcional e aberto apenas quando houver oportunidade relevante.

Não abrir quando:

- cliente disser que está com orçamento apertado;
- demonstrar pressa;
- pedir para finalizar;
- já tiver recusado oferta;
- confiança da recomendação for baixa;
- compra já possuir produtos equivalentes em quantidade suficiente.

O cliente deve sempre ter caminho claro para:

```text
[ Ver opções ]
[ Finalizar sem adicionais ]
```

Sem insistência após recusa.

---

# 10. Motor de recomendação: regra + IA, não IA livre

Não pedir à OpenAI que “invente” produtos para upsell.

Fluxo correto:

```text
carrinho/contexto
→ backend consulta catálogo real
→ regras produzem candidatos permitidos
→ ranking comercial
→ IA escolhe como explicar/apresentar
```

Exemplo:

```text
Cesta + café
→ backend pode produzir: leite, biscoito, filtro, achocolatado
→ IA escolhe os mais coerentes e redige a abordagem
```

A IA nunca cria candidato inexistente.

---

# 11. Orquestrador Comercial — evolução do “Cérebro Dona Antônia”

O projeto deve evoluir para um orquestrador de próxima ação.

Entrada:

- intenção;
- estágio da conversa;
- carrinho atual;
- preferências permitidas;
- histórico permitido;
- quantidade de opções;
- urgência/pressa;
- orçamento declarado;
- confiança da classificação;
- estado operacional.

Saída estruturada, por exemplo:

```json
{
  "next_interface": "flow|carousel|shopping_room|conversation|human",
  "mission": "customize_basket",
  "reason": "multi_item_structured_choice",
  "payload_ref": "server-side-id"
}
```

A decisão final deve ser validada pelo backend antes de qualquer ação.

---

# 12. Contrato de sessão do Flow

Quando chegar a implementação, criar um contrato versionado, e não campos soltos.

Exemplo conceitual:

```text
flow_session_id
conversation_id
customer_id
mission
basket_id / cart_id
current_stage
allowed_items[]
allowed_quantities
allowed_substitutions[]
commercial_rules_version
expires_at
return_action
```

Não colocar secrets ou regras sensíveis no payload do cliente.

Toda resposta recebida do Flow deve ser tratada como **entrada não confiável** e revalidada server-side.

---

# 13. Economia de tokens e custo

Flow pode reduzir custo de IA se for usado corretamente.

Evitar:

```text
IA pergunta arroz?
cliente responde
IA pergunta quantidade?
cliente responde
IA pergunta feijão?
...
```

Preferir:

```text
IA entende a missão uma vez
→ Flow coleta 10–20 escolhas estruturadas
→ backend valida
→ IA recebe somente o resumo final
```

Regras de custo:

1. não chamar LLM a cada campo/tela;
2. não enviar catálogo completo ao modelo;
3. não pedir à IA para interpretar visualmente o resultado do Flow;
4. receber resultados estruturados diretamente;
5. usar backend para regras e cálculos;
6. usar IA antes do Flow para contexto e depois do Flow para comunicação/ranking;
7. medir tokens por missão e por pedido.

O futuro Admin deve conseguir comparar:

```text
IA sem Flow: mensagens + tokens + tempo
IA + Flow: mensagens + tokens + tempo
```

---

# 14. Métricas obrigatórias

Toda implementação de Flow deve nascer instrumentada.

## Flow 1

- convite exibido;
- taxa de abertura/aceitação;
- conclusão;
- abandono por tela;
- tempo no Flow;
- erros de Data Exchange;
- retorno ao WhatsApp;
- conversão em pedido;
- mensagens necessárias por pedido;
- tempo total para fechamento;
- solicitação de humano;
- satisfação.

## Comercial

- ticket médio;
- itens por pedido;
- alterações médias por cesta;
- taxa de personalização;
- taxa de substituição;
- custo de atendimento/pedido.

## Flow 2

- convite ao upsell;
- aceitação;
- conclusão;
- attach rate;
- receita incremental;
- abandono após oferta;
- recusa;
- impacto na conversão principal.

Métrica importante: **o Flow 2 só é bom se aumentar valor sem aumentar abandono de forma prejudicial.**

---

# 15. Experimento recomendado

Não liberar tudo de uma vez.

Primeiro experimento:

```text
Grupo A = IA + conversa atual
Grupo B = IA + Flow 1 de personalização
```

Comparar:

- conversão;
- tempo;
- mensagens;
- abandono;
- ticket;
- satisfação;
- custo/tokens;
- humano solicitado.

Somente depois:

```text
B1 = Flow 1 sem upsell
B2 = Flow 1 + Flow 2 opcional
```

Isso permite saber se o segundo Flow gera receita incremental ou apenas atrito.

---

# 16. Integração com o futuro Gestor de Inteligência do Admin

A análise de Flow deve ser integrada ao futuro `PLANO-ADMIN-INTELIGENCIA-ATENDIMENTO-V1.md`.

O Admin deverá permitir configurar, com auxílio da própria IA:

- missão de cada Flow;
- situações em que pode ser sugerido;
- situações em que deve ser proibido;
- texto de convite;
- versão publicada;
- regras de retorno;
- fallback se o Flow falhar;
- quais categorias/cestas podem usar;
- threshold de recomendação;
- quando usar carrossel;
- quando abrir Sala;
- quando chamar humano;
- métricas e A/B tests.

Exemplo de configuração em linguagem natural:

```text
“Quando o cliente quiser personalizar uma cesta e houver mais de quatro alterações possíveis, sugira o Flow. Se ele estiver com pressa, não abra; continue pelo chat.”
```

A IA do Admin pode transformar a orientação em uma regra estruturada e mostrar uma simulação antes de publicar.

---

# 17. Memória e personalização

A pesquisa do Magalu reforça uma evolução de “entender a mensagem” para “entender o cliente”.

Isso combina com o roadmap de CRM da Dona Antônia:

- marcas preferidas;
- itens recorrentes;
- itens que costuma retirar da cesta;
- frequência de recompra;
- sensibilidade a preço;
- categorias de interesse;
- respostas a upsell;
- preferência por texto/áudio;
- endereços previamente confirmados;
- aniversário, quando coletado com finalidade clara.

Essa memória deve ter governança e nunca ser confundida com liberdade para inventar fatos.

---

# 18. Conflitos entre os relatórios e regras atuais do projeto

Os relatórios contêm exemplos conceituais que **não substituem decisões comerciais já tomadas**.

## 18.1 Pagamento

Alguns exemplos citam Pix durante o funil. A regra atual da Dona Antônia é:

> **pagamento somente na entrega.**

Portanto o futuro Flow deve apenas registrar a forma de pagamento aceita para a entrega conforme cadastro oficial da empresa. Não implementar cobrança antecipada baseado nesses relatórios.

## 18.2 Preço de cesta

Alguns exemplos apresentam totais simulados de itens. Para cesta básica, permanece obrigatório:

- preço comercial próprio da cesta;
- componentes sem preço individual para o cliente;
- diferença comercial/fiscal tratada deterministicamente;
- IA não calcula diferença.

## 18.3 Bling

Os relatórios tratam Bling como fonte comercial operacional. No projeto real, **Bling continua fora do canary atual** e só será ativado após homologação controlada específica.

## 18.4 CPF/dados extras

Não coletar dados apenas porque aparecem em exemplos de funil. Solicitar somente o necessário para entrega/operação/fiscalidade quando realmente aplicável.

---

# 19. Segurança e políticas

Antes de implementar qualquer Flow real, revisar a documentação oficial atual da Meta/WhatsApp no momento da implementação.

Regras mínimas:

- Flow publicado/versionado;
- Data Exchange autenticado server-to-server quando utilizado;
- sessão curta e expirada;
- payload mínimo;
- nenhuma service-role/API key no cliente;
- dados do Flow sempre revalidados;
- idempotência na submissão;
- proteção contra replay;
- CORS/origem quando aplicável;
- logs sem dados sensíveis;
- dados financeiros sensíveis não coletados livremente;
- fallback para chat/humano se Flow estiver indisponível.

---

# 20. Sequenciamento recomendado no roadmap

## Agora

- manter o canary real de atendimento `live=1%` isolado;
- não alterar a experiência em produção por causa desta pesquisa;
- coletar dados reais do canary.

## Depois do canary de atendimento

1. instrumentar métricas de interface/conversão;
2. implementar “interface decision” no orquestrador atrás de feature flag;
3. criar Flow 1 de personalização de cesta em ambiente de teste;
4. homologar Data Exchange/session contract;
5. testar allowlist interna;
6. A/B IA sem Flow vs IA + Flow 1;
7. testar carrossel de recomendações curtas;
8. integrar Sala como fallback de alta variedade;
9. somente depois testar Flow 2 de upsell;
10. expandir gradualmente conforme métricas.

Não misturar a primeira implementação de Flow com a primeira homologação de Bling.

---

# 21. Conclusão oficial

A pesquisa foi aprovada como direção estratégica.

A Dona Antônia não deve ser construída como:

- chatbot infinito;
- ecommerce tradicional dentro do WhatsApp;
- Flow gigante com todos os produtos.

O produto-alvo é um **sistema de comércio conversacional assistido**, onde:

```text
IA = entende, conversa e recomenda
WhatsApp = canal principal de relacionamento
Flow = coleta/decisão estruturada
Carrossel = curadoria visual curta
Sala = exploração visual rica
Backend = regras e segurança
Bling = operação comercial oficial quando homologado
Humano = fallback e exceções
```

O diferencial não é ter Flow. O diferencial é **escolher automaticamente a melhor interface para reduzir esforço do cliente em cada decisão**.

Essa diretriz deve orientar o aperfeiçoamento futuro do atendimento e do Gestor/Roteirista de Inteligência do Admin.
