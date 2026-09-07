create or replace function public.coalesce_pending_stock_command()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.command_type = 'set_stock' and new.product_id is not null then
    update public.bling_commands
       set status = 'cancelled',
           error_message = 'superseded_by_newer_physical_count',
           finished_at = now(),
           updated_at = now()
     where product_id = new.product_id
       and command_type = 'set_stock'
       and status = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_coalesce_pending_stock_command on public.bling_commands;
create trigger trg_coalesce_pending_stock_command
before insert on public.bling_commands
for each row execute function public.coalesce_pending_stock_command();

revoke all on function public.coalesce_pending_stock_command() from public, anon, authenticated;
