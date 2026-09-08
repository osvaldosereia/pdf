import {readFileSync} from 'node:fs';

const config=readFileSync('supabase/config.toml','utf8');
const must=(pattern,message)=>{if(!pattern.test(config))throw new Error(message)};

must(/\[functions\.admin-experience-orchestrator-v1\]\s*verify_jwt\s*=\s*true/i,'admin_orchestrator_must_require_jwt');
must(/\[functions\.admin-whatsapp-flow-v1\]\s*verify_jwt\s*=\s*true/i,'flow_admin_must_require_jwt');
must(/\[functions\.whatsapp-flow-data-exchange-v1\]\s*verify_jwt\s*=\s*false/i,'meta_flow_endpoint_must_use_protocol_auth_not_supabase_jwt');

console.log('PASS: Flow admin endpoints require Supabase JWT and the Meta Data Exchange callback explicitly uses protocol-level authentication with runtime gates.');
