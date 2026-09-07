create or replace function public.finish_bling_command(p_command_id uuid,p_success boolean,p_result jsonb default '{}'::jsonb,p_error text default null,p_retry_seconds integer default 120)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_product_id uuid;v_item_id uuid;v_attempts integer;v_max_attempts integer;v_final_status text;v_has_error boolean;v_has_pending boolean;
begin
  select product_id,nullif(payload->>'inventory_count_item_id','')::uuid,attempts,max_attempts into v_product_id,v_item_id,v_attempts,v_max_attempts from public.bling_commands where id=p_command_id for update;
  if not found then return false; end if;
  if p_success then
    update public.bling_commands set status='done',result=coalesce(p_result,'{}'::jsonb),error_message=null,finished_at=now(),locked_at=null,locked_by=null,updated_at=now() where id=p_command_id;
    if v_item_id is not null then update public.inventory_count_items set sync_status='synced',sync_error=null,synced_to_bling_at=now() where id=v_item_id; end if;
  else
    v_final_status:=case when v_attempts>=v_max_attempts then 'error' else 'pending' end;
    update public.bling_commands set status=v_final_status,result=coalesce(p_result,'{}'::jsonb),error_message=left(coalesce(p_error,'unknown_error'),2000),available_at=case when v_final_status='pending' then now()+make_interval(secs=>greatest(30,least(coalesce(p_retry_seconds,120),3600))) else available_at end,finished_at=case when v_final_status='error' then now() else null end,locked_at=null,locked_by=null,updated_at=now() where id=p_command_id;
    if v_item_id is not null then update public.inventory_count_items set sync_status=case when v_final_status='error' then 'error' else 'pending' end,sync_error=left(coalesce(p_error,'unknown_error'),2000) where id=v_item_id; end if;
  end if;
  if v_product_id is not null then
    select exists(select 1 from public.bling_commands c where c.product_id=v_product_id and c.status='error'),exists(select 1 from public.bling_commands c where c.product_id=v_product_id and c.status in ('pending','processing')) into v_has_error,v_has_pending;
    update public.products set sync_status=case when v_has_error then 'error_bling' when v_has_pending then 'pending_bling' else 'synced' end,sync_error=case when v_has_error then left(coalesce(p_error,sync_error,'bling_command_error'),2000) else null end,last_bling_sync_at=case when not v_has_error and not v_has_pending then now() else last_bling_sync_at end,updated_at=now() where id=v_product_id;
  end if;
  if v_item_id is not null then update public.inventory_counts c set pending_sync=(select count(*) from public.inventory_count_items i where i.inventory_count_id=c.id and i.sync_status in ('pending','processing','error')),updated_at=now() where c.id=(select inventory_count_id from public.inventory_count_items where id=v_item_id); end if;
  return true;
end;$$;
revoke all on function public.finish_bling_command(uuid,boolean,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.finish_bling_command(uuid,boolean,jsonb,text,integer) to service_role;
