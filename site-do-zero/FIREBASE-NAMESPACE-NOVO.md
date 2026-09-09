# Namespace isolado do novo site no Firebase

## Motivo

O diagnóstico somente leitura confirmou:

- `/produtos` está disponível para leitura e possui 1.524 produtos;
- `/cestas`, `/kits` e `/config_site/categorias` retornam HTTP 401;
- as cestas básicas não estão misturadas em `/produtos`;
- os únicos produtos com a palavra “cesta” são utensílios de bambu, não cestas básicas comerciais.

O novo site precisa usar o Firebase como fonte única em tempo de execução, mas não pode alterar a estrutura que sustenta o site atual.

## Estrutura proposta

Criar futuramente, após aprovação, um namespace completamente separado:

```text
/site_novo
  /publico
    /cestas
    /kits
    /categorias
    /config
    /versao
  /pedidos
```

## O que permanece intocável

O projeto novo não altera:

```text
/produtos
/pedidos
/kits
/cestas
/config_site
/cupons
/banners
```

A base `/produtos` atual continuará sendo consultada somente por `GET`.

## Fontes em produção

Depois da implantação do namespace:

- produtos avulsos: `/produtos`;
- cestas básicas: `/site_novo/publico/cestas`;
- kits promocionais: `/site_novo/publico/kits`;
- categorias leves da home: `/site_novo/publico/categorias`;
- configuração pública: `/site_novo/publico/config`;
- versão dos dados: `/site_novo/publico/versao`;
- pedidos do novo site, quando aprovados: `/site_novo/pedidos`.

O navegador não usará arquivos JSON do GitHub como fonte de catálogo.

## Migração inicial

Os arquivos atuais do repositório serão utilizados apenas uma vez para preparar um pacote de importação:

- `site/produtos-cesta-basica.json`;
- `site/kits.json`.

Isso não transforma os arquivos em fonte do novo site. Eles servem apenas como origem para copiar a configuração existente para o namespace isolado.

O pacote será salvo em:

```text
site-do-zero/importacao/site-novo-publico.json
```

Ele não será enviado automaticamente ao Firebase.

## Regra de importação

Quando houver aprovação explícita:

1. criar o nó `/site_novo` sem editar nenhum outro caminho;
2. importar o conteúdo do pacote dentro de `/site_novo`;
3. aplicar permissão pública somente de leitura em `/site_novo/publico`;
4. manter escrita bloqueada no navegador;
5. testar o novo site em homologação;
6. não ativar `/site_novo/pedidos` até o checkout ser aprovado.

## Segurança

Até a autorização da importação:

- nenhuma requisição de escrita será executada;
- nenhuma regra do Firebase será alterada;
- nenhum nó será criado;
- o site atual continuará usando seus dados e arquivos normalmente.
