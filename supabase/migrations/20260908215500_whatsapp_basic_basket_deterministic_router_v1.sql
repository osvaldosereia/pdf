begin;

create or replace function public.whatsapp_simple_basket_list_interactive_v1()
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare rows jsonb:='[]'::jsonb; r record;
begin
  for r in select * from public.get_whatsapp_simple_baskets_v1() loop
    rows:=rows||jsonb_build_array(jsonb_build_object(
      'id','da_basket:'||r.id::text,
      'title',left(r.display_name,24),
      'description','R$ '||replace(to_char(r.base_price,'FM999999990.00'),'.',',')
    ));
  end loop;
  return jsonb_build_object(
    'type','list',
    'body',jsonb_build_object('text','Estas são nossas cestas básicas. Escolha uma para ver a composição e encomendar:'),
    'action',jsonb_build_object('button','Escolher cesta','sections',jsonb_build_array(jsonb_build_object('title','Cestas básicas','rows',rows)))
  );
end $$;

create or replace function public.route_whatsapp_basic_sales_ai_job_v1()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  m public.messages%rowtype;
  iid text:='';
  normalized text:='';
  basket_id uuid;
  basket_result jsonb;
  promise jsonb;
  reply text;
begin
  if new.job_type<>'conversation' or new.status<>'pending' then return new; end if;
  select * into m from public.messages where id=new.message_id and direction='inbound';
  if not found then return new; end if;

  iid:=coalesce(m.ai_interpretation->>'id','');
  normalized:=translate(lower(trim(regexp_replace(coalesce(m.body_text,m.transcript,''),'\s+',' ','g'))),'áàãâéêíóôõúç','aaaaeeiooouc');

  if iid like 'da_basket:%' then
    begin basket_id:=substring(iid from length('da_basket:')+1)::uuid; exception when others then basket_id:=null; end;
    if basket_id is not null then
      basket_result:=public.create_whatsapp_basket_session_v1(new.conversation_id,basket_id);
      reply:='Você escolheu '||coalesce(basket_result->>'basket_name','a cesta')||' — R$ '||replace(to_char(coalesce((basket_result->>'basket_price')::numeric,0),'FM999999990.00'),'.',',')||E'.\n\nAbra aqui para ver a foto grande, os produtos e ajustar as quantidades:\n'||coalesce(basket_result->>'url','');
      perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'basket_catalog_link',basket_result,1);
      new.status:='done'; new.result:=jsonb_build_object('deterministic',true,'action','basket_catalog_link','basket',basket_result); new.updated_at:=now();
      return new;
    end if;
  end if;

  if normalized ~ '(^| )(cesta|cestas)( |$)' then
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,'Escolha uma das nossas 9 cestas básicas:','interactive',null,public.whatsapp_simple_basket_list_interactive_v1(),'show_baskets',jsonb_build_object('deterministic',true),1);
    new.status:='done'; new.result:=jsonb_build_object('deterministic',true,'action','show_baskets'); new.updated_at:=now();
    return new;
  end if;

  if normalized ~ '(forma(s)? de pagamento|como (posso )?pagar|como paga|pagamento|boleto|30 dias)' then
    reply:=E'FORMAS DE PAGAMENTO\n- Cartão de Crédito em 3x sem juros\n- Cartão de Débito\n- Pix e Dinheiro\n- Cartão Alimentação Alelo, Sodexo, Puxee, Cajur, Flash e Ifood.\n- Por enquanto não vendemos pra 30 dias ou no Boleto.';
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'payment_methods',jsonb_build_object('deterministic',true),1);
    new.status:='done'; new.result:=jsonb_build_object('deterministic',true,'action','payment_methods'); new.updated_at:=now();
    return new;
  end if;

  if normalized ~ '(que horas.*entrega|horario.*entrega|entrega.*horario|hora.*entrega|entrega.*que horas)' then
    reply:='As entregas são feitas por rota e o horário depende do bairro. Vou transferir seu atendimento para a equipe confirmar com você.';
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'delivery_time_handoff',jsonb_build_object('deterministic',true),1);
    perform public.queue_human_handoff_v1(new.conversation_id,'delivery_time_requires_human',m.id,2::smallint,'Cliente perguntou o horário da entrega. Entregas são por rota e dependem do bairro.',jsonb_build_object('source','whatsapp_basic_basket_v1'));
    new.status:='done'; new.result:=jsonb_build_object('deterministic',true,'action','delivery_time_handoff'); new.updated_at:=now();
    return new;
  end if;

  if normalized ~ '(taxa.*entrega|entrega.*taxa|frete|cobra.*entrega|custo.*entrega)' then
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,'Não cobramos taxa de entrega.','text',null,null,'delivery_fee',jsonb_build_object('delivery_fee',0,'deterministic',true),1);
    new.status:='done'; new.result:=jsonb_build_object('deterministic',true,'action','delivery_fee','delivery_fee',0); new.updated_at:=now();
    return new;
  end if;

  if normalized ~ '(quando entrega|entrega hoje|entrega amanha|entrega amanhã|prazo.*entrega|depois das 11|apos as 11|após as 11)' then
    promise:=public.whatsapp_basket_delivery_promise_v1(now());
    if coalesce((promise->>'same_day')::boolean,false) then
      reply:='Pedidos feitos até as 11h, no horário de Cuiabá, são entregues no mesmo dia. Não cobramos taxa de entrega.';
    else
      reply:='Pedidos feitos após as 11h, no horário de Cuiabá, são entregues no próximo dia útil. Não cobramos taxa de entrega.';
    end if;
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'delivery_promise',promise,1);
    new.status:='done'; new.result:=jsonb_build_object('deterministic',true,'action','delivery_promise','promise',promise); new.updated_at:=now();
    return new;
  end if;

  return new;
end $$;

drop trigger if exists trg_route_whatsapp_basic_sales_ai_job_v1 on public.ai_jobs;
create trigger trg_route_whatsapp_basic_sales_ai_job_v1
before insert on public.ai_jobs
for each row execute function public.route_whatsapp_basic_sales_ai_job_v1();

revoke all on function public.whatsapp_simple_basket_list_interactive_v1() from public,anon,authenticated;
grant execute on function public.whatsapp_simple_basket_list_interactive_v1() to service_role;

commit;