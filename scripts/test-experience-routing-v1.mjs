import assert from 'node:assert/strict';
import {channelCapabilities,capabilityAllows,chooseChannelAwareExperience,DEFAULT_SESSION_BUDGET} from '../lib/omnichannel/experience-routing-v1.mjs';

assert.equal(channelCapabilities('whatsapp').flow,true);
assert.equal(channelCapabilities('instagram').flow,false);
assert.equal(capabilityAllows('messenger','carousel'),true);
assert.equal(capabilityAllows('instagram','whatsapp_flow'),false);
assert.equal(chooseChannelAwareExperience({channel:'whatsapp',preferred:'whatsapp_flow'}).action,'whatsapp_flow');
assert.equal(chooseChannelAwareExperience({channel:'instagram',preferred:'whatsapp_flow',fallbacks:['carousel','conversation']}).action,'carousel');
assert.equal(chooseChannelAwareExperience({channel:'messenger',preferred:'whatsapp_flow',fallbacks:['conversation']}).action,'conversation');
assert.equal(chooseChannelAwareExperience({channel:'web',preferred:'shopping_room'}).action,'shopping_room');
assert.equal(chooseChannelAwareExperience({channel:'whatsapp',preferred:'carousel',humanRequired:true}).action,'human');
assert.equal(chooseChannelAwareExperience({channel:'whatsapp',preferred:'carousel',usage:{experiences:DEFAULT_SESSION_BUDGET.max_experiences}}).action,'human');
assert.equal(chooseChannelAwareExperience({channel:'whatsapp',preferred:'whatsapp_flow',fallbacks:['conversation'],usage:{flow_exchanges:DEFAULT_SESSION_BUDGET.max_flow_exchanges}}).action,'conversation');
assert.equal(chooseChannelAwareExperience({channel:'whatsapp',preferred:'carousel',fallbacks:['conversation'],usage:{carousels:DEFAULT_SESSION_BUDGET.max_carousels}}).action,'conversation');
console.log('PASS: stage8 channel-aware experience routing, capability fallbacks, budgets and human precedence.');
