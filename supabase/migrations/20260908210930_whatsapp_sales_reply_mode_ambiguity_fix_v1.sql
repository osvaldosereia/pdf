begin;

-- Corrige colisão PL/pgSQL entre a variável local `mode` e conversations.mode.
-- O bug só aparece no runtime real ao enfileirar uma resposta do worker v3.
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
) returns jsonb
language plpgsql security definer set search_path=''
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
  if not found or not coalesce(cfg.automation_enabled and cfg.outbound_enabled and cfg.whatsapp_inbound_enabled and cfg.whatsapp_auto_reply_enabled and cfg.whatsapp_sales_mvp_enabled,false) then
    raise exception 'whatsapp_sales_reply_disabled';
  end if;

  select cv.* into c
    from public.conversations cv
   where cv.id=p_conversation_id and cv.mode='ai' and cv.status<>'closed'
   for update;
  if not found or c.service_window_expires_at<=now() then raise exception 'conversation_service_window_closed'; end if;

  if c.customer_id is not null then select * into customer from public.customers where id=c.customer_id; end if;
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
  values(
    c.id,
    'outbound',
    case when v_mode='image' then 'image' when v_mode='interactive' then 'interactive' else 'text' end,
    body,
    jsonb_build_object('source','whatsapp_sales_mvp','action_type',left(coalesce(p_action_type,'reply'),80),'confidence',p_confidence,'delivery_mode',v_mode,'action_result',coalesce(p_action_result,'{}'::jsonb)),
    jsonb_build_object('source','whatsapp','sales_mvp',true,'source_message_id',p_source_message_id)
  ) returning id into reply_id;

  payload:=jsonb_build_object(
    'message_kind','conversation_reply','message_type',v_mode,'body_text',body,'delivery_mode',v_mode,
    'image_url',img,'interactive',p_interactive,'reply_message_id',reply_id,
    'source_message_id',p_source_message_id,'service_window_expires_at',c.service_window_expires_at,
    'voice_profile','dona_antonia_marin_b_v1'
  );

  insert into public.outbound_jobs(whatsapp_account_id,customer_id,conversation_id,job_type,recipient_e164,dedupe_key,payload)
  values(c.whatsapp_account_id,c.customer_id,c.id,'seller_message',c.wa_contact_e164,'sales_reply:'||reply_id::text,payload)
  on conflict(dedupe_key) do nothing
  returning id into job_id;

  insert into public.whatsapp_sales_action_events(conversation_id,message_id,action_type,action_payload,result,reversible,required_confirmation,confidence)
  values(c.id,p_source_message_id,left(coalesce(p_action_type,'reply'),80),jsonb_build_object('delivery_mode',v_mode,'image_url',img,'interactive',p_interactive),coalesce(p_action_result,'{}'::jsonb),true,false,p_confidence);

  return jsonb_build_object('reply_message_id',reply_id,'outbound_job_id',job_id,'delivery_mode',v_mode);
end
$$;

revoke all on function public.queue_whatsapp_sales_reply_v1(uuid,uuid,text,text,text,jsonb,text,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.queue_whatsapp_sales_reply_v1(uuid,uuid,text,text,text,jsonb,text,jsonb,numeric) to service_role;

commit;
