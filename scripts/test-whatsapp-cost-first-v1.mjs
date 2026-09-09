import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const r=p=>readFileSync(p,'utf8');
const migration=[
  r('supabase/migrations/20260909043000_whatsapp_cost_first_schema_v1.sql'),
  r('supabase/migrations/20260909043100_whatsapp_cost_first_functions_v1.sql'),
  r('supabase/migrations/20260909043150_whatsapp_cost_first_resolver_fix_v1.sql'),
  r('supabase/migrations/20260909043170_whatsapp_dynamic_context_v2.sql'),
  r('supabase/migrations/20260909043200_whatsapp_cost_first_seeds_dispatch_v1.sql')
].join('\n');
const worker=r('supabase/functions/conversation-worker-v4/index.ts');
const admin=r('supabase/functions/admin-service-intelligence-v2/index.ts');
const ui=r('admin-v3/service-intelligence.js');
const page=r('admin/inteligencia.html');
const cfg=r('supabase/config.toml');
const must=(s,x,m)=>assert.ok(s.includes(x),`${m}: faltou ${x}`);
const mustNot=(s,x,m)=>assert.ok(!s.includes(x),`${m}: não deveria conter ${x}`);

must(migration,'whatsapp_cost_first_router_enabled boolean not null default false','router nasce fail-closed');
must(migration,'whatsapp_cost_first_shadow_mode boolean not null default true','shadow nasce ligado');
must(migration,'dynamic_selection_enabled boolean not null default false','contexto dinâmico nasce desligado');
must(migration,'create table if not exists public.service_trigger_rules','motor de gatilhos persistente');
must(migration,'create table if not exists public.service_message_blocks','blocos de mensagem persistentes');
must(migration,'create table if not exists public.product_aliases','aliases de produto persistentes');
must(migration,'resolve_whatsapp_product_candidates_v2','resolvedor local de produtos');
must(migration,"nullif(public.normalize_service_text_v1((select canonical_query from alias_rewrite)),'')",'busca sem alias preserva consulta original');
must(migration,'get_service_intelligence_bundle_v2','seleção dinâmica de contexto');
must(migration,"'context_mode',case when dynamic_enabled then 'compact_dynamic_v2' else 'legacy_v1' end",'contexto compacto é explicitamente gateado');
must(migration,"'raw_event',case when dynamic_enabled then null else m.raw_event end",'raw webhook sai apenas do contexto compacto');
must(migration,"v_worker_version:=4",'dispatcher conhece worker v4');
must(migration,"if coalesce(cfg.whatsapp_cost_first_router_enabled,false)",'dispatcher só usa v4 com gate explícito');
must(migration,"conversation-worker-v3'",'fallback v3 preservado');

must(worker,'V3_URL','worker v4 tem fallback explícito para v3');
must(worker,'get_whatsapp_cost_first_preflight_v1','preflight antes de IA');
must(worker,'record_service_trigger_event_v1','telemetria determinística');
must(worker,'deterministic_cost_first_v1','uso determinístico rastreável');
must(worker,'estimated_cost_usd:0','rota determinística registra custo zero de IA');
must(worker,'if(pre.shadow_mode)','shadow antes de ativação real');
must(worker,'strongCandidate','produto só pula IA com confiança forte');
must(worker,'triggerSupported','gatilho não suportado não deve capturar o job');
must(worker,'if(interactiveId||!deterministicHint)return proxyV3();','fallback ocorre antes do claim');
mustNot(worker,'unsupported_configured_action','não pode tentar fallback v3 depois de claim');
mustNot(worker,'OPENAI_API_KEY','worker cost-first não chama OpenAI diretamente');

must(admin,'service_trigger_rules','Admin v2 gerencia gatilhos');
must(admin,'service_message_blocks','Admin v2 gerencia blocos');
must(admin,'product_aliases','Admin v2 gerencia aliases');
must(admin,'action==="simulate"','Admin possui simulador');
must(admin,'action==="cost_metrics"','Admin possui métricas de custo');
must(ui,'admin-service-intelligence-v2','UI usa API v2');
must(ui,"type==='trigger'",'UI edita gatilhos');
must(ui,"type==='block'",'UI edita blocos');
must(page,'data-tab="trigger"','página mostra gatilhos');
must(page,'id="siSimulate"','página oferece simulador');
must(cfg,'[functions.conversation-worker-v4]','config inclui worker v4');
must(cfg,'[functions.admin-service-intelligence-v2]','config inclui Admin v2');
console.log('PASS: arquitetura cost-first, gatilhos, renderer configurável, busca local, contexto dinâmico, shadow mode, Admin e gates validados.');
