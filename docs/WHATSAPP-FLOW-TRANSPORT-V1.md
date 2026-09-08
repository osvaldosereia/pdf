# Dona Antônia — WhatsApp Flow Transport V1

Data: 08/09/2026

Status: **FUNDAÇÃO IMPLEMENTADA EM CÓDIGO, DORMENTE / FAIL-CLOSED**.

Esta etapa transforma a estratégia de WhatsApp Flows em uma fundação técnica de transporte e segurança. Ela **não publica Flow na Meta, não envia Flow a clientes, não altera carrinho, não muda o canary `live=1%` e não ativa Bling**.

## Princípio

```text
IA entende a missão
→ Orquestrador escolhe WhatsApp Flow quando permitido
→ backend cria sessão e token efêmero
→ Meta abre Flow reutilizável
→ Data Exchange chega criptografado
→ backend descriptografa e revalida dados
→ backend responde criptografado
→ somente uma etapa transacional futura poderá aplicar alterações
```

A IA não recebe nem controla chaves, token de sessão, criptografia, preços, estoque ou escrita de carrinho.

---

## Protocolo de Data Exchange

A implementação segue a referência vigente do WhatsApp Flows:

Entrada criptografada:

- `encrypted_aes_key`;
- `encrypted_flow_data`;
- `initial_vector`.

Criptografia:

- RSA-OAEP com SHA-256 para descriptografar a chave AES;
- AES-128-GCM para o payload;
- resposta criptografada com a mesma chave AES;
- IV da resposta obtido pela inversão bit a bit do IV recebido;
- falha ao descriptografar a chave RSA retorna semântica HTTP `421`, permitindo atualização da chave pública conforme o protocolo de referência.

A mensagem outbound futura usará o contrato Cloud API `interactive.type = flow`, com versão de mensagem `3`, `flow_token`, `flow_id`, CTA e ação apropriada (`data_exchange`/`navigate`).

---

## Edge Functions

### `whatsapp-flow-data-exchange-v1`

Endpoint público para a Meta, porém protegido pela criptografia do protocolo e pelos gates internos.

Quando for publicado em produção deverá usar `verify_jwt=false`, porque a Meta não envia JWT do Supabase. Isto **não significa endpoint aberto funcionalmente**: com os flags desligados ele retorna `flow_endpoint_disabled` antes de descriptografar qualquer payload.

Proteções:

- somente POST JSON;
- limite de tamanho;
- chaves vindas do Vault server-side;
- nenhum log de payload descriptografado, token, chave ou PII;
- `ping` suportado;
- erro do cliente é apenas reconhecido/auditado;
- token de Flow obrigatório para ações de negócio;
- sessão expirada/humana é rejeitada;
- resposta sempre criptografada após descriptografia válida;
- chamadas de negócio são revalidadas no PostgreSQL.

### `admin-whatsapp-flow-v1`

Endpoint JWT de Admin.

Primeira versão possui apenas ações seguras:

- dashboard/readiness;
- geração/rotação de par RSA somente para `owner` e com confirmação `GERAR_CHAVE_FLOW`;
- desativação de transporte.

**Não possui ação para habilitar Data Exchange ou envio.**

A chave privada gerada é enviada diretamente ao Vault por RPC service-role e não volta na resposta. O Admin recebe somente a chave pública e fingerprint.

---

## Chaves

RPC `install_whatsapp_flow_private_key_v1`:

- exige PKCS8 não criptografado (`BEGIN PRIVATE KEY`), adequado a WebCrypto;
- grava a chave privada no Supabase Vault;
- grava somente hash de integridade em `system_secrets`;
- grava chave pública/fingerprint na configuração operacional;
- muda `meta_signature_status` para `pending` após rotação;
- nunca retorna a chave privada.

RPC `get_whatsapp_flow_private_key_v1`:

- disponível somente a `service_role`;
- compara o SHA-256 da chave recuperada do Vault com o hash esperado;
- retorna `null` se a integridade/configuração falhar.

Estados da chave pública na Meta:

```text
unknown
pending
valid
invalid
```

O transporte não pode ficar pronto sem `valid`.

---

## Gates independentes

Novos flags em `automation_config`:

```text
whatsapp_flow_data_exchange_enabled = false
whatsapp_flow_send_enabled = false
```

Ambos nascem e terminam a migration como `false`.

Além deles, emissão de token exige simultaneamente:

1. `experience_orchestrator_enabled = true`;
2. Data Exchange ligado;
3. envio de Flow ligado;
4. chave privada íntegra no Vault;
5. chave pública configurada;
6. `meta_signature_status = valid`;
7. definição Flow `ready|active`;
8. `provider_id` real;
9. feature habilitada;
10. rollout incluir aquela conversa;
11. sessão ativa e não expirada;
12. conversa não estar sob takeover humano.

