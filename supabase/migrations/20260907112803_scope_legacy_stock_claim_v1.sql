create or replace function public.claim_bling_commands(p_worker text, p_limit integer default 20)
returns table(id uuid, command_type text, product_id uuid, payload jsonb, attempts integer)
language sql security definer set search_path = '' as $$
  select * from public.claim_bling_commands_by_types(p_worker,array['set_stock']::text[],p_limit);
$$;
revoke all on function public.claim_bling_commands(text,integer) from public,anon,authenticated;
grant execute on function public.claim_bling_commands(text,integer) to service_role;
