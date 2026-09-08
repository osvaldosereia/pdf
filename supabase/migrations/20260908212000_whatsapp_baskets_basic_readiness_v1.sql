begin;

-- Corrige uma inconsistência antiga: a tabela já possuía trigger set_updated_at,
-- porém a coluna updated_at não havia sido criada.
alter table public.basket_template_items
  add column if not exists updated_at timestamptz not null default now();

-- Cestas são produtos comerciais com preço próprio. O preço da cesta nunca é
-- recalculado pela soma dos componentes. Para personalização, o delta unitário
-- fica congelado a partir do preço conhecido do componente no momento desta
-- configuração, preservando a diferença operacional/comercial oculta da cesta.
update public.basket_template_items bi
set remove_unit_delta = coalesce(bi.remove_unit_delta, -p.price),
    add_unit_delta = coalesce(bi.add_unit_delta, p.price)
from public.products p
where p.id=bi.product_id
  and p.price is not null
  and (bi.remove_unit_delta is null or bi.add_unit_delta is null);

create or replace function public.get_whatsapp_basket_readiness_v1()
returns table(
  basket_id uuid,
  basket_name text,
  base_price numeric,
  image_url text,
  total_components integer,
  inventory_ready_components integer,
  pricing_ready_components integer,
  inventory_missing integer,
  pricing_missing integer,
  ready_for_automatic_confirmation boolean
)
language sql
stable
security definer
set search_path=''
as $$
  select
    b.id,
    b.name,
    b.base_price,
    b.image_url,
    count(bi.id)::integer,
    count(bi.id) filter (
      where p.physically_verified=true
        and p.is_active=true
        and coalesce(p.stock,0)>=bi.quantity
    )::integer,
    count(bi.id) filter (
      where bi.remove_unit_delta is not null
        and bi.add_unit_delta is not null
    )::integer,
    count(bi.id) filter (
      where not (p.physically_verified=true and p.is_active=true and coalesce(p.stock,0)>=bi.quantity)
    )::integer,
    count(bi.id) filter (
      where bi.remove_unit_delta is null or bi.add_unit_delta is null
    )::integer,
    bool_and(p.physically_verified=true and p.is_active=true and coalesce(p.stock,0)>=bi.quantity)
      and bool_and(bi.remove_unit_delta is not null and bi.add_unit_delta is not null)
  from public.basket_templates b
  join public.basket_template_items bi on bi.basket_id=b.id
  join public.products p on p.id=bi.product_id
  where b.is_active=true and b.is_whatsapp_active=true
  group by b.id,b.name,b.base_price,b.image_url,b.sort_order
  order by b.sort_order,b.name
$$;

revoke all on function public.get_whatsapp_basket_readiness_v1() from public,anon,authenticated;
grant execute on function public.get_whatsapp_basket_readiness_v1() to service_role;

insert into public.service_guidance_rules(
  rule_key,title,instruction,behavior_tags,channel_scope,intent_scope,stage_scope,priority,status
)
values(
  'basket_commercial_price_policy',
  'Preço comercial das cestas',
  'A cesta básica possui preço comercial próprio. Nunca exponha ao cliente a soma individual dos componentes, margem, custo operacional ou diferença interna. Personalizações devem usar apenas o total comercial calculado pelo backend.',
  array['mvp_whatsapp','basket','pricing'],array['whatsapp'],array[]::text[],array[]::text[],100,'published'
)
on conflict(rule_key) do update set
  title=excluded.title,instruction=excluded.instruction,behavior_tags=excluded.behavior_tags,
  channel_scope=excluded.channel_scope,priority=excluded.priority,status='published',updated_at=now();

insert into public.service_regression_cases(
  case_key,title,customer_message,setup,expected_intent,expected_action,expected_assertions,status,priority
)
values
(
  'basket_price_not_component_sum','Cesta não revela soma dos itens','Quanto dá cada produto dessa cesta?',
  '{}'::jsonb,'answer','knowledge_answer',
  jsonb_build_object('must_not_expose_component_prices',true,'must_use_basket_commercial_total',true),'active',100
),
(
  'basket_personalization_requires_backend_price','Personalização de cesta usa backend','Tira um óleo e coloca mais um arroz',
  jsonb_build_object('basket_cart',true),'update_cart','set_quantity',
  jsonb_build_object('must_not_calculate_in_model',true,'must_use_backend_delta',true),'active',100
),
(
  'basket_unknown_inventory_no_false_confirmation','Cesta sem estoque conferido não confirma automaticamente','Pode fechar essa cesta',
  jsonb_build_object('basket_inventory_ready',false),'checkout','human_handoff',
  jsonb_build_object('must_not_fake_stock',true,'human_fallback_when_inventory_unknown',true),'active',100
)
on conflict(case_key) do update set
  title=excluded.title,customer_message=excluded.customer_message,setup=excluded.setup,
  expected_intent=excluded.expected_intent,expected_action=excluded.expected_action,
  expected_assertions=excluded.expected_assertions,status='active',priority=excluded.priority,updated_at=now();

commit;