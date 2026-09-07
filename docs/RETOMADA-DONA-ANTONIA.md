# RETOMADA — Projeto Dona Antônia

Atualizado em **2026-09-07 13:25 (America/Campo_Grande)**.

Este arquivo é a referência principal para retomar o projeto em uma nova conversa. Ele está mais atualizado que `docs/ARQUITETURA-DONA-ANTONIA-V2.md`, que contém decisões anteriores e deve ser usado apenas como contexto complementar.

## Como retomar em um novo chat

Use a instrução:

> Acesse o GitHub `osvaldosereia/SUCEDOAN12`, leia `docs/RETOMADA-DONA-ANTONIA.md` e continue exatamente do ponto indicado, programando o máximo possível por rodada com padrão profissional e sem ativar integrações reais perigosas sem validação controlada.

## Objetivo do projeto

Construir o sistema operacional e comercial da **Dona Antônia Cestas e Supermercado**, com atendimento altamente automatizado pelo WhatsApp e uma **Sala de Compra** visual integrada à mesma conversa/carrinho.

A experiência deve permitir ao cliente:

- comprar somente pelo WhatsApp, inclusive por áudio;
- abrir a Sala de Compra quando a experiência visual ajudar;
- alternar WhatsApp ↔ Sala sem perder carrinho/conversa;
- escolher e personalizar cestas;
- adicionar produtos complementares;
- usar texto, áudio e foto;
- informar/confirmar cadastro e endereço;
- conferir e confirmar o pedido;
- receber confirmação final pelo WhatsApp após o pedido oficial chegar ao Bling.

A automação deve agir como uma boa vendedora de varejo: relevante, contextual, sem insistir quando o cliente demonstra desinteresse.

## Arquitetura oficial

```text
WhatsApp/Meta ──────┐
                    ├── Conversation Engine ── Supabase/Postgres
Sala de Compra ─────┘                 │
                                      ├── OpenAI somente quando necessário
                                      ├── regras determinísticas de preço/estoque
                                      └── carrinho/pedido
                                               │
                                      GitHub Actions / workers
                                               │
                                              Bling
                                               │
                                      fila outbound WhatsApp
```

### Responsabilidades

- **GitHub:** código, deploy, CI, migrations, Edge Functions versionadas e Actions.
- **Supabase:** banco operacional, clientes, conversas, produtos adotados, histórico, carrinhos, pedidos, recomendações, Storage, Auth e funções de negócio.
- **Make:** ponte fina com WhatsApp/Meta e integrações em que trouxer vantagem; nunca deve virar o backend principal.
- **Bling:** ERP oficial, contatos fiscais, produtos ERP, estoque oficial e pedido oficial.
- **OpenAI:** compreensão/conversa/transcrição/visão/TTS quando realmente necessário. Preço, estoque, regras e criação de pedido ficam determinísticos.
- **Firebase:** legado temporário somente para localizar/enriquecer produtos durante a conferência física. Não é o banco novo.

## Endereços públicos/operacionais definitivos

- Admin: `https://donaantonia.com.br/admin/`
- Contagem: `https://donaantonia.com.br/contagem/`
- Cadastro atual: `https://donaantonia.com.br/cadastro/` — **ainda possui legado Firebase/Make e precisa ser migrado depois**.
- Sala de Compra: `https://donaantonia.com.br/comprar/`
- `/catalogo/` foi transformado em redirecionamento para `/comprar/` preservando token.

Não expor `v2`, `v3` etc. nas URLs de operação. Versões podem permanecer internamente em nomes técnicos de arquivos/functions.

## Site principal planejado

A home atual ainda não deve ser considerada definitiva. Decisão aprovada para o futuro `www.donaantonia.com.br`:

```text
DONA ANTÔNIA

[ Encomendar por WhatsApp ]
[ Encomendar pelo site ]
```

Entrando pelo site, usar a Sala de Compra com menu:

- Cestas Básicas
- Mercearia Completa
- Limpeza e Lavanderia
- Higiene e Beleza
- Casa e Pet

Checkout do site é apenas conferência/fechamento da encomenda; pagamento é na entrega.

