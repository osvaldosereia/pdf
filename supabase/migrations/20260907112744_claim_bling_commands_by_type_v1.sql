create or replace function public.claim_bling_commands_by_types(p_worker text, p_types text[], p_limit integer default 20)
returns table(id uuid, command_type text, product_id uuid, payload jsonb, attempts integer)
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(trim(p_worker),'') = '' then raise exception 'worker_required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'invalid_limit'; end if;
  if p_types is null or cardinality(p_types) = 0 then raise exception 'types_required'; end if;
  update public.bling_commands set status='pending',locked_at=null,locked_by=null,updated_at=now(),error_message=coalesce(error_message,'processing_timeout_requeued') where status='processing' and locked_at is not null and locked_at < now()-interval '20 minutes';
  return query with picked as (
    select c.id from public.bling_commands c where c.status='pending' and c.available_at<=now() and c.attempts<c.max_attempts and c.command_type=any(p_types) order by c.created_at for update skip locked limit p_limit
  ), claimed as (
    update public.bling_commands c set status='processing',attempts=c.attempts+1,locked_at=now(),locked_by=p_worker,updated_at=now() from picked where c.id=picked.id returning c.id,c.command_type,c.product_id,c.payload,c.attempts
  ) select claimed.id,claimed.command_type,claimed.product_id,claimed.payload,claimed.attempts from claimed;
end;$$;
revoke all on function public.claim_bling_commands_by_types(text,text[],integer) from public,anon,authenticated;
grant execute on function public.claim_bling_commands_by_types(text,text[],integer) to service_role;
