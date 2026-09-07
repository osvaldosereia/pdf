# Dona Antônia v2 — arquitetura operacional

Atualizado em 2026-09-07.

## Princípio central

O sistema novo não importa automaticamente todo o catálogo legado. O catálogo operacional é construído progressivamente com produtos realmente encontrados e conferidos fisicamente.

```text
Prateleira -> celular lê EAN -> Firebase legado localiza cadastro
          -> operador informa estoque + validade reais
          -> Supabase grava produto verificado + histórico
          -> fila bling_commands
          -> GitHub Actions em lote
          -> Bling recebe estoque/produto
```

O GitHub armazena código, migrations e automações. Estoque, validade, clientes e demais dados operacionais não são gravados em commits.

## Autoridades por domínio

- **Supabase:** cérebro operacional, catálogo adotado, contagens, cestas, conversas, carrinhos, pedidos em construção, filas e auditoria.
- **Bling:** ERP oficial, produto ERP, estoque oficial, contato fiscal e pedido oficial.
- **Firebase:** fonte legada temporária para localizar/enriquecer produtos durante a conferência física; será retirado depois da adoção do catálogo real.
- **GitHub Actions:** processamento em lote e escrita assíncrona no Bling.
- **Make:** ponte fina/transacional onde ainda for vantajoso; não é banco nem backend principal.
- **Meta WhatsApp:** canal oficial de atendimento.
- **OpenAI:** interpretação de linguagem, áudio, imagem e geração de respostas somente quando regras determinísticas não bastarem.

## Regra de cesta básica no Bling

No pedido oficial, os componentes da cesta são enviados individualmente. O preço comercial da cesta é independente da soma dos componentes. A diferença positiva entre o valor comercial final e a soma das linhas dos produtos é enviada ao Bling como **Outras despesas**. Se houver cenário em que o total comercial seja menor que a soma das linhas, a diferença será tratada por regra de desconto, nunca por despesa negativa.

A composição comercial é administrada em `basket_templates` e `basket_template_items`. Contar preços individuais não redefine o `base_price` da cesta.

## Contagem física v2

Aplicação: `contagem-v2/`.

- login Supabase Auth + autorização adicional em `admin_users`;
- câmera/EAN, entrada manual e fallback por catálogo administrativo;
- busca no Firebase somente para localizar o legado;
- operador confirma estoque, validade, gôndola e prateleira;
- só entra no catálogo operacional depois da conferência;
- contar não publica: produto novo entra fora do WhatsApp;
- histórico imutável em `inventory_count_items`;
- comando `set_stock` para o Bling;
- contagem mais nova substitui comando de estoque pendente antigo;
- fila offline no celular;
- sessão de contagem com início/fim e resumo.

## Admin v3

Aplicação: `admin-v3/`.

Já implementado:

- dashboard operacional;
- produtos fisicamente conferidos;
- busca e filtros por WhatsApp, oferta, upsell, sem estoque, inativos e sincronização;
- editor completo de produto: nome, SKU, EAN, NCM, preço, custo, marca, unidade, categorias, embalagem, validade, localização, imagem, descrições, tags e flags comerciais;
- estoque deliberadamente fora do editor comum: ajuste físico deve passar pela contagem;
- ativação/inativação gera comando assíncrono para o Bling;
- alteração de campos ERP gera `update_product`;
- criação no Bling é explícita, nunca automática apenas por não haver vínculo;
- histórico de contagens, mudanças administrativas e comandos Bling;
- gestão de cestas com preço comercial independente;
- composição da cesta usa somente produtos fisicamente verificados;
- quantidade, remoção e edição de quantidade por item;
- sessões de contagem e fila Bling com retry.

### Primeiro owner

Aplicação: `setup-admin/`.

Existe um bootstrap de uso único. O usuário cria/entra em uma conta Supabase Auth e apresenta um código temporário. A Edge Function `bootstrap-owner-v1` promove somente o primeiro usuário para `owner`; depois desativa automaticamente o segredo de bootstrap. O código não fica no repositório.

## Gestão de produtos e auditoria

`products` contém somente catálogo operacional/adotado. Além dos dados trazidos da conferência, há campos de marketing, descrição, tags, estoque mínimo, upsell, status desejado no Bling e auditoria de edição.

`product_changes` registra alterações do Admin sem jogar o snapshot completo do Firebase em logs públicos.

`bling_commands` separa estado local da escrita no ERP. Comandos mais novos de `update_product`, status e estoque substituem comandos pendentes obsoletos do mesmo tipo.

## Workers GitHub -> Bling

### Estoque

- `scripts/bling-stock-writer-v1.mjs`
- `.github/workflows/bling-stock-writer-v1.yml`