## Supabase

Projeto:

- ref: `ssbesxgaijknwsjbsbcz`
- região: São Paulo `sa-east-1`
- PostgreSQL 17

O primeiro usuário Auth já foi criado e vinculado como **owner**. O Admin `/admin/` já autentica corretamente.

RLS continua habilitado e as tabelas server-only estão fechadas para `anon/authenticated`. Avisos `RLS enabled no policy` do Advisor são intencionais enquanto o acesso é feito por Edge Functions/service role.

### Segurança

- nunca colocar service role, chaves Meta/Bling/OpenAI ou PII no GitHub/browser;
- Edge Functions administrativas usam JWT + `admin_users`;
- Sala de Compra pública usa token aleatório da sessão, CORS restrito aos domínios Dona Antônia e rate limiting;
- mídia da Sala vai para bucket privado e é entregue por signed URL;
- writes críticos ficam no backend;
- idempotência obrigatória em mensagens/pedidos.

## Gestão de produtos / contagem

Decisão mantida: **não importar em massa todos os produtos antigos**.

Fluxo oficial:

```text
produto físico na prateleira
→ celular lê EAN
→ Firebase legado localiza cadastro quando disponível
→ operador confere estoque/validade/preço/localização/status
→ Supabase recebe produto fisicamente verificado
→ fila Bling
→ worker GitHub Actions
```

A Contagem permite editar:

- estoque;
- validade;
- preço de custo;
- preço de venda;
- gôndola;
- prateleira;
- ativo/inativo.

Regra obrigatória:

```text
estoque = 0
→ produto inativo
→ fora do WhatsApp
→ saldo zero continua podendo ir para o Bling
```

Produtos com estoque maior que zero podem permanecer ativos ou ser desativados manualmente.

Não confiar em números de quantidade de produtos citados em chats antigos: consultar o Supabase no início da nova conversa, pois a contagem física continua em andamento.

## Admin

Admin definitivo em `/admin/`.

Já contém base para:

- dashboard;
- produtos conferidos;
- edição de produto;
- cestas básicas;
- clientes/histórico/recomendações;
- sessões de contagem;
- fila Bling.

Editor de produtos administra nome, SKU, EAN, NCM, preço venda/custo, marca, categoria, embalagem, validade, gôndola/prateleira, imagem, descrições, tags, oferta, upsell, WhatsApp e ativo/inativo.

Cestas usam somente produtos fisicamente verificados.

## Regra comercial/fiscal das cestas

Regra confirmada pelo usuário:

- a cesta tem **preço comercial próprio**;
- o preço da cesta **não é a soma dos produtos**;
- o cliente não vê preço individual dos componentes da cesta;
- no pedido real do Bling os produtos da cesta são enviados **individualmente**;
- diferença positiva entre soma fiscal dos produtos e preço comercial final vai como **Outras despesas**;
- diferença negativa, quando existir, deve ser tratada como desconto;
- IA nunca calcula essa diferença.

## Sala de Compra — conceito oficial

O antigo conceito de “mini catálogo” foi absorvido pela **Sala de Compra**.

A Sala não substitui o WhatsApp. Ela é uma extensão visual da mesma venda, usando a mesma `conversation_id`, `customer_id` e `cart_id`.

WhatsApp continua sendo:

- porta de entrada;
- canal simples para clientes que preferem áudio/texto;
- retomada;
- notificações;
- confirmação final.

Sala de Compra é usada para:

- catálogo;
- ofertas;
- cesta editável;
- carrosséis/cards;
- busca;
- carrinho;
- cadastro;
- endereço;
- conferência;
- áudio/foto/texto;
- finalização.

Cliente pode ser classificado como:

- `catalog_first`
- `hybrid`
- `whatsapp_only`
- `auto`

O sistema aprende comportamento e não deve obrigar cliente de WhatsApp a sair do WhatsApp.

## Sala de Compra — código atual

Diretório: `comprar/`.

Arquivos principais:

- `comprar/index.html`
- `comprar/app.js`
- `comprar/style.css`
- `comprar/room-v2.css`
- `comprar/config.js`

Edge Function:

