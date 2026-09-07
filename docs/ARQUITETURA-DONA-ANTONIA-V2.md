# Dona Antônia v2 — arquitetura operacional

Atualizado em 2026-09-07.

## Princípio central

O sistema novo não importa automaticamente todo o catálogo legado. O catálogo operacional é construído progressivamente com produtos realmente encontrados e conferidos fisicamente.

Fluxo principal de produto:

```text
Prateleira -> celular lê EAN -> Firebase legado localiza cadastro
          -> operador informa estoque + validade reais
          -> Supabase grava produto verificado + histórico da contagem
          -> fila bling_commands
          -> GitHub Action em lote
          -> Bling recebe BALANÇO de estoque
```

O GitHub armazena código e automações. Estoque, validade e demais dados operacionais não são gravados em commits.

## Autoridades por domínio

- Supabase: cérebro operacional, catálogo adotado, contagens, conversas, carrinhos, pedidos em construção e filas.
- Bling: ERP oficial, produto ERP, estoque oficial, contato fiscal e pedido oficial.
- Firebase: fonte legada temporária de enriquecimento para produtos existentes; será retirado depois da adoção do catálogo real.
- GitHub Actions: processamento em lote e integrações de manutenção.
- Make: ponte fina/transacional onde ainda for vantajoso; não é banco nem backend principal.
- Meta WhatsApp: canal oficial de atendimento.
- OpenAI: interpretação de linguagem, áudio, imagem e geração de respostas quando regras determinísticas não bastarem.

## Regra de cesta básica no Bling

No pedido oficial, os componentes da cesta são enviados individualmente. O preço comercial da cesta é independente da soma dos componentes. A diferença positiva entre o valor comercial final e a soma das linhas dos produtos é enviada ao Bling como `Outras despesas`. Se houver cenário em que o total comercial seja menor que a soma das linhas, a diferença deverá ser tratada por regra de desconto, não por despesa negativa.

## Contagem física v2

Aplicação: `contagem-v2/`.

Características:

- login Supabase Auth;
- autorização adicional por `admin_users`;
- leitura EAN pela câmera quando o navegador oferece `BarcodeDetector`;
- entrada manual de EAN/código como fallback;
- busca direta por chave Firebase e fallback no catálogo administrativo derivado do Firebase;
- tentativa de abrir novamente o registro fresco no Firebase pelo `firebase_key`;
- operador confirma estoque, validade, gôndola e prateleira;
- produto só entra no catálogo operacional depois de conferido;
- produtos novos da contagem entram com `is_whatsapp_active=false`; contar não significa publicar;
- cada gravação gera histórico em `inventory_count_items`;
- cada gravação gera comando `set_stock` para o Bling;
- contagens repetidas do mesmo produto substituem comandos pendentes antigos, mantendo o dado físico mais recente;
- fila offline local no celular para perda temporária de internet;
- sessão de contagem com início/fim e resumo.

## Estruturas Supabase de inventário

### products

Somente catálogo operacional/adotado. Campos relevantes adicionados: `firebase_key`, `brand`, categorias, embalagem, fornecedor, validade, gôndola, prateleira, `source_system`, `sync_status`, `last_counted_at`, `firebase_snapshot`, `physically_verified`, `physically_verified_at`, `physically_verified_by`, `sync_error`.

### inventory_counts

Sessões de contagem. Guarda operador, dispositivo, início, encerramento, quantidade de itens e pendências de sincronização.

### inventory_count_items

Registro imutável da conferência: estoque anterior, estoque contado, validade anterior, validade conferida, EAN, snapshot de origem e status de sincronização.

### bling_commands

Fila de integração. O worker reclama lotes com `FOR UPDATE SKIP LOCKED`, possui tentativas, lock, retry e resultado. Um comando `set_stock` mais novo cancela um comando `set_stock` ainda pendente para o mesmo produto.

## Worker GitHub -> Bling

Arquivos:

