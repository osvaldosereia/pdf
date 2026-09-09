# CanecaFácil — Chat de personalização V1

## Decisão de produto

A loja continua visual para descoberta, busca, SEO, compartilhamento e compra rápida. O chat substitui a configuração visível da personalização.

Fluxos preservados:

1. Instagram/anúncio -> produto específico -> Comprar ou Personalizar.
2. Home/categoria/busca -> descoberta visual -> produto -> Comprar ou Personalizar.
3. Personalizar -> conversa curta -> prévia -> aprovação -> carrinho/checkout.

Não transformar a home inteira em chat.

## Implementação desta branch

Arquivos novos:

- `loja-integrada/personalizar/chat-v1.js`
- `loja-integrada/personalizar/chat-v1.css`
- `scripts/test-canecafacil-chat-v1.mjs`

Arquivo alterado:

- `loja-integrada/personalizar/index.html`

O `app-v15.js`, `native-cart-v2.js`, geração via Make, CF-ID, prévia, Minhas Artes e carrinho nativo permanecem como estavam.

### Como funciona

O formulário existente continua no DOM e continua sendo o contrato operacional da geração. A camada de chat o preenche por trás e o oculta somente depois de inicializar corretamente. Se o chat não carregar, o formulário continua sendo o fallback.

O cliente vê uma pergunta por vez. Campos opcionais podem ser pulados. Foto aparece somente quando o campo correspondente chega na conversa. E-mail é perguntado no fim, antes de gerar.

Nomes, frases, mensagens e textos exatos recebem confirmação antes da geração para reduzir erro de transcrição/digitação.

A primeira versão usa `SpeechRecognition`/`webkitSpeechRecognition` como ditado quando o navegador oferece suporte. Não há chave OpenAI no navegador.

## Próxima camada: agente de IA

A interface já deve continuar igual. A evolução é trocar a seleção local da próxima pergunta por um endpoint server-side/Make que receba o estado e devolva apenas a próxima ação necessária.

Contrato sugerido do endpoint:

```json
{
  "action": "personalization_chat_turn",
  "session_id": "...",
  "model_id": "...",
  "product_name": "...",
  "user_message": "...",
  "allowed_fields": [
    {"id":"nome","label":"Nome","required":true,"type":"text"}
  ],
  "current_values": {"nome":"Maria"},
  "conversation": []
}
```

Resposta:

```json
{
  "ok": true,
  "assistant_text": "Já estou imaginando. Qual frase deve aparecer?",
  "field_updates": {"nome":"Maria"},
  "next_field_id": "frase",
  "confirm_exact": null,
  "request_photo": false,
  "ready_to_generate": false
}
```

Regras obrigatórias:

- o agente só pode preencher/alterar campos liberados no cadastro do modelo;
- nome/frase exatos sempre devem ser confirmados visualmente;
- se já houver informação suficiente, o agente deve parar de perguntar;
- cor, composição e decisões artísticas não essenciais devem ser inferidas, não perguntadas;
- preço, desconto, estoque, frete, prazo e pagamento nunca vêm da memória do modelo; vêm de APIs/regras do sistema;
- nenhum segredo OpenAI, Mercado Pago, Melhor Envio ou Loja Integrada pode ficar no JavaScript público.

## Áudio definitivo

Quando o endpoint de IA estiver ativo, substituir o ditado do navegador pelo fluxo assíncrono planejado:

1. `MediaRecorder` grava a mensagem.
2. O blob é enviado ao backend/Make.
3. OpenAI Transcribe retorna texto.
4. O agente atualiza o briefing e devolve a próxima pergunta em texto.
5. Botão `Ouvir` usa TTS somente sob demanda e pode cachear o áudio.

Isso mantém o chat barato e não exige Realtime.

## Checkout futuro dentro da conversa

A experiência pode continuar visualmente dentro do chat, mas as fontes de verdade ficam separadas:

- preço/quantidade/desconto: backend/regra comercial;
- frete/prazo: Melhor Envio;
- pagamento: Mercado Pago/checkout seguro;
- pedido: arquitetura transacional escolhida para produção.

Dados de cartão nunca passam pela IA.

## Critério de publicação

Antes de levar para `main`:

1. rodar `node scripts/test-canecafacil-chat-v1.mjs`;
2. testar desktop e mobile em um produto com texto, um com nome/frase e um com foto;
3. confirmar geração e CF-ID;
4. confirmar `APROVAR E COMPRAR` e carrinho original;
5. confirmar reabertura de criação existente;
6. confirmar que navegador sem reconhecimento de voz continua funcionando por texto.
