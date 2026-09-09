# Fase 2 — SEO, Merchant e páginas institucionais

## Concluído

- Firebase mantido em modo exclusivamente leitura.
- Home separada com carregamento inicial leve.
- Produtos carregados somente quando necessários.
- Gerador estático de páginas de cestas.
- Feed Merchant exclusivo para cestas básicas.
- Sitemap exclusivo para home, cestas e páginas institucionais.
- Relatório de cestas rejeitadas sem correção automática no Firebase.
- Validação automática contra métodos de escrita.
- Páginas institucionais novas e discretas:
  - Sobre nós;
  - Contato;
  - Política de entrega;
  - Trocas e reembolsos;
  - Política de privacidade;
  - Termos de uso;
  - Perguntas frequentes sobre cestas básicas.

## Regras preservadas

- Nenhum arquivo da raiz foi substituído.
- Nenhum dado do Firebase foi alterado.
- O site atual continua em produção.
- O projeto novo permanece em `site-do-zero/`.
- Produtos avulsos e kits não entram no Merchant.
- Produtos avulsos e kits não recebem páginas indexáveis.

## Próximos passos

1. Executar o gerador em ambiente de validação com acesso somente leitura.
2. Conferir o relatório da estrutura real do Firebase.
3. Ajustar apenas o leitor caso os nomes dos caminhos sejam diferentes.
4. Revisar as páginas geradas de todas as cestas.
5. Validar os dados estruturados.
6. Validar o XML do Merchant.
7. Publicar uma URL de homologação.
8. Executar PageSpeed em mobile e desktop.
9. Corrigir desempenho antes de ativar qualquer integração de pedido.
10. Somente depois da aprovação, planejar a troca controlada da produção.
