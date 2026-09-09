# Estratégia IA Produto V2

A IA não altera produtos diretamente.

Fluxo:

Produto atual
→ Solicitação IA
→ Sugestão gerada
→ Revisão humana
→ Aprovação
→ Gravação futura

Ações independentes:

- nome
- descrição
- categoria
- NCM
- tags
- embalagem
- imagem

Campos críticos:

- categoria
- NCM

Esses sempre exigem revisão antes de qualquer gravação.

Nenhuma chave de IA deve existir no frontend. Integrações futuras devem ocorrer via serviço protegido ou Make.
