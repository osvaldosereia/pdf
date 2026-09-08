# Dona Antônia

## Atualização de Planejamento - Central de Atendimento Humano e Copiloto IA no Admin

Documento para anexar ao chat de programação. Consolida a decisão de evoluir a Inbox atual para uma central profissional de atendimento e vendas, preservando os gates e o estado operacional já definidos no projeto.

> **DECISÃO:** é tecnicamente viável continuar a conversa com o cliente pelo próprio Admin. No WhatsApp, a fundação principal já está implementada no SUCEDOAN12; o próximo avanço é principalmente de interface, ergonomia operacional e copiloto de IA.

## 1. Situação verificada no projeto

A auditoria do repositório `osvaldosereia/SUCEDOAN12` encontrou uma base funcional para atendimento humano no Admin.

- Inbox omnichannel no Admin, com filtros por canal, status e prioridade.
- Ações de **Assumir**, **Responder**, **Resolver**, abrir **Histórico** e consultar **CRM**.
- Edge Function `admin-whatsapp-ops-v1` com JWT/RBAC e ações server-side para inbox, timeline, CRM, handoff e resposta humana.
- Fila própria `operator_reply_jobs`, separada do outbound da IA.
- Resposta humana exige conversa em `mode=human`, handoff claimed e ownership do operador.
- Dispatcher revalida janela de atendimento e gates antes de enviar.
- Entrega incerta é encaminhada para `review_required`, sem retry cego.
- WhatsApp humano reaproveita o transporte existente; Instagram e Messenger continuam sem transporte ativo.

### Arquivos centrais já existentes

| Componente | Função |
|---|---|
| `admin-v3/whatsapp-ops.js` | Inbox, filtros, histórico, CRM, assumir, resolver e responder. |
| `supabase/functions/admin-whatsapp-ops-v1/index.ts` | API segura do Admin para operações humanas. |
| `supabase/migrations/20260908040000_unified_crm_inbox_v1.sql` | Inbox unificada, `operator_reply_jobs`, RPCs e dispatcher. |
| `docs/RETOMADA-DONA-ANTONIA.md` | Estado operacional e gates que devem ser preservados. |

## 2. Fluxo alvo de atendimento humano

```text
CLIENTE ENVIA MENSAGEM
        ↓
IA ATENDE
        ↓
necessita humano / operador decide assumir
        ↓
HANDOFF
        ↓
aparece na Inbox do Admin
        ↓
OPERADOR ASSUME
        ↓
IA deixa de responder diretamente
        ↓
operador continua a mesma conversa pelo Admin
        ↓
backend → operator_reply_jobs → transporte do canal
        ↓
cliente recebe no mesmo canal
```

## 3. Evolução recomendada da interface

A função atual de resposta usa uma interface simples. Para operação real, evoluir a Inbox para uma tela de chat profissional, sem criar um novo sistema paralelo.

| Coluna | Conteúdo recomendado |
|---|---|
| **Esquerda - Conversas** | Fila, cliente, canal, prioridade, SLA, não lidas, assumido por, busca e filtros. |
| **Centro - Chat** | Timeline completa, mensagens do cliente/IA/humano, campo de resposta, anexos, áudio, imagem e status de envio. |
| **Direita - Contexto** | CRM, último pedido, pedido atual, endereço, preferências úteis, histórico resumido e atalhos operacionais. |

## 4. Três modos formais de conversa

| Modo | Quem fala com o cliente | Papel da IA |
|---|---|---|
| `AI` | IA | Atende diretamente conforme políticas e gates. |
| `HUMAN` | Operador | IA não envia; apenas contexto interno se permitido. |
| `HUMAN_COPILOT` | Operador | IA resume, consulta, sugere e prepara ações; operador revisa e envia. |

> **Regra:** quando o humano assume, a IA não deve voltar a falar automaticamente. A retomada da IA deve ser uma ação explícita, auditada e confirmada.

## 5. Copiloto IA para o operador

O copiloto deve continuar trabalhando nos bastidores, sem gerar mensagem adicional ao cliente até o operador escolher enviar.

- Resumo curto da conversa e da intenção atual.
- Sugestão de próxima melhor ação (*Next Best Action*).
- Sugestão de resposta editável, nunca enviada automaticamente no modo humano.
- Consulta de preço, estoque, histórico e último pedido.
- Montagem ou alteração de carrinho provisório.
- Detecção de objeção de preço e busca de alternativas permitidas.
- Resumo das preferências comerciais com evidência suficiente.
- Alertas de risco: janela fechando, identidade incerta, entrega/pagamento não confirmado, necessidade de revisão.

