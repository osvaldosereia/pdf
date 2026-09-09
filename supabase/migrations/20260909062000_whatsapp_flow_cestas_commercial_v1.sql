begin;

-- Dona Antônia — WhatsApp Flow Cestas Comercial V1
-- Camada READ-ONLY para o futuro Flow único de cestas, personalização,
-- adicionais, upsell e checkout. Nada é ativado por esta migration.

create table if not exists public.whatsapp_flow_search_terms (
  id uuid primary key default gen_random_uuid(),
  section_key text not null,
  section_title text not null,
  term_key text not null,
  term_title text not null,
  search_query text not null,
  sort_order integer not null default 100,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(section_key,term_key),
  constraint whatsapp_flow_search_terms_section_key_check check(section_key ~ '^[a-z0-9_]{2,50}$'),
  constraint whatsapp_flow_search_terms_term_key_check check(term_key ~ '^[a-z0-9_]{2,60}$'),
  constraint whatsapp_flow_search_terms_query_check check(length(trim(search_query)) between 2 and 120)
);

alter table public.whatsapp_flow_search_terms enable row level security;
revoke all on table public.whatsapp_flow_search_terms from public,anon,authenticated;
grant select,insert,update,delete on table public.whatsapp_flow_search_terms to service_role;

insert into public.whatsapp_flow_search_terms(section_key,section_title,term_key,term_title,search_query,sort_order)
values
('mercearia','Mercearia','arroz','Arroz','arroz',10),
('mercearia','Mercearia','feijao','Feijão','feijao',20),
('mercearia','Mercearia','cafe','Café','cafe',30),
('mercearia','Mercearia','acucar','Açúcar','acucar',40),
('mercearia','Mercearia','oleo','Óleo','oleo',50),
('mercearia','Mercearia','macarrao','Macarrão','macarrao',60),
('mercearia','Mercearia','molho','Molhos','molho',70),
('mercearia','Mercearia','biscoito','Biscoitos','biscoito',80),
('limpeza','Limpeza','detergente','Detergentes','detergente',10),
('limpeza','Limpeza','desinfetante','Desinfetantes','desinfetante',20),
('limpeza','Limpeza','sabao','Sabão','sabao',30),
('limpeza','Limpeza','amaciante','Amaciantes','amaciante',40),
('limpeza','Limpeza','agua_sanitaria','Água sanitária','agua sanitaria',50),
('limpeza','Limpeza','esponja','Esponjas','esponja',60),
('limpeza','Limpeza','saco_lixo','Sacos de lixo','saco lixo',70),
('higiene','Higiene e beleza','sabonete','Sabonetes','sabonete',10),
('higiene','Higiene e beleza','shampoo','Shampoo','shampoo',20),
('higiene','Higiene e beleza','condicionador','Condicionador','condicionador',30),
('higiene','Higiene e beleza','creme_dental','Creme dental','creme dental',40),
('higiene','Higiene e beleza','desodorante','Desodorantes','desodorante',50),
('higiene','Higiene e beleza','papel_higienico','Papel higiênico','papel higienico',60),
('higiene','Higiene e beleza','absorvente','Absorventes','absorvente',70),
('higiene','Higiene e beleza','infantil','Cuidados infantis','infantil',80),
('bebidas','Bebidas','refrigerante','Refrigerantes','refrigerante',10),
('bebidas','Bebidas','suco','Sucos','suco',20),
('bebidas','Bebidas','agua','Água','agua',30),
('bebidas','Bebidas','achocolatado','Achocolatados','achocolatado',40),
('utilidades_pet','Casa e Pet','papel_toalha','Papel toalha','papel toalha',10),
('utilidades_pet','Casa e Pet','guardanapo','Guardanapos','guardanapo',20),
('utilidades_pet','Casa e Pet','racao','Ração','racao',30),
('utilidades_pet','Casa e Pet','petisco','Petiscos pet','petisco',40),
('ofertas','Ofertas','ofertas','Ofertas do dia','oferta',10)
on conflict(section_key,term_key) do update set
  section_title=excluded.section_title,
  term_title=excluded.term_title,
  search_query=excluded.search_query,
  sort_order=excluded.sort_order,
  updated_at=now();

create or replace function public.get_whatsapp_flow_sections_v1()
returns table(section_key text,section_title text,sort_order integer,term_count bigint)
language sql stable security definer set search_path=''
as $$
  select t.section_key,min(t.section_title),min(t.sort_order),count(*)
  from public.whatsapp_flow_search_terms t
  where t.enabled=true
  group by t.section_key
  order by min(t.sort_order),min(t.section_title);
$$;

create or replace function public.get_whatsapp_flow_search_terms_v1(p_section_key text)
returns table(term_key text,term_title text,search_query text,sort_order integer)
language sql stable security definer set search_path=''
as $$
  select t.term_key,t.term_title,t.search_query,t.sort_order
  from public.whatsapp_flow_search_terms t
  where t.enabled=true and t.section_key=lower(trim(coalesce(p_section_key,'')))
  order by t.sort_order,t.term_title;
$$;