- `supabase/functions/shopping-room-v1/index.ts`
- produção estava em **version 3** no momento desta retomada.

A Sala já possui/foi preparada para:

- abrir sessão por token;
- criar sessão vinda diretamente do site (`create_web_room`);
- categorias comerciais;
- busca de produtos;
- ofertas;
- recomendações;
- cestas;
- personalização de cesta;
- carrinho persistente;
- checkout;
- identificação de cliente;
- CPF/CNPJ quando necessário;
- endereço;
- pagamento “na entrega”;
- retorno ao WhatsApp;
- upload de áudio e foto;
- Storage privado;
- fila de processamento de IA para transcrição/visão.

CI da Sala valida `MediaRecorder`, upload de mídia, criação web, identificação, regras de segurança e ausência de secrets no frontend.

## Migrations recentes importantes

### Núcleo Sala

- `supabase/migrations/20260907152000_shopping_room_core_v1.sql`

### Identidade, mídia e segurança

- `supabase/migrations/20260907160549_shopping_room_identity_media_and_security.sql`

Inclui, entre outros:

- `channel = whatsapp|web|hybrid` em conversas;
- sessões web;
- normalização/variantes de telefone brasileiro, incluindo 8/9 dígitos;
- identificação de cliente por telefone/documento;
- Storage/mídia;
- rate limits públicos;
- `room_identify_customer`;
- `room_save_address`;
- fila de jobs de IA para mídia.

### Resolução de cliente Bling e fila outbound

- `supabase/migrations/20260907160650_order_customer_resolution_and_outbound_queue.sql`

Inclui:

- `outbound_jobs` com dedupe;
- `bind_bling_contact_id`;
- pedido exige cliente/documento suficiente antes da integração;
- preparação da confirmação final via WhatsApp;
- reforço do checkout/identificação.

### Fila de pedido Bling

- `supabase/migrations/20260907161000_order_sync_queue_v1.sql`

Inclui `order_sync_jobs`, claim/finish e estado `review_bling` para casos ambíguos.

### Motor comercial contextual

Último avanço funcional antes deste arquivo:

- commit `8801b6635bdf67585f5e79a7c21deec40b8eef7a`
- migration `supabase/migrations/20260907162325_cart_aware_sales_recommendation_engine.sql`

Foi criado:

- `sales_offer_events`;
- `record_sales_offer_event(...)`;
- `get_cart_aware_recommendations(...)`;
- `plan_next_sales_move(...)`.

Regras do motor:

- não recomendar item já no carrinho;
- histórico do próprio cliente tem peso alto;
- ofertas, categorias de afinidade e produtos de upsell aumentam score;
- produto rejeitado recentemente é excluído;
- ofertas repetidas são penalizadas;
- no máximo 2 iniciativas comerciais proativas por compra como regra inicial;
- se cliente disser “não quero”/“só a cesta”, `sales_pressure_level=0` e segue para checkout;
- se cliente demonstrar pressa, segue para checkout;
- checkout não deve ter upsell agressivo;
- sem recomendação realmente relevante, não oferecer nada.

## Histórico de compras / inteligência do cliente

Estruturas já preparadas:

- `orders`
- `order_items`
- `customer_product_stats`
- `customer_behavior_events`
- `sales_offer_events`

Cada pedido confirmado deve alimentar estatísticas por produto/cliente para permitir:

- “você costuma comprar…”;
- ofertas de produtos realmente relevantes;
- lembrar itens que o cliente costuma levar e não colocou no pedido atual;
- preferir texto/áudio conforme comportamento;
- aprender uso da Sala vs WhatsApp.

## Conversational selling

Campos em `conversations` já incluem:

- `mode = ai|human|paused`
- `sales_pressure_level` 0..3
- `proactive_offer_count`
- `upsell_declined`
- `fast_checkout`
- `last_offer_at`
- `room_last_active_at`
- takeover humano / retorno à IA.

Princípio:

> IA conversa e vende; interface apresenta; backend valida; Bling registra.

A IA nunca deve:

- inventar preço;
- prometer estoque;
- alterar carrinho sem validação;
- criar pedido sem confirmação explícita;
- insistir depois de rejeição.

