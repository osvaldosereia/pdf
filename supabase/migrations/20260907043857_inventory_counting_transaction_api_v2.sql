alter table public.products
  add column if not exists unit text,
  add column if not exists is_active boolean not null default true,
  add column if not exists physically_verified boolean not null default false,
  add column if not exists physically_verified_at timestamptz,
  add column if not exists physically_verified_by uuid references auth.users(id) on delete set null,
  add column if not exists sync_error text;

alter table public.admin_users
  add column if not exists display_name text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.inventory_counts
  add column if not exists device_label text,
  add column if not exists item_count integer not null default 0 check (item_count >= 0),
  add column if not exists pending_sync integer not null default 0 check (pending_sync >= 0),
  add column if not exists updated_at timestamptz not null default now();

alter table public.inventory_count_items
  add column if not exists bling_command_id uuid references public.bling_commands(id) on delete set null,
  add column if not exists sync_status text not null default 'pending' check (sync_status in ('pending','processing','synced','error','skipped')),
  add column if not exists sync_error text,
  add column if not exists synced_to_bling_at timestamptz,
  add column if not exists gondola text,
  add column if not exists shelf text;

alter table public.bling_commands
  add column if not exists max_attempts integer not null default 5 check (max_attempts >= 1),
  add column if not exists result jsonb not null default '{}'::jsonb,
  add column if not exists locked_by text;

create unique index if not exists products_gtin_verified_uidx on public.products(gtin) where gtin is not null and gtin <> '';
create index if not exists products_verified_idx on public.products(physically_verified, last_counted_at desc);
create index if not exists inventory_counts_status_idx on public.inventory_counts(status, started_at desc);
create index if not exists inventory_count_items_count_idx on public.inventory_count_items(inventory_count_id, counted_at desc);
create index if not exists inventory_count_items_sync_idx on public.inventory_count_items(sync_status, counted_at);
create index if not exists bling_commands_ready_idx on public.bling_commands(status, available_at, created_at);