create or replace function public.get_whatsapp_flow_product_results_v1(p_query text,p_limit integer default 12)
returns jsonb
language sql stable security definer set search_path=''
as $$
  select jsonb_build_object(
    'query',left(trim(coalesce(p_query,'')),120),
    'limit',greatest(1,least(coalesce(p_limit,12),20)),
    'products',coalesce(jsonb_agg(jsonb_build_object(
      'id',x.id,
      'name',x.name,
      'brand',x.brand,
      'packaging',x.packaging,
      'price',x.price,
      'image_url',x.image_url,
      'category',x.category
    ) order by x.score desc,x.name) filter(where x.id is not null),'[]'::jsonb)
  )
  from public.search_whatsapp_sellable_products_v1(left(trim(coalesce(p_query,'')),120),greatest(1,least(coalesce(p_limit,12),20))) x;
$$;

create or replace function public.get_whatsapp_flow_commercial_snapshot_v1(p_conversation_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_customer jsonb;
  v_cart jsonb;
  v_baskets jsonb;
  v_sections jsonb;
  v_upsell jsonb;
begin
  if not exists(select 1 from public.conversations c where c.id=p_conversation_id) then
    raise exception 'conversation_not_found';
  end if;

  v_customer:=public.get_whatsapp_basket_customer_status_v1(p_conversation_id);
  v_cart:=public.get_whatsapp_sales_cart_v1(p_conversation_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',b.id,'name',b.display_name,'price',b.base_price,'image_url',b.image_url
  ) order by b.sort_order,b.display_name),'[]'::jsonb)
  into v_baskets from public.get_whatsapp_simple_baskets_v1() b;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key',s.section_key,'title',s.section_title,'term_count',s.term_count
  ) order by s.sort_order,s.section_title),'[]'::jsonb)
  into v_sections from public.get_whatsapp_flow_sections_v1() s;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',u.product_id,'name',u.name,'price',u.price,'image_url',u.image_url,
    'reason',u.reason,'is_offer',u.is_offer
  ) order by u.score desc),'[]'::jsonb)
  into v_upsell from public.get_cart_aware_recommendations(p_conversation_id,6,'upsell') u;

  return jsonb_build_object(
    'customer',v_customer,
    'cart',v_cart,
    'baskets',v_baskets,
    'sections',v_sections,
    'upsell',v_upsell,
    'catalog_policy',jsonb_build_object(
      'never_load_full_catalog',true,
      'max_products_per_query',20,
      'default_products_per_query',12,
      'component_prices_visible',false,
      'upsell_optional',true
    )
  );
end;
$$;

revoke all on function public.get_whatsapp_flow_sections_v1() from public,anon,authenticated;
revoke all on function public.get_whatsapp_flow_search_terms_v1(text) from public,anon,authenticated;
revoke all on function public.get_whatsapp_flow_product_results_v1(text,integer) from public,anon,authenticated;
revoke all on function public.get_whatsapp_flow_commercial_snapshot_v1(uuid) from public,anon,authenticated;
grant execute on function public.get_whatsapp_flow_sections_v1() to service_role;
grant execute on function public.get_whatsapp_flow_search_terms_v1(text) to service_role;
grant execute on function public.get_whatsapp_flow_product_results_v1(text,integer) to service_role;
grant execute on function public.get_whatsapp_flow_commercial_snapshot_v1(uuid) to service_role;

insert into public.experience_feature_flags(key,experience_type,enabled,rollout_percent,channel,config,updated_at)
values('flow_basket_commercial','whatsapp_flow',false,0,'whatsapp',jsonb_build_object(
  'mission','basket_commercial',
  'max_products_per_query',20,
  'default_products_per_query',12,
  'never_load_full_catalog',true,
  'upsell_optional',true
),now())
on conflict(key) do update set
  enabled=false,
  rollout_percent=0,
  config=excluded.config,
  updated_at=now();

insert into public.experience_definitions(
  slug,feature_key,experience_type,purpose,status,provider,provider_id,provider_version,schema_version,config,metadata
)
values(
  'flow-cestas-comercial-v1','flow_basket_commercial','whatsapp_flow',
  'Flow comercial único: escolher cesta, personalizar, adicionar produtos por busca segmentada, upsell opcional e revisar checkout.',
  'draft','meta_whatsapp_flow',null,null,1,
  jsonb_build_object(
    'flow_action','data_exchange',
    'flow_cta','Montar pedido',
    'component_prices_visible',false,
    'never_load_full_catalog',true,
    'max_products_per_query',20,
    'default_products_per_query',12,
    'upsell_optional',true,
    'requires_backend_validation',true
  ),
  jsonb_build_object('implementation_stage','read_only_contract')
)
on conflict(slug) do update set
  purpose=excluded.purpose,
  status='draft',
  provider_id=null,
  config=excluded.config,
  metadata=excluded.metadata,
  updated_at=now();

-- Garantias explícitas: esta migration não ativa transporte, orquestrador ou Bling.
update public.automation_config
set experience_orchestrator_enabled=false,
    whatsapp_flow_data_exchange_enabled=false,
    whatsapp_flow_send_enabled=false,
    bling_order_sync_enabled=false,
    updated_at=now()
where id=1;

commit;
