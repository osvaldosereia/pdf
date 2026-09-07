alter table public.admin_users
  add column if not exists email text,
  add column if not exists last_login_at timestamptz;
