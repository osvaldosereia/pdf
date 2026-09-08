# Roadmap final — Dona Antônia em 12 etapas

Atualizado em 07/09/2026.

Este documento SUBSTITUI `docs/ROADMAP-FINAL-DONA-ANTONIA-8-ETAPAS.md` como roadmap principal de conclusão do projeto Dona Antônia. O roadmap anterior permanece apenas como histórico.

O objetivo final agora é uma plataforma própria de comércio conversacional omnichannel, com um único cérebro, CRM e núcleo transacional, servindo WhatsApp, Instagram Direct, Facebook Messenger, Sala de Compra e e-mail, além de um Gestor de Redes Sociais/Meta Ads integrado ao Admin.

## Princípios invariáveis

- um único cliente/CRM, nunca um CRM por canal;
- um único núcleo de produtos, estoque, preço, carrinho, pedido e regras;
- canais são adaptadores/renderizadores, não cérebros separados;
- OpenAI interpreta e conversa; backend decide verdade comercial e transacional;
- Make continua como ponte fina quando necessário;
- eventos entram em formato normalizado antes do motor central;
- saídas são decisões estruturadas e só depois renderizadas por canal;
- identidades externas nunca são unificadas por nome; vínculo exige evidência legítima;
- gates/canary independentes por canal;
- marketing e anúncios exigem consentimento/política/permissões aplicáveis;
- IA pode sugerir conteúdo, campanha e orçamento, mas publicação/gasto segue limites e confirmações definidos;
- o WhatsApp canary não sobe acima de 1% sem nova autorização explícita;
- Bling não é ativado fora de homologação autorizada;
- WhatsApp Flow/Data Exchange não é liberado para clientes sem autorização;
- atendimento humano aberto nunca é retomado automaticamente por IA/Flow.

---

# ETAPA 1 — Fundação, limpeza e consolidação operacional

Objetivo: encerrar dívida de homologação e deixar o núcleo atual limpo antes de ampliar canais.

Entregas:
1. integrar/revisar PRs atuais seguros e dormentes, incluindo ciclo de vida da chave Flow;
2. preservar e monitorar canary `live=1%` e handoffs humanos;
3. revisar Security Advisor e permissões críticas;
4. inventariar Make: produção, homologação, temporário, legado;
5. desativar/arquivar rotas temporárias que possam processar produção por engano;
6. classificar PRs antigas/paralelas e reduzir ambiguidade operacional;
7. consolidar runbooks, backup, restore, retenção e rollback;
8. garantir CI verde e documentação autoritativa.

Critério de saída: ambiente previsível, sem caminhos concorrentes acidentais e com rollback documentado.

---

# ETAPA 2 — Pedido real ponta a ponta + Bling

Objetivo: provar o ciclo comercial real na nova arquitetura.

Entregas:
1. conversa/Sala → carrinho → cesta personalizada → endereço → confirmação;
2. pedido idempotente no Supabase;
3. cestas com preço comercial próprio e componentes individualizados para ERP;
4. diferença positiva em outras despesas e negativa em desconto;
5. contato/pedido/itens/estoque/status no Bling;
6. idempotência e tratamento de timeout sem retry cego;
7. estados entregue/cancelado/devolvido e correção de métricas;
8. uma homologação real allowlisted antes de qualquer abertura ampla.

Critério de saída: pedido completo comprovado, sem duplicidade e com conciliação correta.

---

# ETAPA 3 — Núcleo omnichannel e evento normalizado

Objetivo: tornar o motor central independente de WhatsApp.

Entregas:
1. ampliar `conversation.channel` para suportar explicitamente `instagram` e `messenger` além de `whatsapp`, `web` e `hybrid`;
2. criar `channel_accounts`;
3. criar `customer_channel_identities`/estrutura equivalente para E.164, IGSID, PSID e futuras identidades;
4. criar contrato de evento normalizado com `channel`, `channel_account_id`, `external_user_id`, `external_message_id`, `direction`, `message_type`, `reply_to`, `source`, `referral`, `timestamp` e referência de evento bruto segura;
5. idempotência por canal/mensagem externa;
6. normalização de mídia e referência de post/comentário;
7. manter payload cru fora do motor de IA sempre que não for necessário.

Critério de saída: motor recebe o mesmo formato interno independentemente do canal.

---

# ETAPA 4 — Adapters, renderers e gates independentes

Objetivo: separar compreensão/decisão de apresentação por canal.