## 6. Regras de segurança e operação

- Humano tem precedência absoluta sobre IA, Flow e automações na conversa assumida.
- Somente owner/operator autorizado pode assumir e responder.
- A resposta deve ser atribuída ao operador e auditável.
- Não executar retry cego de resposta humana quando o estado da entrega for incerto.
- Não retomar IA automaticamente após resolver um handoff.
- Não permitir que a IA finalize, cancele, altere pedido confirmado ou execute ação irreversível sem a política de confirmação aplicável.
- Custo do canal deve passar pelo Cost Policy Engine; recurso não precificado ou acima do limite configurado deve ficar bloqueado.
- O Admin não deve introduzir ferramenta Meta com tarifa adicional acima da interação padrão definida pelo proprietário.

## 7. Estado de canais

| Canal | Inbox/CRM | Assumir | Resposta real pelo Admin | Decisão atual |
|---|---:|---:|---|---|
| **WhatsApp** | Sim | Sim | Sim - fundação pronta | Evoluir UI; preservar canary 1%. |
| **Sala/Web** | Fundação | Fundação | Depende do transporte web | Integrar à mesma Inbox. |
| **Instagram** | Fundação | Fundação | Não - transporte dormente | Não ativar ainda. |
| **Messenger** | Fundação | Fundação | Não - transporte não habilitado | Não ativar ainda. |

## 8. Prioridades de programação recomendadas

### P0 - Interface operacional do chat

- Substituir prompt de texto por composer de chat real.
- Exibir timeline completa em bolhas/linhas de conversa, com origem IA/humano/cliente.
- Exibir status do handoff, operador responsável, SLA e janela do canal.
- Manter ações Assumir, Resolver e CRM sem alterar gates de produção.

### P0 - Segurança e ownership

- Preservar verificação server-side de `mode=human`, handoff claimed e `claimed_by`.
- Garantir atribuição de cada resposta humana ao `admin_user_id`.
- Manter comportamento fail-closed quando janela/gate/transporte estiver indisponível.

### P1 - Copiloto IA

- Resumo da conversa.
- Sugestão de resposta editável.
- Next Best Action para o operador.
- Acesso contextual a CRM, pedido, estoque e histórico, sem autoridade sobre verdades determinísticas.

### P1 - Contexto comercial na mesma tela

- Pedido atual e último pedido.
- Atalhos para adicionar/remover itens em carrinho provisório.
- Preferências úteis com evidência/confiança.
- Endereço e dados cadastrais sem expor informação interna desnecessária.

### P2 - Omnichannel completo

- Quando autorizado, implementar/ativar transporte humano Instagram e Messenger.
- Manter a mesma Inbox, identidade, timeline, CRM, ownership e auditoria para todos os canais.

## 9. Critérios de aceite

- Operador consegue assumir uma conversa WhatsApp e continuar pelo Admin no mesmo thread do cliente.
- IA para de responder automaticamente enquanto o humano estiver no controle.
- Histórico mostra claramente cliente, IA e operador, com timestamps e canal.
- Resposta humana aparece auditada e associada ao operador.
- Se a janela de atendimento ou gate estiver fechado, o sistema bloqueia o envio com motivo claro.
- Falha/estado incerto não provoca reenvio cego.
- Resolver handoff não retoma IA automaticamente.
- Copiloto pode sugerir, mas não envia sem ação explícita do operador.
- Nenhum rollout aumenta o WhatsApp acima de 1% ou ativa Instagram/Messenger/Flow/Bling sem autorização específica.

## 10. Instrução para o chat de programação

> Incorporar esta decisão como diretriz transversal do projeto, sem reiniciar etapas já concluídas. A Central de Atendimento deve evoluir a Inbox existente, não criar um sistema paralelo. Programar o máximo seguro possível da interface e do copiloto mantendo todos os gates atuais. Preservar especialmente: WhatsApp `live=1%`, Flow/Data Exchange desligados, Experience Orchestrator desligado, Instagram/Messenger/Ads desligados e Bling order sync desligado.

### Referência técnica resumida

- `docs/RETOMADA-DONA-ANTONIA.md`
- `docs/ROADMAP-20-ETAPAS-PROGRESS.md`
- `admin-v3/whatsapp-ops.js`
- `supabase/functions/admin-whatsapp-ops-v1/index.ts`
- `supabase/migrations/20260908040000_unified_crm_inbox_v1.sql`

## Resumo final

A arquitetura correta já existe. O trabalho recomendado é transformar a Inbox atual em uma central profissional de conversa, CRM, pedido e copiloto IA, mantendo a resposta humana separada da automação e sem alterar o rollout atual.
