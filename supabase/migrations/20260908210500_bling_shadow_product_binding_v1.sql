begin;

create table if not exists public.bling_product_binding_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  bling_product_id bigint not null,
  binding_source text not null,
  external_key text,
  created_at timestamptz not null default now()
);
create index if not exists bling_product_binding_events_product_idx on public.bling_product_binding_events(product_id,created_at desc);
alter table public.bling_product_binding_events enable row level security;
revoke all on public.bling_product_binding_events from public,anon,authenticated;
grant select,insert on public.bling_product_binding_events to service_role;

create or replace function public.bind_bling_product_id_v1(p_product_id uuid,p_bling_product_id bigint,p_source text default 'whatsapp_sales_mvp',p_external_key text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare p public.products%rowtype;
begin
  if p_product_id is null or coalesce(p_bling_product_id,0)<=0 then raise exception 'invalid_product_binding'; end if;
  select * into p from public.products where id=p_product_id for update;
  if not found then raise exception 'product_not_found'; end if;
  if p.bling_product_id is not null and p.bling_product_id<>p_bling_product_id then raise exception 'bling_product_binding_conflict'; end if;
  update public.products set bling_product_id=p_bling_product_id,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('bling_binding_source',left(coalesce(p_source,'whatsapp_sales_mvp'),80),'bling_binding_at',now()),updated_at=now() where id=p.id;
  insert into public.bling_product_binding_events(product_id,bling_product_id,binding_source,external_key)
  values(p.id,p_bling_product_id,left(coalesce(p_source,'whatsapp_sales_mvp'),80),left(p_external_key,180));
  return jsonb_build_object('product_id',p.id,'bling_product_id',p_bling_product_id,'source',p_source);
end $$;

create or replace function public.build_bling_order_draft(p_order_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'order_id',o.id,'bling_order_id',o.bling_order_id,'status',o.status,'customer',o.customer_snapshot,'delivery_address',o.delivery_address,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id',oi.product_id,'bling_product_id',p.bling_product_id,'sku',oi.sku_snapshot,'name',oi.name_snapshot,
        'gtin',p.gtin,'ncm',p.ncm,'unit',p.unit,'packaging',p.packaging,'quantity',oi.quantity,'unit_price',oi.unit_price,'line_total',oi.line_total,
        'catalog_source','counter_verified'
      ) order by oi.created_at)
      from public.order_items oi left join public.products p on p.id=oi.product_id where oi.order_id=o.id
    ),'[]'::jsonb),
    'fiscal_subtotal',o.fiscal_subtotal,'other_expenses',o.other_expenses,'discount',o.discount,'total',o.total,'currency',o.currency,
    'catalog_source','counter_verified'
  ) from public.orders o where o.id=p_order_id
$$;

revoke all on function public.bind_bling_product_id_v1(uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function public.build_bling_order_draft(uuid) from public,anon,authenticated;
grant execute on function public.bind_bling_product_id_v1(uuid,bigint,text,text) to service_role;
grant execute on function public.build_bling_order_draft(uuid) to service_role;

commit;
