create or replace function public.claim_bling_commands(p_worker text, p_limit integer default 20)
returns table(id uuid, command_type text, product_id uuid, payload jsonb, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(trim(p_worker),'') = '' then raise exception 'worker_required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'invalid_limit'; end if;

  update public.bling_commands
     set status = 'pending', locked_at = null, locked_by = null, updated_at = now(),
         error_message = coalesce(error_message, 'processing_timeout_requeued')
   where status = 'processing'
     and locked_at is not null
     and locked_at < now() - interval '20 minutes';

  return query
  with picked as (
    select c.id
    from public.bling_commands c
    where c.status = 'pending'
      and c.available_at <= now()
      and c.attempts < c.max_attempts
    order by c.created_at
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.bling_commands c
       set status = 'processing', attempts = c.attempts + 1, locked_at = now(), locked_by = p_worker, updated_at = now()
      from picked
     where c.id = picked.id
    returning c.id, c.command_type, c.product_id, c.payload, c.attempts
  )
  select claimed.id, claimed.command_type, claimed.product_id, claimed.payload, claimed.attempts from claimed;
end;
$$;

create or replace function public.bind_bling_product_id(p_product_id uuid, p_bling_product_id bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_product_id is null or p_bling_product_id is null then raise exception 'ids_required'; end if;
  update public.products set bling_product_id = p_bling_product_id, updated_at = now() where id = p_product_id;
  return found;
end;
$$;

create or replace function public.finish_bling_command(
  p_command_id uuid,
  p_success boolean,
  p_result jsonb default '{}'::jsonb,
  p_error text default null,
  p_retry_seconds integer default 120
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product_id uuid;
  v_item_id uuid;
  v_attempts integer;
  v_max_attempts integer;
  v_final_status text;
begin
  select product_id, nullif(payload->>'inventory_count_item_id','')::uuid, attempts, max_attempts
    into v_product_id, v_item_id, v_attempts, v_max_attempts
  from public.bling_commands where id = p_command_id for update;
  if not found then return false; end if;

  if p_success then
    update public.bling_commands
       set status = 'done', result = coalesce(p_result,'{}'::jsonb), error_message = null,
           finished_at = now(), locked_at = null, locked_by = null, updated_at = now()
     where id = p_command_id;
    if v_item_id is not null then
      update public.inventory_count_items set sync_status = 'synced', sync_error = null, synced_to_bling_at = now() where id = v_item_id;
    end if;
    if v_product_id is not null then
      update public.products set sync_status = 'synced', sync_error = null, last_bling_sync_at = now(), updated_at = now() where id = v_product_id;
    end if;
  else
    v_final_status := case when v_attempts >= v_max_attempts then 'error' else 'pending' end;
    update public.bling_commands
       set status = v_final_status,
           result = coalesce(p_result,'{}'::jsonb),
           error_message = left(coalesce(p_error,'unknown_error'),2000),
           available_at = case when v_final_status = 'pending' then now() + make_interval(secs => greatest(30,least(coalesce(p_retry_seconds,120),3600))) else available_at end,
           finished_at = case when v_final_status = 'error' then now() else null end,
           locked_at = null, locked_by = null, updated_at = now()
     where id = p_command_id;
    if v_item_id is not null then
      update public.inventory_count_items
         set sync_status = case when v_final_status = 'error' then 'error' else 'pending' end,
             sync_error = left(coalesce(p_error,'unknown_error'),2000)
       where id = v_item_id;
    end if;
    if v_product_id is not null then
      update public.products
         set sync_status = case when v_final_status = 'error' then 'error_bling' else 'pending_bling' end,
             sync_error = left(coalesce(p_error,'unknown_error'),2000), updated_at = now()
       where id = v_product_id;
    end if;
  end if;

  if v_item_id is not null then
    update public.inventory_counts c
       set pending_sync = (
         select count(*) from public.inventory_count_items i
         where i.inventory_count_id = c.id and i.sync_status in ('pending','processing','error')
       ), updated_at = now()
     where c.id = (select inventory_count_id from public.inventory_count_items where id = v_item_id);
  end if;
  return true;
end;
$$;

revoke all on function public.claim_bling_commands(text,integer) from public, anon, authenticated;
revoke all on function public.bind_bling_product_id(uuid,bigint) from public, anon, authenticated;
revoke all on function public.finish_bling_command(uuid,boolean,jsonb,text,integer) from public, anon, authenticated;
grant execute on function public.claim_bling_commands(text,integer) to service_role;
grant execute on function public.bind_bling_product_id(uuid,bigint) to service_role;
grant execute on function public.finish_bling_command(uuid,boolean,jsonb,text,integer) to service_role;
