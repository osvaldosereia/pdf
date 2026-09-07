import test from 'node:test';
import assert from 'node:assert/strict';
import {deterministicIntent,renderDecision,validateIntent,parseResponse,validateMedia,readLimited} from './lib/conversation-core-v1.mjs';
import {runWorker,createProvider,createBackend} from './conversation-worker-v1.mjs';

const flags={automation_enabled:true,ai_enabled:true,conversation_worker_enabled:true};
const job={id:'job',message_id:'message',conversation_id:'conversation',attempt:1,job_type:'conversation',body_text:'Quero arroz'};
function harness({enabled=flags,finishFails=false}={}) {
 const calls=[];let claimed=false;
 return {calls,flags:async()=>enabled,rpc:async(name,args)=>{calls.push({name,args});if(name==='claim_conversation_job'){if(claimed)return null;claimed=true;return job;}if(finishFails)throw new Error('db_unavailable');return {status:'done'};}};
}
test('dry-run does not claim jobs or call a provider',async()=>{
 const b=harness();await runWorker({backend:b,provider:{analyze(){throw Error('spent')}}});assert.equal(b.calls.length,0);
});
test('every release gate prevents a paid request',async()=>{
 for(const gate of Object.keys(flags)){const b=harness({enabled:{...flags,[gate]:false}});const r=await runWorker({backend:b,apply:true});assert.equal(r.enabled,false);assert.equal(b.calls.length,0);}
});
test('single provider call is completed through one atomic RPC',async()=>{
 let spent=0;const b=harness();const r=await runWorker({backend:b,provider:{async analyze(){spent++;return{result:renderDecision({intent:'search',query:'arroz'}),usage:{model:'test'}}}},apply:true});
 assert.equal(spent,1);assert.equal(r.done,1);assert.equal(b.calls.filter(x=>x.name==='finish_conversation_job').length,1);
 assert.equal(b.calls[1].args.p_result.ui.q,'arroz');
});
test('provider timeout is terminal, sanitized and never retried blindly',async()=>{
 let spent=0;const b=harness();const r=await runWorker({backend:b,provider:{async analyze(){spent++;throw new Error('PRIVATE CUSTOMER TEXT')}} ,apply:true});
 assert.equal(spent,1);assert.equal(r.errors,1);assert.equal(b.calls[1].args.p_error,'provider_or_media_failed');
});
test('uncertain database completion stops rather than repeating provider',async()=>{
 let spent=0;const b=harness({finishFails:true});await assert.rejects(runWorker({backend:b,provider:{async analyze(){spent++;return{result:renderDecision({intent:'greeting'}),usage:{}}}},apply:true}),/db_unavailable/);assert.equal(spent,1);
});
test('decline, urgency and human handoff precede any commercial routing',()=>{
 for(const [message,intent] of [['Não quero mais nada, só a cesta','decline_upsell'],['Estou com pressa','fast_checkout'],['Quero um atendente','human']])assert.equal(deterministicIntent(message).intent,intent);
});
test('model result cannot contain prices, execute cart edits, or confirm an order',()=>{
 assert.throws(()=>validateIntent({intent:'confirm_order',query:'',confidence:1,description:''}));
 assert.throws(()=>validateIntent({intent:'search',query:'arroz',confidence:1,description:'',price:1}));
 assert.equal(validateIntent({intent:'search',query:'arroz',confidence:0.3,description:''}).intent,'clarify');
 assert.match(renderDecision({intent:'checkout'}).reply,/só será enviado quando/);
});
test('incomplete responses and refusals cannot become seller messages',()=>{
 assert.throws(()=>parseResponse({status:'incomplete',output:[]}));
 assert.throws(()=>parseResponse({status:'completed',output:[{content:[{type:'refusal'}]}]}));
});
test('media is scoped to the source message and fixed private bucket',()=>{
 const j={...job,job_type:'vision'};const m={message_id:job.message_id,conversation_id:job.conversation_id,bucket:'shopping-room-media',catalog_session_id:'session',kind:'image',object_path:'sessions/session/image/2026-09/file.jpg',mime_type:'image/jpeg',bytes:100,expires_at:'2099-01-01'};
 assert.equal(validateMedia(m,j),'image/jpeg');
 for(const invalid of [{message_id:'foreign'},{bucket:'public'},{object_path:'https://evil.example/file'},{object_path:'sessions/session/image/../../secret'},{bytes:10485761},{expires_at:'2000-01-01'},{mime_type:'image/heic'}])assert.throws(()=>validateMedia({...m,...invalid},j));
});
test('bounded download enforces streamed size without content-length',async()=>{
 await assert.rejects(readLimited(new Response(new Uint8Array(11)),10),/media_size_limit/);
 assert.equal((await readLimited(new Response(new Uint8Array(10)),10)).size,10);
});
test('provider sends strict classification schema, no stored response or tools',async()=>{
 let body;const provider=createProvider({key:'test',fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(options.body);return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({intent:'search',query:'arroz',confidence:0.9,description:''})}]}],usage:{input_tokens:30,output_tokens:12}});}});
 const output=await provider.analyze(job,null);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.tools,undefined);assert.equal(output.result.ui.q,'arroz');assert.equal(output.usage.input_tokens,30);
});
test('audio uses one transcription call and deterministic response',async()=>{
 let calls=0;const p=createProvider({key:'test',fetchImpl:async(url,opts)=>{calls++;assert.equal(url,'https://api.openai.com/v1/audio/transcriptions');assert.equal(opts.body.get('language'),'pt');return Response.json({text:'Não quero mais nada'});}});
 const output=await p.analyze({...job,job_type:'transcription',media:{object_path:'audio.webm'}},{blob:new Blob(['audio'])});assert.equal(calls,1);assert.equal(output.result.intent,'decline_upsell');
});
test('backend refuses arbitrary destination for privileged credentials',()=>{
 assert.throws(()=>createBackend({url:'https://evil.example',key:'test'}),/unexpected_supabase_project/);
});
