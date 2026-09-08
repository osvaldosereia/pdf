import fs from 'node:fs';
import assert from 'node:assert/strict';

const fn=fs.readFileSync('supabase/functions/admin-automation-builder-v1/index.ts','utf8');
const compiler=fs.readFileSync('supabase/functions/admin-automation-builder-v1/openai-compiler.ts','utf8');
const admin=fs.readFileSync('admin-v3/automation-builder.js','utf8');
const config=fs.readFileSync('admin/config.js','utf8');

assert.match(config,/automationBuilderUiEnabled:\s*false/,'Builder UI must remain dormant');
assert.match(fn,/owner_required_for_paid_compiler/,'paid compiler must be owner-only');
assert.match(fn,/requestedCompiler===?\s*["']openai["']/,'OpenAI compiler must require explicit request');
assert.match(fn,/persisted:false/,'compiler response must declare no persistence');
assert.match(fn,/requires_human_review:true/,'human review must be mandatory');
assert.match(fn,/fallback_available:true/,'safe deterministic fallback must remain available');
assert.match(compiler,/AUTOMATION_OPENAI_COMPILER_ENABLED/,'server-side OpenAI gate missing');
assert.match(compiler,/AUTOMATION_OPENAI_COMPILER_MAX_COST_USD/,'cost cap missing');
assert.match(compiler,/AUTOMATION_OPENAI_MAX_OUTPUT_TOKENS/,'output token cap missing');
assert.match(compiler,/text:\{format:\{type:"json_schema"/,'strict Structured Outputs schema missing');
assert.match(compiler,/strict:true/,'strict schema adherence missing');
assert.match(compiler,/enabled:false/,'AI draft must stay disabled');
assert.match(compiler,/execution_mode:"off"/,'AI draft must stay off');
assert.match(compiler,/kill_switch:true/,'AI draft kill switch must stay on');
assert.match(compiler,/canary_percent:0/,'AI draft canary must stay zero');
assert.match(compiler,/runtime_activation_supported:false/,'AI draft runtime activation must remain unsupported');
assert.match(compiler,/github_action/,'compiler instructions must preserve GitHub Actions first policy');
assert.doesNotMatch(compiler,/supabase\.from\(/,'compiler module must not persist to Supabase');
assert.doesNotMatch(compiler,/execution_mode:\s*["']live["']/,'compiler must never create live mode');
assert.match(admin,/value="openai"/,'Admin must expose explicit compiler choice only inside dormant Builder');
assert.match(admin,/requires_human_review/,'Admin must surface review requirement');

console.log('stage10 OpenAI compiler v4 checks passed');
