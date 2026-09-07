create index if not exists bling_commands_created_by_idx on public.bling_commands(created_by) where created_by is not null;
create index if not exists inventory_count_items_bling_command_idx on public.inventory_count_items(bling_command_id) where bling_command_id is not null;
create index if not exists inventory_count_items_counted_by_idx on public.inventory_count_items(counted_by) where counted_by is not null;
create index if not exists inventory_counts_opened_by_idx on public.inventory_counts(opened_by) where opened_by is not null;
create index if not exists products_physically_verified_by_idx on public.products(physically_verified_by) where physically_verified_by is not null;