create or replace function public.start_inventory_count(p_user_id uuid, p_device_label text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if p_user_id is null then raise exception 'user_required'; end if;
  insert into public.inventory_counts(opened_by, status, device_label)
  values (p_user_id, 'open', nullif(trim(p_device_label),''))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.save_verified_inventory_count(
  p_inventory_count_id uuid,
  p_user_id uuid,
  p_firebase_key text,
  p_source jsonb,
  p_counted_stock numeric,
  p_validity_date date,
  p_gondola text default null,
  p_shelf text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count_id uuid := p_inventory_count_id;
  v_product_id uuid;
  v_item_id uuid;
  v_command_id uuid;
  v_gtin text;
  v_name text;
  v_sku text;
  v_prev_stock numeric;
  v_prev_validity date;
  v_source_stock numeric;
  v_source_validity date;
  v_now timestamptz := now();
begin
  if p_user_id is null then raise exception 'user_required'; end if;
  if p_counted_stock is null or p_counted_stock < 0 then raise exception 'counted_stock_invalid'; end if;
  if p_source is null or jsonb_typeof(p_source) <> 'object' then raise exception 'source_required'; end if;

  v_gtin := regexp_replace(coalesce(nullif(p_source->>'gtin',''), nullif(p_source->>'ean',''), ''), '\D', '', 'g');
  if v_gtin = '' then raise exception 'gtin_required'; end if;
  v_name := coalesce(nullif(trim(p_source->>'nome'),''), nullif(trim(p_source->>'name'),''), 'Produto sem nome');
  v_sku := coalesce(nullif(trim(p_source->>'sku'),''), nullif(trim(p_source->>'codigo'),''));

  begin
    if coalesce(p_source->>'estoque','') ~ '^-?[0-9]+([.,][0-9]+)?$' then
      v_source_stock := replace(p_source->>'estoque',',','.')::numeric;
    end if;
  exception when others then v_source_stock := null; end;

  begin
    if coalesce(p_source->>'validade','') <> '' then
      v_source_validity := (p_source->>'validade')::date;
    elsif coalesce(p_source->>'data_validade','') <> '' then
      v_source_validity := (p_source->>'data_validade')::date;
    end if;
  exception when others then v_source_validity := null; end;

  if v_count_id is null then
    v_count_id := public.start_inventory_count(p_user_id, null);
  else
    perform 1 from public.inventory_counts c where c.id = v_count_id and c.status = 'open';
    if not found then raise exception 'inventory_count_not_open'; end if;
  end if;

  select p.id, p.stock, p.validity_date
    into v_product_id, v_prev_stock, v_prev_validity
  from public.products p
  where (p.firebase_key is not null and p.firebase_key = nullif(p_firebase_key,''))
     or (p.gtin is not null and p.gtin = v_gtin)
  order by case when p.firebase_key = nullif(p_firebase_key,'') then 0 else 1 end
  limit 1;

  if v_product_id is null then
    insert into public.products(
      firebase_key, sku, name, gtin, ncm, price, cost, stock, image_url,
      brand, category, subcategory, subsubcategory, packaging, supplier, unit,
      validity_date, gondola, shelf, source_system, sync_status, last_counted_at,
      firebase_snapshot, is_whatsapp_active, is_offer, is_active,
      physically_verified, physically_verified_at, physically_verified_by, metadata
    ) values (
      nullif(p_firebase_key,''), v_sku, v_name, v_gtin,
      nullif(regexp_replace(coalesce(p_source->>'ncm',''), '\D', '', 'g'),''),
      case when coalesce(p_source->>'preco','') ~ '^[0-9]+([.,][0-9]+)?$' then replace(p_source->>'preco',',','.')::numeric else null end,
      case when coalesce(p_source->>'preco_custo','') ~ '^[0-9]+([.,][0-9]+)?$' then replace(p_source->>'preco_custo',',','.')::numeric else null end,
      p_counted_stock,
      nullif(coalesce(p_source->>'url_imagem', p_source->>'imagem_url', p_source->>'imagem'),''),
      nullif(p_source->>'marca',''), nullif(p_source->>'categoria',''), nullif(p_source->>'subcategoria',''),
      nullif(p_source->>'subsubcategoria',''), nullif(p_source->>'embalagem',''), nullif(p_source->>'fornecedor',''), nullif(p_source->>'unidade',''),
      p_validity_date, coalesce(nullif(p_gondola,''), nullif(p_source->>'gondola','')),
      coalesce(nullif(p_shelf,''), nullif(p_source->>'prateleira','')),
      'firebase_verified', 'pending_bling', v_now, p_source, false, false, true,
      true, v_now, p_user_id,
      jsonb_build_object('verified_source','physical_count','firebase_key',nullif(p_firebase_key,''))
    ) returning id into v_product_id;
  else
    update public.products p set
      firebase_key = coalesce(p.firebase_key, nullif(p_firebase_key,'')),
      sku = coalesce(nullif(v_sku,''), p.sku),
      name = coalesce(nullif(v_name,''), p.name),
      gtin = v_gtin,
      ncm = coalesce(nullif(regexp_replace(coalesce(p_source->>'ncm',''), '\D', '', 'g'),''), p.ncm),
      price = coalesce(case when coalesce(p_source->>'preco','') ~ '^[0-9]+([.,][0-9]+)?$' then replace(p_source->>'preco',',','.')::numeric end, p.price),
      cost = coalesce(case when coalesce(p_source->>'preco_custo','') ~ '^[0-9]+([.,][0-9]+)?$' then replace(p_source->>'preco_custo',',','.')::numeric end, p.cost),
      stock = p_counted_stock,
      image_url = coalesce(nullif(coalesce(p_source->>'url_imagem', p_source->>'imagem_url', p_source->>'imagem'),''), p.image_url),
      brand = coalesce(nullif(p_source->>'marca',''), p.brand),
      category = coalesce(nullif(p_source->>'categoria',''), p.category),
      subcategory = coalesce(nullif(p_source->>'subcategoria',''), p.subcategory),
      subsubcategory = coalesce(nullif(p_source->>'subsubcategoria',''), p.subsubcategory),
      packaging = coalesce(nullif(p_source->>'embalagem',''), p.packaging),
      supplier = coalesce(nullif(p_source->>'fornecedor',''), p.supplier),
      unit = coalesce(nullif(p_source->>'unidade',''), p.unit),
      validity_date = p_validity_date,
      gondola = coalesce(nullif(p_gondola,''), nullif(p_source->>'gondola',''), p.gondola),
      shelf = coalesce(nullif(p_shelf,''), nullif(p_source->>'prateleira',''), p.shelf),
      source_system = 'firebase_verified',
      sync_status = 'pending_bling',
      sync_error = null,
      last_counted_at = v_now,
      firebase_snapshot = p_source,
      is_active = true,
      physically_verified = true,
      physically_verified_at = v_now,
      physically_verified_by = p_user_id,
      updated_at = v_now
    where p.id = v_product_id;
  end if;

  insert into public.inventory_count_items(
    inventory_count_id, product_id, firebase_key, ean, previous_stock, counted_stock,
    previous_validity_date, validity_date, counted_by, source_snapshot, counted_at,
    sync_status, gondola, shelf
  ) values (
    v_count_id, v_product_id, nullif(p_firebase_key,''), v_gtin,
    coalesce(v_prev_stock, v_source_stock), p_counted_stock,
    coalesce(v_prev_validity, v_source_validity), p_validity_date,
    p_user_id, p_source, v_now, 'pending',
    coalesce(nullif(p_gondola,''), nullif(p_source->>'gondola','')),
    coalesce(nullif(p_shelf,''), nullif(p_source->>'prateleira',''))
  ) returning id into v_item_id;

  insert into public.bling_commands(command_type, product_id, payload, status, created_by)
  values (
    'set_stock', v_product_id,
    jsonb_build_object(
      'gtin', v_gtin,
      'counted_stock', p_counted_stock,
      'validity_date', p_validity_date,
      'firebase_key', nullif(p_firebase_key,''),
      'inventory_count_item_id', v_item_id
    ),
    'pending', p_user_id
  ) returning id into v_command_id;

  update public.inventory_count_items set bling_command_id = v_command_id where id = v_item_id;
  update public.inventory_counts c set
    item_count = (select count(*) from public.inventory_count_items i where i.inventory_count_id = v_count_id),
    pending_sync = (select count(*) from public.inventory_count_items i where i.inventory_count_id = v_count_id and i.sync_status in ('pending','error')),
    updated_at = v_now
  where c.id = v_count_id;

  return jsonb_build_object(
    'inventory_count_id', v_count_id,
    'product_id', v_product_id,
    'count_item_id', v_item_id,
    'bling_command_id', v_command_id,
    'gtin', v_gtin,
    'stock', p_counted_stock,
    'validity_date', p_validity_date,
    'sync_status', 'pending'
  );
end;
$$;

create or replace function public.close_inventory_count(p_inventory_count_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_items integer; v_pending integer;
begin
  update public.inventory_counts
     set status = 'closed', closed_at = now(), updated_at = now()
   where id = p_inventory_count_id
     and status = 'open'
     and (opened_by = p_user_id or opened_by is null);
  if not found then raise exception 'inventory_count_not_open'; end if;

  select count(*), count(*) filter (where sync_status in ('pending','error'))
    into v_items, v_pending
  from public.inventory_count_items where inventory_count_id = p_inventory_count_id;

  update public.inventory_counts set item_count = v_items, pending_sync = v_pending where id = p_inventory_count_id;
  return jsonb_build_object('inventory_count_id',p_inventory_count_id,'status','closed','item_count',v_items,'pending_sync',v_pending);
end;
$$;

revoke all on function public.start_inventory_count(uuid,text) from public, anon, authenticated;
revoke all on function public.save_verified_inventory_count(uuid,uuid,text,jsonb,numeric,date,text,text) from public, anon, authenticated;
revoke all on function public.close_inventory_count(uuid,uuid) from public, anon, authenticated;
grant execute on function public.start_inventory_count(uuid,text) to service_role;
grant execute on function public.save_verified_inventory_count(uuid,uuid,text,jsonb,numeric,date,text,text) to service_role;
grant execute on function public.close_inventory_count(uuid,uuid) to service_role;
