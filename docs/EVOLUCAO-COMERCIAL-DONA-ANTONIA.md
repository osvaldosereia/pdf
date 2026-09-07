# Evolução comercial — Dona Antônia

Requisitos recebidos em 07/09/2026. Este documento complementa `RETOMADA-DONA-ANTONIA.md`; não substitui a prioridade de fazer Sala + conversa + pedido funcionarem ponta a ponta.

## Decisões do proprietário

1. Guardar pedidos e itens de cada cliente para personalizar o atendimento e gerar relatórios.
2. Preparar recompra pelo WhatsApp, inicialmente a cada 15 dias, com conteúdo adequado ao perfil individual.
3. Oferecer o que interessa ao cliente e ampliar gradualmente suas compras com itens complementares estratégicos.
4. Pedir aniversário para benefício no mês: desconto **ou** brinde, com regra definida no admin.
5. Priorizar produtos próximos do vencimento: 20% de desconto de 31 a 60 dias; 30% de 0 a 30 dias. Não acumular as duas faixas.
6. Lista de produtos leve, pesquisável e segmentável de diversas maneiras.
7. Criador de regras de ofertas, descontos e brindes no admin.
8. Central para orientar a IA, com a própria IA ajudando a organizar instruções e prompts.
9. Evolução de integração Meta Ads no admin para criar, analisar, gerar criativos, planejar públicos e administrar anúncios.

Esses itens são requisitos do projeto. Não significam que campanhas, descontos em produção, anúncios ou envio automático estejam ativos.

## Pesquisa e adaptação ao porte da empresa

Pesquisa em fontes primárias em 07/09/2026:

- **Tesco + Adobe:** parceria anunciada em abril de 2026 para personalizar experiências e recompensar fidelidade, combinando dados do varejista e IA. A inspiração aproveitável é manter contexto do cliente entre canais e selecionar conteúdo relevante; não reproduzir sua infraestrutura. [Comunicado oficial](https://news.adobe.com/en/gb/news/2026/04/adobe-tesco-enter-strategic-ai-partnership).
- **dunnhumby:** descreve a evolução de recomendações baseadas em comportamento para antecipação das próximas necessidades. [Personalização no varejo alimentar](https://www.dunnhumby.com/articles/exploring-the-evolution-of-personalisation-in-grocery-retail/). Para nossa operação, começar com intervalos observados entre pedidos e categorias compradas, sem modelo preditivo caro.
- **Tesco Clubcard Prices:** referência de comunicação clara de ofertas e benefícios. Não é evidência de que qualquer desconto aumente margem. [Clareza dos preços Clubcard](https://www.tescoplc.com/making-clubcard-prices-even-clearer-for-customers/).
- **WhatsApp:** opt-in, respeito ao opt-out e templates aprovados para iniciar mensagens; fora das 24 horas após a última mensagem do usuário, usar template aprovado. [Política oficial](https://www.whatsapp.com/legal/business-policy/) e [documentação de opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in).
- **Meta Marketing API:** permissões de leitura e gestão são distintas. Reports/Insights e gestão de campanhas dependem do acesso efetivo do app à conta. [Autorização](https://developers.facebook.com/documentation/ads-commerce/marketing-api/get-started/authorization) e [Insights](https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights). As páginas diretas apresentaram restrição de acesso nesta pesquisa; conferir os detalhes da versão da API e permissões antes da implementação.

O desenho abaixo é uma **proposta para a Dona Antônia**, derivada dessas referências e das instruções do proprietário. Não atribuir a todos os varejistas os percentuais, a cadência ou os resultados desta proposta.

## Histórico, perfil e relatórios

Usar Supabase como fonte do relacionamento, preservando snapshots de pedido: itens, quantidades, preço comercial final, desconto/regra aplicada, custo conhecido na venda, canal, entrega, status e vínculo Bling. Separar pedido confirmado, enviado ao ERP, entregue, cancelado e devolvido. Compra entregue deve orientar recompra; cancelamentos/devoluções precisam corrigir as estatísticas. Não somar faturamento novamente ao reenviar webhook.

Perfil inicial determinístico:

- recência da última compra válida, frequência e valor;
- intervalo mediano entre compras, quando houver histórico suficiente;
- categorias, marcas e produtos recorrentes;
- complementos aceitos, recusas, itens removidos da cesta e preferências declaradas;
- preferência de canal e texto/áudio;
- consentimento, último marketing, descadastro e resposta às campanhas.

Não inferir renda, saúde, religião, composição familiar ou outros atributos sensíveis a partir de produtos. Preferências declaradas devem prevalecer sobre inferências comerciais. Sem histórico suficiente: usar contexto da compra atual e perguntar, sem fingir conhecer o cliente.

Painel futuro, agregado por período e com detalhamento paginado:

| Relatório | Decisão que ajuda a tomar |
|---|---|
| Pedidos, vendas válidas, ticket médio e recompra | Saber se há crescimento sustentável |
| Clientes novos, recorrentes e sem comprar | Escolher a abordagem de relacionamento |
| Categorias, produtos e complementos aceitos | Ajustar sortimento e sugestões |
| Margem conhecida após desconto/brinde | Evitar crescer faturamento reduzindo resultado |
| Estoque por faixa de validade, escoamento e perdas | Avaliar a política de vencimento |
| Enviados, entregues, respostas, pedidos e opt-outs | Avaliar qualidade das campanhas |
| Custo de Meta, Make e IA por pedido válido | Controlar custo operacional |
| Resultados de grupo tratado e controle | Distinguir vendas associadas de efeito incremental |

Valores sem custo conhecido devem ser marcados como incompletos, nunca estimados como lucro integral. Relatórios usam agregação SQL incremental; IA interpreta resumos, sem receber o histórico completo a cada consulta.

## Recompra personalizada

O pedido de “a cada 15 dias” vira **cadência inicial configurável**, não envio obrigatório a toda a base. Avaliação diária barata por SQL/worker; apenas candidatos elegíveis chegam à etapa de texto/IA/Meta. Não criar cron por cliente.

Elegibilidade inicial proposta:

1. Cliente ativo, compra válida e consentimento atual para ofertas no WhatsApp.
2. Intervalo mínimo de 15 dias entre iniciativas de marketing, compartilhado entre campanhas; ajustar depois com dados. Aniversário compete com recompra, não duplica contato no mesmo ciclo.
3. Sem pedido aberto, compra muito recente, atendimento humano pendente, reclamação não resolvida ou opt-out.
4. Oferta realmente disponível, válida na data prevista de entrega e compatível com o perfil.
5. Template **marketing** aprovado, orçamento diário disponível e qualidade da conta aceitável. Compra anterior sozinha não autoriza marketing.
6. Revalidar consentimento, preço, estoque, validade, template e dedupe imediatamente antes do envio. Falha de entrega não autoriza disparar de novo cegamente.

Estratégia de seleção:

| Perfil observável | Abordagem proposta |
|---|---|
| Compra cesta com frequência | Facilitar repetição da última cesta, permitindo editar |
| Recorrente de mercearia | Lembrar itens habituais no intervalo provável de reposição |
| Compra limpeza | Ofertar marca/categoria de afinidade e um complemento pertinente |
| Costuma aceitar promoções | Escolher oferta real dentro de suas categorias |
| Pouco histórico | Uma pergunta simples ou seleção pequena; sem falsa personalização |
| Sem responder | Reduzir pressão; proposta: pausar após duas iniciativas sem resposta e reavaliar |
| Aniversariante elegível | Um benefício no mês, conforme regra e disponibilidade |

Composição inicial: maioria de itens de afinidade e **no máximo um complemento novo por abordagem**. Fazer um piloto pequeno com grupo de comparação; avaliar recompra, margem, opt-out e custo, não apenas cliques. A escala depende desses resultados. Não prometer aumento percentual sem teste.

Registro por campanha: versão da regra, motivo da seleção, produto/lote, benefício, template, destinatário interno, consentimento vigente, dedupe, provider ID e pedido atribuído. Não registrar telefone/documento em logs de GitHub Actions.

## Aniversário

Pedir **dia e mês opcionais**, sem exigir ano para o benefício. Tratar 29/02 como aniversário em fevereiro para campanha mensal. Não bloquear compras sem aniversário.

Cadastro nesta rodada inclui campos e consentimento separado, sem marcação prévia. Definir depois no criador de regras: desconto **ou** brinde, mínimo de compra, teto do desconto, SKU/estoque do brinde, vigência, acumulabilidade e quantidade máxima. Uma concessão por cliente/ano, com chave única e resgate transacional. Alterar data não deve renovar benefício. Mostrar condição e disponibilidade ao cliente.

## Validade e preço

| Dias até vencer | Regra solicitada |
|---|---|
| Mais de 60 ou data não informada | Nenhum desconto automático por validade |
| 31 a 60, inclusive | 20% |
| 0 a 30, inclusive | 30% |
| Data já vencida | Bloquear venda e promoção |

Calcular em `America/Cuiaba`, usando preço de referência aprovado em centavos, arredondamento consistente e desconto não cumulativo. Não alterar repetidamente o preço já descontado. Manter preço original e trilha de auditoria. Um item de R$ 100 passa a R$ 80 na primeira faixa e R$ 70 na segunda.

**Lotes são requisito antes de ativar universalmente:** um SKU pode ter unidades com vencimentos diferentes. Não descontar todo o estoque com base apenas na data mais próxima. Registrar lote, quantidade e validade; reservar e separar pelo lote com vencimento mais próximo (FEFO). A data de entrega também entra na elegibilidade. Enquanto só existir `products.validity_date`, usar filtro e simulação para revisão operacional.

Na oferta, mostrar preço anterior real, preço atual, percentual e validade com transparência. “Oferta imperdível” só como texto comercial sem esconder vencimento nem inventar escassez. A prioridade comercial aumenta entre itens relevantes ao cliente, sem aumentar a frequência de mensagens nem ignorar recusas.

Estoque zero, produto inativo/não conferido, validade vencida ou entrega posterior à validade bloqueiam promoção. Margem negativa gera alerta e decisão explícita do proprietário: não esconder redução de margem nem alterar silenciosamente os percentuais solicitados.

**Cestas:** manter preço próprio e valores individuais ocultos. Desconto de componente não muda automaticamente preço da cesta. Uma campanha para cesta exige regra específica, novo total comercial e conciliação fiscal determinística com o Bling. Verificar desconto no carrinho, checkout, pedido e ERP antes de ativar.

## Criador de regras no admin

Módulo planejado “Ofertas e benefícios”, com editor estruturado:

- nome, objetivo, prioridade, período, status rascunho/publicado/pausado;
- público elegível e exclusões;
- produtos, categorias, lotes e faixas de validade;
- percentual/valor fixo/brinde, mínimo de compra, teto e orçamento;
- limite por cliente/período, estoque reservado e acumulabilidade;
- canais e template aprovado;
- simulação com preço, margem e motivos de elegibilidade;
- versões, autor, publicação, pausa e reversão.

Regras conflitantes devem ter precedência explícita. Padrão inicial: benefícios não cumulativos; escolher um benefício elegível segundo política aprovada. Validar e reservar brindes como estoque, com registro no pedido. O backend executa as regras; IA não pode publicar JSON arbitrário ou alterar preço por prompt.

## Central de orientação da IA

Separar tom de voz, identidade, atendimento, entrega, personalização de cesta, vendas, trocas, escalonamento humano e exemplos aprovados. Cada bloco tem versão e responsável. Dados comerciais vêm do backend; prompts não substituem estoque, preço, regras ou consentimento.

Assistente de prompts proposto: operador escreve em linguagem natural → IA organiza em rascunho, aponta ambiguidades/conflitos → mostra diferença para a versão atual → testa em conversas fictícias → operador publica. Instruções obtidas de clientes, documentos ou imagens nunca podem virar política administrativa. Guardar versão efetiva em cada execução; permitir retornar à versão anterior.

## Meta Ads no admin

Implantação em etapas:

1. **Leitura:** conectar conta de anúncios correta e consultar Insights; cards de investimento, conversas iniciadas, pedidos válidos, CPA e receita atribuída, com limitações de atribuição claras.
2. **Planejamento e criativos:** briefing, textos e imagens em rascunho; usar produtos/imagens fiéis, oferta vigente, validade e área efetiva de entrega. Público sugerido inicialmente por localização e interesse comercial, sem inferências sensíveis.
3. **Gestão:** campanhas, conjuntos e anúncios criados pausados; orçamento, datas, objetivo e segmentação revisáveis antes de publicação. Permissões e App Review conforme a conta e API vigentes.
4. **Otimização controlada:** comparação de criativos, alertas, propostas de pausa e alterações dentro de limites aprovados. IA não pode aumentar orçamento sem limite nem publicar criativo livremente.

WABA/WhatsApp e conta de anúncios são ativos distintos. Uma conexão Make saudável com WhatsApp não prova acesso à Marketing API. Segredos ficam no backend. Audiências a partir de clientes e eventos de conversão exigem avaliação própria de consentimento, minimização e acesso; hash de telefone não elimina essas responsabilidades. Não incluir automaticamente a base em públicos de anúncios.

## Entrega desta rodada e sequência

Preparados em código: worker protegido de transcrição/visão/classificação, contabilização de uso, resposta determinística; leitura leve de mensagens; aniversário/consentimento; filtros do admin; função de simulação de desconto por validade. **Sem campanhas, anúncios ou descontos automáticos em produção.**

A próxima camada comercial é: consolidar status de compra válida e métricas → relatório inicial → lotes e aplicação consistente de preços → editor de regras e simulador → piloto de recompra → aniversários → IA de prompts → Meta Ads. A homologação do motor de conversa e do pedido continua tendo prioridade.