Entregas:
1. WA Adapter, IG Adapter, Messenger Adapter e Web/Sala Adapter;
2. Channel Capability Registry;
3. renderer por canal para texto, imagem, áudio, botões, quick replies, cards e carrosséis conforme capacidade;
4. decisão comercial neutra, por exemplo `mission=show_three_baskets`;
5. gates independentes: inbound, auto-reply, IA, outbound/canary por Instagram e Messenger;
6. nenhuma flag global libera todos os canais;
7. testes de fallback de recurso quando um canal não suporta determinada apresentação.

Critério de saída: mesma decisão comercial pode ser renderizada corretamente em canais distintos.

---

# ETAPA 5 — CRM unificado, identidades e caixa de entrada única

Objetivo: enxergar uma pessoa e um histórico, mesmo usando vários canais.

Entregas:
1. CRM com telefone, e-mail, Instagram, Messenger e demais identidades confirmadas;
2. regras seguras de vínculo entre identidades;
3. `customer_emails`/estrutura equivalente e consentimentos por canal;
4. timeline única: comentário → Direct → WhatsApp → Sala → pedido → entrega;
5. inbox única no Admin com filtros por canal e prioridade;
6. `human_handoffs` generalizado por canal;
7. operador responder pelo próprio Admin;
8. métricas de SLA e motivo de handoff.

Critério de saída: operador não precisa abrir Instagram, Facebook e WhatsApp separadamente para atender.

---

# ETAPA 6 — Instagram Direct + comentários → private reply → Direct

Objetivo: transformar descoberta e conteúdo do Instagram em conversa comercial legítima.

Entregas:
1. conexão oficial Meta para Instagram profissional;
2. webhooks de mensagens/comentários;
3. observe mode antes de resposta automática;
4. Direct inbound humano primeiro;
5. canary IA independente;
6. quick replies, botões, Generic Template/carrossel e compartilhamento de post próprio;
7. detecção de intenção em comentários;
8. private reply controlado conforme regras vigentes da Meta;
9. só continuar automação quando o cliente responder quando a política exigir;
10. atribuição de Reel/post/anúncio à conversa e pedido.

Critério de saída: comentário/Direct pode gerar recomendação e venda sem obrigar migração imediata para WhatsApp.

---

# ETAPA 7 — Facebook Messenger + integração Meta centralizada

Objetivo: incorporar atendimento vindo do Facebook e anúncios ao mesmo motor.

Entregas:
1. Page + Messenger Platform;
2. inbound/observe/humano/canary IA;
3. quick replies, botões, Generic Template, mídia e recursos suportados;
4. atualizações operacionais somente dentro das permissões/templates aplicáveis;
5. integração com Conversations API quando apropriado;
6. sincronização inicial segura da inbox quando viável;
7. atribuição de origem Facebook/Meta Ads.

Critério de saída: Messenger opera como mais um canal do mesmo CRM e Admin.

---

# ETAPA 8 — Sala de Compra + WhatsApp Flow + orquestrador channel-aware

Objetivo: fazer o orquestrador escolher a melhor experiência, não apenas responder texto.

Entregas:
1. finalizar chave e homologação do WhatsApp Flow sem expor private key;
2. registrar chave pública na Meta em etapa controlada;
3. homologar Data Exchange e state machine;
4. habilitar escrita transacional em carrinho apenas após testes;
5. orquestrador escolher entre conversa, botões, quick replies, carrossel, Flow, Sala ou humano;
6. respeitar capacidades de cada canal;
7. preservar handoff humano e budget por sessão.

Critério de saída: experiência escolhida dinamicamente e com fallback seguro.

---

# ETAPA 9 — Lotes, validade, ofertas, benefícios e inteligência comercial

Objetivo: fechar a verdade comercial antes de escalar campanhas.

Entregas:
1. estoque por lote e validade;
2. FEFO;
3. regras de 20% para 31–60 dias e 30% para 0–30 dias, sem cumulatividade indevida;
4. bloqueio de vencidos e incompatibilidade com data de entrega;
5. editor de ofertas/descontos/brindes/aniversário no Admin;
6. versão, prioridade, orçamento, margem, limite e rollback;
7. recomendações ligadas a histórico real de compras;
8. relatórios iniciais de vendas, margem, recompra e estoque.

Critério de saída: nenhuma campanha recomenda produto/preço/benefício inválido.

---

# ETAPA 10 — Marketing omnicanal pós-compra a cada 10 dias

Objetivo: relacionamento automático profissional e mensurável.

