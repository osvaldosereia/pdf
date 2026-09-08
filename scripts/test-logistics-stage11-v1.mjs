import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildRoutingRequest,chooseRoutingProvider,canComputeApproachingEta,shouldNotifyApproaching} from '../lib/logistics/routing-provider-v1.mjs';

const foundation=fs.readFileSync('supabase/migrations/20260908112000_stage11_logistics_foundation_v1.sql','utf8');
const driverActions=fs.readFileSync('supabase/migrations/20260908112100_stage11_driver_actions_v1.sql','utf8');
const adminFn=fs.readFileSync('supabase/functions/admin-logistics-v1/index.ts','utf8');
const driverFn=fs.readFileSync('supabase/functions/driver-logistics-v1/index.ts','utf8');
const adminConfig=fs.readFileSync('admin/config.js','utf8');
const adminHtml=fs.readFileSync('admin/index.html','utf8');
const driverConfig=fs.readFileSync('driver-app/config.js','utf8');
const driverApp=fs.readFileSync('driver-app/app.js','utf8');
const sw=fs.readFileSync('driver-app/sw.js','utf8');

for(const table of ['logistics_runtime_config','drivers','vehicles','delivery_jobs','delivery_routes','delivery_stops','delivery_route_versions','delivery_events','delivery_incidents','driver_locations','delivery_notifications','routing_provider_calls','logistics_audit_events']){
  assert.match(foundation,new RegExp(`create table if not exists public\\.${table}`),`${table} missing`);
  assert.match(foundation,new RegExp(`alter table public\\.${table} enable row level security`),`${table} RLS missing`);
}
assert.match(foundation,/enabled boolean not null default false/);
assert.match(foundation,/execution_mode text not null default 'off'/);
assert.match(foundation,/job_creation_enabled boolean not null default false/);
assert.match(foundation,/routing_enabled boolean not null default false/);
assert.match(foundation,/driver_app_enabled boolean not null default false/);
assert.match(foundation,/gps_tracking_enabled boolean not null default false/);
assert.match(foundation,/notifications_enabled boolean not null default false/);
assert.match(foundation,/external_provider_enabled boolean not null default false/);
assert.match(foundation,/provider_name text not null default 'none'/);
assert.match(foundation,/canary_percent smallint not null default 0/);
assert.match(foundation,/status text not null default 'waiting_route'/);
assert.match(foundation,/unique\(order_id,attempt_no\)/);
assert.match(foundation,/unique\(idempotency_key\)/);
assert.match(foundation,/locked_stop_override_reason_required/);
assert.match(foundation,/logistics_job_creation_disabled/);
assert.match(foundation,/external_provider_released/);
assert.match(foundation,/external_call_performed boolean not null default false/);
assert.match(foundation,/revoke all on public\.logistics_runtime_config.*from public,anon,authenticated/s);
assert.match(foundation,/revoke all on function public\.record_driver_location_v1.*from public,anon,authenticated/s);
assert.match(foundation,/kill_logistics_runtime_v1/);
assert.match(foundation,/execution_mode='off'/);
assert.match(foundation,/external_provider_enabled=false/);
assert.match(foundation,/provider_name='none'/);

for(const fn of ['driver_start_route_v1','driver_arrive_stop_v1','driver_deliver_stop_v1','driver_fail_stop_v1']){
  assert.match(driverActions,new RegExp(`create or replace function public\\.${fn}`));
  assert.match(driverActions,new RegExp(`revoke all on function public\\.${fn}.*from public,anon,authenticated`,'s'));
}
assert.match(driverActions,/client_event_id=p_client_event_id/,'driver actions must dedupe client events');
assert.match(driverActions,/arrival_confirmation_required/,'delivery requires explicit arrival confirmation');
assert.match(driverActions,/update public\.orders set status='delivered'/,'delivery must reflect in commercial order');
assert.doesNotMatch(driverActions,/geofence/i,'geofence must not auto-complete delivery');

assert.match(adminFn,/admin_users/);
assert.match(adminFn,/owner_required/);
assert.match(adminFn,/runtime_activation_supported:false/);
assert.match(adminFn,/external_routing_supported:false/);
assert.match(adminFn,/enabled:false,execution_mode:"off",job_creation_enabled:false,routing_enabled:false,driver_app_enabled:false,gps_tracking_enabled:false,notifications_enabled:false,external_provider_enabled:false,provider_name:"none",canary_percent:0/);
assert.doesNotMatch(adminFn,/execution_mode\s*:\s*["']live["']/);
assert.doesNotMatch(adminFn,/external_provider_enabled\s*:\s*true/);

assert.match(driverFn,/auth\.getUser\(token\)/);
assert.match(driverFn,/driver_runtime_disabled/);
assert.match(driverFn,/gps_tracking_disabled/);
assert.match(driverFn,/client_event_id/);
assert.match(driverFn,/driver_deliver_stop_v1/);

assert.match(adminConfig,/logisticsUiEnabled:\s*false/);
assert.match(adminHtml,/id="logisticsNav" class="nav hidden"/);
assert.match(adminHtml,/id="logisticsMount"/);
assert.match(driverConfig,/enabled:false/);
assert.match(driverApp,/localStorage\.setItem\('da_driver_queue_v1'/,'offline queue missing');
assert.match(driverApp,/watchPosition/,'GPS lifecycle missing');
assert.match(driverApp,/route\?\.status!==['"]active['"]/,'GPS must require active route');
assert.match(sw,/caches\.open/,'PWA cache missing');

const etaReq=buildRoutingRequest('compute_eta',{origin:{latitude:-15.60,longitude:-56.10},destination:{latitude:-15.61,longitude:-56.11}});
assert.equal(etaReq.operation,'compute_eta');
assert.equal(chooseRoutingProvider({enabled:false}).name,'none');
const held=await chooseRoutingProvider({enabled:false}).computeEta({origin:{latitude:-15.60,longitude:-56.10},destination:{latitude:-15.61,longitude:-56.11}});
assert.equal(held.external_call_performed,false);
assert.equal(held.status,'held');
assert.equal(canComputeApproachingEta({routeStatus:'active',gpsCapturedAt:new Date(Date.now()-30_000).toISOString(),minimumGpsFreshnessSeconds:120}).ok,true);
assert.equal(canComputeApproachingEta({routeStatus:'active',gpsCapturedAt:new Date(Date.now()-300_000).toISOString(),minimumGpsFreshnessSeconds:120}).reason,'gps_stale');
assert.equal(shouldNotifyApproaching({etaSeconds:170,etaConfidence:.9,thresholdSeconds:180,minimumConfidence:.8}).ok,true);
assert.equal(shouldNotifyApproaching({etaSeconds:170,etaConfidence:.5,thresholdSeconds:180,minimumConfidence:.8}).reason,'eta_low_confidence');

console.log('stage11 logistics safety assertions: OK');
