alter table public.products
  add column if not exists description_short text,
  add column if not exists description_long text,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists min_stock numeric,
  add column if not exists sort_order integer not null default 0,
  add column if not exists is_upsell boolean not null default false,
  add column if not exists desired_bling_status text not null default 'A' check (desired_bling_status in ('A','I')),
  add column if not exists last_admin_edit_at timestamptz,
  add column if not exists last_admin_edit_by uuid references auth.users(id) on delete set null;

create table if not exists public.product_changes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  change_type text not null default 'edit',
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists product_changes_product_idx on public.product_changes(product_id,created_at desc);
create index if not exists product_changes_changed_by_idx on public.product_changes(changed_by) where changed_by is not null;
create index if not exists products_admin_edit_by_idx on public.products(last_admin_edit_by) where last_admin_edit_by is not null;
create index if not exists products_operational_search_idx on public.products(physically_verified,is_active,updated_at desc);
alter table public.product_changes enable row level security;
revoke all on table public.product_changes from anon,authenticated;

create or replace function public.coalesce_pending_product_command()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.product_id is null then return new; end if;
  if new.command_type='update_product' then
    update public.bling_commands set status='cancelled',error_message='superseded_by_newer_product_edit',finished_at=now(),updated_at=now() where product_id=new.product_id and command_type='update_product' and status='pending';
  elsif new.command_type in ('activate_product','inactivate_product') then
    update public.bling_commands set status='cancelled',error_message='superseded_by_newer_product_status',finished_at=now(),updated_at=now() where product_id=new.product_id and command_type in ('activate_product','inactivate_product') and status='pending';
  end if;
  return new;
end;$$;
drop trigger if exists trg_coalesce_pending_product_command on public.bling_commands;
create trigger trg_coalesce_pending_product_command before insert on public.bling_commands for each row execute function public.coalesce_pending_product_command();
revoke all on function public.coalesce_pending_product_command() from public,anon,authenticated;
