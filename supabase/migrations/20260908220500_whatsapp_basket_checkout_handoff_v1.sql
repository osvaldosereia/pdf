begin;

create or replace function public.whatsapp_basket_customer_confirm_interactive_v1(p_status jsonb)
returns jsonb language sql immutable set search_path=''
as $$
  select jsonb_build_object(
    'type','button',
    'body',jsonb_build_object('text',left(
      'Confirme seus dados de entrega:'||E'\n\nNome: '||coalesce(p_status->'customer'->>'name','')||
      E'\nRua: '||coalesce(p_status->'address'->>'street','')||
      E'\nQuadra: '||coalesce(p_status->'address'->>'block','')||
      E'\nCasa: '||coalesce(p_status->'address'->>'house','')||
      E'\nBairro: '||coalesce(p_status->'address'->>'neighborhood','')||
      E'\nLocalizador: '||coalesce(p_status->'address'->>'locator',''),1024)),
    'action',jsonb_build_object('buttons',jsonb_build_array(
      jsonb_build_object('type','reply','reply',jsonb_build_object('id','da_basket_customer_confirm','title','Confirmar dados')),
      jsonb_build_object('type','reply','reply',jsonb_build_object('id','da_basket_customer_change','title','Alterar dados'))
    ))
  )
$$;

create or replace function public.finalize_whatsapp_basket_order_request_v1(p_conversation_id uuid)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  c public.conversations%rowtype;
  bs public.catalog_sessions%rowtype;
  es public.catalog_sessions%rowtype;
  b public.basket_templates%rowtype;
  customer_status jsonb;
  promise jsonb;
  basket_items jsonb:='[]'::jsonb;
  extras jsonb:='[]'::jsonb;
  extras_total numeric:=0;
  total_value numeric:=0;
  req public.whatsapp_basket_order_requests%rowtype;
begin
  select * into c from public.conversations where id=p_conversation_id for update;
  if not found then raise exception 'conversation_not_found'; end if;

  customer_status:=public.confirm_whatsapp_basket_customer_v1(c.id);

  select * into bs from public.catalog_sessions
   where conversation_id=c.id and metadata->>'flow'='basket_basic_v1'
   order by created_at desc limit 1;
  if not found then raise exception 'basket_session_required'; end if;

  select * into b from public.basket_templates where id=(bs.metadata->>'basket_id')::uuid;
  if not found then raise exception 'basket_not_found'; end if;

  select * into es from public.catalog_sessions
   where conversation_id=c.id and metadata->>'flow'='basket_extras_v1'
   order by created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',i.product_id,'name',p.name,'quantity',i.quantity,
    'base_quantity',coalesce((i.metadata->>'base_quantity')::numeric,i.quantity),
    'changed',i.quantity is distinct from coalesce((i.metadata->>'base_quantity')::numeric,i.quantity)
  ) order by i.rank),'[]'::jsonb)
  into basket_items
  from public.catalog_session_items i join public.products p on p.id=i.product_id
  where i.catalog_session_id=bs.id;

  if bs.cart_id is not null then
    select coalesce(sum(ci.line_total),0),coalesce(jsonb_agg(jsonb_build_object(
      'product_id',ci.product_id,'name',p.name,'quantity',ci.quantity,'unit_price',ci.unit_price,'line_total',ci.line_total
    ) order by p.name) filter(where ci.id is not null),'[]'::jsonb)
    into extras_total,extras
    from public.cart_items ci join public.products p on p.id=ci.product_id
    where ci.cart_id=bs.cart_id and ci.source='addon' and ci.quantity>0;
  end if;

  total_value:=coalesce(b.base_price,0)+coalesce(extras_total,0);
  promise:=public.whatsapp_basket_delivery_promise_v1(now());

  insert into public.whatsapp_basket_order_requests(
    conversation_id,customer_id,basket_session_id,extras_session_id,basket_id,cart_id,status,
    basket_name_snapshot,basket_base_price,extras_total,total,basket_selection,extras,
    customer_snapshot,address_snapshot,delivery_date,delivery_rule,updated_at
  ) values(
    c.id,c.customer_id,bs.id,es.id,b.id,bs.cart_id,'ready_for_human',
    b.name,b.base_price,extras_total,total_value,basket_items,extras,
    coalesce(customer_status->'customer','{}'::jsonb),coalesce(customer_status->'address','{}'::jsonb),
    (promise->>'delivery_date')::date,coalesce(promise->>'rule','delivery_rule'),now()
  )
  on conflict(basket_session_id) do update set
    customer_id=excluded.customer_id,extras_session_id=excluded.extras_session_id,cart_id=excluded.cart_id,
    status='ready_for_human',basket_name_snapshot=excluded.basket_name_snapshot,basket_base_price=excluded.basket_base_price,
    extras_total=excluded.extras_total,total=excluded.total,basket_selection=excluded.basket_selection,extras=excluded.extras,
    customer_snapshot=excluded.customer_snapshot,address_snapshot=excluded.address_snapshot,
    delivery_date=excluded.delivery_date,delivery_rule=excluded.delivery_rule,updated_at=now()
  returning * into req;

  return jsonb_build_object(
    'request_id',req.id,'basket_name',req.basket_name_snapshot,'basket_price',req.basket_base_price,
    'extras_total',req.extras_total,'total',req.total,'delivery_date',req.delivery_date,
    'delivery_rule',req.delivery_rule,'delivery_fee',0,'basket_customized',exists(
      select 1 from jsonb_array_elements(req.basket_selection) x where coalesce((x->>'changed')::boolean,false)
    ),'customer',req.customer_snapshot,'address',req.address_snapshot
  );