Entregas:
1. nova compra válida reinicia relógio de marketing;
2. elegibilidade em 10 dias por canal;
3. WhatsApp marketing via template aprovado, preferencialmente carrossel;
4. e-mail marketing profissional para clientes com e-mail/consentimento;
5. segmentação por perfil e produtos relacionados;
6. opt-out, unsubscribe, bounce, complaint e suppression;
7. dedupe/idempotência, cap diário, orçamento e kill switch;
8. SPF/DKIM/DMARC para e-mail;
9. atribuição campanha → conversa → pedido;
10. métricas de entrega, resposta, pedido, margem, custo e opt-out.

Critério de saída: piloto pequeno e controlado antes de escala.

---

# ETAPA 11 — Gestor de Redes Sociais + Meta Ads dentro do Admin

Objetivo: transformar o Admin Dona Antônia na central de operação de Instagram, Facebook e anúncios Meta.

## Gestor de conteúdo/social

1. contas/páginas conectadas e estado de autorização;
2. calendário editorial;
3. rascunho, revisão, aprovação, agendamento e publicação de posts/Reels/carrosséis quando suportado;
4. biblioteca de mídia/criativos;
5. IA para briefing, legenda, variações, CTA e calendário — sempre como rascunho até política permitir publicação;
6. comentários e respostas centralizados;
7. Direct/Messenger integrados à inbox;
8. moderação, tags, prioridade e escalonamento;
9. histórico por conteúdo e campanha;
10. métricas orgânicas: alcance, engajamento, comentários, conversas iniciadas e pedidos atribuídos.

## Gestor Meta Ads

1. conexão de Business/Ad Account/Page/Instagram corretos;
2. leitura de campanhas, conjuntos, anúncios, criativos e Insights;
3. dashboard de investimento, conversas, pedidos, CPA, ROAS/receita atribuída quando tecnicamente justificável;
4. criador de campanha em rascunho/pausado;
5. segmentação, orçamento, datas, objetivo, placement e criativo revisáveis;
6. Welcome Message Flows / Click-to-Instagram Direct / Click-to-Messenger quando aprovados;
7. `campaign_id`, `adset_id`, `ad_id`, `creative_id`, `entry_channel` e `entry_flow` preservados na atribuição;
8. comparação de criativos e sugestões de otimização;
9. alertas de gasto, anomalia e desempenho;
10. publicação/ativação e aumento de orçamento protegidos por RBAC, confirmação e limites; IA não pode aumentar gasto livremente;
11. auditoria completa de quem criou, aprovou, publicou, pausou ou alterou orçamento;
12. kill switch e limites diários/mensais.

Critério de saída: Admin controla operação social e anúncios de forma auditável sem depender do Ads Manager/Meta Business para tarefas rotineiras que a API permita.

---

# ETAPA 12 — Testes finais, autorizações externas e liberação controlada

Objetivo: homologar tudo e liberar gradualmente.

Entregas:
1. regressão completa Node/PGlite/Deno e testes de integração;
2. segurança, RLS, Vault, secrets, rate limit, replay, idempotência e rollback;
3. testes reais controlados em WhatsApp, Instagram, Messenger, Sala, e-mail, Bling e Meta Ads;
4. App Review/Advanced Access/Business Verification/permissões que ainda dependam da Meta;
5. DNS/e-mail e demais ações externas;
6. testes mobile/desktop/WhatsApp Web/Meta inbox;
7. canary independente por canal;
8. marketing e Ads em allowlist/baixo volume primeiro;
9. monitorar qualidade, bloqueios, opt-outs, custo, erros, pedidos e margem;
10. relatório final de pendências manuais/externas;
11. rollout gradual por gates, nunca ativação geral simultânea;
12. declaração `Dona Antônia V1 — Produção Completa` somente após período estável.

Critério de saída: operação estável, auditável, reversível e com todas as integrações críticas comprovadas.

---

# Ordem oficial de execução

1. Fundação/limpeza
2. Pedido+Bling
3. Núcleo omnichannel
4. Adapters/renderers/gates
5. CRM/inbox/identidades
6. Instagram Direct/comentários
7. Messenger
8. Sala/Flow/orquestrador
9. Lotes/regras/inteligência
10. Marketing 10 dias
11. Gestor Social + Meta Ads
12. Testes finais + autorizações + liberação

A programação deve avançar em blocos grandes por etapa. Quando uma etapa depender de ação externa, concluir toda a parte programável e seguir para componentes independentes, registrando o bloqueio para o relatório final.