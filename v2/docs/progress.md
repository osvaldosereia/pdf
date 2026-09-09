# Progresso da reconstrução V2

## Fundação concluída

- configuração central de ambiente;
- catálogo compartilhado e seguro;
- bloqueio de catálogo vazio;
- detecção de queda anormal e IDs duplicados;
- cache controlado;
- carrinho e favoritos compartilhados;
- roteamento por hash;
- página inicial de catálogo, busca, categorias e detalhe do produto;
- cestas, kits e Compra rápida resolvidos por referências do catálogo;
- painel administrativo modular em modo seguro.

## Cadastro de produtos em homologação

- consulta por EAN;
- captura separada de fotos;
- compressão e armazenamento local em IndexedDB;
- preparação de pacote para Make/OpenAI;
- validação e revisão humana da resposta da IA;
- editor com comparação de alterações;
- rascunhos locais;
- checklist e ficha de homologação;
- publicação externa ainda bloqueada.

## Checkout e pedidos em homologação

- validação de cliente, endereço, pagamento e pedido mínimo;
- geração de envelope com fingerprint;
- fila local protegida contra duplicidade;
- ordem de canais definida: WhatsApp, Firebase de homologação e Make;
- mensagem e URL do WhatsApp preparadas para abertura manual;
- sessão de despacho com histórico por canal;
- fila de homologação local visível no admin, separada dos pedidos reais;
- bloqueio de reenvio para canais já concluídos;
- limite de tentativas compartilhado entre reprocessamentos.

## Reprocessamento administrativo

- reprocessamento separado para Firebase e Make;
- WhatsApp nunca é reenviado automaticamente;
- Make depende de Firebase concluído;
- venda do Bling confirmada bloqueia novo envio do Make;
- limite diário do Bling bloqueia repetição manual;
- motivo obrigatório antes da preparação;
- confirmação por frase específica do canal e pedido;
- solicitação com expiração de dez minutos;
- bloqueio de solicitações concorrentes para o mesmo canal;
- exceções de rede consomem tentativa e fecham a solicitação como falha;
- configuração bloqueada não consome tentativa;
- eventos de preparação, início, bloqueio, cancelamento, falha e conclusão registrados no histórico;
- execução externa continua desabilitada.

## Firebase de homologação

- nó exclusivo `homologacao_v2/pedidos`;
- rejeição por contrato de `/pedidos` e qualquer caminho sobreposto;
- leitura antes da gravação;
- idempotência por fingerprint;
- conflito protegido quando o mesmo ID contém outro fingerprint;
- timeout configurável;
- escrita ainda desabilitada.

## Make e Bling

- webhook do Make validado por HTTPS e host permitido;
- URL completa nunca exibida no admin;
- contrato versionado e idempotente;
- timeout, repetição exponencial e máximo de tentativas;
- repetição somente para falhas transitórias;
- Bling acessado exclusivamente pelo Make;
- nenhum token OAuth do Bling no navegador;
- confirmação obrigatória do mesmo envelope e da mesma chave de idempotência;
- confirmação obrigatória do contato e da venda no Bling;
- venda duplicada só é aceita com ID ou número da venda existente;
- tratamento de limite por segundo e limite diário;
- referência do contato e da venda preservada no histórico do pedido;
- Firebase, Make e Bling continuam sem execução real.

## Regras de segurança mantidas

- desenvolvimento somente na branch `rebuild-v2`;
- arquivos novos somente dentro de `v2/`;
- nenhuma alteração na branch `main`;
- nenhuma escrita no Firebase;
- nenhum webhook real acionado;
- nenhuma chamada direta ao Bling;
- nenhum envio automático pelo WhatsApp;
- checkout e publicação permanecem bloqueados para uso real.

## Próximas etapas prioritárias

1. executar os testes HTML em navegador e aparelhos reais;
2. adaptar o cenário do Make ao contrato V2 sem criar venda real;
3. criar um modo de ensaio do cenário com resposta simulada de contato e venda;
4. finalizar cupom, entrega e agendamento;
5. implementar separação, conferência e etiqueta;
6. habilitar escrita somente no nó de homologação após backup e teste manual;
7. concluir testes automatizados, segurança e plano de migração.
