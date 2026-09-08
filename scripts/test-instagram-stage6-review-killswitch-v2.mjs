import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql=await readFile('supabase/migrations/20260908060002_instagram_stage6_review_killswitch_v2.sql','utf8');
const has=(re,msg)=>assert.match(sql,re,msg);
const lacks=(re,msg)=>assert.doesNotMatch(sql,re,msg);

has(/review_instagram_private_reply_v2/i);
has(/not coalesce\(v_controls\.private_reply_prepare_enabled,false\)/i,'review must respect the preparation kill switch');
has(/raise exception 'instagram_private_reply_prepare_disabled'/i);
has(/c\.private_reply_prepare_enabled and j\.policy_expires_at>now\(\)/i,'review view must hide disabled drafts');
has(/set state='held',hold_reason='instagram_transport_not_enabled'/i,'approval must remain held');
has(/'sent',false/i,'review must state no message was sent');
lacks(/private_reply_send_enabled\s*=\s*true|outbound_enabled\s*=\s*true|auto_reply_enabled\s*=\s*true/i,'kill switch migration must not open outbound gates');
lacks(/net\.http_post|graph\.instagram\.com|graph\.facebook\.com|fetch\s*\(/i,'kill switch migration must not contain transport');

console.log('Instagram Stage 6 review kill switch v2: OK');
