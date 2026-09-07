alter table public.products
  add column if not exists firebase_key text,
  add column if not exists brand text,
  add column if not exists category text,
  add column if not exists subcategory text,
  add column if not exists subsubcategory text,
  add column if not exists packaging text,
  add column if not exists supplier text,
  add column if not exists validity_date date,
  add column if not exists gondola text,
  add column if not exists shelf text,
  add column if not exists source_system text not null default 'operational',
  add column if not exists sync_status text not null default 'local',
  add column if not exists last_counted_at timestamptz,
  add column if not exists firebase_snapshot jsonb not null default '{}'::jsonb;

create unique index if not exists products_firebase_key_uidx
  on public.products(firebase_key)
  where firebase_key is not null and firebase_key <> '';
create index if not exists products_gtin_idx
  on public.products(gtin)
  where gtin is not null and gtin <> '';

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'operator' check (role in ('owner','operator','viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  notes text,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  inventory_count_id uuid references public.inventory_counts(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  firebase_key text,
  ean text,
  previous_stock numeric,
  counted_stock numeric not null check (counted_stock >= 0),
  previous_validity_date date,
  validity_date date,
  counted_by uuid references auth.users(id) on delete set null,
  source_snapshot jsonb not null default '{}'::jsonb,
  counted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists inventory_count_items_product_idx
  on public.inventory_count_items(product_id, counted_at desc);
create index if not exists inventory_count_items_ean_idx
  on public.inventory_count_items(ean, counted_at desc)
  where ean is not null and ean <> '';

alter table public.admin_users enable row level security;
alter table public.inventory_counts enable row level security;
alter table public.inventory_count_items enable row level security;
revoke all on table public.admin_users from anon, authenticated;
revoke all on table public.inventory_counts from anon, authenticated;
revoke all on table public.inventory_count_items from anon, authenticated;
