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
const worker=r('supabase/functions/conversation-worker-v3/index.ts');
const admin=r('supabase/functions/admin-service-intelligence-v1/index.ts');
const ui=r('admin-v3/service-intelligence.js');
const page=r('admin/inteligencia.html');
const writer=r('scripts/bling-order-writer-v1.mjs');
const blingWorkflow=r('.github/workflows/bling-order-writer-v1.yml');
const has=(s,re,msg)=>assert.match(s,re,msg);
const lacks=(s,re,msg)=>assert.doesNotMatch(s,re,msg);

has(core,/whatsapp_sales_mvp_enabled boolean not null default false/i,'MVP nasce OFF');
has(core,/whatsapp_sales_catalog_source text not null default 'counter_verified'/i,'fonte é contador');
has(core,/where p\.physically_verified=true[\s\S]*p\.is_active=true[\s\S]*coalesce\(p\.stock,0\)>0/i,'catálogo exige conferência física/ativo/estoque');
lacks(core,/search_whatsapp_sellable_products_v1[\s\S]{0,4000}bling_product_id/i,'busca ao cliente não pode depender de Bling');
has(core,/service_knowledge_items/i,'conhecimento versionável');
has(core,/service_guidance_rules/i,'orientações versionáveis');
has(core,/service_procedures/i,'procedimentos versionáveis');
has(core,/service_regression_cases/i,'regressões versionáveis');
has(core,/replace_whatsapp_sales_product_v1/i,'troca de produto');
has(core,/basket_substitution_confirmation_required/i,'troca de cesta protegida');

has(exec,/explicit_order_confirmation_required/i,'pedido exige confirmação explícita');
has(exec,/whatsapp_sales_order_submit_enabled/i,'gate de finalização');
has(exec,/whatsapp_sales_bling_submit_enabled/i,'gate separado para Bling');
has(exec,/delivery_mode.*'text','audio','image','interactive'/s,'outbound permite recursos oficiais necessários');
has(exec,/protocol_version',4/i,'protocolo outbound v4');
lacks(exec,/carousel/i,'carrossel proibido');
has(interactive,/v_interactive_id like 'da\\_%'/i,'botões/listas comerciais retornam ao worker');
has(state,/pending_delivery_address/i,'estado multietapa guarda endereço');

has(confirmFirst,/Primeiro e definitivamente: cria o pedido interno/i,'venda é concluída antes da retaguarda');
has(confirmFirst,/queue_bling_order_backoffice_v1/i,'Bling entra em fila local');
has(confirmFirst,/Nenhuma chamada ao Bling ocorre aqui/i,'checkout não chama Bling');
has(confirmFirst,/'customer_sale_status','confirmed'/i,'cliente recebe estado de venda confirmada');
has(confirmFirst,/'bling',null/i,'Bling não aparece como requisito da experiência');
has(confirmFirst,/not c\.bling_order_sync_enabled or not c\.whatsapp_sales_bling_submit_enabled/i,'worker Bling exige dois gates');
has(confirmFirst,/default 10/i,'intervalo padrão é 10 minutos');
has(confirmFirst,/default '07:00'/i,'janela começa 07h');
has(confirmFirst,/default '18:00'/i,'janela termina 18h');
has(confirmFirst,/default 'America\/Cuiaba'/i,'timezone explícito');

has(blingWorkflow,/cron: '\*\/10 11-21 \* \* \*'/i,'agenda cobre 07:00–17:50 Cuiabá');
has(blingWorkflow,/cron: '0 22 \* \* \*'/i,'agenda inclui rodada das 18:00');
has(blingWorkflow,/TZ=America\/Cuiaba date \+%H%M/i,'workflow valida hora local');
has(blingWorkflow,/github\.event_name == 'schedule' && 'apply'/i,'agenda automática roda apply');
has(blingWorkflow,/cancel-in-progress: false/i,'lotes não se atropelam');

has(support,/resolver corretamente a necessidade/i,'objetivo comercial correto seedado');
has(support,/menor número de mensagens necessário/i,'baixa carga cognitiva');
has(support,/banco próprio de produtos fisicamente conferidos pelo contador/i,'regra catálogo próprio');
has(support,/Finalizar pedido e enviá-lo ao Bling exige confirmação explícita/i,'ação de compromisso protegida');

has(worker,/counter_verified/i,'worker usa fonte própria');
has(worker,/da_confirm_order/i,'worker trata confirmação oficial');
has(worker,/da_add_product:/i,'worker trata escolha de produto');
has(worker,/productListInteractive/i,'worker produz listas');
has(worker,/confirmInteractive/i,'worker produz botões');
has(worker,/queue_human_handoff_v1/i,'handoff humano preservado');
lacks(worker,/carousel/i,'worker não usa carrossel');
lacks(worker,/GET \/produtos|\/Api\/v3\/produtos/i,'worker não consulta Bling');

has(admin,/service_knowledge_items/i,'Admin gerencia conhecimento');
has(admin,/set_status/i,'Admin publica/arquiva');
has(admin,/owner_required/i,'publicação/runtime owner-only');
has(admin,/search_whatsapp_sellable_products_v1/i,'Admin consulta catálogo próprio');
has(ui,/preview_bundle/i,'UI tem prévia do cérebro');
has(page,/Conhecimento[\s\S]*Orientações[\s\S]*Procedimentos[\s\S]*Mídia[\s\S]*Testes[\s\S]*Publicação/i,'Admin cobre todos domínios');

has(binding,/bind_bling_product_id_v1/i,'vínculo técnico auditável');
has(binding,/'catalog_source','counter_verified'/i,'draft Bling declara fonte própria');
has(writer,/createShadowProduct/i,'writer cria produto técnico sob demanda');
has(writer,/POST|method:'POST'/i,'writer cria via POST');
has(writer,/`${API_BASE}\/produtos`/i,'writer usa endpoint atual de produto');
has(writer,/bind_bling_product_id_v1/i,'writer persiste vínculo');
has(writer,/class AmbiguousError/i,'efeito externo incerto vai para revisão');
has(writer,/catalog_source.*counter_verified/s,'writer valida fonte própria');
lacks(writer,/if\(!Number\(i\.bling_product_id\)\)throw/i,'writer não exige vínculo prévio');

for(const s of [core,exec,support,state,interactive,binding,confirmFirst]){
  has(s,/revoke all on function/i,'RPCs revogadas do público');
}
console.log('whatsapp sales MVP contract: ok');
