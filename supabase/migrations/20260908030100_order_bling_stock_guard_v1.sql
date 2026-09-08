begin;

create or replace function public.guard_order_sync_stock_v1()
returns trigger
language plpgsql
set search_path=''
as $$
declare shortage jsonb;
begin
  select jsonb_agg(jsonb_build_object('product_id',oi.product_id,'sku',oi.sku_snapshot,'requested',oi.quantity,'available',coalesce(p.stock,0)))
    into shortage
  from public.order_items oi
  join public.products p on p.id=oi.product_id
  where oi.order_id=new.order_id and oi.quantity>coalesce(p.stock,0);

  if shortage is not null then
    raise exception 'insufficient_local_stock:%', shortage::text;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_order_sync_stock_v1() from public, anon, authenticated;
grant execute on function public.guard_order_sync_stock_v1() to service_role;

drop trigger if exists trg_guard_order_sync_stock_v1 on public.order_sync_jobs;
create trigger trg_guard_order_sync_stock_v1
before insert on public.order_sync_jobs
for each row execute function public.guard_order_sync_stock_v1();

commit;
