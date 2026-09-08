begin;

-- Regra operacional: a venda termina com o cliente no WhatsApp.
-- O Bling é retaguarda assíncrona e nunca participa do caminho crítico da confirmação.

alter table public.automation_config
  add column if not exists bling_order_batch_interval_minutes smallint not null default 10,
  add column if not exists bling_order_batch_start_local time not null default '07:00',
  add column if not exists bling_order_batch_end_local time not null default '18:00',
  add column if not exists bling_order_batch_timezone text not null default 'America/Cuiaba';

alter table public.automation_config drop constraint if exists automation_config_bling_order_batch_interval_check;
alter table public.automation_config add constraint automation_config_bling_order_batch_interval_check
  check (bling_order_batch_interval_minutes between 5 and 60);

create or replace function public.queue_bling_order_backoffice_v1(p_order_id uuid,p_external_key text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare o public.orders%rowtype; j public.order_sync_jobs%rowtype; k text;
begin
  select * into o from public.orders where id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if o.bling_order_id is not null or o.status='sent_to_bling' then
    return jsonb_build_object('order_id',o.id,'status','already_synced','bling_order_id',o.bling_order_id,'idempotent_replay',true);
  end if;
  if o.status<>'confirmed' then raise exception 'order_not_eligible_for_bling_queue'; end if;
  k:=coalesce(nullif(btrim(p_external_key),''),'DA-WA-'||replace(o.id::text,'-',''));
  select * into j from public.order_sync_jobs where order_id=o.id limit 1;
  if found then
    return jsonb_build_object('job_id',j.id,'order_id',o.id,'status',j.status,'external_key',j.external_key,'idempotent_replay',true,'external_side_effect',false);
  end if;
  insert into public.order_sync_jobs(order_id,status,attempts,max_attempts,next_attempt_at,external_key)
  values(o.id,'pending',0,3,now(),left(k,180)) returning * into j;
  update public.orders set sync_status='pending_bling',sync_error=null,updated_at=now() where id=o.id;
  return jsonb_build_object('job_id',j.id,'order_id',o.id,'status','pending','external_key',j.external_key,'idempotent_replay',false,'external_side_effect',false);
end $$;

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
  backoffice jsonb;
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

  -- Primeiro e definitivamente: cria o pedido interno. Esta é a conclusão da venda para o cliente.
  result:=public.confirm_cart_order_v2(k.id,addr,'wa:'||coalesce(m.whatsapp_message_id,m.id::text));

  -- Depois, somente uma fila LOCAL de retaguarda. Nenhuma chamada ao Bling ocorre aqui.
  begin
    backoffice:=public.queue_bling_order_backoffice_v1(nullif(result->>'order_id','')::uuid,'DA-WA-'||replace(nullif(result->>'order_id',''),'-',''));
  exception when others then
    -- Uma falha de fila não desfaz nem invalida a venda confirmada.
    backoffice:=jsonb_build_object('status','queue_review_required','error',sqlerrm,'external_side_effect',false);
  end;

  insert into public.whatsapp_sales_action_events(conversation_id,message_id,action_type,action_payload,result,reversible,required_confirmation,confidence)
  values(c.id,m.id,'confirm_order',jsonb_build_object('delivery_address',addr),result||jsonb_build_object('backoffice_sync',backoffice),false,true,1);
  update public.conversations set stage='order_confirmed',status='waiting_customer',updated_at=now() where id=c.id;

  -- Não expõe Bling como parte da experiência do cliente.
  return result||jsonb_build_object(
    'delivery_address',addr,
    'explicit_confirmation',true,
    'customer_sale_status','confirmed',
    'backoffice_sync_status',coalesce(backoffice->>'status','pending'),
    'bling',null
  );
end $$;

-- O worker de retaguarda só pode tocar o Bling quando os dois gates estiverem ativos.
create or replace function public.claim_order_sync_jobs(p_worker text,p_limit integer default 10)
returns setof public.order_sync_jobs language plpgsql security definer set search_path=''
as $$
declare c public.automation_config%rowtype; lim integer;
begin
  select * into c from public.automation_config where id=1;
  if not found or not c.bling_order_sync_enabled or not c.whatsapp_sales_bling_submit_enabled then return; end if;
  lim:=greatest(1,least(coalesce(p_limit,10),coalesce(c.bling_order_max_per_run,1),10));
  return query
  with picked as (
    select j.id from public.order_sync_jobs j join public.orders o on o.id=j.order_id
    where j.status in ('pending','error') and j.next_attempt_at<=now() and j.attempts<j.max_attempts
      and o.status='confirmed' and o.bling_order_id is null
      and (not c.bling_order_homologation_only or exists(select 1 from public.bling_order_homologation_allowlist a where a.order_id=o.id and a.enabled and (a.expires_at is null or a.expires_at>now())))
    order by j.created_at for update of j skip locked limit lim
  ), upd as (
    update public.order_sync_jobs j set status='processing',worker_id=left(coalesce(p_worker,'unknown'),120),locked_at=now(),attempts=j.attempts+1,updated_at=now() from picked where j.id=picked.id returning j.*
  ) select * from upd;
end $$;

revoke all on function public.queue_bling_order_backoffice_v1(uuid,text) from public,anon,authenticated;
revoke all on function public.confirm_whatsapp_sales_order_v1(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.claim_order_sync_jobs(text,integer) from public,anon,authenticated;
grant execute on function public.queue_bling_order_backoffice_v1(uuid,text) to service_role;
grant execute on function public.confirm_whatsapp_sales_order_v1(uuid,uuid,jsonb) to service_role;
grant execute on function public.claim_order_sync_jobs(text,integer) to service_role;

commit;
