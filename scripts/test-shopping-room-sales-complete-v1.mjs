import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const {JSDOM}=require(process.env.TEST_RUNTIME?`${process.env.TEST_RUNTIME}/node_modules/jsdom`:'jsdom');
const edge=readFileSync('supabase/functions/shopping-room-sales-v1/index.ts','utf8');
assert.match(edge,/plan_next_sales_move/);assert.match(edge,/record_sales_offer_event/);assert.match(edge,/p_event_type:'offered'/);assert.match(edge,/product_not_in_cart/);assert.match(edge,/TERMINAL_EVENTS/);assert.match(edge,/duplicate:true/);assert.doesNotMatch(edge,/OPENAI|BLING|META/i);
const js=readFileSync('comprar/sales-intelligence.js','utf8');
const html='<!doctype html><body><div id="content"></div><input id="searchInput"><button id="searchButton">Buscar</button><div id="cartBar"><b id="cartCount">1</b></div></body>';
const dom=new JSDOM(html,{url:'https://donaantonia.com.br/comprar/?s='+'a'.repeat(64),runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,calls=[],timers=[];
w.DA_SHOPPING_ROOM_CONFIG={salesApi:'https://sales.test'};w.setTimeout=(fn,delay)=>{timers.push({fn,delay});return timers.length};w.clearTimeout=()=>{};w.navigator.sendBeacon=()=>true;
w.fetch=async(_url,opts)=>{const body=JSON.parse(opts.body);calls.push(body);const data=body.action==='next_offer'?{ok:true,action:'offer_suggestions',offer:{product_id:'11111111-1111-4111-8111-111111111111',name:'Café',price:19.9,reason:'Você costuma comprar'}}:{ok:true,event:{id:'e'}};return {ok:true,json:async()=>data};};
let searched=false;w.document.getElementById('searchButton').onclick=()=>{searched=true};
try{w.eval(js);const timer=timers.find(t=>t.delay===1200);assert.ok(timer,'smart offer must schedule after room load');await timer.fn();await new Promise(r=>setImmediate(r));const card=w.document.getElementById('smartSalesOffer');assert.ok(card&&!card.classList.contains('hidden'));assert.match(card.textContent,/Café/);card.querySelector('[data-sales-view]').click();await new Promise(r=>setImmediate(r));assert.ok(calls.some(x=>x.action==='event'&&x.event_type==='viewed'));assert.equal(searched,true);assert.equal(w.document.getElementById('searchInput').value,'Café');console.log('PASS: isolated smart offer, safe event tracking and product handoff.');}finally{dom.window.close();}
