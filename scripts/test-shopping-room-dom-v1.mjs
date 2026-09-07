import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {JSDOM}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/jsdom`:'jsdom');
const html=readFileSync('comprar/index.html','utf8'),js=readFileSync('comprar/app.js','utf8');
const dom=new JSDOM(html,{url:'https://donaantonia.com.br/comprar/?s='+'a'.repeat(64),runScripts:'outside-only',pretendToBeVisual:true});
const w=dom.window,calls=[],timers=[];
w.DA_SHOPPING_ROOM_CONFIG={api:'https://example.test/room'};
w.setTimeout=(fn,delay)=>{timers.push({fn,delay});return timers.length};w.clearTimeout=()=>{};
let polled=false;
const audio={id:'audio-1',direction:'inbound',message_type:'audio',media_url:'https://example.test/private-audio',processing_status:'queued'};
w.fetch=async(_url,opts)=>{
 const body=JSON.parse(opts.body);calls.push(body);let result={ok:true};
 if(body.action==='open')result={...result,session:{},cart:{total:80,items:[{quantity:1}]},messages:[audio],customer:{name:'Cliente'}};
 if(body.action==='messages'){polled=true;result={...result,cursor:'cursor1',messages:[{...audio,transcript:'Quero arroz',processing_status:'processed'},{id:'reply-1',direction:'outbound',message_type:'text',body_text:'Confira os resultados.',ui:{type:'products',q:'arroz'}}]};}
 if(body.action==='checkout_preview')result={...result,checkout:{customer:{name:'Cliente',phone:'65999999999'},requires_document:false,cart:{total:80},items:[],addresses:[{street:'Rua teste',number:'1',city:'Cuiabá'}]}};
 if(body.action==='identify')result={...result,customer:{id:'customer',requires_document:false}};
 if(body.action==='confirm_order')result={...result,order:{total:80},whatsapp_url:'https://wa.me/556584491018'};
 return {ok:true,json:async()=>result};
};
const flush=async()=>{for(let i=0;i<15;i++)await new Promise(r=>setImmediate(r));};
try {
 w.eval(js);await flush();
 const player=w.document.querySelector('audio');assert.ok(player);
 const poll=timers.find(t=>t.delay===1000);assert.ok(poll);await poll.fn();await flush();
 assert.equal(polled,true);assert.equal(w.document.querySelector('audio'),player,'poll must preserve audio element');
 assert.match(w.document.querySelector('.media-caption').textContent,/Quero arroz/);
 assert.equal(w.document.querySelector('#chat button').textContent,'Ver produtos');
 w.document.getElementById('reviewButton').click();await flush();
 assert.ok(w.document.getElementById('birthdayDay'));assert.equal(w.document.getElementById('marketingOptIn').checked,false);
 w.document.getElementById('birthdayDay').value='29';w.document.getElementById('birthdayMonth').value='2';
 w.document.getElementById('confirmOrderButton').click();await flush();
 const prefs=calls.find(x=>x.action==='preferences');assert.equal(prefs.birthday_day,29);assert.equal(prefs.marketing_opt_in,null);
 assert.equal(calls.find(x=>x.action==='confirm_order').delivery_address.street,'Rua teste');
 assert.match(w.document.getElementById('content').textContent,/Pedido recebido/);
 console.log('PASS: stable audio DOM, transcript/status, asynchronous reply action, birthday without implicit opt-in, checkout saved address.');
}finally{w.close();}
