create table if not exists public.product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_by uuid null references auth.users(id) on delete set null,
  constraint product_categories_name_length check (char_length(btrim(name)) between 1 and 120)
);

create unique index if not exists product_categories_name_ci_uq
  on public.product_categories (lower(btrim(name)));

alter table public.product_categories enable row level security;
revoke all on table public.product_categories from public, anon, authenticated;
grant select, insert, update, delete on table public.product_categories to service_role;

insert into public.product_categories(name)
select distinct regexp_replace(btrim(category), '\s+', ' ', 'g')
from public.products
where category is not null and btrim(category) <> ''
on conflict do nothing;

create or replace view public.admin_product_categories
with (security_invoker = true)
as
select
  c.id,
  c.name,
  c.created_at,
  c.updated_at,
  count(p.id) filter (where p.physically_verified = true) as product_count
from public.product_categories c
left join public.products p
  on lower(btrim(coalesce(p.category,''))) = lower(btrim(c.name))
group by c.id, c.name, c.created_at, c.updated_at;

revoke all on table public.admin_product_categories from public, anon, authenticated;
grant select on table public.admin_product_categories to service_role;

create or replace function public.rename_product_category(
  p_category_id uuid,
  p_new_name text,
  p_user_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_name text;
  v_new_name text;
  v_ids uuid[] := '{}'::uuid[];
  v_count integer := 0;
begin
  v_new_name := regexp_replace(btrim(coalesce(p_new_name,'')), '\s+', ' ', 'g');
  if char_length(v_new_name) < 1 or char_length(v_new_name) > 120 then
    raise exception using errcode='22023', message='invalid_category_name';
  end if;

  select name into v_old_name
  from public.product_categories
  where id = p_category_id
  for update;

  if not found then
    raise exception using errcode='P0002', message='category_not_found';
  end if;

  if exists (
    select 1 from public.product_categories
    where id <> p_category_id
      and lower(btrim(name)) = lower(v_new_name)
  ) then
    raise exception using errcode='23505', message='category_exists';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_ids
  from public.products
  where lower(btrim(coalesce(category,''))) = lower(btrim(v_old_name));

  v_count := coalesce(array_length(v_ids, 1), 0);

  update public.product_categories
  set name = v_new_name,
      updated_at = now(),
      updated_by = p_user_id
  where id = p_category_id;

  if v_count > 0 then
    update public.products
    set category = v_new_name,
        updated_at = now(),
        last_admin_edit_at = now(),
        last_admin_edit_by = p_user_id
    where id = any(v_ids);

    insert into public.product_changes(product_id, changed_by, change_type, before_state, after_state)
    select
      product_id,
      p_user_id,
      'category_registry_rename',
      jsonb_build_object('category', v_old_name),
      jsonb_build_object('category', v_new_name)
    from unnest(v_ids) as product_id;
  end if;

  return jsonb_build_object(
    'id', p_category_id,
    'name', v_new_name,
    'previous_name', v_old_name,
    'affected_products', v_count
  );
end;
$$;

revoke all on function public.rename_product_category(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.rename_product_category(uuid,text,uuid) to service_role;

create or replace function public.delete_product_category(
  p_category_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_name text;
  v_count integer := 0;
begin
  select name into v_name
  from public.product_categories
  where id = p_category_id
  for update;

  if not found then
    raise exception using errcode='P0002', message='category_not_found';
  end if;

  select count(*)::integer into v_count
  from public.products
  where lower(btrim(coalesce(category,''))) = lower(btrim(v_name));

  if v_count > 0 then
    raise exception using errcode='P0001', message='category_in_use', detail=v_count::text;
  end if;

  delete from public.product_categories where id = p_category_id;
  return jsonb_build_object('id', p_category_id, 'name', v_name, 'deleted', true);
end;
$$;

revoke all on function public.delete_product_category(uuid) from public, anon, authenticated;
grant execute on function public.delete_product_category(uuid) to service_role;
