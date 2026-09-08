# Stack Google relevante — Dona Antônia

Atualizado em 07/09/2026.

Este documento define somente as integrações Google que trazem valor operacional real para a Dona Antônia. O objetivo não é replicar todos os consoles do Google dentro do Admin, e sim centralizar indicadores e ações úteis para SEO, descoberta, produtos, medição e mídia paga.

## Regra de custo

Sempre que a tarefa puder ser executada em lote ou por agenda sem necessidade de tempo real, preferir GitHub Actions a Make.

Usar GitHub Actions para:
- gerar/validar sitemap, robots e feeds;
- auditoria técnica de SEO;
- PageSpeed/CrUX snapshots;
- importação periódica de métricas Search Console/GA4/Google Ads;
- validação de dados estruturados e URLs públicas;
- relatórios diários/semanais;
- tarefas determinísticas de manutenção.

Reservar Make para webhooks/conectores em tempo real ou integrações em que o conector ofereça ganho operacional claro.

## O que já existe

O repositório já possui:
- `sitemap.xml` e `robots.txt`;
- `merchant.xml`;
- `scripts/gerar-merchant.js`;
- scripts de páginas SEO e sitemap;
- `SEO-GOOGLE-DELIVERY-CHECKLIST.md`;
- `.github/workflows/update-public-data.yml`, agendado de hora em hora, que regenera SEO, Merchant, Meta catalog e sitemap e valida os arquivos públicos.

Essa base deve ser aproveitada, não substituída.

## 1. Google Search Console — prioridade obrigatória

Integrar propriedade `donaantonia.com.br` para:
- cliques, impressões, CTR e posição média;
- consultas que trazem tráfego;
- páginas com melhor/pior desempenho;
- indexação/cobertura e sitemap;
- alertas de queda anormal;
- visão por período no Admin.

O Admin deve mostrar resumo acionável e tendências, sem tentar copiar toda a interface do Search Console.

Automação preferida: GitHub Action diária para snapshot + consulta sob demanda pelo backend quando necessário.

## 2. Google Merchant Center — prioridade obrigatória

Aproveitar o `merchant.xml` atual para:
- listagens gratuitas de produtos quando elegíveis;
- diagnóstico de itens aprovados/reprovados;
- preço/estoque/URL/imagem consistentes;
- alertas de erro do feed;
- métricas resumidas de visibilidade/click quando disponíveis.

Como a operação é delivery e não atendimento em loja, não assumir recursos de inventário local de loja física. Usar somente recursos compatíveis com o modelo real da empresa.

Automação preferida: GitHub Actions para geração/validação de feed; API/consulta periódica para status e diagnósticos.

## 3. Google Analytics 4 — prioridade alta

Instrumentar eventos realmente úteis:
- `view_item`;
- `search`;
- `add_to_cart`;
- abertura da Sala;
- início de conversa por canal;
- início do checkout;
- pedido confirmado;
- origem/campanha preservada;
- eventos de handoff quando relevantes.

Não enviar PII como telefone, e-mail, CPF ou conteúdo de mensagens ao Analytics.

Usar Google Analytics Data API para painel resumido no Admin: usuários, sessões, páginas, origens, funil e conversões relevantes.

Automação preferida: snapshots via GitHub Actions + leitura sob demanda quando necessário.

## 4. Perfil da Empresa no Google — prioridade alta para SEO local

A Dona Antônia é delivery/serviço por área, sem necessidade de mostrar endereço de atendimento ao público. Configurar corretamente como empresa de serviço local/área de cobertura quando esse for o modelo efetivo.

No Admin, inicialmente apenas:
- status da ficha;
- dados essenciais conferidos;
- área de atendimento;
- horário/telefone/site;
- avaliações e tendência quando acesso/API permitir;
- alerta de dados inconsistentes.

Não transformar o Admin em clone do Perfil da Empresa.

## 5. PageSpeed + Core Web Vitals — prioridade alta técnica

Rodar auditorias automáticas nas páginas críticas:
- home;
- cestas;
- produto/cesta representativa;
- Sala de Compra;
- páginas institucionais relevantes.

Guardar tendência de performance, acessibilidade e SEO técnico; falhar CI somente para regressões graves previamente definidas, evitando flutuação de laboratório virar falso bloqueio.

Automação preferida: GitHub Actions semanal e após mudanças relevantes no frontend.

## 6. Google Ads — prioridade alta, porém mídia é paga

O console/API não substitui o custo dos anúncios. A integração deve permitir no futuro:
- conectar conta correta;
- ler campanhas, grupos, anúncios, palavras-chave/termos quando aplicável e métricas;
- acompanhar custo, cliques, conversões e CPA;
- atribuir campanha/origem ao pedido quando tecnicamente consistente;
- criar/editar campanhas de forma controlada;
- manter campanhas novas inicialmente em rascunho/pausadas;
- proteger publicação e aumento de orçamento com RBAC, confirmação, limites e auditoria;
- IA pode sugerir palavras-chave, negativas, textos e ajustes, mas não alterar gasto livremente.

Para acesso programático à Google Ads API será necessário developer token e autenticação adequada. Essa etapa externa entra no checklist final de autorizações.

Automação preferida: GitHub Actions para relatórios/snapshots; backend/Admin para ações transacionais. Não usar Make para polling de Google Ads se uma API + Action fizer o mesmo de forma mais barata.

## 7. Google Tag Manager — opcional

Usar somente se houver ganho claro na administração de tags. Se GA4/Google Ads puderem ser instrumentados de forma limpa e versionada no código, não adicionar GTM apenas por tradição.

## Não prioritários nesta versão

Não criar integrações apenas porque existem APIs Google. Evitar, até surgir necessidade concreta:
- Looker Studio embutido como dependência central;
- múltiplas ferramentas de SEO sobrepostas;
- automações de conteúdo que publiquem alterações SEO sem revisão;
- dashboards duplicando integralmente Search Console, Analytics ou Ads.

## Visão do Admin

Criar uma seção `Google / Crescimento` com cinco blocos úteis:
1. SEO/Search Console;
2. Produtos/Merchant;
3. Tráfego/GA4;
4. Presença local/Perfil da Empresa;
5. Google Ads.

PageSpeed aparece como saúde técnica transversal.

O objetivo é responder rapidamente:
- como estamos sendo encontrados;
- quais páginas/produtos trazem tráfego;
- onde há erro de indexação/feed;
- qual canal/campanha gera conversa e pedido;
- quanto custa adquirir um pedido;
- quais problemas técnicos precisam de ação.
