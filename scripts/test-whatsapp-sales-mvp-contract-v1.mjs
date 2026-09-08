import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const r=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
const core=r('supabase/migrations/20260908210000_whatsapp_sales_intelligence_mvp_v1.sql');
const exec=r('supabase/migrations/20260908210100_whatsapp_sales_execution_and_outbound_v1.sql');
const support=r('supabase/migrations/20260908210200_whatsapp_sales_worker_support_v1.sql');
const state=r('supabase/migrations/20260908210300_whatsapp_sales_state_v1.sql');
const interactive=r('supabase/migrations/20260908210400_whatsapp_sales_interactive_ingest_v1.sql');
const binding=r('supabase/migrations/20260908210500_bling_shadow_product_binding_v1.sql');
const confirmFirst=r('supabase/migrations/20260908210600_whatsapp_confirm_first_bling_batch_v1.sql');
const dispatchTarget=r('supabase/migrations/20260908210900_conversation_worker_v3_dispatch_target_v1.sql');
const searchRanking=r('supabase/migrations/20260908210910_whatsapp_sales_search_ranking_v2.sql');
const worker=r('supabase/functions/conversation-worker-v3/index.ts');
const admin=r('supabase/functions/admin-service-intelligence-v1/index.ts');
const ui=r('admin-v3/service-intelligence.js');
const page=r('admin/inteligencia.html');
const writer=r('scripts/bling-order-writer-v1.mjs');
const blingWorkflow=r('.github/workflows/bling-order-writer-v1.yml');
const must=(s,needle,msg)=>assert.ok(s.includes(needle),`${msg}: faltou ${needle}`);
const mustNot=(s,needle,msg)=>assert.ok(!s.includes(needle),`${msg}: encontrou ${needle}`);

must(core,"whatsapp_sales_mvp_enabled boolean not null default false",'MVP nasce OFF');
must(core,"whatsapp_sales_catalog_source text not null default 'counter_verified'",'fonte é contador');
must(core,'p.physically_verified=true','catálogo exige conferência física');
must(core,'p.is_active=true','catálogo exige produto ativo');
must(core,'coalesce(p.stock,0)>0','catálogo exige estoque positivo');
must(core,'service_knowledge_items','conhecimento versionável');
must(core,'service_guidance_rules','orientações versionáveis');
must(core,'service_procedures','procedimentos versionáveis');
must(core,'service_regression_cases','regressões versionáveis');
must(core,'replace_whatsapp_sales_product_v1','troca de produto');
must(core,'basket_substitution_confirmation_required','troca de cesta protegida');

must(exec,'explicit_order_confirmation_required','pedido exige confirmação explícita');
must(exec,'whatsapp_sales_order_submit_enabled','gate de finalização');
must(exec,'whatsapp_sales_bling_submit_enabled','gate separado para Bling');
must(exec,"mode not in ('text','audio','image','interactive')",'outbound permite texto/áudio/imagem/interativo');
must(exec,"'protocol_version',4",'protocolo outbound v4');
mustNot(exec,'carousel','carrossel proibido');
must(interactive,"v_interactive_id like 'da\\_%'",'botões/listas comerciais retornam ao worker');
must(state,'pending_delivery_address','estado multietapa guarda endereço');

must(confirmFirst,'queue_bling_order_backoffice_v1','Bling entra em fila local');
must(confirmFirst,'Nenhuma chamada ao Bling ocorre aqui','checkout não chama Bling');
must(confirmFirst,"'customer_sale_status','confirmed'",'venda confirmada é estado do cliente');
must(confirmFirst,"'bling',null",'Bling não aparece como requisito da experiência');
must(confirmFirst,'not c.bling_order_sync_enabled or not c.whatsapp_sales_bling_submit_enabled','worker Bling exige dois gates');
must(confirmFirst,'bling_order_batch_interval_minutes smallint not null default 10','intervalo padrão 10 minutos');
must(confirmFirst,"bling_order_batch_start_local time not null default '07:00'",'janela começa 07h');
must(confirmFirst,"bling_order_batch_end_local time not null default '18:00'",'janela termina 18h');
must(confirmFirst,"bling_order_batch_timezone text not null default 'America/Cuiaba'",'timezone explícito');

