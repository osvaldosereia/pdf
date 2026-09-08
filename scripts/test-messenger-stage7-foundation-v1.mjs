import assert from 'node:assert/strict';
import {normalizeMessengerWebhook,classifyMessengerEvent,messengerAutomationGate,messengerDispatchGate,renderMessengerDecision,metaAttributionFromMessenger} from '../lib/omnichannel/messenger-runtime-v1.mjs';

const events=normalizeMessengerWebhook({object:'page',entry:[{id:'page-1',messaging:[{sender:{id:'psid-1'},recipient:{id:'page-1'},timestamp:1788841000000,message:{mid:'m-1',text:'Oi',quick_reply:{payload:'Q1'}},referral:{source:'ADS',ad_id:'ad-9',ref:'campaign-x'}},{sender:{id:'psid-1'},recipient:{id:'page-1'},timestamp:1788841000001,postback:{title:'Comprar',payload:'BUY'}}]}]});
assert.equal(events.length,2);
assert.equal(events[0].external_user_id,'psid-1');
assert.equal(events[0].context.quick_reply_payload,'Q1');
assert.equal(classifyMessengerEvent(events[0]),'message_inbound');
assert.equal(classifyMessengerEvent(events[1]),'postback_inbound');

const dormant={channel:'messenger',status:'dormant',inbound_enabled:false,outbound_enabled:false};
assert.equal(messengerAutomationGate(dormant,{},'message').allow,false);
const observe={channel:'messenger',status:'observe',inbound_enabled:true,outbound_enabled:false};
assert.deepEqual(messengerAutomationGate(observe,{webhook_ingest_enabled:true,message_observe_enabled:true},'message'),{allow:true,reason:'observe_allowed'});
assert.equal(messengerAutomationGate(observe,{webhook_ingest_enabled:true,message_observe_enabled:false},'message').allow,false);
assert.equal(messengerDispatchGate({...observe,outbound_enabled:true},{transport_send_enabled:true,policy_verified_at:new Date().toISOString(),policy_version:'reviewed'},{recipient_id:'psid-1'}).reason,'transport_not_implemented');

const card=renderMessengerDecision({cards:[{title:'Cesta',body:'Opção',buttons:[{type:'postback',label:'Escolher',value:'basket-1'}]}]});
assert.equal(card.type,'generic_template');
assert.equal(card.attachment.payload.elements.length,1);
const quick=renderMessengerDecision({text:'Escolha',quick_replies:Array.from({length:20},(_,i)=>({label:`Q${i}`,value:`${i}`}))});
assert.equal(quick.quick_replies.length,13);
const attr=metaAttributionFromMessenger(events[0]);
assert.equal(attr.channel,'messenger');
assert.equal(attr.ad_id,'ad-9');

console.log('Messenger stage 7 foundation tests: ok');
