begin;

-- Corrige fallback do resolvedor quando não existe alias canônico.
-- normalize_service_text_v1(NULL) retorna '', então é necessário NULLIF para
-- preservar a consulta normal em vez de transformar qualquer busca sem alias em vazia.
create or replace function public.resolve_whatsapp_product_candidates_v2(
  p_text text,
  p_limit integer default 8
)
returns table(
  id uuid,
  sku text,
  gtin text,
  name text,
  brand text,
  category text,
  packaging text,
  price numeric,
  stock numeric,
  image_url text,
  score integer,
  confidence numeric,
  match_reason text
)
language sql
stable
security definer
set search_path=''
as $$
  with raw as (
    select public.normalize_service_text_v1(left(coalesce(p_text,''),240)) raw_term,
           greatest(1,least(coalesce(p_limit,8),20)) lim
  ), alias_rewrite as (
    select a.canonical_query
    from public.product_aliases a cross join raw
    where a.status='published'
      and a.canonical_query is not null
      and a.normalized_alias<>''
      and raw.raw_term like '%'||a.normalized_alias||'%'
    order by a.priority desc,length(a.normalized_alias) desc,a.updated_at desc
    limit 1
  ), q as (
    select coalesce(
      nullif(public.normalize_service_text_v1((select canonical_query from alias_rewrite)),''),
      raw.raw_term
    ) term,
    raw.raw_term original_term,raw.lim
    from raw
  ), product_base as (
    select p.*,
      public.normalize_service_text_v1(p.name) norm_name,
      public.normalize_service_text_v1(coalesce(p.brand,'')) norm_brand,
      public.normalize_service_text_v1(coalesce(p.category,'')) norm_category,
      public.normalize_service_text_v1(coalesce(p.packaging,'')) norm_packaging
    from public.products p
    where p.physically_verified=true
      and p.is_active=true
      and p.price is not null and p.price>=0
      and coalesce(p.stock,0)>0
  ), alias_hits as (
    select a.product_id,
      max(case
        when q.original_term=a.normalized_alias then 100
        when q.original_term like '%'||a.normalized_alias||'%' then 94
        else 0 end) alias_score
    from public.product_aliases a cross join q
    where a.status='published'
      and a.product_id is not null
      and a.normalized_alias<>''
      and (q.original_term=a.normalized_alias or q.original_term like '%'||a.normalized_alias||'%')
    group by a.product_id
  ), scored as (
    select p.*,
      greatest(
        case when q.term<>'' and lower(coalesce(p.gtin,''))=q.term then 100 else 0 end,
        case when q.term<>'' and lower(coalesce(p.sku,''))=q.term then 99 else 0 end,
        case when q.term=p.norm_name then 98 else 0 end,
        case when q.term<>'' and q.term like '%'||p.norm_name||'%' and length(p.norm_name)>=4 then 96 else 0 end,
        case when q.term<>'' and p.norm_name like '%'||q.term||'%' and length(q.term)>=4 then 92 else 0 end,
        coalesce(a.alias_score,0),
        case when p.norm_brand<>'' and q.term like '%'||p.norm_brand||'%' and q.term like '%'||split_part(p.norm_name,' ',1)||'%' then 88 else 0 end,
        case when p.norm_category<>'' and q.term like '%'||p.norm_category||'%' then 72 else 0 end,
        case when p.norm_packaging<>'' and q.term like '%'||p.norm_packaging||'%' then 68 else 0 end,
        least(86,45+12*(
          select count(*)::int
          from (select distinct x from regexp_split_to_table(p.norm_name,' ') x where length(x)>=3) t
          where q.term like '%'||t.x||'%'
        ))
      )::int final_score,
      case
        when q.term<>'' and lower(coalesce(p.gtin,''))=q.term then 'gtin_exact'
        when q.term<>'' and lower(coalesce(p.sku,''))=q.term then 'sku_exact'
        when q.term=p.norm_name then 'name_exact'
        when q.term<>'' and q.term like '%'||p.norm_name||'%' and length(p.norm_name)>=4 then 'name_in_message'
        when coalesce(a.alias_score,0)>0 then 'alias'
        else 'token_overlap'
      end reason
    from product_base p cross join q
    left join alias_hits a on a.product_id=p.id
    where q.term<>''
  )
  select s.id,s.sku,s.gtin,s.name,s.brand,s.category,s.packaging,s.price,s.stock,s.image_url,
         s.final_score,round((s.final_score::numeric/100),4),s.reason
  from scored s
  where s.final_score>=55
  order by s.final_score desc,s.sort_order nulls last,s.name,s.id
  limit (select lim from q)
$$;

commit;