end $$;

create or replace function public.parse_and_save_whatsapp_basket_customer_v1(p_conversation_id uuid,p_text text)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare parts text[]; normalized text:=trim(coalesce(p_text,''));
begin
  normalized:=replace(normalized,';','|');
  parts:=regexp_split_to_array(normalized,'\s*\|\s*');
  if cardinality(parts)<>6 then
    return jsonb_build_object('ok',false,'error','expected_six_fields');
  end if;
  if exists(select 1 from unnest(parts) x where nullif(trim(x),'') is null) then
    return jsonb_build_object('ok',false,'error','empty_field');
  end if;
  return jsonb_build_object('ok',true,'status',public.save_whatsapp_basket_customer_v1(
    p_conversation_id,trim(parts[1]),trim(parts[2]),trim(parts[3]),trim(parts[4]),trim(parts[5]),trim(parts[6])
  ));
end $$;

create or replace function public.route_whatsapp_basic_sales_ai_job_v1()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  m public.messages%rowtype;
  iid text:=''; normalized text:=''; basket_id uuid;
  basket_result jsonb; promise jsonb; reply text; st public.whatsapp_sales_state%rowtype;
  customer_status jsonb; saved jsonb; final_result jsonb; delivery_text text;
begin
  if new.job_type<>'conversation' or new.status<>'pending' then return new; end if;
  select * into m from public.messages where id=new.message_id and direction='inbound';
  if not found then return new; end if;
  iid:=coalesce(m.ai_interpretation->>'id','');
  normalized:=translate(lower(trim(regexp_replace(coalesce(m.body_text,m.transcript,''),'\s+',' ','g'))),'áàãâéêíóôõúç','aaaaeeiooouc');
  select * into st from public.whatsapp_sales_state where conversation_id=new.conversation_id;

  -- Confirmação/alteração de cadastro durante checkout da cesta.
  if coalesce(st.awaiting,'')='basket_customer_confirmation' then
    if iid='da_basket_customer_change' or normalized ~ '(^| )(alterar|mudar|corrigir)( |$)' then
      perform public.update_whatsapp_sales_state_v1(new.conversation_id,null,null,'basket_customer_data_requested',null,'basket_customer_data');
      reply:=E'Envie os 6 dados em uma única mensagem, separados por |, nesta ordem:\nNome | Rua | Quadra | Casa | Bairro | Localizador\n\nExemplo: Maria Silva | Rua A | 12 | 34 | Centro | perto da igreja';
      perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'request_basket_customer_data',jsonb_build_object('deterministic',true),1);
      new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','request_basket_customer_data');new.updated_at:=now();return new;
    end if;
    if iid='da_basket_customer_confirm' or normalized ~ '(^| )(confirmo|confirmar|sim|correto|pode)( |$)' then
      perform public.confirm_whatsapp_basket_customer_v1(new.conversation_id);
      final_result:=public.finalize_whatsapp_basket_order_request_v1(new.conversation_id);
      perform public.update_whatsapp_sales_state_v1(new.conversation_id,null,null,'basket_ready_for_human',null,'');
      delivery_text:=to_char((final_result->>'delivery_date')::date,'DD/MM/YYYY');
      reply:='Pedido recebido para conferência. Total: R$ '||replace(to_char((final_result->>'total')::numeric,'FM999999990.00'),'.',',')||'. Entrega prevista: '||delivery_text||'. Não cobramos taxa de entrega. Agora vou transferir você para nossa equipe concluir o atendimento.';
      perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'basket_ready_for_human',final_result,1);
      perform public.queue_human_handoff_v1(new.conversation_id,'basket_order_ready_for_human',m.id,3::smallint,'Pedido de cesta pronto para conferência e conclusão humana.',jsonb_build_object('source','whatsapp_basic_basket_v1','order_request',final_result));
      new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','basket_ready_for_human','order_request',final_result);new.updated_at:=now();return new;
    end if;
  end if;

  if coalesce(st.awaiting,'')='basket_customer_data' then
    saved:=public.parse_and_save_whatsapp_basket_customer_v1(new.conversation_id,coalesce(m.body_text,m.transcript,''));
    if coalesce((saved->>'ok')::boolean,false) is not true then
      reply:=E'Preciso dos 6 dados em uma única mensagem, separados por |, nesta ordem:\nNome | Rua | Quadra | Casa | Bairro | Localizador';
      perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'request_basket_customer_data',saved,1);
      new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','request_basket_customer_data','parse',saved);new.updated_at:=now();return new;
    end if;
    final_result:=public.finalize_whatsapp_basket_order_request_v1(new.conversation_id);
    perform public.update_whatsapp_sales_state_v1(new.conversation_id,null,null,'basket_ready_for_human',null,'');
    delivery_text:=to_char((final_result->>'delivery_date')::date,'DD/MM/YYYY');
    reply:='Cadastro confirmado. Pedido recebido para conferência. Total: R$ '||replace(to_char((final_result->>'total')::numeric,'FM999999990.00'),'.',',')||'. Entrega prevista: '||delivery_text||'. Não cobramos taxa de entrega. Agora vou transferir você para nossa equipe concluir o atendimento.';
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'basket_ready_for_human',final_result,1);
    perform public.queue_human_handoff_v1(new.conversation_id,'basket_order_ready_for_human',m.id,3::smallint,'Pedido de cesta pronto para conferência e conclusão humana.',jsonb_build_object('source','whatsapp_basic_basket_v1','order_request',final_result));
    new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','basket_ready_for_human','order_request',final_result);new.updated_at:=now();return new;
  end if;

  if iid like 'da_basket:%' then
    begin basket_id:=substring(iid from length('da_basket:')+1)::uuid; exception when others then basket_id:=null; end;
    if basket_id is not null then
      basket_result:=public.create_whatsapp_basket_session_v1(new.conversation_id,basket_id);
      reply:='Você escolheu '||coalesce(basket_result->>'basket_name','a cesta')||' — R$ '||replace(to_char(coalesce((basket_result->>'basket_price')::numeric,0),'FM999999990.00'),'.',',')||E'.\n\nAbra aqui para ver a foto grande, os produtos e ajustar as quantidades:\n'||coalesce(basket_result->>'url','');
      perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'basket_catalog_link',basket_result,1);
      new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','basket_catalog_link','basket',basket_result);new.updated_at:=now();return new;
    end if;
  end if;

  -- Retorno do catálogo: confirmar cadastro antes do handoff.
  if normalized ~ '(quero encomendar a cesta que escolhi|terminei de escolher os produtos adicionais da minha cesta)' then
    customer_status:=public.get_whatsapp_basket_customer_status_v1(new.conversation_id);
    if coalesce((customer_status->>'registered')::boolean,false) then
      perform public.update_whatsapp_sales_state_v1(new.conversation_id,null,null,'basket_customer_confirmation',null,'basket_customer_confirmation');
      perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,'Confirme seus dados para concluir a encomenda:','interactive',null,public.whatsapp_basket_customer_confirm_interactive_v1(customer_status),'basket_customer_confirmation',customer_status,1);
      new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','basket_customer_confirmation');new.updated_at:=now();return new;
    else
      perform public.update_whatsapp_sales_state_v1(new.conversation_id,null,null,'basket_customer_data_requested',null,'basket_customer_data');
      reply:=E'Para concluir, envie os 6 dados em uma única mensagem, separados por |, nesta ordem:\nNome | Rua | Quadra | Casa | Bairro | Localizador\n\nExemplo: Maria Silva | Rua A | 12 | 34 | Centro | perto da igreja';
      perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'request_basket_customer_data',customer_status,1);
      new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','request_basket_customer_data');new.updated_at:=now();return new;
    end if;
  end if;

  if normalized ~ '(^| )(cesta|cestas)( |$)' then
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,'Escolha uma das nossas 9 cestas básicas:','interactive',null,public.whatsapp_simple_basket_list_interactive_v1(),'show_baskets',jsonb_build_object('deterministic',true),1);
    new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','show_baskets');new.updated_at:=now();return new;
  end if;

  if normalized ~ '(forma(s)? de pagamento|como (posso )?pagar|como paga|pagamento|boleto|30 dias)' then
    reply:=E'FORMAS DE PAGAMENTO\n- Cartão de Crédito em 3x sem juros\n- Cartão de Débito\n- Pix e Dinheiro\n- Cartão Alimentação Alelo, Sodexo, Puxee, Cajur, Flash e Ifood.\n- Por enquanto não vendemos pra 30 dias ou no Boleto.';
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'payment_methods',jsonb_build_object('deterministic',true),1);
    new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','payment_methods');new.updated_at:=now();return new;
  end if;

  if normalized ~ '(que horas.*entrega|horario.*entrega|entrega.*horario|hora.*entrega|entrega.*que horas)' then
    reply:='As entregas são feitas por rota e o horário depende do bairro. Vou transferir seu atendimento para a equipe confirmar com você.';
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'delivery_time_handoff',jsonb_build_object('deterministic',true),1);
    perform public.queue_human_handoff_v1(new.conversation_id,'delivery_time_requires_human',m.id,2::smallint,'Cliente perguntou o horário da entrega. Entregas são por rota e dependem do bairro.',jsonb_build_object('source','whatsapp_basic_basket_v1'));
    new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','delivery_time_handoff');new.updated_at:=now();return new;
  end if;

  if normalized ~ '(taxa.*entrega|entrega.*taxa|frete|cobra.*entrega|custo.*entrega)' then
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,'Não cobramos taxa de entrega.','text',null,null,'delivery_fee',jsonb_build_object('delivery_fee',0,'deterministic',true),1);
    new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','delivery_fee','delivery_fee',0);new.updated_at:=now();return new;
  end if;

  if normalized ~ '(quando entrega|entrega hoje|entrega amanha|entrega amanhã|prazo.*entrega|depois das 11|apos as 11|após as 11)' then
    promise:=public.whatsapp_basket_delivery_promise_v1(now());
    if coalesce((promise->>'same_day')::boolean,false) then reply:='Pedidos feitos até as 11h, no horário de Cuiabá, são entregues no mesmo dia. Não cobramos taxa de entrega.';
    else reply:='Pedidos feitos após as 11h, no horário de Cuiabá, são entregues no próximo dia útil. Não cobramos taxa de entrega.'; end if;
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'delivery_promise',promise,1);
    new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','delivery_promise','promise',promise);new.updated_at:=now();return new;
  end if;

  return new;
end $$;

revoke all on function public.whatsapp_basket_customer_confirm_interactive_v1(jsonb) from public,anon,authenticated;
revoke all on function public.finalize_whatsapp_basket_order_request_v1(uuid) from public,anon,authenticated;
revoke all on function public.parse_and_save_whatsapp_basket_customer_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.whatsapp_basket_customer_confirm_interactive_v1(jsonb) to service_role;
grant execute on function public.finalize_whatsapp_basket_order_request_v1(uuid) to service_role;
grant execute on function public.parse_and_save_whatsapp_basket_customer_v1(uuid,text) to service_role;

commit;