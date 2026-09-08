begin;

-- Guardrails descobertos na homologação real:
-- 1) saudações não podem virar busca de produto por substring (ex.: OLA em BOLACHA/CHOCOLATE);
-- 2) endereço sugerido pelo modelo não pode virar verdade sem evidência explícita do cliente.

create or replace function public.build_whatsapp_sales_context_v1(p_conversation_id uuid,p_message_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  c public.conversations%rowtype;
  m public.messages%rowtype;
  customer jsonb;
  history jsonb;
  products jsonb;
  cart jsonb;
  intelligence jsonb;
  q text;
  normalized text;
  intent_hint text:=null;
  st jsonb;
begin
  select * into c from public.conversations where id=p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  select * into m from public.messages where id=p_message_id and conversation_id=c.id;
  if not found then raise exception 'message_not_found'; end if;

  q:=left(coalesce(m.body_text,m.transcript,''),120);
  normalized:=translate(lower(trim(regexp_replace(q,'\s+',' ','g'))),'áàãâéêíóôõúç','aaaaeeiooouc');
  normalized:=regexp_replace(normalized,'[.!?,;:]+$','','g');
  if normalized in ('oi','oii','oiii','ola','olaa','olaaa','bom dia','boa tarde','boa noite','menu','inicio','iniciar','comecar') then
    intent_hint:='greeting';
  end if;

  select case when u.id is null then null else jsonb_build_object(
    'id',u.id,'name',u.name,'phone',u.primary_whatsapp_e164,'preferred_reply',u.preferred_reply,
    'order_count',u.order_count,'last_order_at',u.last_order_at
  ) end
  into customer
  from public.customers u
  where u.id=c.customer_id;

  select coalesce(jsonb_agg(
    jsonb_build_object('direction',x.direction,'type',x.message_type,'text',left(coalesce(x.body_text,x.transcript,''),500),'at',x.created_at)
    order by x.created_at
  ),'[]'::jsonb)
  into history
  from (
    select direction,message_type,body_text,transcript,created_at
      from public.messages
     where conversation_id=c.id
       and id<>m.id
       and created_at<=m.created_at
       and created_at>=m.created_at-interval '2 hours'
     order by created_at desc
     limit 8
  ) x;

  if intent_hint='greeting' then
    products:='[]'::jsonb;
  else
    select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb)
      into products
      from public.search_whatsapp_sellable_products_v1(q,8) s;
  end if;

  cart:=public.get_whatsapp_sales_cart_v1(c.id);
  intelligence:=public.get_service_intelligence_bundle_v1('whatsapp',null,c.stage);
  select to_jsonb(x) into st from public.whatsapp_sales_state x where x.conversation_id=c.id;

  return jsonb_build_object(
    'current_message_priority','authoritative',
    'current_intent_hint',intent_hint,
    'history_role','context_only',
    'address_policy','Only accept address data explicitly evidenced by the current customer message or previously saved deterministic state.',
    'conversation',jsonb_build_object('id',c.id,'stage',c.stage,'mode',c.mode,'service_window_expires_at',c.service_window_expires_at,'fast_checkout',c.fast_checkout,'upsell_declined',c.upsell_declined),
    'message',jsonb_build_object('id',m.id,'type',m.message_type,'text',coalesce(m.body_text,m.transcript,''),'interactive',coalesce(m.ai_interpretation,'{}'::jsonb),'raw_event',m.raw_event),
    'customer',customer,
    'cart',cart,
    'sales_state',coalesce(st,'{}'::jsonb),
    'product_candidates',products,
    'history',history,
    'intelligence',intelligence,
    'catalog_source','counter_verified'
  );
end
$$;

