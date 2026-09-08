begin;

-- Se a composição personalizada tiver item sem preço/delta confiável,
-- nunca enviar um total numérico como se estivesse confirmado.
create or replace function public.queue_whatsapp_sales_reply_v1(
  p_conversation_id uuid,
  p_source_message_id uuid,
  p_body_text text,
  p_delivery_mode text default 'text',
  p_image_url text default null,
  p_interactive jsonb default null,
  p_action_type text default 'reply',
  p_action_result jsonb default '{}'::jsonb,
  p_confidence numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  c public.conversations%rowtype;
  customer public.customers%rowtype;
  v_mode text:=lower(trim(coalesce(p_delivery_mode,'text')));
  body text:=left(trim(coalesce(p_body_text,'')),4096);
  img text:=nullif(trim(coalesce(p_image_url,'')),'');
  reply_id uuid;
  job_id uuid;
  payload jsonb;
begin
  select * into cfg from public.automation_config where id=1;
  if not found or not coalesce(cfg.automation_enabled and cfg.outbound_enabled and cfg.whatsapp_inbound_enabled and cfg.whatsapp_auto_reply_enabled and cfg.whatsapp_sales_mvp_enabled,false) then raise exception 'whatsapp_sales_reply_disabled'; end if;
  select cv.* into c from public.conversations cv where cv.id=p_conversation_id and cv.mode='ai' and cv.status<>'closed' for update;
  if not found or c.service_window_expires_at<=now() then raise exception 'conversation_service_window_closed'; end if;
  if c.customer_id is not null then select * into customer from public.customers where id=c.customer_id; end if;

  if coalesce(p_action_type,'')='basket_ready_for_human'
     and coalesce(p_action_result->>'pricing_status','ready')='needs_review' then
    body:='Pedido recebido para conferência. Como sua cesta foi personalizada e um dos itens ainda precisa de conferência de valor, nossa equipe vai confirmar o total final com você. Não cobramos taxa de entrega. Agora vou transferir você para nossa equipe concluir o atendimento.';
  end if;

  if v_mode not in ('text','audio','image','interactive') then raise exception 'unsupported_delivery_mode'; end if;
  if v_mode in ('text','audio') and body='' then raise exception 'body_required'; end if;
  if v_mode='image' then
    if not cfg.whatsapp_sales_images_enabled then raise exception 'whatsapp_sales_images_disabled'; end if;
    if img is null or img !~ '^https://' then raise exception 'https_image_url_required'; end if;
  end if;
  if v_mode='interactive' then
    if not cfg.whatsapp_sales_interactive_enabled then raise exception 'whatsapp_sales_interactive_disabled'; end if;
    if jsonb_typeof(p_interactive) is distinct from 'object' or coalesce(p_interactive->>'type','') not in ('button','list') then raise exception 'invalid_interactive_payload'; end if;
  end if;
  insert into public.messages(conversation_id,direction,message_type,body_text,ai_interpretation,raw_event)
  values(c.id,'outbound',case when v_mode='image' then 'image' when v_mode='interactive' then 'interactive' else 'text' end,body,
    jsonb_build_object('source','whatsapp_sales_mvp','action_type',left(coalesce(p_action_type,'reply'),80),'confidence',p_confidence,'delivery_mode',v_mode,'action_result',coalesce(p_action_result,'{}'::jsonb)),
    jsonb_build_object('source','whatsapp','sales_mvp',true,'source_message_id',p_source_message_id)) returning id into reply_id;
  payload:=jsonb_build_object('message_kind','conversation_reply','message_type',v_mode,'body_text',body,'delivery_mode',v_mode,'image_url',img,'interactive',p_interactive,'reply_message_id',reply_id,'source_message_id',p_source_message_id,'service_window_expires_at',c.service_window_expires_at,'voice_profile','dona_antonia_marin_b_v1');
  insert into public.outbound_jobs(whatsapp_account_id,customer_id,conversation_id,job_type,recipient_e164,dedupe_key,payload)
  values(c.whatsapp_account_id,c.customer_id,c.id,'seller_message',c.wa_contact_e164,'sales_reply:'||reply_id::text,payload)
  on conflict(dedupe_key) do nothing returning id into job_id;
  insert into public.whatsapp_sales_action_events(conversation_id,message_id,action_type,action_payload,result,reversible,required_confirmation,confidence)
  values(c.id,p_source_message_id,left(coalesce(p_action_type,'reply'),80),jsonb_build_object('delivery_mode',v_mode,'image_url',img,'interactive',p_interactive),coalesce(p_action_result,'{}'::jsonb),true,false,p_confidence);
  return jsonb_build_object('reply_message_id',reply_id,'outbound_job_id',job_id,'delivery_mode',v_mode);
end $$;

revoke all on function public.queue_whatsapp_sales_reply_v1(uuid,uuid,text,text,text,jsonb,text,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.queue_whatsapp_sales_reply_v1(uuid,uuid,text,text,text,jsonb,text,jsonb,numeric) to service_role;

-- A lista inicial da cesta não tem mais botão Trocar. Se a IA não conseguir
-- identificar qual item sai, pede apenas o nome do item. Quando a origem é
-- conhecida e o destino não, a vitrine externa já abre a seleção de categorias.
create or replace function public.route_whatsapp_basket_swap_ai_job_v1()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  m public.messages%rowtype;
  raw_text text;
  norm text;
  bs public.catalog_sessions%rowtype;
  source_part text:='';
  target_part text:='';
  src uuid;
  src_name text;
  swap jsonb;
  reply text;
begin
  if new.job_type<>'conversation' or new.status<>'pending' then return new; end if;

  select * into m from public.messages where id=new.message_id and direction='inbound';
  if not found then return new; end if;

  raw_text:=trim(coalesce(m.body_text,m.transcript,''));
  norm:=translate(lower(raw_text),'áàãâäéèêëíìîïóòõôöúùûüç','aaaaaeeeeiiiiooooouuuuc');
  if norm !~ '(^| )(trocar|troca|substituir|substitui|mudar|muda)( |$)' then return new; end if;

  select * into bs
  from public.catalog_sessions
  where conversation_id=new.conversation_id and metadata->>'flow'='basket_basic_v1'
  order by created_at desc limit 1;
  if not found then return new; end if;

  if position(' por ' in norm)>0 then
    source_part:=trim(regexp_replace(split_part(norm,' por ',1),'^.*?(trocar|troca|substituir|substitui|mudar|muda)\s+','','i'));
    target_part:=trim(split_part(norm,' por ',2));
  else
    source_part:=trim(regexp_replace(norm,'^.*?(trocar|troca|substituir|substitui|mudar|muda)\s+','','i'));
  end if;
  source_part:=regexp_replace(source_part,'^(o|a|um|uma|do|da|de)\s+','','i');
  target_part:=regexp_replace(target_part,'^(o|a|um|uma|do|da|de)\s+','','i');

  if source_part<>'' then
    select i.product_id,p.name into src,src_name
    from public.catalog_session_items i
    join public.products p on p.id=i.product_id
    where i.catalog_session_id=bs.id
      and translate(lower(p.name),'áàãâäéèêëíìîïóòõôöúùûüç','aaaaaeeeeiiiiooooouuuuc') like '%'||source_part||'%'
    order by length(p.name),i.rank
    limit 1;
  end if;

  if src is null then
    reply:='Qual produto da cesta você quer trocar? Me diga o nome do produto. Assim eu monto a vitrine de substituição para você.';
    perform public.queue_whatsapp_sales_reply_v1(
      new.conversation_id,m.id,reply,'text',null,null,
      'basket_swap_source_required',jsonb_build_object('deterministic',true),1
    );
    new.status:='done';
    new.result:=jsonb_build_object('deterministic',true,'action','basket_swap_source_required');
    new.updated_at:=now();
    return new;
  end if;

  swap:=public.create_whatsapp_basket_replacement_session_v1(
    new.conversation_id,src,nullif(target_part,''),array[]::text[]
  );
  reply:=case
    when coalesce((swap->>'item_count')::integer,0)>0 then
      'Entendi a troca de '||src_name||'. Separei as opções na vitrine. Escolha por lá para eu registrar a substituição:'||E'\n'||swap->>'url'
    else
      'Vamos trocar '||src_name||'. Abra a vitrine, marque a categoria do produto que quer colocar e escolha a opção:'||E'\n'||swap->>'url'
  end;
  perform public.queue_whatsapp_sales_reply_v1(
    new.conversation_id,m.id,reply,'text',null,null,
    'basket_swap_showcase',swap,1
  );

  new.status:='done';
  new.result:=jsonb_build_object('deterministic',true,'action','basket_swap_showcase');
  new.updated_at:=now();
  return new;
end $$;

revoke all on function public.route_whatsapp_basket_swap_ai_job_v1() from public,anon,authenticated;
grant execute on function public.route_whatsapp_basket_swap_ai_job_v1() to service_role;

commit;
