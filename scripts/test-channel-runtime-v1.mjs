import assert from 'node:assert/strict';
import {CAPABILITY_REGISTRY,adapters,assertIndependentGates,canAutoReply,commercialMissionShowBaskets,renderDecision} from '../lib/omnichannel/channel-runtime-v1.mjs';

const dormant={status:'dormant',inbound_enabled:false,ai_enabled:false,auto_reply_enabled:false,outbound_enabled:false,canary_percent:0};
const active={status:'active',inbound_enabled:true,ai_enabled:true,auto_reply_enabled:true,outbound_enabled:true,canary_percent:1};

assert.equal(assertIndependentGates(dormant),true);
assert.equal(canAutoReply(dormant),false);
assert.equal(canAutoReply(active),true);
for(const channel of ['whatsapp','web','instagram','messenger']) assert.ok(CAPABILITY_REGISTRY[channel]);

for(const channel of ['whatsapp','web','instagram','messenger']){
  const event=adapters[channel]({external_user_id:'u1',external_message_id:`m-${channel}`,message_type:'text',body_text:'oi'});
  assert.equal(event.channel,channel);
  assert.equal(event.direction,'inbound');
  assert.equal(event.body_text,'oi');
}

const mission=commercialMissionShowBaskets([
  {id:'1',name:'Cesta Essencial',description:'Opção 1',image_url:'https://example.test/1.jpg'},
  {id:'2',name:'Cesta Família',description:'Opção 2',image_url:'https://example.test/2.jpg'},
  {id:'3',name:'Cesta Completa',description:'Opção 3',image_url:'https://example.test/3.jpg'}
]);
assert.equal(mission.mission,'show_three_baskets');

const blocked=renderDecision('instagram',mission,dormant);
assert.equal(blocked.blocked,true);
assert.equal(blocked.block_reason,'channel_outbound_disabled');

const wa=renderDecision('whatsapp',mission,active);
const ig=renderDecision('instagram',mission,active);
const ms=renderDecision('messenger',mission,active);
const web=renderDecision('web',mission,active);
assert.equal(wa.render_type,'carousel');
assert.equal(ig.render_type,'carousel');
assert.equal(ms.render_type,'carousel');
assert.equal(web.render_type,'carousel');

const quick={mission:'ask_choice',text:'Como prefere?',quick_replies:['Texto','Áudio']};
assert.equal(renderDecision('instagram',quick,active).render_type,'quick_replies');
const waQuick=renderDecision('whatsapp',quick,active);
assert.equal(waQuick.render_type,'text');
assert.deepEqual(waQuick.fallbacks,['quick_replies_to_text']);

const tooManyButtons={mission:'choose',text:'Escolha',buttons:[1,2,3,4,5].map(n=>({label:String(n),value:n}))};
assert.equal(renderDecision('whatsapp',tooManyButtons,active).payload.items.length,3);
assert.equal(renderDecision('web',tooManyButtons,active).payload.items.length,5);

console.log('channel adapters/renderers contract: ok');
