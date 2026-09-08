begin;

-- Melhora o ranking do catálogo conversacional sem introduzir IA na verdade comercial.
-- Termos que aparecem no início do nome (inclusive depois da marca) ficam à frente de
-- produtos onde a palavra aparece apenas em uma descrição composta/ingrediente.
create or replace function public.search_whatsapp_sellable_products_v1(p_query text,p_limit integer default 8)
returns table(
  id uuid, sku text, gtin text, name text, brand text, category text, packaging text,
  price numeric, stock numeric, image_url text, gondola text, shelf text, score integer
)
language sql stable security definer set search_path=''
as $$
  with q as (
    select lower(trim(coalesce(p_query,''))) as term,
           greatest(1,least(coalesce(p_limit,8),20)) as lim
  ), ranked as (
    select
      p.id,p.sku,p.gtin,p.name,p.brand,p.category,p.packaging,p.price,p.stock,p.image_url,p.gondola,p.shelf,
      case
        when q.term<>'' and lower(coalesce(p.gtin,''))=q.term then 100
        when q.term<>'' and lower(coalesce(p.sku,''))=q.term then 98
        when q.term<>'' and lower(p.name)=q.term then 96
        when q.term<>'' and lower(p.name) like q.term||'%' then 94
        when q.term<>'' and strpos(lower(p.name),q.term) between 1 and 14 then 90
        when q.term<>'' and lower(p.name) like '%'||q.term||'%' then 80
        when q.term<>'' and lower(coalesce(p.brand,'')) like '%'||q.term||'%' then 70
        when q.term<>'' and lower(coalesce(p.category,'')) like '%'||q.term||'%' then 60
        else 10
      end as score,
      case when q.term='' then 9999 else nullif(strpos(lower(p.name),q.term),0) end as term_position,
      p.sort_order
    from public.products p cross join q
    where p.physically_verified=true
      and p.is_active=true
      and p.price is not null and p.price>=0
      and coalesce(p.stock,0)>0
      and (
        q.term='' or lower(coalesce(p.gtin,''))=q.term or lower(coalesce(p.sku,''))=q.term or
        lower(p.name) like '%'||q.term||'%' or lower(coalesce(p.brand,'')) like '%'||q.term||'%' or
        lower(coalesce(p.category,'')) like '%'||q.term||'%'
      )
  )
  select r.id,r.sku,r.gtin,r.name,r.brand,r.category,r.packaging,r.price,r.stock,r.image_url,r.gondola,r.shelf,r.score
  from ranked r cross join q
  order by r.score desc,r.term_position nulls last,r.sort_order nulls last,r.name,r.id
  limit (select lim from q)
$$;

revoke all on function public.search_whatsapp_sellable_products_v1(text,integer) from public,anon,authenticated;
grant execute on function public.search_whatsapp_sellable_products_v1(text,integer) to service_role;

commit;
