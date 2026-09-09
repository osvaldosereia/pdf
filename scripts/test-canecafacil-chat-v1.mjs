import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd();
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),'utf8');
const index=read('loja-integrada','personalizar','index.html');
const chat=read('loja-integrada','personalizar','chat-v1.js');
const css=read('loja-integrada','personalizar','chat-v1.css');
const app=read('loja-integrada','personalizar','app-v15.js');
const inlineLoader=read('loja-integrada','loader-personalizador-inline-producao-v10.js');
const modalEmbed=read('loja-integrada','personalizador-embed-v1.js');

assert.match(index,/id="chatCard"/,'personalizador deve expor o chat');
assert.match(index,/id="chatMic"/,'chat deve permitir resposta por voz quando o navegador suportar');
assert.match(index,/id="chatPhoto"/,'chat deve permitir enviar foto no contexto da pergunta');
assert.match(index,/chat-v1\.css/,'chat deve carregar CSS próprio');
assert.match(index,/chat-v1\.js/,'chat deve carregar a camada conversacional');
assert.match(index,/id="personalizerForm"/,'formulário operacional deve permanecer como fallback e contrato da geração');
assert.match(chat,/document\.body\.classList\.add\('cf-chat-mode'\)/,'chat deve ocultar o formulário somente após inicializar');
assert.match(chat,/SpeechRecognition \|\| window\.webkitSpeechRecognition/,'voz deve ter fallback de ditado no navegador');
assert.match(chat,/isExactField/,'nomes e frases devem receber confirmação visual');
assert.match(chat,/form\.requestSubmit/,'chat deve reutilizar o submit oficial do V15');
assert.match(chat,/sessionStorage\.setItem/,'respostas de texto devem sobreviver a recarregamentos da sessão');
assert.match(css,/\.cf-chat-mode #personalizerForm/,'formulário deve permanecer acessível ao código mas invisível no modo chat');
assert.match(app,/action:'personalize_mug_model'/,'geração deve continuar usando o contrato oficial existente');
assert.match(inlineLoader,/setAttribute\('allow','clipboard-write; microphone'\)/,'iframe inline deve permitir microfone ao personalizador');
assert.match(inlineLoader,/searchParams\.set\('ui','20260904-chat-v1'\)/,'loader inline deve identificar a interface de chat');
assert.match(modalEmbed,/allow="clipboard-write; microphone"/,'iframe modal deve permitir microfone ao personalizador');
assert.equal(chat.includes('OPENAI_API_KEY'),false,'frontend nunca pode conter chave OpenAI');
assert.equal(chat.includes('sk-'),false,'frontend não pode conter segredo OpenAI');

console.log('OK CanecaFácil Chat V1: conversa progressiva, voz opcional, foto contextual, confirmação de texto exato, permissão de microfone no embed e geração V15 preservada.');