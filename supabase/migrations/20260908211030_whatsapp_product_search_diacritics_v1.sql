begin;

-- Mensagens de WhatsApp frequentemente chegam sem acentos. A busca precisa tratar
-- "oleo" e "óleo", "acucar" e "açúcar" como equivalentes sem alterar GTIN/SKU.
create or replace function public.search_whatsapp_sellable_products_v1(p_query text,p_limit integer default 8)
returns table(
  id uuid,sku text,gtin text,name text,brand text,category text,packaging text,
  price numeric,stock numeric,image_url text,gondola text,shelf text,score integer
)
language sql stable security definer set search_path=''
as $$
  with q as (
    select
      translate(lower(trim(coalesce(p_query,''))),
        'áàãâäéèêëíìîïóòõôöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc') as term,
      greatest(1,least(coalesce(p_limit,8),20)) as lim
  ), normalized as (
    select p.*,
      translate(lower(coalesce(p.name,'')),
        'áàãâäéèêëíìîïóòõôöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc') as n_name,
      translate(lower(coalesce(p.brand,'')),
        'áàãâäéèêëíìîïóòõôöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc') as n_brand,
      translate(lower(coalesce(p.category,'')),
        'áàãâäéèêëíìîïóòõôöúùûüç',
        'aaaaaeeeeiiiiooooouuuuc') as n_category
    from public.products p
    where p.physically_verified=true
      and p.is_active=true
      and p.price is not null and p.price>=0
      and coalesce(p.stock,0)>0
  ), ranked as (
    select
      p.id,p.sku,p.gtin,p.name,p.brand,p.category,p.packaging,p.price,p.stock,p.image_url,p.gondola,p.shelf,
      case
        when q.term<>'' and lower(coalesce(p.gtin,''))=q.term then 100
        when q.term<>'' and lower(coalesce(p.sku,''))=q.term then 98
        when q.term<>'' and p.n_name=q.term then 96
        when q.term<>'' and p.n_name like q.term||'%' then 94
        when q.term<>'' and strpos(p.n_name,q.term) between 1 and 14 then 90
        when q.term<>'' and p.n_name like '%'||q.term||'%' then 80
        when q.term<>'' and p.n_brand like '%'||q.term||'%' then 70
        when q.term<>'' and p.n_category like '%'||q.term||'%' then 60
        else 10
      end as score,
      case when q.term='' then 9999 else nullif(strpos(p.n_name,q.term),0) end as term_position,
      p.sort_order
    from normalized p cross join q
    where q.term=''
       or lower(coalesce(p.gtin,''))=q.term
       or lower(coalesce(p.sku,''))=q.term
       or p.n_name like '%'||q.term||'%'
       or p.n_brand like '%'||q.term||'%'
       or p.n_category like '%'||q.term||'%'
  )
  select r.id,r.sku,r.gtin,r.name,r.brand,r.category,r.packaging,r.price,r.stock,r.image_url,r.gondola,r.shelf,r.score
  from ranked r cross join q
  order by r.score desc,r.term_position nulls last,r.sort_order nulls last,r.name,r.id
  limit (select lim from q)
$$;

revoke all on function public.search_whatsapp_sellable_products_v1(text,integer) from public,anon,authenticated;
grant execute on function public.search_whatsapp_sellable_products_v1(text,integer) to service_role;

insert into public.service_regression_cases(
  case_key,title,customer_message,setup,expected_intent,expected_action,expected_assertions,status,priority
) values(
  'accentless_product_search',
  'Busca de produto funciona sem acentos',
  'Quanto ta o oleo?',
  jsonb_build_object('catalog_source','counter_verified'),
  'search','search_product',
  jsonb_build_object('diacritic_insensitive',true,'must_find_if_accented_name_exists',true),
  'active',100
)
on conflict(case_key) do update
set title=excluded.title,customer_message=excluded.customer_message,setup=excluded.setup,
    expected_intent=excluded.expected_intent,expected_action=excluded.expected_action,
    expected_assertions=excluded.expected_assertions,status='active',priority=100,updated_at=now();

commit;
