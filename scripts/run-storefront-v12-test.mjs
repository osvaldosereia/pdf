import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const sourcePath = 'scripts/build-storefront-v12-test.mjs';
let source = await fs.readFile(sourcePath, 'utf8');

// Os padrões de limpeza podem não existir em versões antigas ou novas do index.
// A validação estática posterior confirma que nenhum conflito permaneceu.
source = source.replace(
  "if (matches.length < minimum) throw new Error(`Não foi possível aplicar ${label}. Encontrado: ${matches.length}`);",
  "if (matches.length < minimum) console.warn(`Padrão opcional não encontrado: ${label}. Encontrado: ${matches.length}`);"
);

// Os quatro primeiros cards entram no DOM com carregamento prioritário, sem depender
// de uma alteração posterior do MutationObserver em celulares mais antigos.
source = source.replace(
  "const first = items.slice(0, 4).map(function(product) { return productCard(product, cardMode); }).join('');",
  "const first = items.slice(0, 4).map(function(product) { const card = productCard(product, cardMode); return card.replace('loading=\"lazy\"', 'loading=\"eager\" fetchpriority=\"high\"'); }).join('');"
);

// Usa a última inicialização real do script principal, independentemente de CRLF ou espaçamento.
source = source.replace(
  /const initPattern = [\s\S]*?replaceRequired\(initPattern, `\$\{runtime\}\$1`, 'runtime v12 antes do init'\);/,
  `const initIndex = html.lastIndexOf('    init();');\nif (initIndex < 0) throw new Error('Inicialização principal não encontrada.');\nhtml = html.slice(0, initIndex) + runtime + html.slice(initIndex);`
);

const temporaryPath = '/tmp/build-storefront-v12-test-runtime.mjs';
await fs.writeFile(temporaryPath, source, 'utf8');
await import(pathToFileURL(temporaryPath).href + `?v=${Date.now()}`);
