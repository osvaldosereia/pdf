import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../orcamento/index.html', import.meta.url), 'utf8');
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';

assert.ok(inlineScript, 'script principal do orçamento não encontrado');
assert.doesNotThrow(() => new Function(inlineScript), 'JavaScript inline do orçamento deve compilar');

assert.match(html, /id="hideUnitPrice"/, 'controle para ocultar valor unitário ausente');
assert.match(html, /id="manualTotal"/, 'campo de total manual ausente');
assert.match(html, /id="useCalculatedTotal"/, 'ação para restaurar total calculado ausente');
assert.match(html, /\.paper\.hide-unit-price \.unit-price-col\{display:none\}/, 'CSS para ocultar valor unitário no documento ausente');
assert.match(html, /quantity\)\*Math\.max\(0,i\.unitPrice\)/, 'subtotal deve continuar usando quantidade x valor unitário');
assert.match(html, /manualTotalOverride===null\?calculatedTotal/, 'total calculado deve ser padrão quando não há override');
assert.match(html, /options:\{hideUnitPrice:state\.hideUnitPrice,manualTotalOverride:state\.manualTotalOverride\}/, 'opções devem ser salvas no rascunho');
assert.match(html, /draft\.options\?\.hideUnitPrice===true/, 'rascunhos devem restaurar o modo sem unitário');
assert.match(html, /manual===null\|\|manual===undefined\?null/, 'rascunhos antigos sem total manual devem continuar compatíveis');
assert.match(html, /class="money unit-price-col"/, 'coluna de valor unitário deve estar marcada para ocultação seletiva');
assert.match(html, /formatMoney\(i\.quantity\*i\.unitPrice\)/, 'total por item deve continuar calculado pelos valores unitários');

console.log('OK · orçamento V2: modo sem valor unitário + total manual preservando cálculo automático.');
