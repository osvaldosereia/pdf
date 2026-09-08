# Admin de Inteligência — modo simples do MVP

## Decisão

Para o MVP de atendimento e venda pelo WhatsApp, o Admin de Inteligência deve ser simples e operacional. O backend continua versionado e auditável, mas a interface não expõe complexidade técnica desnecessária.

## O que o usuário vê

A tela possui apenas três áreas:

1. **O que a IA deve saber** — fatos estáveis sobre empresa, cestas, pagamento, entrega, trocas, atendimento e outras informações úteis.
2. **Como a IA deve atender** — orientações de comportamento, tom, venda, perguntas, sugestões e condução da conversa.
3. **Regras importantes** — procedimentos/regras que a IA deve seguir em situações relevantes e limites que não pode quebrar.

## O que fica escondido no MVP

- chaves técnicas;
- prioridade numérica;
- tags;
- escopos técnicos de intenção/estágio;
- JSON de testes;
- biblioteca de mídia manual;
- configuração de runtime;
- prévia técnica do bundle.

Esses recursos permanecem no backend para evolução futura, sem dificultar o uso diário.

## Regras de UX

- criar conteúdo deve exigir apenas título + texto principal;
- chaves são geradas automaticamente;
- canal padrão é WhatsApp;
- prioridade padrão é alta e definida pelo sistema;
- salvar cria rascunho;
- publicar continua uma ação explícita do proprietário;
- fotos de produto vêm do catálogo próprio alimentado pelo contador, não desta tela;
- catálogo, preço e estoque continuam fora do prompt e vêm do banco em tempo real.
