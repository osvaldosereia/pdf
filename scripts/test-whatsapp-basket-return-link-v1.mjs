import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const js=readFileSync('cesta/whatsapp-return.js','utf8');
const html=readFileSync('cesta/index.html','utf8');

assert.match(js,/https:\/\/wa\.me\/\$\{WHATSAPP_PHONE\}/,'retorno deve usar link HTTPS direto do WhatsApp');
assert.match(js,/keepalive:true/,'registro de retorno deve sobreviver à navegação');
assert.match(js,/stopImmediatePropagation/,'helper deve impedir o handler assíncrono antigo no clique de envio');
assert.match(js,/extras_done/,'fluxo de adicionais deve continuar sinalizando extras_done');
assert.match(js,/Quero encomendar a cesta que escolhi\./,'mensagem de encomenda deve manter contrato do roteador');
assert.match(js,/Terminei de escolher os produtos adicionais da minha cesta/,'mensagem de adicionais deve manter contrato do roteador');
assert.match(js,/voltar\\s\+para\\s\+cesta/i,'helper não pode interceptar retorno da vitrine de substituição');
assert.match(html,/whatsapp-return\.js\?v=1/,'helper deve estar carregado na página da cesta');
assert.doesNotMatch(js,/whatsapp:\/\//,'não deve depender de custom scheme bloqueável pelo navegador interno');

console.log('PASS: retorno direto da vitrine para WhatsApp validado.');