Áudio da vendedora deve ser curto e usado quando melhora a experiência. Listas, totais, endereço e confirmação permanecem visuais/escritos.

## Bling — pedido oficial

Worker:

- `scripts/bling-order-writer-v1.mjs`
- `.github/workflows/bling-order-writer-v1.yml`

CI:

- `.github/workflows/test-order-sync.yml`

O teste da fila de pedidos Bling terminou em **success** antes desta retomada.

O writer:

- inicia em `dry-run`;
- usa `concurrency: bling-api-global`;
- valida subtotal fiscal + outras despesas - desconto = total;
- exige Bling Product ID nos itens;
- resolve contato Bling pelo CPF/CNPJ quando necessário;
- cria contato se realmente não existir;
- vincula `bling_contact_id` ao cliente Supabase;
- cria pedido em `POST /pedidos/vendas`;
- envia produtos individualizados;
- envia `outrasDespesas` da cesta;
- pagamento descrito como na entrega;
- se a rede falhar depois de iniciar criação do pedido/contato, usa estado de revisão, sem retry cego para evitar duplicidade.

O cenário Make legado grande `5897739` foi estudado somente como referência para os payloads reais do Bling. Ele não é base da arquitetura nova.

## Estoque e produtos → Bling

Workers já existentes:

- `scripts/bling-stock-writer-v1.mjs`
- `.github/workflows/bling-stock-writer-v1.yml`
- `scripts/bling-product-writer-v1.mjs`
- `.github/workflows/bling-product-writer-v1.yml`

Todos continuam protegidos; não transformar em writes automáticos indiscriminados.

## WhatsApp/Meta/Make

Conta correta:

- WABA: `840102181903253`
- Phone Number ID: `1218939807961094`
- número: `+55 65 8449-1018`
- conexão Make saudável: `10607999`

A conexão anterior `10606991` apresentou 401 e **não deve ser usada**.

O cenário de teste WhatsApp `Dona Antônia - TESTE WhatsApp 1018` já recebeu mensagens reais com sucesso e demonstrou o payload. Foi deixado inativo após o teste para evitar consumo/acidente. Antes de confiar no status, consultar o Make novamente no novo chat.

Payload inbound real já confirmado possui:

- `metadata.phone_number_id`;
- contato/`wa_id`;
- `messages[].id` para idempotência;
- `messages[].type`;
- texto e mídia conforme evento.

Arquitetura desejada do Make:

```text
WhatsApp trigger
→ filtro de inbound verdadeiro
→ UMA chamada ao backend/Supabase
→ fim
```

Não colocar AI/Bling/30 módulos dentro do Make.

## Fila outbound WhatsApp

`outbound_jobs` já existe no Supabase, mas o worker/ponte final de envio pelo WhatsApp ainda deve ser concluído.

O outbound deve respeitar:

- `automation_config.outbound_enabled`;
- dedupe key;
- janela de atendimento/template quando aplicável;
- conta WhatsApp correta;
- confirmação de pedido somente após Bling confirmar;
- idempotência do provider message id.

## Automação global — segurança

`automation_config` foi criado inicialmente com:

- `automation_enabled = false`
- `ai_enabled = false`
- `outbound_enabled = false`

Antes de ativar produção, consultar o estado atual e manter kill switch. Não presumir que flags mudaram sem ler o Supabase.

## OpenAI / áudio / imagem

Decisão de custo-benefício:

- usar modelo barato/rápido quando resolve;
- escolher modelo melhor quando a diferença de preço for pequena e a melhora de qualidade justificar;
- AI não deve ser chamada para botões/ações determinísticas;
- transcrever somente áudio;
- visão somente imagem quando necessário;
- TTS apenas em respostas curtas que tenham valor comercial/conversacional.

A Sala já enfileira mídia para `transcription`/`vision`, mas **o worker real de IA que consome esses jobs ainda é um próximo passo**.

## Cadastro de produtos

A página `/cadastro/` ainda é o ponto mais importante de dívida legada: ela ainda usa Firebase/Make para produto novo.