Mesmo que um flag seja ligado por engano, token não nasce com transporte incompleto.

---

## Token de Flow

`issue_whatsapp_flow_token_v1(session_id)` gera token aleatório de alta entropia.

Banco armazena somente:

```text
SHA-256(token)
issued_at
last_exchange_at
exchange_count
```

O token cru é devolvido uma única vez ao componente server-side que futuramente montar a mensagem `interactive.flow`.

O token cru não deve aparecer em:

- logs;
- `experience_events`;
- tabela de exchanges;
- Admin;
- navegador;
- GitHub.

---

## Auditoria sem PII

`whatsapp_flow_exchange_events` registra somente:

- sessão/conversa/definição;
- request ID;
- ação;
- tela;
- status;
- código de erro;
- horário.

A tabela deliberadamente não possui colunas para:

- payload;
- dados do formulário;
- `flow_token`;
- dados criptografados;
- corpo descriptografado.

Dados necessários para a regra de negócio permanecem na sessão/entidades oficiais, não em log de transporte.

---

## Flow Personalizar Cesta

Nesta fundação somente `flow-personalizar-cesta-v1` possui handler.

### INIT

Retorna:

```text
BASKET_EDIT
```

com o contrato já homologado pelo backend:

- foto/nome da cesta;
- preço comercial próprio da cesta;
- produtos e quantidades;
- limites de edição;
- sem preço individual dos componentes;
- sem custo;
- sem estoque numérico.

### BASKET_EDIT → Data Exchange

O retorno do celular é **entrada não confiável**.

`validate_basket_flow_selection_v1` revalida:

- produto pertencente à cesta;
- duplicidade;
- quantidade;
- item removível/editável;
- disponibilidade;
- snapshot completo.

Seleção válida segue para:

```text
BASKET_REVIEW
```

### BASKET_REVIEW

A escrita no carrinho está propositalmente bloqueada:

```text
write_enabled = false
error_code = flow_cart_apply_not_enabled
```

Nenhuma seleção de Flow desta etapa pode alterar carrinho/pedido.

---

## Readiness no Admin

O `admin-experience-orchestrator-v1` passa a agregar também `get_whatsapp_flow_transport_readiness_v1`.

O módulo visual dormente do Admin mostrará:

- contrato interno pronto;
- chave privada configurada ou não;
- status da chave pública na Meta;
- Data Exchange on/off;
- envio pronto/bloqueado;
- proteção de preço individual dos componentes.

A UI continua atrás de:

```text
experienceOrchestratorUiEnabled = false
```

Não há botão de ativação nesta fase.

---

## Testes obrigatórios

`scripts/test-whatsapp-flow-transport-v1.mjs` cobre:

- runtime default off;
- readiness false por padrão;
- nenhuma coluna de payload sensível na auditoria;
- sessão Flow existente mas token bloqueado enquanto runtime off;
- flags sozinhos insuficientes para emissão;
- key install sem retorno da private key;
- `pending` da Meta bloqueando envio;
- `valid` liberando readiness em fixture;
- somente hash do token persistido;
- token resolvendo sessão;
- token cru ausente dos eventos;
- INIT retornando contrato sem preço individual;
- validação de seleção;
- review sem escrita de carrinho;
- gate revalidado no handler;
- RPC da chave privada revogado de cliente e permitido apenas a service_role.

`crypto.test.ts` cobre o round-trip criptográfico Meta-style e HTTP 421 para chave privada incorreta.

---

## O que ainda NÃO existe

- Flow real criado/publicado na Meta;
- `provider_id` de produção;
- chave pública enviada/assinada na Meta;
- Data Exchange habilitado;
- envio de mensagem Flow no Make/outbound;
- aplicação da seleção no carrinho;
- homologação allowlisted do endpoint com a Meta;
- experimento A/B rodando;
- rollout de qualquer Flow;
- Bling.

---

## Ordem segura da próxima fase

1. passar CI desta fundação;
2. merge;
3. aplicar migrations em produção com flags `false`;
4. publicar os dois Edge Functions, mantendo endpoint desabilitado;
5. auditar que `live=1%` não mudou;
6. gerar par de chaves pelo backend Admin;
7. registrar somente a chave pública na Meta;
8. verificar assinatura/status da chave;
9. criar/publicar Flow real de personalização;
10. cadastrar `provider_id` mantendo feature/rollout em 0%;
11. abrir homologação Flow allowlisted separada;
12. testar ping/INIT/Data Exchange/review sem escrita;
13. só depois programar aplicação idempotente no carrinho;
14. somente depois avaliar A/B/rollout.

Nunca combinar a primeira homologação de Flow com a primeira homologação real de Bling.
