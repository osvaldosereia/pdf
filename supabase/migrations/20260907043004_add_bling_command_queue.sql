create table if not exists public.bling_commands (
  id uuid primary key default gen_random_uuid(),
  command_type text not null check (command_type in ('create_product','update_product','activate_product','inactivate_product','delete_product','set_stock','stock_entry','stock_exit')),
  product_id uuid references public.products(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','done','error','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  finished_at timestamptz,
  error_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bling_commands_pending_idx
  on public.bling_commands(status, available_at, created_at)
  where status = 'pending';
create index if not exists bling_commands_product_idx
  on public.bling_commands(product_id, created_at desc);

alter table public.bling_commands enable row level security;
revoke all on table public.bling_commands from anon, authenticated;

drop trigger if exists set_bling_commands_updated_at on public.bling_commands;
create trigger set_bling_commands_updated_at
before update on public.bling_commands
for each row execute function public.set_updated_at();