create or replace function public.update_whatsapp_sales_state_v1(
  p_conversation_id uuid,
  p_delivery_address jsonb default null,
  p_candidates jsonb default null,
  p_last_action text default null,
  p_last_product_id uuid default null,
  p_awaiting text default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.whatsapp_sales_state%rowtype;
  merged jsonb;
  v_message_text text:='';
  v_normalized text:='';
  v_address_evidence boolean:=false;
begin
  if not exists(select 1 from public.conversations where id=p_conversation_id) then raise exception 'conversation_not_found'; end if;
  insert into public.whatsapp_sales_state(conversation_id) values(p_conversation_id) on conflict(conversation_id) do nothing;
  select * into s from public.whatsapp_sales_state where conversation_id=p_conversation_id for update;
  merged:=s.pending_delivery_address;

  select coalesce(m.body_text,m.transcript,'') into v_message_text
    from public.messages m
   where m.conversation_id=p_conversation_id and m.direction='inbound'
   order by m.created_at desc,m.id desc
   limit 1;
  v_normalized:=translate(lower(trim(regexp_replace(coalesce(v_message_text,''),'\s+',' ','g'))),'áàãâéêíóôõúç','aaaaeeiooouc');
  v_address_evidence:=
    v_normalized ~ '[0-9]'
    and (
      s.awaiting='delivery_address'
      or v_normalized ~ '(^| )(rua|r\.?|avenida|av\.?|travessa|estrada|rodovia|bairro|numero|nº|casa|apto|apartamento)( |$)'
    );

  if p_delivery_address is not null and jsonb_typeof(p_delivery_address)='object' and v_address_evidence then
    merged:=coalesce(merged,'{}'::jsonb)||jsonb_strip_nulls(p_delivery_address);
  end if;

  update public.whatsapp_sales_state set
    pending_delivery_address=merged,
    last_candidates=case when p_candidates is null then last_candidates else coalesce(p_candidates,'[]'::jsonb) end,
    last_action=coalesce(nullif(p_last_action,''),last_action),
    last_product_id=coalesce(p_last_product_id,last_product_id),
    awaiting=case when p_awaiting is null then awaiting when p_awaiting='' then null else p_awaiting end,
    updated_at=now()
  where conversation_id=p_conversation_id
  returning * into s;

  return to_jsonb(s)||jsonb_build_object('address_update_accepted',v_address_evidence and p_delivery_address is not null);
end
$$;

create or replace function public.confirm_whatsapp_sales_order_v1(
  p_conversation_id uuid,
  p_message_id uuid,
  p_delivery_address jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  c public.conversations%rowtype;
  m public.messages%rowtype;
  k public.carts%rowtype;
  addr jsonb:='{}'::jsonb;
  proposed jsonb:=coalesce(p_delivery_address,'{}'::jsonb);
  state_addr jsonb:='{}'::jsonb;
  normalized text;
  explicit boolean:=false;
  address_evidence boolean:=false;
  result jsonb;
  backoffice jsonb;
begin
  select * into cfg from public.automation_config where id=1;
  if not found or not cfg.whatsapp_sales_mvp_enabled or not cfg.whatsapp_sales_order_submit_enabled then raise exception 'whatsapp_sales_order_submit_disabled'; end if;

  select cv.* into c from public.conversations cv where cv.id=p_conversation_id and cv.mode='ai' and cv.status<>'closed' for update;
  if not found then raise exception 'conversation_not_available'; end if;
  select * into m from public.messages where id=p_message_id and conversation_id=c.id and direction='inbound';
  if not found then raise exception 'message_not_found'; end if;

  normalized:=translate(lower(trim(regexp_replace(coalesce(m.body_text,m.transcript,''),'\s+',' ','g'))),'áàãâéêíóôõúç','aaaaeeiooouc');
  explicit:=coalesce(m.ai_interpretation->>'id','')='da_confirm_order'
    or normalized ~ '(^| )(confirmo|pode fechar|pode finalizar|finaliza o pedido|finalizar o pedido|fechar o pedido|confirmar o pedido|pode concluir|pode mandar o pedido)( |$)';
  if not explicit then raise exception 'explicit_order_confirmation_required'; end if;

  select * into k from public.carts where conversation_id=c.id and status='draft' order by updated_at desc limit 1 for update;
  if not found then raise exception 'cart_not_found'; end if;
  if not exists(select 1 from public.cart_items where cart_id=k.id and quantity>0) then raise exception 'empty_cart'; end if;

  select coalesce(s.pending_delivery_address,'{}'::jsonb) into state_addr
    from public.whatsapp_sales_state s where s.conversation_id=c.id;

  if coalesce(state_addr->>'street','')<>'' and coalesce(state_addr->>'number','')<>'' and coalesce(state_addr->>'city','')<>'' then
    addr:=state_addr;
  else
    address_evidence:=normalized ~ '[0-9]'
      and normalized ~ '(^| )(rua|r\.?|avenida|av\.?|travessa|estrada|rodovia|bairro|numero|nº|casa|apto|apartamento)( |$)';
    if address_evidence
       and coalesce(proposed->>'street','')<>''
       and coalesce(proposed->>'number','')<>''
       and coalesce(proposed->>'city','')<>'' then
      addr:=proposed;
    end if;
  end if;

  if addr='{}'::jsonb and c.customer_id is not null then
    select jsonb_build_object('street',a.street,'number',a.number,'complement',a.complement,'neighborhood',a.neighborhood,'city',a.city,'state',a.state,'postal_code',a.postal_code,'reference',a.reference)
      into addr
      from public.customer_addresses a
     where a.customer_id=c.customer_id and a.is_active=true
     order by a.is_default desc,a.updated_at desc
     limit 1;
  end if;

  if coalesce(addr->>'street','')='' or coalesce(addr->>'number','')='' or coalesce(addr->>'city','')='' then raise exception 'delivery_address_required'; end if;

  result:=public.confirm_cart_order_v2(k.id,addr,'wa:'||coalesce(m.whatsapp_message_id,m.id::text));
  begin
    backoffice:=public.queue_bling_order_backoffice_v1(nullif(result->>'order_id','')::uuid,'DA-WA-'||replace(nullif(result->>'order_id',''),'-',''));
  exception when others then
    backoffice:=jsonb_build_object('status','queue_review_required','error',sqlerrm,'external_side_effect',false);
  end;

  insert into public.whatsapp_sales_action_events(conversation_id,message_id,action_type,action_payload,result,reversible,required_confirmation,confidence)
  values(c.id,m.id,'confirm_order',jsonb_build_object('delivery_address',addr),result||jsonb_build_object('backoffice_sync',backoffice),false,true,1);
  update public.conversations set stage='order_confirmed',status='waiting_customer',updated_at=now() where id=c.id;
  return result||jsonb_build_object('delivery_address',addr,'explicit_confirmation',true,'customer_sale_status','confirmed','backoffice_sync_status',coalesce(backoffice->>'status','pending'),'bling',null);
end
$$;

revoke all on function public.build_whatsapp_sales_context_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.update_whatsapp_sales_state_v1(uuid,jsonb,jsonb,text,uuid,text) from public,anon,authenticated;
revoke all on function public.confirm_whatsapp_sales_order_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.build_whatsapp_sales_context_v1(uuid,uuid) to service_role;
grant execute on function public.update_whatsapp_sales_state_v1(uuid,jsonb,jsonb,text,uuid,text) to service_role;
grant execute on function public.confirm_whatsapp_sales_order_v1(uuid,uuid,jsonb) to service_role;

commit;