Usa operação de balanço `B`, encontra produto por GTIN quando necessário, identifica depósito, respeita pacing/retry e inicia em `dry-run`.

### Produtos

- `scripts/bling-product-writer-v1.mjs`
- `.github/workflows/bling-product-writer-v1.yml`

Trata `create_product`, `update_product`, `activate_product` e `inactivate_product`. Para update/status sem Bling ID, tenta vincular por GTIN antes de qualquer criação. Criar produto exige comando explícito do Admin. O `PUT` preserva a estrutura atual do produto obtida do Bling e mescla os campos desejados; NCM é enviado dentro de `tributacao`.

Ambos usam `enable-jwt: 1`, rotação do refresh token e `concurrency: bling-api-global`, impedindo dois writers Bling simultâneos.

### Separação das filas

`claim_bling_commands_by_types()` permite cada worker reclamar somente os comandos que sabe executar. O claim legado do worker de estoque foi restringido a `set_stock`, evitando que um writer capture comandos de outro.

## Cestas

Backend: `admin-baskets-v1`.

Estruturas:

- `basket_templates`: nome, SKU, foto, descrição, preço comercial, status, WhatsApp, destaque e regras;
- `basket_template_items`: produto, quantidade, removível, quantidade editável, limites e grupo de substituição;
- `basket_changes`: auditoria administrativa.

Somente produtos `physically_verified=true` podem ser adicionados pela interface atual.

## Segurança

- RLS habilitado nas tabelas operacionais;
- anon/authenticated sem acesso direto às tabelas server-only;
- navegador recebe apenas publishable key;
- Edge Functions administrativas exigem JWT e validam `admin_users`;
- bootstrap do primeiro owner exige JWT + segredo temporário de uso único;
- service role, credenciais Bling, Meta/OpenAI e PII nunca entram no JavaScript público;
- repositório público armazena código, não estoque/validade/clientes;
- Advisor de segurança pode mostrar `RLS enabled no policy` para tabelas fechadas ao browser; isso é proposital enquanto o acesso ocorre por Edge Functions autenticadas.

## Make legado

O cenário `6567836 — Disparar sincronizacao Firebase para Bling`, que ainda estava ativo/agendado, foi **desativado em 2026-09-07**. O cenário antigo grande de pedidos/Firebase está em estado de erro e não é a base do novo desenho.

## Proteção contra importação massiva

`bling-products-ingest` exige uma janela temporária de importação. Fora dela retorna `bulk_product_import_disabled`. A carga temporária de 1.800 produtos foi removida após confirmar que não havia cestas, carrinhos ou pedidos dependentes dela.

## Edge Functions ativas do núcleo novo

- `inventory-count-v2` — JWT obrigatório;
- `admin-ops-v1` — JWT obrigatório;
- `admin-baskets-v1` — JWT obrigatório;
- `bootstrap-owner-v1` — JWT obrigatório e bootstrap de uso único;
- `bling-products-ingest` — legado protegido por gate;
- `whatsapp-ingest` — ponte de homologação já existente.

## Secrets requeridos nos Actions Bling

- `BLING_CLIENT_ID`
- `BLING_CLIENT_SECRET`
- `BLING_REFRESH_TOKEN`
- `GH_SECRETS_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY`

O último ainda precisa ser configurado no repositório antes de executar os writers com acesso ao Supabase.

## Estado atual

- catálogo operacional Supabase começa vazio para adoção física;
- contagem mobile, backend e fila estão implementados;
- Admin v3 de produtos e cestas está implementado;
- writers de estoque e produtos estão implementados e continuam `dry-run` por padrão;
- bootstrap seguro do primeiro owner está implementado;
- importação massiva está bloqueada por padrão;
- sincronizador legado Firebase -> Bling no Make foi desligado;
- testes automáticos validam Admin, contagem e sintaxe dos workers;
- ainda é necessário ativar o primeiro usuário owner e configurar `SUPABASE_SERVICE_ROLE_KEY` no GitHub para o primeiro teste ponta a ponta.

## Próximos passos operacionais

1. Ativar o primeiro `owner` por `setup-admin/`.
2. Fazer 2–3 contagens físicas reais pelo celular.
3. Configurar `SUPABASE_SERVICE_ROLE_KEY` em GitHub Secrets.
4. Executar writer de estoque em `dry-run` e validar produto/depósito.
5. Executar `apply` somente para poucos itens conferidos.
6. Começar a montar as cestas reais usando somente produtos verificados.
7. Depois conectar o catálogo confiável ao Conversation Engine/WhatsApp e ao fechamento de pedido Bling.