- `scripts/bling-stock-writer-v1.mjs`
- `.github/workflows/bling-stock-writer-v1.yml`

A primeira versão é manual e abre em `dry-run` por padrão. O modo `apply` deve ser usado somente depois do dry-run.

Funcionamento:

1. lê/reclama comandos pendentes no Supabase;
2. renova OAuth/JWT do Bling com `enable-jwt: 1`;
3. persiste o refresh token rotacionado de volta em GitHub Secrets;
4. identifica depósito padrão (ou usa `BLING_DEPOSIT_ID` explícito);
5. quando o produto ainda não tem `bling_product_id`, procura por GTIN/EAN no Bling;
6. grava estoque com operação de balanço `B`, usando a quantidade física final;
7. marca comando, item da contagem e produto como sincronizados;
8. falhas transitórias voltam para a fila com retry; após o limite ficam em erro.

O worker usa intervalo mínimo deliberadamente abaixo do limite oficial de 3 requisições/s da conta Bling.

### Secrets requeridos pelo workflow

- `BLING_CLIENT_ID`
- `BLING_CLIENT_SECRET`
- `BLING_REFRESH_TOKEN`
- `GH_SECRETS_TOKEN`
- `SUPABASE_SERVICE_ROLE_KEY` (ainda precisa ser configurada no repositório)

Nenhuma dessas chaves pode ser exposta em JavaScript público.

## Proteção contra importação massiva

A Edge Function `bling-products-ingest` foi endurecida. Importações em massa exigem uma janela temporária explícita via `claim_bling_import_gate()`. Fora dessa janela, retorna `bulk_product_import_disabled`.

Mesmo quando uma importação manual é temporariamente permitida, seus produtos entram como `imported_unverified` e não são publicados no WhatsApp.

## Edge Functions versionadas

- `supabase/functions/inventory-count-v2/index.ts`
- `supabase/functions/bling-products-ingest/index.ts`

A versão ativa de `inventory-count-v2` exige JWT e depois valida a existência de um usuário ativo em `admin_users`.

## Segurança

- tabelas operacionais usam RLS;
- anon/authenticated não recebem acesso direto às tabelas server-only;
- funções privilegiadas de inventário são executáveis somente por `service_role`;
- navegador recebe apenas publishable key;
- `inventory-count-v2` exige JWT e valida a role do operador;
- repositório público não deve receber PII, service role, credenciais Bling ou tokens Meta/OpenAI;
- o Advisor de segurança atualmente informa apenas `RLS enabled no policy` nas tabelas fechadas ao browser; isso é intencional enquanto o acesso ocorre por Edge Functions autenticadas.

## Estado atual em 2026-09-07

- carga temporária de 1.800 produtos do Bling foi removida depois de confirmado que não havia carrinhos, pedidos ou itens referenciando esses registros;
- `products` começa vazio para a adoção física real;
- `inventory-count-v2` está implantada;
- `contagem-v2/` está programada e versionada;
- fila do Bling e worker em GitHub Actions estão programados;
- importação massiva Bling está bloqueada por padrão;
- ainda não há usuários em Supabase Auth e `admin_users`, portanto o primeiro acesso precisa ser criado/autorizado antes do teste humano da microaplicação;
- o workflow do Bling precisa do secret `SUPABASE_SERVICE_ROLE_KEY` antes do primeiro dry-run.

## Próximos blocos

1. Criar primeiro usuário Auth e vinculá-lo como `owner` em `admin_users`.
2. Fazer 2–3 contagens reais no celular sem aplicar no Bling.
3. Configurar `SUPABASE_SERVICE_ROLE_KEY` no GitHub e executar workflow em `dry-run`.
4. Conferir depósito e matching GTIN; depois executar `apply` para poucos itens.
5. Construir o novo módulo Produtos/Admin sobre o catálogo fisicamente verificado.
6. Adicionar criação/edição/ativação/inativação de produto pela fila do Bling.
7. Só depois conectar esse catálogo confiável ao atendimento WhatsApp e às cestas.
