import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync('supabase/migrations/20260908053500_instagram_direct_comment_foundation_v1.sql','utf8');
const edge=readFileSync('supabase/functions/meta-instagram-webhook-v1/index.ts','utf8');
const config=readFileSync('supabase/config.toml','utf8');
const has=(source,re,msg)=>assert.match(source,re,msg);

has(sql,/create table if not exists public\.instagram_channel_controls/i,'typed Instagram controls required');
has(sql,/webhook_ingest_enabled boolean not null default false/i,'webhook must default off');
has(sql,/private_reply_send_enabled boolean not null default false/i,'private reply send must default off');
has(sql,/private_reply_window_seconds integer not null default 0/i,'policy window must default unknown/closed');
has(sql,/create table if not exists public\.instagram_private_reply_jobs/i,'private reply queue required');
has(sql,/state text not null default 'held'/i,'private replies must default held');
has(sql,/attempts smallint not null default 0 check \(attempts between 0 and 1\)/i,'blind retry must be impossible');
has(sql,/requires_user_response boolean not null default true/i,'follow-up automation must require user response');
has(sql,/transport_implemented',false/i,'readiness must state transport is not implemented');
has(sql,/customer_runtime_released',false/i,'readiness must state customer runtime is not released');
has(sql,/revoke all on public\.instagram_channel_controls from public,anon,authenticated/i,'controls must be server-only');
has(sql,/revoke all on function public\.prepare_instagram_private_reply_v1/i,'prepare RPC must be server-only');

has(edge,/META_INSTAGRAM_WEBHOOK_RUNTIME_ENABLED/i,'edge runtime needs explicit external gate');
has(edge,/x-hub-signature-256/i,'Meta signature required');
has(edge,/HMAC.*SHA-256/is,'signature must use HMAC SHA-256');
has(edge,/if\(!runtimeEnabled\).*instagram_webhook_runtime_disabled/s,'runtime must fail closed');
has(edge,/item\?\.message\?\.is_echo===true/i,'echoes must not re-enter the brain');
assert.doesNotMatch(edge,/private_repl(?:y|ies)|\/messages\b|graph\.facebook\.com/i,'webhook endpoint must not send Meta messages or private replies');

has(config,/\[functions\.meta-instagram-webhook-v1\][\s\S]*verify_jwt = false/i,'Meta webhook must explicitly bypass Supabase JWT gateway only at config layer');
console.log('instagram direct/comment foundation invariants: ok');
