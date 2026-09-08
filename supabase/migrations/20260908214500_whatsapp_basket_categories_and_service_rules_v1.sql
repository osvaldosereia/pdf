begin;

create or replace function public.get_whatsapp_product_categories_v1()
returns table(category text, display_name text, product_count integer)
language sql stable security definer set search_path=''
as $$
  select p.category,
         initcap(lower(p.category)) as display_name,
         count(*)::integer as product_count
    from public.products p
   where p.physically_verified=true
     and p.is_active=true
     and p.price is not null
     and p.price>=0
     and coalesce(p.stock,0)>0
     and nullif(trim(p.category),'') is not null
   group by p.category
   order by p.category
$$;

create or replace function public.create_whatsapp_basket_extras_by_categories_v1(
  p_conversation_id uuid,
  p_categories text[]
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  c public.conversations%rowtype;
  base_s public.catalog_sessions%rowtype;
  extra_s public.catalog_sessions%rowtype;
  selected text[]:='{}'::text[];
  cat text;
  cnt integer:=0;
begin
  select * into c from public.conversations where id=p_conversation_id and status<>'closed';
  if not found then raise exception 'conversation_not_found'; end if;
  select * into base_s from public.catalog_sessions
   where conversation_id=c.id and metadata->>'flow'='basket_basic_v1'
   order by created_at desc limit 1;
  if not found or base_s.cart_id is null then raise exception 'basket_session_required'; end if;

  foreach cat in array coalesce(p_categories,'{}'::text[]) loop
    cat:=trim(cat);
    if cat<>'' and exists(
      select 1 from public.products p where p.category=cat
       and p.physically_verified=true and p.is_active=true
       and p.price is not null and p.price>=0 and coalesce(p.stock,0)>0
    ) and not cat=any(selected) then selected:=array_append(selected,cat); end if;
  end loop;
  if cardinality(selected)=0 then raise exception 'categories_required'; end if;

  update public.catalog_sessions set status='closed',closed_at=now(),last_activity_at=now()
   where conversation_id=c.id and status='open' and metadata->>'flow'='basket_extras_v1';

  insert into public.catalog_sessions(customer_id,conversation_id,cart_id,kind,title,status,expires_at,metadata,experience,current_view,last_activity_at)
  values(c.customer_id,c.id,base_s.cart_id,'browse','Adicionar produtos','open',now()+interval '24 hours',
    jsonb_build_object('flow','basket_extras_v1','parent_basket_session_id',base_s.id,'categories',to_jsonb(selected)),
    'shopping_room','products',now()) returning * into extra_s;

  insert into public.catalog_session_items(catalog_session_id,product_id,rank,reason,recommendation_score,quantity,metadata)
  select extra_s.id,p.id,row_number() over(order by p.category,p.sort_order nulls last,p.name)::integer,
         p.category,0,coalesce(ci.quantity,0),jsonb_build_object('item_type','extra','category',p.category)
    from public.products p
    left join public.cart_items ci on ci.cart_id=base_s.cart_id and ci.product_id=p.id and ci.source='addon'
   where p.physically_verified=true and p.is_active=true and p.price is not null and p.price>=0
     and coalesce(p.stock,0)>0 and p.category=any(selected)
   order by p.category,p.sort_order nulls last,p.name
   limit 300;
  get diagnostics cnt=row_count;

  return jsonb_build_object('session_id',extra_s.id,'token',extra_s.public_token,'item_count',cnt,
    'categories',to_jsonb(selected),'url','https://donaantonia.com.br/cesta/?t='||extra_s.public_token);
end $$;

revoke all on function public.get_whatsapp_product_categories_v1() from public,anon,authenticated;
revoke all on function public.create_whatsapp_basket_extras_by_categories_v1(uuid,text[]) from public,anon,authenticated;
grant execute on function public.get_whatsapp_product_categories_v1() to service_role;
grant execute on function public.create_whatsapp_basket_extras_by_categories_v1(uuid,text[]) to service_role;

delete from public.service_knowledge_items where knowledge_key in (
  'formas_pagamento_cestas_v1','entrega_taxa_v1','entrega_prazo_11h_v1','entrega_horario_rota_v1'
);
insert into public.service_knowledge_items(
  knowledge_key,category,title,content,keywords,channel_scope,status,priority,source_note
) values
('formas_pagamento_cestas_v1','Pagamento','Formas de pagamento',E'FORMAS DE PAGAMENTO\n- Cartão de Crédito em 3x sem juros\n- Cartão de Débito\n- Pix e Dinheiro\n- Cartão Alimentação Alelo, Sodexo, Puxee, Cajur, Flash e Ifood.\n- Por enquanto não vendemos pra 30 dias ou no Boleto.',array['pagamento','cartao','crédito','credito','débito','debito','pix','dinheiro','alelo','sodexo','puxee','cajur','flash','ifood','boleto','30 dias'],array['whatsapp'],'published',100,'Regra comercial informada pelo proprietário'),
('entrega_taxa_v1','Entrega','Taxa de entrega','Não cobramos taxa de entrega.',array['taxa','entrega','frete'],array['whatsapp'],'published',100,'Regra comercial informada pelo proprietário'),
('entrega_prazo_11h_v1','Entrega','Prazo conforme horário do pedido','Pedidos feitos até as 11h no horário de Cuiabá podem ser entregues no mesmo dia. Pedidos feitos após as 11h serão entregues no próximo dia útil.',array['11h','prazo','entrega','hoje','amanha','amanhã'],array['whatsapp'],'published',100,'Regra comercial informada pelo proprietário'),
('entrega_horario_rota_v1','Entrega','Horário da entrega','As entregas são feitas por rota e o horário depende do bairro. Quando o cliente perguntar o horário da entrega, informe isso e transfira o atendimento para uma pessoa da equipe.',array['horario','horário','que horas','rota','bairro'],array['whatsapp'],'published',100,'Regra comercial informada pelo proprietário');

delete from public.service_guidance_rules where rule_key in (
  'payment_exact_answer_v1','delivery_time_handoff_v1','basket_categories_real_catalog_v1','delivery_free_v1'
);
insert into public.service_guidance_rules(rule_key,title,instruction,behavior_tags,channel_scope,intent_scope,stage_scope,priority,status)
values
('payment_exact_answer_v1','Responder pagamento sem improvisar','Se perguntarem formas de pagamento, 30 dias ou boleto, responda somente com as formas cadastradas na base. Informe explicitamente que por enquanto não vendemos para 30 dias nem no boleto.',array['mvp_whatsapp','payment'],array['whatsapp'],array[]::text[],array[]::text[],100,'published'),
('delivery_time_handoff_v1','Horário de entrega exige humano','Se o cliente perguntar qual horário a entrega chegará, diga que as entregas são por rota e o horário depende do bairro e encaminhe imediatamente para atendimento humano. Não invente janela de horário.',array['mvp_whatsapp','delivery','handoff'],array['whatsapp'],array[]::text[],array[]::text[],100,'published'),
('basket_categories_real_catalog_v1','Personalização usa categorias do cadastro','Ao adicionar produtos para personalizar uma cesta, apresente as categorias reais disponíveis no cadastro de produtos e permita que o cliente escolha uma ou várias. Gere a vitrine somente com as categorias escolhidas.',array['mvp_whatsapp','basket','catalog'],array['whatsapp'],array[]::text[],array[]::text[],100,'published'),
('delivery_free_v1','Entrega sem taxa','Quando o cliente perguntar sobre taxa ou frete, informe que não cobramos taxa de entrega.',array['mvp_whatsapp','delivery'],array['whatsapp'],array[]::text[],array[]::text[],100,'published');

delete from public.service_regression_cases where case_key in (
  'payment_methods_exact_v1','delivery_time_routes_handoff_v1','after_11_next_business_day_v1','delivery_fee_zero_v1','basket_real_categories_v1'
);
insert into public.service_regression_cases(case_key,title,customer_message,setup,expected_intent,expected_action,expected_assertions,status,priority)
values
('payment_methods_exact_v1','Pagamento e boleto','Vocês vendem no boleto ou para 30 dias?','{}'::jsonb,'answer','knowledge_answer',jsonb_build_object('must_say_no_boleto',true,'must_say_no_30_days',true,'must_include_payment_methods',true),'active',100),
('delivery_time_routes_handoff_v1','Horário por rota transfere humano','Que horas minha cesta chega?','{}'::jsonb,'human','human_handoff',jsonb_build_object('must_explain_route_by_neighborhood',true,'must_handoff',true,'must_not_invent_time',true),'active',100),
('after_11_next_business_day_v1','Pedido após 11h','Se eu pedir depois das 11 entrega hoje?','{}'::jsonb,'answer','knowledge_answer',jsonb_build_object('after_11_next_business_day',true,'timezone','America/Cuiaba'),'active',100),
('delivery_fee_zero_v1','Sem taxa de entrega','Tem taxa de entrega?','{}'::jsonb,'answer','knowledge_answer',jsonb_build_object('delivery_fee',0),'active',100),
('basket_real_categories_v1','Categorias reais na personalização','Quero colocar mais produtos na cesta',jsonb_build_object('basket_selected',true),'basket_extras','show_categories',jsonb_build_object('must_use_registered_categories',true,'allow_multiple_categories',true),'active',100);

commit;