must(dispatchTarget,'conversation-worker-v3','dispatcher aponta para worker v3');
must(dispatchTarget,"'worker_version',3",'dispatcher registra versão 3');
must(dispatchTarget,"conversation_worker_webhook_key_v2",'dispatcher preserva segredo autenticado existente');
mustNot(dispatchTarget,'functions/v1/conversation-worker-v2','migration corretiva não pode restaurar worker v2');

must(searchRanking,'strpos(lower(p.name),q.term) between 1 and 14','termo próximo ao início recebe prioridade');
must(searchRanking,'order by r.score desc,r.term_position','ranking usa score e posição do termo');
must(searchRanking,'p.physically_verified=true','ranking mantém conferência física obrigatória');
must(searchRanking,'coalesce(p.stock,0)>0','ranking mantém estoque positivo obrigatório');

must(blingWorkflow,"cron: '*/10 11-21 * * *'",'agenda cobre 07:00–17:50 Cuiabá');
must(blingWorkflow,"cron: '0 22 * * *'",'agenda inclui 18:00 Cuiabá');
must(blingWorkflow,'TZ=America/Cuiaba date +%H%M','workflow valida hora local');
must(blingWorkflow,"github.event_name == 'schedule' && 'apply'",'agenda automática usa apply');
must(blingWorkflow,'cancel-in-progress: false','lotes não se atropelam');

must(support,'resolver corretamente a necessidade','objetivo comercial correto');
must(support,'menor número de mensagens necessário','baixa carga cognitiva');
must(support,'banco próprio de produtos fisicamente conferidos pelo contador','catálogo próprio');
must(support,'Finalizar pedido e enviá-lo ao Bling exige confirmação explícita','ação de compromisso protegida');

must(worker,'counter_verified','worker usa fonte própria');
must(worker,'da_confirm_order','worker trata confirmação oficial');
must(worker,'da_add_product:','worker trata escolha de produto');
must(worker,'productListInteractive','worker produz listas');
must(worker,'confirmInteractive','worker produz botões');
must(worker,'queue_human_handoff_v1','handoff humano preservado');
mustNot(worker,'carousel','worker não usa carrossel');
mustNot(worker,'/Api/v3/produtos','worker não consulta Bling');

must(admin,'service_knowledge_items','Admin gerencia conhecimento');
must(admin,'set_status','Admin publica/arquiva');
must(admin,'owner_required','publicação/runtime owner-only');
must(admin,'search_whatsapp_sellable_products_v1','Admin consulta catálogo próprio');
must(ui,'preview_bundle','UI tem prévia do cérebro');
for(const label of ['Conhecimento','Orientações','Procedimentos','Mídia','Testes','Publicação'])must(page,label,`Admin contém ${label}`);

must(binding,'bind_bling_product_id_v1','vínculo técnico auditável');
must(binding,"'catalog_source','counter_verified'",'draft Bling declara fonte própria');
must(writer,'createShadowProduct','writer cria produto técnico sob demanda');
must(writer,'`${API_BASE}/produtos`','writer usa endpoint de produto');
must(writer,'bind_bling_product_id_v1','writer persiste vínculo');
must(writer,'class AmbiguousError','efeito externo incerto vai para revisão');
must(writer,"d.catalog_source!=='counter_verified'",'writer valida fonte própria');
mustNot(writer,"if(!Number(i.bling_product_id))throw",'writer não exige vínculo prévio');

for(const s of [core,exec,support,state,interactive,binding,confirmFirst,dispatchTarget,searchRanking]) must(s,'revoke all on function','RPCs revogadas do público');
console.log('PASS: WhatsApp Sales MVP contract — catálogo próprio, ranking conversacional, IA/admin, dispatcher v3, confirmação antes do Bling e lote de 10 min 07–18 Cuiabá.');
