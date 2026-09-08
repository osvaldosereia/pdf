# Gestor de Redes Sociais + Meta Ads — Admin Dona Antônia

Atualizado em 07/09/2026.

Este módulo é parte do produto principal Dona Antônia. Não cria CRM, IA ou banco separados: usa o mesmo cliente, catálogo, estoque, regras, atribuição e histórico do motor omnichannel.

## Objetivo

Centralizar no Admin a operação rotineira permitida pelas APIs da Meta para Instagram, Facebook, Direct, Messenger e Meta Ads.

## Social

- contas/páginas conectadas, permissões, validade de token e alertas;
- calendário editorial diário/semanal/mensal;
- fluxo rascunho → revisão → aprovado → agendado → publicado;
- posts, Reels, carrosséis, Stories e demais formatos somente quando suportados pela API vigente;
- biblioteca de mídia/criativos com versões e vínculo a produtos/ofertas;
- IA para pauta, briefing, legenda, CTA, variações e calendário como rascunho;
- comentários Instagram/Facebook centralizados, classificação e resposta sugerida;
- private reply do Instagram apenas dentro das regras vigentes;
- Direct e Messenger integrados à inbox omnichannel;
- moderação, tags, prioridade, reclamação e handoff humano;
- métricas orgânicas e atribuição conteúdo → conversa → pedido.

## Meta Ads

- conectar Business, Ad Account, Página e Instagram corretos;
- ler campanhas, conjuntos, anúncios, criativos e Insights;
- dashboard de investimento, conversas, pedidos, CPA e receita atribuída quando tecnicamente confiável;
- criar campanhas em rascunho/pausadas;
- revisar objetivo, público, orçamento, datas, placement e criativo antes de ativar;
- preservar `campaign_id`, `adset_id`, `ad_id`, `creative_id`, `entry_channel` e `entry_flow`;
- Click-to-Instagram Direct, Click-to-Messenger e Welcome Message Flows quando disponíveis/aprovados;
- comparar criativos e sugerir otimizações;
- alertas de gasto, anomalia, campanha sem conversão e permissões/token;
- RBAC por ação;
- trilha de auditoria de criação, aprovação, publicação, pausa e alteração de orçamento;
- kill switch e limites de gasto diários/mensais.

## Segurança de orçamento/publicação

A IA pode analisar e sugerir, mas não pode por conta própria:

- ativar campanha real;
- aumentar orçamento fora de limites previamente aprovados;
- alterar segmentação sensível;
- publicar oferta com preço/estoque não validado;
- usar base de clientes como audiência sem política/consentimento aplicável.

Ações com impacto financeiro devem ser transacionais, idempotentes quando possível e exigir permissão/confirmacão conforme a política operacional.

## Relação com o Make atual

Cenários existentes de publicação Instagram podem ser usados como evidência e ponte temporária. O objetivo final é que o Admin controle intenção, conteúdo, estado e auditoria; Make permanece ponte fina quando a integração direta não for vantajosa.

A conexão Meta existente no Make deve ser auditada e renovada/reautorizada se estiver expirando antes de homologações futuras.
