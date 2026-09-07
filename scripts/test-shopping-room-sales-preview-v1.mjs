import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const source=readFileSync('supabase/functions/shopping-room-v1/index.ts','utf8');

assert.match(source,/action==='sales_move_preview'/,'preview endpoint must exist');
assert.match(source,/plan_next_sales_move/,'preview must delegate to deterministic database planner');
assert.match(source,/p_bucket:'room_sales_preview'/,'preview must be rate limited');
assert.match(source,/PASSIVE_SALES_EVENTS=new Set\(\['viewed','added','rejected','ignored','accepted_category'\]\)/,'browser event whitelist must stay passive');
assert.doesNotMatch(source,/PASSIVE_SALES_EVENTS[^\n]*offered/,'browser must never be allowed to mark an offer as proactively offered');
assert.doesNotMatch(source,/PASSIVE_SALES_EVENTS[^\n]*declined_all/,'browser must not set global decline through the generic event endpoint');

const previewBlock=source.slice(source.indexOf("if(action==='sales_move_preview')"),source.indexOf("if(action==='sales_event')"));
assert.doesNotMatch(previewBlock,/record_sales_offer_event/,'reading a plan must not consume proactive offer budget');
assert.doesNotMatch(previewBlock,/from\('messages'\)\.insert|from\('cart_items'\)\.(insert|update|delete)/,'preview must not mutate messages or cart');

const eventBlock=source.slice(source.indexOf("if(action==='sales_event')"),source.indexOf("if(action==='upload_media')"));
assert.match(eventBlock,/p_source:'shopping_room'/,'sales events must have fixed source');
assert.match(eventBlock,/safeContext/,'event context must be sanitized before privileged RPC');
assert.doesNotMatch(eventBlock,/body\?\.source|body\.source/,'browser must not control the privileged source field');

console.log('PASS: sales preview is read-only and generic browser events cannot consume proactive offer budget.');
