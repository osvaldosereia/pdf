# RETOMADA — Projeto Dona Antônia

Atualizado em **07/09/2026 — Etapa 3 WhatsApp Bridge v3**.

Este é o arquivo **autoritativo** para retomar o projeto em uma nova conversa. Não voltar a planejar do zero. Primeiro ler este arquivo, depois consultar o estado real no GitHub, Supabase e Make antes de alterar qualquer gate.

Documento técnico complementar da etapa atual:

- `docs/WHATSAPP-BRIDGE-V3.md`

Documentos importantes anteriores:

- `docs/HOMOLOGACAO-OPENAI-20260907.md`
- `docs/SALA-COMPRA-MOTOR-COMERCIAL-V1.md`
- `docs/CONVERSATION-WORKER-V1.md`
- `docs/EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`
- `docs/ARQUITETURA-DONA-ANTONIA-V2.md` — contexto histórico, não fonte principal.

---

## PONTO EXATO DE RETOMADA

A **Sala de Compra + motor comercial** e a **homologação OpenAI texto/áudio/imagem** já foram concluídas.

A **Etapa 3 — WhatsApp** está tecnicamente preparada em PR #146, branch:

`codex/dona-antonia-whatsapp-bridge-v1-20260907`

No fechamento desta atualização:

- migrations WhatsApp v3/allowlist/health já foram aplicadas no Supabase de produção;
- `whatsapp-ingest` está em produção na **v3**;
- `whatsapp-outbound-v1` está em produção na **v4**, com protocolo antigo `claim/finish` desativado;
- Make outbound oficial é o scenario **7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3**;
- Make inbound é o scenario **6779824 — Dona Antônia - WhatsApp Inbound Controlado v1**;
- inbound teve os HTTP v4 corrigidos com campos avançados e aceita ativação, mas foi deixado desligado;
- scenario **7290290** foi renomeado para `LEGACY - NÃO USAR - WhatsApp Outbound HTTP v1` e está desligado;
- healthcheck Supabase → Make v3 passou com HTTP 200 e `sent=false`;
- allowlist temporária foi testada apenas com telefone fictício e fechada em seguida;
- nenhum cliente real foi atendido nesta rodada;
- nenhum TTS foi consumido nesta rodada;
- nenhum pedido/Bling foi criado ou alterado nesta rodada.

Estado final auditado no Supabase:

```text
whatsapp_release_mode = off
whatsapp_inbound_enabled = false
whatsapp_auto_reply_enabled = false
ai_enabled = false
conversation_worker_enabled = false
allowlist ativa = 0
seller_message pending = 0
seller_message processing = 0
seller_message error = 0
ai_jobs pending/processing/error = 0
```

`automation_enabled` e `outbound_enabled` podem permanecer true globalmente porque os gates específicos do WhatsApp/IA acima estão fechados. Sempre reler o banco antes de confiar nestes valores.

### Próxima ação real necessária

A próxima etapa é uma **homologação inbound real somente no telefone de teste do usuário**, nunca liberação geral.

Ordem:

1. consultar `get_whatsapp_bridge_health_v1()`;
2. confirmar todos os jobs vazios e release `off`;
3. armar `arm_whatsapp_homologation_v1(<telefone de teste>, 30–60)`;
4. ativar Make scenario `6779824`;
5. pedir ao usuário para enviar **uma mensagem de texto nova**;
6. validar ingest e welcome/menu determinístico ainda com IA desligada;
7. depois abrir IA/worker somente dentro da janela/allowlist;
8. testar texto IA;
9. testar áudio inbound → transcrição → resposta Marin B;
10. testar imagem inbound → visão;
11. fechar `close_whatsapp_homologation_v1()`;
12. desligar scenario inbound novamente se a homologação terminar;
13. auditar zero efeito em Bling e zero job incerto.

**Não pedir configuração manual ao usuário antes do passo 5.** As conexões Meta/OpenAI já estão funcionais. A autorização Supabase→Make que chegou a ser iniciada como plano B não é necessária na arquitetura v3 e pode ser ignorada.

---

## Estado da Etapa 1 — Sala de Compra + motor comercial

Concluída.

PR #145 foi incorporada anteriormente com motor comercial determinístico e Edge isolada `shopping-room-sales-v1`.

A Sala de Compra oficial fica em:

`/comprar/`

Princípios:

- WhatsApp e Sala representam a mesma venda/conversa;
- não obrigar cliente de WhatsApp a usar site;
- interface visual ajuda quando necessário;
- carrinho, preços e estoque são validados no backend;
- recomendações comerciais são relevantes e não insistentes.

Motor comercial:

- não recomenda item já no carrinho;
- histórico do próprio cliente tem peso alto;
- afinidade, oferta e upsell aumentam score;
- rejeição recente exclui/penaliza;
- máximo inicial de 2 iniciativas proativas por compra;
- “não quero” / “só a cesta” reduz pressão a zero;
- cliente com pressa segue para checkout;
- sem recomendação forte, não oferecer.

Edge de produção:

`shopping-room-sales-v1`

Mantém OpenAI, Meta e Bling fora da decisão comercial determinística.

---

## Estado da Etapa 2 — OpenAI

Concluída.

Homologações reais controladas passaram para:

- texto;
- transcrição de áudio;
- visão de imagem.

Worker:

- `scripts/conversation-worker-v1.mjs`
- `scripts/lib/conversation-core-v1.mjs`

Modelos base atualmente usados/configuráveis:

- conversa/visão: `gpt-4o-mini`;
- transcrição: `gpt-4o-mini-transcribe`;
- TTS: `gpt-4o-mini-tts`.

### Voz oficial escolhida

O usuário comparou vozes e estilos reais no WhatsApp e escolheu:

- voz: **Marin**;
- perfil: **B — atendente natural/humanizada**;
- id técnico: `dona_antonia_marin_b_v1`.

Características:

- português brasileiro natural;
- mulher adulta;
- calorosa e tranquila;
- sem tom de locutora/URA/propaganda;
- pausas e variação natural de ritmo;
- respostas curtas e conversacionais.

O TTS do atendimento deve usar o endpoint direto da OpenAI porque precisamos do campo `instructions` completo.

---

## Etapa 3 — arquitetura WhatsApp oficial

Visão simplificada:

```text
Meta WhatsApp
   │
   ▼
Make inbound
   │
   ▼
Supabase ingest / Postgres / Storage
   │
   ├── IA quando gates permitem
   │
   └── outbound_jobs seller_message
             │
             ▼
          pg_net
             │
             ▼
Make outbound v3
   │          │
 texto      Marin B
   │          │
   └──── Meta WhatsApp
             │
             ▼
      Webhook Response
             │
             ▼
      net._http_response
             │
             ▼
       reconciliação DB
```

### Inbound

Make scenario:

`6779824 — Dona Antônia - WhatsApp Inbound Controlado v1`

Fluxo:

- trigger WhatsApp Business Cloud;
- filtro de inbound verdadeiro;
- adaptador flat para Supabase;
- dedupe por message id;
- customer/conversation;
- texto/interativos;
- para áudio/imagem: download Meta + Storage privado;
- job de transcrição/visão quando gates permitem.

Os módulos HTTP v4 agora possuem explicitamente os campos avançados de runtime; isso corrigiu o `BundleValidationError` observado na criação inicial.

### Outbound v3

Make scenario:

`7290488 — Dona Antônia - WhatsApp Outbound Event-Driven v3`

Não usa polling e não faz callback HTTP Make→Supabase.

O Postgres:

1. valida gates e janela de atendimento;
2. bloqueia o job exato;
3. manda o job completo pelo `pg_net` ao webhook Make guardado no Vault;
4. Make envia pela Meta;
5. Make devolve `provider_message_id` na resposta síncrona do webhook;
6. `net._http_response` guarda o resultado;
7. Postgres reconcilia e só então marca `sent`.

Se houver qualquer dúvida de que a Meta possa ter recebido a tentativa, o job vai para `review_required` e **não é reenviado cegamente**.

### Outbound legado

`7290290 — LEGACY - NÃO USAR - WhatsApp Outbound HTTP v1`

Deixado inativo somente como referência. Não reativar.

---

## Segurança de release do WhatsApp

Gates principais:

- `whatsapp_release_mode`;
- `whatsapp_inbound_enabled`;
- `whatsapp_auto_reply_enabled`;
- `whatsapp_inbound_since`;
- `ai_enabled`;
- `conversation_worker_enabled`.

Release modes:

- `off` — fechado;
- `observe` — ingest permitido, respostas ainda controladas;
- `homologation` — somente allowlist temporária;
- `live` — geral, ainda sujeito aos demais gates.

### Anti-backlog

Eventos anteriores a `whatsapp_inbound_since` são recusados antes de criar cliente/conversa.

### Homologação allowlisted

Tabela server-only:

`whatsapp_test_allowlist`

RPCs:

- `whatsapp_release_decision(...)`;
- `arm_whatsapp_homologation_v1(...)`;
- `close_whatsapp_homologation_v1()`;
- `expire_whatsapp_homologation_v1()`.

A allowlist é aplicada no próprio banco antes do core de ingest. O número de teste nunca deve ser commitado no GitHub.

Cron de expiração roda a cada minuto e fecha automaticamente a homologação.

### Health e emergency stop

RPCs:

- `get_whatsapp_bridge_health_v1()`;
- `whatsapp_bridge_emergency_stop_v1(reason)`;
- `dispatch_whatsapp_outbound_healthcheck_v3()`;
- `reconcile_whatsapp_outbound_responses_v3()`;
- `recover_whatsapp_outbound_dispatch()`.

Emergency stop:

- fecha release/inbound/auto-reply/IA/worker;
- desativa allowlist;
- cancela jobs ainda não enviados;
- jobs já em processamento vão para revisão, não retry.

---

## Supabase

Projeto:

- ref `ssbesxgaijknwsjbsbcz`;
- região São Paulo `sa-east-1`;
- PostgreSQL 17.

Responsabilidades:

- banco operacional;
- clientes/conversas;
- produtos fisicamente adotados;
- cestas/carrinhos/pedidos;
- Storage privado;
- filas de IA/outbound/Bling;
- funções determinísticas;
- Auth/Admin.

Segurança:

- nunca versionar service role, Meta, Bling ou OpenAI keys;
- server-only tables fechadas para anon/authenticated;
- Edge pública apenas quando há autenticação custom adequada;
- mídia privada e URLs assinadas;
- idempotência obrigatória.

Edge WhatsApp de produção no fechamento:

- `whatsapp-ingest` v3;
- `whatsapp-ingest-make-v1` v1;
- `whatsapp-outbound-v1` v4.

`whatsapp-outbound-v1` v4 não transporta mais mensagens; ele apenas reporta health/status autenticado e retorna 410 para o protocolo antigo.

---

## Make

Princípio oficial:

> Make é ponte fina, não backend.

Conexões já funcionais:

- WhatsApp Business Cloud;
- OpenAI.

Não pedir ao usuário para criar uma conexão Supabase no Make para a arquitetura atual. O outbound v3 não precisa dela.

Inbound ainda usa HTTP para a Edge, agora com configuração v4 corrigida.

---

## Bling

Bling continua sendo ERP oficial, mas **não faz parte da homologação WhatsApp atual**.

Workers existentes:

- `scripts/bling-order-writer-v1.mjs`;
- `scripts/bling-stock-writer-v1.mjs`;
- `scripts/bling-product-writer-v1.mjs`.

Pedido real só será homologado depois do WhatsApp ponta a ponta.

Regras das cestas:

- cesta tem preço comercial próprio;
- preço não é soma dos componentes;
- cliente não vê preços individuais;
- Bling recebe componentes individualizados;
- diferença positiva vai para Outras despesas;
- diferença negativa vira desconto;
- IA nunca calcula essa diferença.

---

## Gestão de produtos

Decisão mantida: não importar em massa todo legado.

Fluxo:

```text
produto físico
→ ler EAN
→ Firebase apenas como lookup legado quando existir
→ operador verifica dados/estoque/validade/localização
→ Supabase
→ fila Bling
```

Firebase não deve crescer como banco novo.

A página `/cadastro/` ainda é dívida de migração para Supabase.

---

## CRM / evolução comercial futura

Requisitos documentados em `docs/EVOLUCAO-COMERCIAL-DONA-ANTONIA.md`:

- salvar todos os pedidos/histórico;
- relatórios no admin;
- recompra personalizada;
- cadência inicial pensada em ~15 dias, configurável;
- opt-in e templates Meta quando necessário;
- aniversário opcional para benefício no mês;
- recomendações baseadas no próprio perfil/histórico;
- ampliar o leque de compra com ofertas estratégicas relevantes;
- regras de validade/descontos determinísticas.

Não ativar campanhas em massa nesta etapa.

---

## URLs operacionais

- Admin: `/admin/`
- Contagem: `/contagem/`
- Cadastro legado: `/cadastro/`
- Sala de Compra: `/comprar/`
- `/catalogo/` redireciona para `/comprar/` preservando token.

Pagamento: somente na entrega.

Operação: somente entrega.

---

## O que continua NÃO liberado

- IA geral atendendo todos os clientes do WhatsApp;
- `whatsapp_release_mode=live`;
- automação comercial de marketing/recompra em massa;
- criação indiscriminada de pedido real no Bling;
- writers Bling automáticos amplos;
- remoção do Firebase antes de migrar cadastro;
- campanhas de validade/desconto sem controle de lote/preço consistente.

---

## Ordem recomendada após concluir a homologação WhatsApp

1. homologar texto/áudio/imagem no número allowlisted;
2. fechar homologação e auditar;
3. decidir liberação gradual do WhatsApp;
4. homologar um pedido Bling real controlado;
5. finalizar fechamento/retorno do pedido no WhatsApp;
6. migrar `/cadastro/` para Supabase;
7. evoluir CRM, relatórios, recompra e aniversário;
8. só depois acabamento final/home pública/campanhas.

---

## Regra de trabalho

O usuário pediu explicitamente:

- programar grandes blocos por rodada;
- manter padrão profissional e modular;
- analisar o projeto de forma global;
- fazer funcionar ponta a ponta antes de polir detalhes;
- buscar baixo custo;
- evitar operações Make desnecessárias;
- nunca ativar integração perigosa sem validação controlada;
- atualizar o GitHub para que uma nova conversa retome exatamente daqui.

### Instrução para um novo chat

> Acesse o GitHub `osvaldosereia/SUCEDOAN12`, leia `docs/RETOMADA-DONA-ANTONIA.md` e `docs/WHATSAPP-BRIDGE-V3.md`, consulte o estado real no Supabase e Make e continue exatamente do ponto indicado. Programe o máximo possível por rodada, mantendo os gates fechados fora de homologação controlada.
