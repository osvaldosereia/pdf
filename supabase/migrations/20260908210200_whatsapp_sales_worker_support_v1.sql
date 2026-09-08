begin;

create or replace function public.finish_whatsapp_sales_job_v1(
  p_job_id uuid,p_worker text,p_attempt integer,p_result jsonb,p_usage jsonb default '{}'::jsonb,p_error text default null
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare j public.ai_jobs%rowtype; m public.messages%rowtype;
begin
  select * into j from public.ai_jobs where id=p_job_id for update;
  if not found then raise exception 'job_not_found'; end if;
  if j.status='done' then return jsonb_build_object('status','done','duplicate',true); end if;
  if j.status<>'processing' or j.locked_by is distinct from p_worker or j.attempts<>p_attempt then raise exception 'stale_job_lease'; end if;
  select * into m from public.messages where id=j.message_id for update;
  update public.ai_usage_events set status=case when p_error is null then 'done' else 'error' end,
    model=left(p_usage->>'model',100),provider_request_id=left(p_usage->>'provider_request_id',200),
    input_tokens=nullif(p_usage->>'input_tokens','')::integer,output_tokens=nullif(p_usage->>'output_tokens','')::integer,
    audio_seconds=nullif(p_usage->>'audio_seconds','')::numeric,estimated_cost_usd=nullif(p_usage->>'estimated_cost_usd','')::numeric,
    pricing_version=left(p_usage->>'pricing_version',100),finished_at=now()
  where job_id=j.id and attempt=j.attempts;
  if p_error is not null then
    update public.ai_jobs set status='error',error_message=left(p_error,100),updated_at=now() where id=j.id;
    if j.job_type='vision' then update public.room_media set processing_status='error',processing_error=left(p_error,100) where message_id=j.message_id; end if;
    return jsonb_build_object('status','error');
  end if;
  update public.messages set ai_interpretation=coalesce(ai_interpretation,'{}'::jsonb)||jsonb_build_object(
    'sales_mvp',true,'sales_plan',coalesce(p_result->'plan','{}'::jsonb),'sales_action_result',coalesce(p_result->'action_result','{}'::jsonb),'source','conversation_worker_v3'
  ) where id=j.message_id;
  if j.job_type='vision' then update public.room_media set processing_status='processed',processing_error=null where message_id=j.message_id; end if;
  update public.ai_jobs set status='done',result=coalesce(p_result,'{}'::jsonb),error_message=null,updated_at=now() where id=j.id;
  return jsonb_build_object('status','done','reply_suppressed',true,'sales_mvp',true);
end $$;

-- Orientações que o proprietário já definiu. Runtime continua OFF até a ativação do MVP.
insert into public.service_guidance_rules(rule_key,title,instruction,intent_scope,stage_scope,behavior_tags,status,priority,version_no)
values
('sales_objective_order','Ordem dos objetivos','Otimize nesta ordem: 1) resolver corretamente a necessidade; 2) tornar a compra fácil; 3) fechar a venda; 4) aumentar ticket apenas quando fizer sentido. Nunca sacrifique os três primeiros para fazer upsell.','{}','{}',array['sales','trust'],'published',100,1),
('minimal_interactions','Poucas interações com baixa carga cognitiva','Use o menor número de mensagens necessário, sem transformar a resposta em um texto enorme. Entregue de uma vez apenas as informações úteis para a intenção atual.','{}','{}',array['ux','concise'],'published',100,1),
('catalog_source','Fonte de verdade do catálogo','Preço, estoque, nome, disponibilidade e foto vêm exclusivamente do banco próprio de produtos fisicamente conferidos pelo contador. Nunca use o catálogo do Bling como fonte de atendimento e nunca invente dados ausentes.','{}','{}',array['catalog','safety'],'published',100,1),
('safe_actions','Ações seguras','Pode consultar catálogo, histórico, carrinho, comparar alternativas, mostrar fotos e preparar alterações reversíveis sem pedir autorização intermediária. Finalizar pedido e enviá-lo ao Bling exige confirmação explícita do cliente.','{}','{}',array['autonomy','safety'],'published',100,1),
('basket_price','Preço comercial das cestas','Cestas possuem preço comercial próprio. Não revele preços individuais dos componentes como explicação do preço da cesta e não trate o preço da cesta como soma dos itens.','{}','{}',array['basket','pricing'],'published',100,1),
('no_false_promises','Sem promessas inventadas','Se não houver dado confiável de estoque, preço, prazo, endereço ou regra, diga que precisa conferir ou faça handoff. Não prometa entrega nem disponibilidade para fechar a venda.','{}','{}',array['trust','safety'],'published',100,1)
on conflict(rule_key,version_no) do nothing;

insert into public.service_procedures(procedure_key,title,trigger_description,steps,allowed_actions,confirmation_actions,fallback,status,priority,version_no)
values
('product_purchase','Comprar produto avulso','Cliente pede produto, quantidade ou demonstra necessidade implícita.',
 '["Entender produto e quantidade","Consultar somente produtos conferidos","Se houver uma opção clara, adicionar ao carrinho e informar o que foi feito","Se houver ambiguidade, mostrar poucas opções","Continuar até o cliente querer fechar"]'::jsonb,
 array['search_product','show_product','add_product','set_quantity','remove_product','cart_summary'],array['confirm_order'],'Se não houver produto adequado, oferecer alternativa real do catálogo ou chamar humano.','published',100,1),
('order_checkout','Finalizar pedido','Cliente pede para fechar, finalizar ou confirmar a compra.',
 '["Mostrar resumo curto do carrinho e total","Confirmar endereço ou solicitar o que falta","Apresentar botão Confirmar pedido","Somente após confirmação explícita criar o pedido","Enfileirar envio ao Bling quando o gate estiver habilitado"]'::jsonb,
 array['cart_summary','checkout_preview'],array['confirm_order'],'Se faltar informação obrigatória, pedir somente o dado faltante.','published',100,1),
('product_replacement','Troca e personalização','Cliente pede para retirar, aumentar, diminuir ou trocar produto.',
 '["Identificar item atual","Identificar substituto no catálogo conferido","Validar disponibilidade","Para item avulso executar alteração reversível","Para componente de cesta respeitar grupo de substituição configurado e confirmação quando necessária","Mostrar resultado atualizado"]'::jsonb,
 array['search_product','set_quantity','remove_product','replace_product'],array['basket_replace'],'Se a regra da cesta não estiver configurada, não improvisar; pedir alternativa ou chamar humano.','published',100,1)
on conflict(procedure_key,version_no) do nothing;

insert into public.service_regression_cases(case_key,title,customer_message,expected_intent,expected_action,expected_assertions,status,priority)
values
('price_basket','Pergunta preço de cesta','Quanto está a cesta?','baskets','show_baskets','{"no_followup_question_before_options":true,"no_component_price_breakdown":true}'::jsonb,'active',100),
('add_known_product','Adicionar produto claro','Coloca 2 arroz Tio João 5kg','add','add_product','{"source":"counter_verified","quantity":2}'::jsonb,'active',100),
('implicit_need','Necessidade implícita','Tá faltando óleo aqui em casa','search','search_product','{"offer_real_catalog_option":true}'::jsonb,'active',90),
('ambiguous_product','Produto ambíguo','Põe aquele sabão azul','clarify','clarify','{"do_not_guess":true}'::jsonb,'active',100),
('confirm_order','Confirmação do pedido','Pode fechar o pedido','checkout','confirm_order','{"requires_explicit_confirmation":true,"bling_only_after_confirmation":true}'::jsonb,'active',100)
on conflict(case_key) do nothing;

revoke all on function public.finish_whatsapp_sales_job_v1(uuid,text,integer,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.finish_whatsapp_sales_job_v1(uuid,text,integer,jsonb,jsonb,text) to service_role;

commit;