Direção aprovada:

```text
EAN/foto
→ consulta Firebase só para legado
→ se existe: encaminhar para contagem
→ se novo: IA ajuda cadastro + imagem
→ salvar no Supabase
→ fila produto Bling
```

Não expandir o Firebase novo.

## Make legado

O sincronizador agendado `6567836 — Disparar sincronizacao Firebase para Bling` foi desativado.

Existem cenários temporários/on-demand de importação Bling → Supabase. Não executar importação massiva sem motivo; a decisão é adoção física progressiva.

## O que NÃO está liberado ainda

- IA conversando autonomamente com cliente real no WhatsApp;
- outbound automático de confirmação/status;
- envio real indiscriminado de pedidos ao Bling;
- writers de estoque/produtos em automação ampla;
- substituição completa da home principal;
- remoção definitiva do Firebase;
- cadastro novo 100% Supabase;
- worker de áudio/visão/TTS completo.

## Próximo ponto exato de programação

Na próxima conversa, **não voltar a planejar do zero**. Primeiro ler este arquivo e consultar estado real no Supabase/GitHub/Make.

Prioridade técnica recomendada:

1. **Concluir o Conversation Engine e jobs de IA**:
   - worker de `ai_jobs` para transcrição de áudio;
   - visão de imagem;
   - roteamento estruturado da intenção;
   - resposta em texto e opção TTS;
   - limitar chamadas por evento e registrar custo/uso.

2. **Concluir a Sala de Compra**:
   - renderização estável de áudio/imagem;
   - atualização de mensagens sem refresh completo (Realtime ou polling leve seguro);
   - tratamento de estados de processamento de mídia;
   - integração do `plan_next_sales_move()` no backend da Sala;
   - registrar `sales_offer_events` quando sugestões forem mostradas/adicionadas/rejeitadas;
   - cadastro/endereço/checkout bem validados no mobile.

3. **WhatsApp inbound fino**:
   - reabrir cenário 1018 somente em janela de teste;
   - trigger → backend único;
   - dedupe por `wamid`;
   - criar/localizar customer/conversation;
   - suportar texto/áudio/imagem;
   - depois desativar novamente até homologação.

4. **Outbound WhatsApp**:
   - consumir `outbound_jobs`;
   - enviar confirmação depois de `sent_to_bling`;
   - registrar provider message id/status;
   - dedupe;
   - manter `outbound_enabled=false` durante desenvolvimento.

5. **Pedido Bling controlado**:
   - conferir secrets e vínculos reais;
   - dry-run com pedido real de teste controlado;
   - validar contato, produtos, outras despesas e endereço;
   - somente depois um `apply` único e auditado.

6. **Migrar `/cadastro/` para Supabase** e reduzir Firebase a lookup legado.

7. **Nova home pública** somente depois que Sala + WhatsApp + fechamento estiverem estáveis.

## Últimos commits funcionais relevantes antes desta retomada

- `80f1a40c...` — adiciona áudio e foto à Sala de Compra
- `f5fa19ed...` — completa fluxo web, checkout e mídia
- `b86d2026...` — resolve/cria cliente no Bling antes do pedido
- `6892b17a...` — versiona identidade e mídia da Sala
- `d7f5728f...` — resolução de cliente e fila outbound
- `95313d8d...` — amplia CI da Sala
- `276adf9f...` — amplia CI de pedidos e resolução Bling
- `8801b663...` — motor comercial contextual/cart-aware

## Regra de trabalho para as próximas rodadas

O usuário pediu explicitamente:

- programar **grandes blocos por rodada**;
- manter padrão profissional/modular;
- analisar o projeto globalmente a cada avanço;
- priorizar primeiro fazer o sistema funcionar ponta a ponta;
- depois aperfeiçoar detalhes;
- controlar custos do Make e evitar operações desnecessárias;
- preferir backend/GitHub Actions quando mais barato e apropriado;
- registrar andamento no GitHub para que qualquer nova conversa possa continuar.

Ao terminar cada grande rodada futura, atualizar este arquivo `docs/RETOMADA-DONA-ANTONIA.md` com o novo ponto exato.