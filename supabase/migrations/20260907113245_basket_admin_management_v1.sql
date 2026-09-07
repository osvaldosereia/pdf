alter table public.basket_templates
  add column if not exists is_whatsapp_active boolean not null default true,
  add column if not exists is_featured boolean not null default false,
  add column if not exists internal_notes text,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

create table if not exists public.basket_changes(
  id uuid primary key default gen_random_uuid(),
  basket_id uuid not null references public.basket_templates(id) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  change_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists basket_changes_basket_idx on public.basket_changes(basket_id,created_at desc);
create index if not exists basket_changes_user_idx on public.basket_changes(changed_by) where changed_by is not null;
create index if not exists basket_templates_updated_by_idx on public.basket_templates(updated_by) where updated_by is not null;
create index if not exists basket_templates_active_sort_idx on public.basket_templates(is_active,is_whatsapp_active,sort_order,name);
alter table public.basket_changes enable row level security;
revoke all on table public.basket_changes from anon,authenticated;
