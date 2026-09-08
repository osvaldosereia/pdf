begin;

create or replace function public.confirm_whatsapp_sales_order_v1(
  p_conversation_id uuid,
  p_message_id uuid,
  p_delivery_address jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  c public.conversations%rowtype;
  m public.messages%rowtype;
  k public.carts%rowtype;
  addr jsonb:=coalesce(p_delivery_address,'{}'::jsonb);
  normalized text;
  explicit boolean:=false;
  result jsonb;
  queued jsonb;
begin
  select * into cfg from public.automation_config where id=1;
  if not found or not cfg.whatsapp_sales_mvp_enabled or not cfg.whatsapp_sales_order_submit_enabled then raise exception 'whatsapp_sales_order_submit_disabled'; end if;
  select * into c from public.conversations where id=p_conversation_id and mode='ai' and status<>'closed' for update;
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

  if addr='{}'::jsonb and c.customer_id is not null then
    select jsonb_build_object('street',a.street,'number',a.number,'complement',a.complement,'neighborhood',a.neighborhood,'city',a.city,'state',a.state,'postal_code',a.postal_code,'reference',a.reference)
      into addr from public.customer_addresses a where a.customer_id=c.customer_id and a.is_active=true order by a.is_default desc,a.updated_at desc limit 1;
  end if;
  if coalesce(addr->>'street','')='' or coalesce(addr->>'number','')='' or coalesce(addr->>'city','')='' then raise exception 'delivery_address_required'; end if;

  result:=public.confirm_cart_order_v2(k.id,addr,'wa:'||coalesce(m.whatsapp_message_id,m.id::text));
  queued:=null;
  if cfg.whatsapp_sales_bling_submit_enabled and cfg.bling_order_sync_enabled then
    begin
      queued:=public.queue_bling_order_homologation_v1(nullif(result->>'order_id','')::uuid,'DA-WA-'||replace(nullif(result->>'order_id',''),'-',''));
    exception when others then
      queued:=jsonb_build_object('queued',false,'error',sqlerrm);
    end;
  end if;
  insert into public.whatsapp_sales_action_events(conversation_id,message_id,action_type,action_payload,result,reversible,required_confirmation,confidence)
  values(c.id,m.id,'confirm_order',jsonb_build_object('delivery_address',addr),result||jsonb_build_object('bling',queued),false,true,1);
  update public.conversations set stage='order_confirmed',updated_at=now() where id=c.id;
  return result||jsonb_build_object('delivery_address',addr,'bling',queued,'explicit_confirmation',true);
end $$;

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
  mode text:=lower(trim(coalesce(p_delivery_mode,'text')));
  body text:=left(trim(coalesce(p_body_text,'')),4096);
  img text:=nullif(trim(coalesce(p_image_url,'')),'');
  reply_id uuid; job_id uuid; payload jsonb;
begin
  select * into cfg from public.automation_config where id=1;
  if not found or not coalesce(cfg.automation_enabled and cfg.outbound_enabled and cfg.whatsapp_inbound_enabled and cfg.whatsapp_auto_reply_enabled and cfg.whatsapp_sales_mvp_enabled,false) then
    raise exception 'whatsapp_sales_reply_disabled';
  end if;
  select * into c from public.conversations where id=p_conversation_id and mode='ai' and status<>'closed' for update;
  if not found or c.service_window_expires_at<=now() then raise exception 'conversation_service_window_closed'; end if;
  if c.customer_id is not null then select * into customer from public.customers where id=c.customer_id; end if;
  if mode not in ('text','audio','image','interactive') then raise exception 'unsupported_delivery_mode'; end if;
  if mode in ('text','audio') and body='' then raise exception 'body_required'; end if;
  if mode='image' then
    if not cfg.whatsapp_sales_images_enabled then raise exception 'whatsapp_sales_images_disabled'; end if;
    if img is null or img !~ '^https://' then raise exception 'https_image_url_required'; end if;
  end if;
  if mode='interactive' then
    if not cfg.whatsapp_sales_interactive_enabled then raise exception 'whatsapp_sales_interactive_disabled'; end if;
    if jsonb_typeof(p_interactive) is distinct from 'object' or coalesce(p_interactive->>'type','') not in ('button','list') then raise exception 'invalid_interactive_payload'; end if;
  end if;

  insert into public.messages(conversation_id,direction,message_type,body_text,ai_interpretation,raw_event)
  values(c.id,'outbound',case when mode='image' then 'image' when mode='interactive' then 'interactive' else 'text' end,body,
    jsonb_build_object('source','whatsapp_sales_mvp','action_type',left(coalesce(p_action_type,'reply'),80),'confidence',p_confidence,'delivery_mode',mode,'action_result',coalesce(p_action_result,'{}'::jsonb)),
    jsonb_build_object('source','whatsapp','sales_mvp',true,'source_message_id',p_source_message_id)) returning id into reply_id;

  payload:=jsonb_build_object(
    'message_kind','conversation_reply','message_type',mode,'body_text',body,'delivery_mode',mode,
    'image_url',img,'interactive',p_interactive,'reply_message_id',reply_id,
    'source_message_id',p_source_message_id,'service_window_expires_at',c.service_window_expires_at,
    'voice_profile','dona_antonia_marin_b_v1'
  );
  insert into public.outbound_jobs(whatsapp_account_id,customer_id,conversation_id,job_type,recipient_e164,dedupe_key,payload)
  values(c.whatsapp_account_id,c.customer_id,c.id,'seller_message',c.wa_contact_e164,'sales_reply:'||reply_id::text,payload)
  on conflict(dedupe_key) do nothing returning id into job_id;

  insert into public.whatsapp_sales_action_events(conversation_id,message_id,action_type,action_payload,result,reversible,required_confirmation,confidence)
  values(c.id,p_source_message_id,left(coalesce(p_action_type,'reply'),80),jsonb_build_object('delivery_mode',mode,'image_url',img,'interactive',p_interactive),coalesce(p_action_result,'{}'::jsonb),true,false,p_confidence);
  return jsonb_build_object('reply_message_id',reply_id,'outbound_job_id',job_id,'delivery_mode',mode);
end $$;

-- Protocolo outbound v4: adiciona imagem e mensagens interativas oficiais (lista/botões), sem carrossel.
create or replace function public.dispatch_whatsapp_outbound_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_cfg public.automation_config%rowtype;
  v_job public.outbound_jobs%rowtype;
  v_profile public.ai_voice_profiles%rowtype;
  v_webhook text; v_request_id bigint; v_mode text; v_payload jsonb; v_interactive jsonb; v_image text;
begin
  if p_job_id is null then return jsonb_build_object('ok',false,'reason','job_id_required'); end if;
  select * into v_cfg from public.automation_config where id=1;
  if not coalesce(v_cfg.automation_enabled and v_cfg.outbound_enabled and v_cfg.ai_enabled and v_cfg.conversation_worker_enabled and v_cfg.whatsapp_inbound_enabled and v_cfg.whatsapp_auto_reply_enabled,false) then
    return jsonb_build_object('ok',true,'skipped','automation_disabled');
  end if;
  select j.* into v_job from public.outbound_jobs j join public.conversations c on c.id=j.conversation_id
   where j.id=p_job_id and j.job_type='seller_message' and j.payload->>'message_kind'='conversation_reply'
     and j.status in ('pending','error') and coalesce(j.last_error,'') not in ('lease_expired_review_required','dispatch_unreachable_review_required','delivery_uncertain_review_required')
     and j.not_before<=now() and j.attempts<j.max_attempts and c.mode='ai' and c.service_window_expires_at>now() for update of j;
  if not found then return jsonb_build_object('ok',true,'skipped','job_unavailable'); end if;

  v_mode:=coalesce(v_job.payload->>'delivery_mode','text');
  if v_mode not in ('text','audio','image','interactive') then v_mode:='text'; end if;
  if v_mode in ('text','audio') and nullif(trim(coalesce(v_job.payload->>'body_text','')),'') is null then
    update public.outbound_jobs set status='cancelled',last_error='empty_conversation_reply',locked_at=null,locked_by=null,updated_at=now() where id=v_job.id;
    return jsonb_build_object('ok',true,'skipped','empty_conversation_reply');
  end if;
  if v_mode='audio' then
    select * into v_profile from public.ai_voice_profiles where id=coalesce(nullif(v_job.payload->>'voice_profile',''),'dona_antonia_marin_b_v1') and is_active=true;
    if not found then return jsonb_build_object('ok',false,'reason','voice_profile_unavailable'); end if;
  elsif v_mode='image' then
    v_image:=nullif(v_job.payload->>'image_url','');
    if v_image is null or v_image !~ '^https://' then return jsonb_build_object('ok',false,'reason','image_url_unavailable'); end if;
  elsif v_mode='interactive' then
    v_interactive:=v_job.payload->'interactive';
    if jsonb_typeof(v_interactive) is distinct from 'object' or coalesce(v_interactive->>'type','') not in ('button','list') then return jsonb_build_object('ok',false,'reason','interactive_payload_invalid'); end if;
  end if;

  select decrypted_secret into v_webhook from vault.decrypted_secrets where name='dona_antonia_whatsapp_outbound_make_webhook' order by created_at desc limit 1;
  if nullif(v_webhook,'') is null then return jsonb_build_object('ok',false,'reason','webhook_unavailable'); end if;
  update public.outbound_jobs set status='processing',attempts=attempts+1,locked_at=now(),locked_by='pgnet-make-outbound-v4',dispatch_attempts=dispatch_attempts+1,last_dispatch_at=now(),last_error=null,dispatch_response_status=null,dispatch_response=null,dispatch_response_checked_at=null,updated_at=now()
   where id=v_job.id returning * into v_job;

  v_payload:=jsonb_build_object('event','outbound_delivery','protocol_version',4,'job',jsonb_build_object(
    'id',v_job.id::text,'conversation_id',v_job.conversation_id::text,'recipient_e164',v_job.recipient_e164,'attempt',v_job.attempts,
    'delivery_mode',v_mode,'body_text',left(coalesce(v_job.payload->>'body_text',''),4096),'image_url',v_image,'interactive',v_interactive,
    'reply_message_id',v_job.payload->>'reply_message_id','voice_profile',case when v_mode='audio' then jsonb_build_object('id',v_profile.id,'model',v_profile.model,'voice',v_profile.voice,'speed',v_profile.speed,'instructions',v_profile.instructions,'output_format',v_profile.output_format) else null end
  ));
  begin
    v_request_id:=net.http_post(url:=v_webhook,body:=v_payload,headers:='{"Content-Type":"application/json"}'::jsonb,timeout_milliseconds:=30000);
  exception when others then
    update public.outbound_jobs set status='error',last_error='dispatch_enqueue_failed',not_before=now()+interval '2 minutes',locked_at=null,locked_by=null,updated_at=now() where id=v_job.id;
    return jsonb_build_object('ok',false,'reason','dispatch_enqueue_failed');
  end;
  update public.outbound_jobs set last_dispatch_request_id=v_request_id,updated_at=now() where id=v_job.id;
  return jsonb_build_object('ok',true,'request_id',v_request_id,'job_id',v_job.id,'protocol_version',4,'delivery_mode',v_mode);
end $$;

create or replace function public.reconcile_whatsapp_outbound_responses_v4()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_job public.outbound_jobs%rowtype; v_resp record; v_json jsonb; v_sent integer:=0; v_review integer:=0; v_waiting integer:=0; v_provider_id text; v_mode text;
begin
  for v_job in select j.* from public.outbound_jobs j where j.job_type='seller_message' and j.payload->>'message_kind'='conversation_reply' and j.status='processing' and j.locked_by='pgnet-make-outbound-v4' order by j.locked_at,j.id limit 100 for update skip locked loop
    if v_job.last_dispatch_request_id is null then v_waiting:=v_waiting+1; continue; end if;
    select r.* into v_resp from net._http_response r where r.id=v_job.last_dispatch_request_id order by r.created desc limit 1;
    if not found then
      if v_job.locked_at<now()-interval '2 minutes' then update public.outbound_jobs set status='error',last_error='delivery_uncertain_review_required',not_before=now()+interval '100 years',locked_at=null,locked_by=null,dispatch_response_checked_at=now(),updated_at=now() where id=v_job.id; v_review:=v_review+1; else v_waiting:=v_waiting+1; end if;
      continue;
    end if;
    v_json:=null; begin if nullif(trim(coalesce(v_resp.content,'')),'') is not null then v_json:=v_resp.content::jsonb; end if; exception when others then v_json:=null; end;
    update public.outbound_jobs set dispatch_response_status=v_resp.status_code,dispatch_response=case when jsonb_typeof(v_json)='object' then v_json else null end,dispatch_response_checked_at=now(),updated_at=now() where id=v_job.id;
    v_mode:=coalesce(v_job.payload->>'delivery_mode','text'); if v_mode not in ('text','audio','image','interactive') then v_mode:='text'; end if;
    v_provider_id:=nullif(trim(coalesce(v_json->>'provider_message_id','')),'');
    if coalesce(v_resp.timed_out,false) or nullif(v_resp.error_msg,'') is not null or coalesce(v_resp.status_code,0)<200 or coalesce(v_resp.status_code,0)>=300 or jsonb_typeof(v_json) is distinct from 'object' or coalesce(v_json->>'ok','')<>'true' or coalesce(v_json->>'job_id','')<>v_job.id::text or v_provider_id is null or length(v_provider_id)>500 or coalesce(v_json->>'delivery_mode','')<>v_mode then
      update public.outbound_jobs set status='error',last_error='delivery_uncertain_review_required',not_before=now()+interval '100 years',locked_at=null,locked_by=null,updated_at=now() where id=v_job.id; v_review:=v_review+1; continue;
    end if;
    perform public.finish_outbound_job(v_job.id,true,v_provider_id,null,120); v_sent:=v_sent+1;
  end loop;
  return jsonb_build_object('sent',v_sent,'review_required',v_review,'waiting',v_waiting);
end $$;

create or replace function public.recover_whatsapp_outbound_dispatch()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_id uuid; v_reconcile jsonb; v_requeued integer:=0;
begin
  v_reconcile:=public.reconcile_whatsapp_outbound_responses_v4();
  for v_id in
    select j.id from public.outbound_jobs j join public.conversations c on c.id=j.conversation_id cross join public.automation_config cfg
    where cfg.id=1 and cfg.automation_enabled and cfg.outbound_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and cfg.whatsapp_inbound_enabled and cfg.whatsapp_auto_reply_enabled
      and j.job_type='seller_message' and j.payload->>'message_kind'='conversation_reply' and j.status in ('pending','error')
      and coalesce(j.last_error,'') in ('','dispatch_enqueue_failed','dispatch_webhook_unavailable','voice_profile_unavailable') and j.not_before<=now() and j.attempts<j.max_attempts and c.mode='ai' and c.service_window_expires_at>now()
    order by j.created_at,j.id limit 20
  loop perform public.dispatch_whatsapp_outbound_job(v_id); v_requeued:=v_requeued+1; end loop;
  return v_reconcile||jsonb_build_object('safe_redispatch_candidates',v_requeued);
end $$;

-- Mantém o mesmo segredo customizado; apenas troca o worker para v3.
create or replace function public.dispatch_conversation_worker_job_v2(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare cfg public.automation_config%rowtype; j public.ai_jobs%rowtype; v_secret text; v_request bigint;
begin
  select * into cfg from public.automation_config where id=1;
  select * into j from public.ai_jobs where id=p_job_id for update;
  if not found then return jsonb_build_object('dispatched',false,'reason','job_not_found'); end if;
  if j.status<>'pending' then return jsonb_build_object('dispatched',false,'reason','job_not_pending','status',j.status); end if;
  if not coalesce(cfg.automation_enabled and cfg.ai_enabled and cfg.conversation_worker_enabled and cfg.conversation_worker_dispatch_enabled,false) then return jsonb_build_object('dispatched',false,'reason','worker_dispatch_disabled'); end if;
  if j.worker_dispatch_attempts>=cfg.conversation_worker_dispatch_max_attempts then update public.ai_jobs set status='held',error_message='worker_dispatch_exhausted_human_required',updated_at=now() where id=j.id; return jsonb_build_object('dispatched',false,'reason','dispatch_attempts_exhausted'); end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='conversation_worker_webhook_key_v2' limit 1;
  if v_secret is null then update public.ai_jobs set worker_dispatch_last_error='worker_vault_secret_missing',updated_at=now() where id=j.id; return jsonb_build_object('dispatched',false,'reason','worker_secret_missing'); end if;
  begin
    v_request:=net.http_post(url:='https://ssbesxgaijknwsjbsbcz.supabase.co/functions/v1/conversation-worker-v3',headers:=jsonb_build_object('Content-Type','application/json','x-da-worker-key',v_secret),body:=jsonb_build_object('job_id',j.id),timeout_milliseconds:=120000);
    update public.ai_jobs set worker_dispatch_request_id=v_request,worker_dispatched_at=now(),worker_dispatch_attempts=worker_dispatch_attempts+1,worker_dispatch_last_error=null,updated_at=now() where id=j.id;
    return jsonb_build_object('dispatched',true,'request_id',v_request,'job_id',j.id,'worker_version',3);
  exception when others then
    update public.ai_jobs set worker_dispatch_attempts=worker_dispatch_attempts+1,worker_dispatch_last_error='worker_dispatch_failed',worker_dispatched_at=now(),updated_at=now() where id=j.id;
    return jsonb_build_object('dispatched',false,'reason','worker_dispatch_failed');
  end;
end $$;

revoke all on function public.confirm_whatsapp_sales_order_v1(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.queue_whatsapp_sales_reply_v1(uuid,uuid,text,text,text,jsonb,text,jsonb,numeric) from public,anon,authenticated;
revoke all on function public.dispatch_whatsapp_outbound_job(uuid) from public,anon,authenticated;
revoke all on function public.reconcile_whatsapp_outbound_responses_v4() from public,anon,authenticated;
revoke all on function public.recover_whatsapp_outbound_dispatch() from public,anon,authenticated;
revoke all on function public.dispatch_conversation_worker_job_v2(uuid) from public,anon,authenticated;

grant execute on function public.confirm_whatsapp_sales_order_v1(uuid,uuid,jsonb) to service_role;
grant execute on function public.queue_whatsapp_sales_reply_v1(uuid,uuid,text,text,text,jsonb,text,jsonb,numeric) to service_role;
grant execute on function public.dispatch_whatsapp_outbound_job(uuid) to service_role;
grant execute on function public.reconcile_whatsapp_outbound_responses_v4() to service_role;
grant execute on function public.recover_whatsapp_outbound_dispatch() to service_role;
grant execute on function public.dispatch_conversation_worker_job_v2(uuid) to service_role;

commit;
