import assert from 'node:assert/strict';
import {normalizeInstagramWebhook,classifyInstagramEvent,instagramAutomationGate,privateReplyPreparationGate,privateReplyDispatchGate} from '../lib/omnichannel/instagram-runtime-v1.mjs';

const webhook={entry:[{id:'ig-account-1',messaging:[{sender:{id:'igsid-1'},recipient:{id:'ig-account-1'},timestamp:1788840000000,message:{mid:'mid-1',text:'Quero uma cesta'}}],changes:[{field:'comments',value:{id:'comment-1',text:'quanto custa?',from:{id:'igsid-2',username:'cliente'},media:{id:'media-1',media_product_type:'REELS'}}}]}]};
const events=normalizeInstagramWebhook(webhook);
assert.equal(events.length,2);
assert.equal(events[0].kind,'direct');
assert.equal(events[0].external_user_id,'igsid-1');
assert.equal(events[1].kind,'comment');
assert.equal(events[1].referral.media_id,'media-1');
assert.equal(classifyInstagramEvent(events[0]),'direct_inbound');
assert.equal(classifyInstagramEvent({...events[0],context:{is_echo:true}}),'direct_echo');

const accountDormant={channel:'instagram',status:'dormant',inbound_enabled:false,auto_reply_enabled:false,outbound_enabled:false};
const accountObserve={channel:'instagram',status:'observe',inbound_enabled:true,auto_reply_enabled:false,outbound_enabled:false};
const controlsOff={webhook_ingest_enabled:false,direct_observe_enabled:false,comment_observe_enabled:false,private_reply_prepare_enabled:false,private_reply_send_enabled:false,policy_version:null,policy_verified_at:null,private_reply_window_seconds:0};
assert.equal(instagramAutomationGate(accountDormant,controlsOff,'direct').allow,false);
assert.equal(instagramAutomationGate(accountObserve,controlsOff,'direct').reason,'instagram_webhook_disabled');

const observe={...controlsOff,webhook_ingest_enabled:true,direct_observe_enabled:true,comment_observe_enabled:true};
assert.equal(instagramAutomationGate(accountObserve,observe,'direct').allow,true);
assert.equal(instagramAutomationGate(accountObserve,observe,'comment').allow,true);

const observation={external_comment_id:'comment-1',private_reply_job_id:null};
assert.equal(privateReplyPreparationGate(accountObserve,observe,observation).allow,false);
const verified={...observe,private_reply_prepare_enabled:true,policy_version:'manual-review-required',policy_verified_at:'2026-09-08T00:00:00Z',private_reply_window_seconds:3600};
assert.equal(privateReplyPreparationGate(accountObserve,verified,observation).reason,'draft_only');
assert.equal(privateReplyDispatchGate(accountObserve,verified,{requires_user_response:true}).allow,false);
assert.equal(privateReplyDispatchGate({...accountObserve,outbound_enabled:true,auto_reply_enabled:true},{...verified,private_reply_send_enabled:true},{requires_user_response:true}).reason,'transport_not_implemented');

console.log('instagram runtime dormant foundation: ok');
