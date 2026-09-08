begin;

-- MVP comercial do WhatsApp: somente atendimento, venda, personalização, confirmação e Bling.
-- Fonte comercial do catálogo = banco próprio alimentado pelo contador físico.
-- Bling nunca é usado como fonte de nome/preço/estoque/disponibilidade.

alter table public.automation_config
  add column if not exists whatsapp_sales_mvp_enabled boolean not null default false,
  add column if not exists whatsapp_sales_catalog_source text not null default 'counter_verified',
  add column if not exists whatsapp_sales_images_enabled boolean not null default false,
  add column if not exists whatsapp_sales_interactive_enabled boolean not null default false,
  add column if not exists whatsapp_sales_order_submit_enabled boolean not null default false,
  add column if not exists whatsapp_sales_bling_submit_enabled boolean not null default false;

alter table public.automation_config drop constraint if exists automation_config_whatsapp_sales_catalog_source_check;
alter table public.automation_config add constraint automation_config_whatsapp_sales_catalog_source_check
  check (whatsapp_sales_catalog_source='counter_verified');

create table if not exists public.service_intelligence_runtime_config (
  id smallint primary key default 1 check (id=1),
  enabled boolean not null default false,
  execution_mode text not null default 'off' check (execution_mode in ('off','homologation','live')),
  knowledge_enabled boolean not null default false,
  guidance_enabled boolean not null default false,
  procedures_enabled boolean not null default false,
  media_enabled boolean not null default false,
  regression_suite_enabled boolean not null default false,
  max_knowledge_items smallint not null default 12 check (max_knowledge_items between 1 and 30),
  max_guidance_items smallint not null default 8 check (max_guidance_items between 1 and 20),
  max_procedure_items smallint not null default 6 check (max_procedure_items between 1 and 20),
  updated_at timestamptz not null default now()
);
insert into public.service_intelligence_runtime_config(id) values(1) on conflict(id) do nothing;

create table if not exists public.service_knowledge_items (
  id uuid primary key default gen_random_uuid(),
  knowledge_key text not null,
  category text not null,
  title text not null,
  content text not null,
  keywords text[] not null default '{}',
  channel_scope text[] not null default array['whatsapp']::text[],
  status text not null default 'draft' check (status in ('draft','published','archived')),
  priority smallint not null default 50 check (priority between 0 and 100),
  version_no integer not null default 1 check (version_no>0),
  valid_from timestamptz,
  valid_until timestamptz,
  source_note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(knowledge_key,version_no)
);
create index if not exists service_knowledge_published_idx on public.service_knowledge_items(priority desc,updated_at desc) where status='published';

create table if not exists public.service_guidance_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  title text not null,
  instruction text not null,
  intent_scope text[] not null default '{}',
  stage_scope text[] not null default '{}',
  channel_scope text[] not null default array['whatsapp']::text[],
  behavior_tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','published','archived')),
  priority smallint not null default 50 check (priority between 0 and 100),
  version_no integer not null default 1 check (version_no>0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(rule_key,version_no)
);
create index if not exists service_guidance_published_idx on public.service_guidance_rules(priority desc,updated_at desc) where status='published';

create table if not exists public.service_procedures (
  id uuid primary key default gen_random_uuid(),
  procedure_key text not null,
  title text not null,
  trigger_description text not null,
  steps jsonb not null default '[]'::jsonb,
  allowed_actions text[] not null default '{}',
  confirmation_actions text[] not null default '{}',
  fallback text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  priority smallint not null default 50 check (priority between 0 and 100),
  version_no integer not null default 1 check (version_no>0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(procedure_key,version_no)
);
create index if not exists service_procedures_published_idx on public.service_procedures(priority desc,updated_at desc) where status='published';

create table if not exists public.service_media_library (
  id uuid primary key default gen_random_uuid(),
  media_key text not null unique,
  media_type text not null check (media_type in ('product_image','basket_image','image','document')),
  title text not null,
  product_id uuid references public.products(id) on delete set null,
  basket_id uuid references public.basket_templates(id) on delete set null,
  media_url text,
  caption_template text,
  use_when text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_regression_cases (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique,
  title text not null,
  customer_message text not null,
  setup jsonb not null default '{}'::jsonb,
  expected_intent text,
  expected_action text,
  expected_assertions jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','disabled','archived')),
  priority smallint not null default 50 check (priority between 0 and 100),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.service_intelligence_publication_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('knowledge','guidance','procedure','media','regression_case')),
  entity_id uuid not null,
  from_status text,
  to_status text not null,
  actor_user_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.whatsapp_sales_action_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  action_type text not null,
  action_payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  reversible boolean not null default true,
  required_confirmation boolean not null default false,
  confidence numeric(5,4),
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_sales_action_events_conv_idx on public.whatsapp_sales_action_events(conversation_id,created_at desc);

-- Server-only. Admin e workers entram por Edge Functions/RPCs com service_role.
do $$ declare t text; begin
  foreach t in array array[
    'service_intelligence_runtime_config','service_knowledge_items','service_guidance_rules','service_procedures',
    'service_media_library','service_regression_cases','service_intelligence_publication_events','whatsapp_sales_action_events'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on table public.%I to service_role',t);
  end loop;
end $$;

-- Catálogo oficial do atendimento: somente produtos realmente conferidos pelo contador.
create or replace function public.search_whatsapp_sellable_products_v1(p_query text,p_limit integer default 8)
returns table(
  id uuid, sku text, gtin text, name text, brand text, category text, packaging text,
  price numeric, stock numeric, image_url text, gondola text, shelf text, score integer
)
language sql stable security definer set search_path=''
as $$
  with q as (
    select lower(trim(coalesce(p_query,''))) as term, greatest(1,least(coalesce(p_limit,8),20)) as lim
  )
  select p.id,p.sku,p.gtin,p.name,p.brand,p.category,p.packaging,p.price,p.stock,p.image_url,p.gondola,p.shelf,
    case
      when q.term<>'' and lower(coalesce(p.gtin,''))=q.term then 100
      when q.term<>'' and lower(coalesce(p.sku,''))=q.term then 98
      when q.term<>'' and lower(p.name)=q.term then 96
      when q.term<>'' and lower(p.name) like q.term||'%' then 90
      when q.term<>'' and lower(p.name) like '%'||q.term||'%' then 80
      when q.term<>'' and lower(coalesce(p.brand,'')) like '%'||q.term||'%' then 70
      when q.term<>'' and lower(coalesce(p.category,'')) like '%'||q.term||'%' then 60
      else 10
    end as score
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
  order by score desc,p.sort_order nulls last,p.name,p.id
  limit (select lim from q)
$$;

create or replace function public.get_whatsapp_sellable_product_v1(p_product_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
  select case when p.id is null then null else jsonb_build_object(
    'id',p.id,'sku',p.sku,'gtin',p.gtin,'name',p.name,'brand',p.brand,'category',p.category,
    'packaging',p.packaging,'price',p.price,'stock',p.stock,'image_url',p.image_url,
    'description_short',p.description_short,'gondola',p.gondola,'shelf',p.shelf,'source','counter_verified'
  ) end
  from public.products p
  where p.id=p_product_id and p.physically_verified=true and p.is_active=true and p.price is not null and p.price>=0 and coalesce(p.stock,0)>0
$$;

create or replace function public.ensure_whatsapp_sales_cart_v1(p_conversation_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare c public.conversations%rowtype; k public.carts%rowtype;
begin
  select * into c from public.conversations where id=p_conversation_id and status<>'closed' for update;
  if not found then raise exception 'conversation_not_found'; end if;
  select * into k from public.carts where conversation_id=c.id and status='draft' order by updated_at desc limit 1 for update;
  if not found then
    insert into public.carts(conversation_id,customer_id,status,base_commercial_price,total,expires_at)
    values(c.id,c.customer_id,'draft',0,0,now()+interval '24 hours') returning * into k;
  end if;
  return jsonb_build_object('cart_id',k.id,'total',k.total,'version',k.version,'basket_id',k.basket_id);
end $$;

create or replace function public.set_whatsapp_sales_product_quantity_v1(p_conversation_id uuid,p_product_id uuid,p_quantity numeric)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare k uuid; p public.products%rowtype; existing public.cart_items%rowtype; result jsonb;
begin
  if p_quantity is null or p_quantity<0 or p_quantity>999 then raise exception 'invalid_quantity'; end if;
  select * into p from public.products where id=p_product_id and physically_verified=true and is_active=true and price is not null and price>=0 and coalesce(stock,0)>0;
  if not found then raise exception 'product_not_available'; end if;
  if p_quantity>coalesce(p.stock,0) then raise exception 'insufficient_stock'; end if;
  k:=nullif(public.ensure_whatsapp_sales_cart_v1(p_conversation_id)->>'cart_id','')::uuid;
  select * into existing from public.cart_items where cart_id=k and product_id=p_product_id and source='addon' limit 1 for update;
  if p_quantity=0 then
    if found then delete from public.cart_items where id=existing.id; end if;
  elsif found then
    update public.cart_items set quantity=p_quantity,unit_price=p.price,line_total=p_quantity*p.price,commercial_unit_price=p.price,updated_at=now() where id=existing.id;
  else
    insert into public.cart_items(cart_id,product_id,source,quantity,unit_price,line_total,commercial_unit_price,metadata)
    values(k,p.id,'addon',p_quantity,p.price,p_quantity*p.price,p.price,jsonb_build_object('source','whatsapp_sales_mvp','catalog_source','counter_verified'));
  end if;
  result:=public.recalculate_cart(k);
  update public.conversations set stage='customizing',updated_at=now() where id=p_conversation_id;
  return result||jsonb_build_object('product_id',p.id,'product_name',p.name,'quantity',p_quantity);
end $$;

create or replace function public.add_whatsapp_sales_product_v1(p_conversation_id uuid,p_product_id uuid,p_quantity numeric default 1)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare k uuid; current_qty numeric:=0;
begin
  if p_quantity is null or p_quantity<=0 then raise exception 'invalid_quantity'; end if;
  k:=nullif(public.ensure_whatsapp_sales_cart_v1(p_conversation_id)->>'cart_id','')::uuid;
  select quantity into current_qty from public.cart_items where cart_id=k and product_id=p_product_id and source='addon' limit 1;
  return public.set_whatsapp_sales_product_quantity_v1(p_conversation_id,p_product_id,coalesce(current_qty,0)+p_quantity);
end $$;

create or replace function public.replace_whatsapp_sales_product_v1(
  p_conversation_id uuid,p_original_product_id uuid,p_replacement_product_id uuid,p_customer_confirmed boolean default false
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare k uuid; old_item public.cart_items%rowtype; target public.products%rowtype; group_code text; group_id uuid; result jsonb;
begin
  if p_original_product_id=p_replacement_product_id then raise exception 'same_product'; end if;
  k:=nullif(public.ensure_whatsapp_sales_cart_v1(p_conversation_id)->>'cart_id','')::uuid;
  select * into old_item from public.cart_items where cart_id=k and product_id=p_original_product_id and quantity>0 limit 1 for update;
  if not found then raise exception 'original_product_not_in_cart'; end if;
  select * into target from public.products where id=p_replacement_product_id and physically_verified=true and is_active=true and price is not null and price>=0 and coalesce(stock,0)>=old_item.quantity;
  if not found then raise exception 'replacement_product_not_available'; end if;

  if old_item.source='addon' then
    delete from public.cart_items where id=old_item.id;
    insert into public.cart_items(cart_id,product_id,source,quantity,unit_price,line_total,commercial_unit_price,metadata)
    values(k,target.id,'addon',old_item.quantity,target.price,old_item.quantity*target.price,target.price,
      old_item.metadata||jsonb_build_object('replaced_product_id',p_original_product_id,'source','whatsapp_sales_mvp'));
  else
    if not coalesce(p_customer_confirmed,false) then raise exception 'basket_substitution_confirmation_required'; end if;
    group_code:=nullif(old_item.metadata->>'substitution_group','');
    if group_code is null then raise exception 'basket_substitution_not_configured'; end if;
    select g.id into group_id from public.substitution_groups g where g.code=group_code and g.status='active' order by g.version_no desc limit 1;
    if group_id is null or not exists(select 1 from public.substitution_group_items gi where gi.group_id=group_id and gi.product_id=target.id and gi.status='active') then
      raise exception 'replacement_not_allowed_for_basket';
    end if;
    update public.cart_items set product_id=target.id,source='substitution',unit_price=target.price,line_total=quantity*target.price,
      metadata=metadata||jsonb_build_object('replaced_product_id',p_original_product_id,'substitution_group_id',group_id,'customer_confirmed',true),updated_at=now()
    where id=old_item.id;
  end if;
  result:=public.recalculate_cart(k);
  return result||jsonb_build_object('original_product_id',p_original_product_id,'replacement_product_id',target.id,'replacement_name',target.name);
end $$;

create or replace function public.get_whatsapp_sales_cart_v1(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare k public.carts%rowtype; items jsonb;
begin
  select * into k from public.carts where conversation_id=p_conversation_id and status='draft' order by updated_at desc limit 1;
  if not found then return jsonb_build_object('exists',false,'items','[]'::jsonb,'total',0); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'product_id',ci.product_id,'name',p.name,'sku',p.sku,'quantity',ci.quantity,
    'unit_price',case when ci.source='basket' then null else ci.unit_price end,
    'line_total',case when ci.source='basket' then null else ci.line_total end,
    'source',ci.source,'image_url',p.image_url
  ) order by ci.created_at),'[]'::jsonb) into items
  from public.cart_items ci join public.products p on p.id=ci.product_id where ci.cart_id=k.id and ci.quantity>0;
  return jsonb_build_object('exists',true,'cart_id',k.id,'basket_id',k.basket_id,'items',items,'total',k.total,
    'fiscal_subtotal',k.fiscal_subtotal,'other_expenses',k.other_expenses,'discount',k.discount,'version',k.version,'pricing_status',k.pricing_status);
end $$;

create or replace function public.get_service_intelligence_bundle_v1(p_channel text default 'whatsapp',p_intent text default null,p_stage text default null)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare cfg public.service_intelligence_runtime_config%rowtype; k jsonb:='[]'::jsonb; g jsonb:='[]'::jsonb; p jsonb:='[]'::jsonb;
begin
  select * into cfg from public.service_intelligence_runtime_config where id=1;
  if not found or not cfg.enabled or cfg.execution_mode='off' then
    return jsonb_build_object('enabled',false,'knowledge','[]'::jsonb,'guidance','[]'::jsonb,'procedures','[]'::jsonb);
  end if;
  if cfg.knowledge_enabled then
    select coalesce(jsonb_agg(jsonb_build_object('key',x.knowledge_key,'category',x.category,'title',x.title,'content',x.content) order by x.priority desc,x.updated_at desc),'[]'::jsonb) into k
    from (select * from public.service_knowledge_items where status='published' and p_channel=any(channel_scope) and (valid_from is null or valid_from<=now()) and (valid_until is null or valid_until>now()) order by priority desc,updated_at desc limit cfg.max_knowledge_items) x;
  end if;
  if cfg.guidance_enabled then
    select coalesce(jsonb_agg(jsonb_build_object('key',x.rule_key,'title',x.title,'instruction',x.instruction,'behavior_tags',x.behavior_tags) order by x.priority desc,x.updated_at desc),'[]'::jsonb) into g
    from (select * from public.service_guidance_rules where status='published' and p_channel=any(channel_scope)
      and (cardinality(intent_scope)=0 or p_intent is null or p_intent=any(intent_scope))
      and (cardinality(stage_scope)=0 or p_stage is null or p_stage=any(stage_scope))
      order by priority desc,updated_at desc limit cfg.max_guidance_items) x;
  end if;
  if cfg.procedures_enabled then
    select coalesce(jsonb_agg(jsonb_build_object('key',x.procedure_key,'title',x.title,'trigger',x.trigger_description,'steps',x.steps,'allowed_actions',x.allowed_actions,'confirmation_actions',x.confirmation_actions,'fallback',x.fallback) order by x.priority desc,x.updated_at desc),'[]'::jsonb) into p
    from (select * from public.service_procedures where status='published' order by priority desc,updated_at desc limit cfg.max_procedure_items) x;
  end if;
  return jsonb_build_object('enabled',true,'execution_mode',cfg.execution_mode,'knowledge',k,'guidance',g,'procedures',p);
end $$;

create or replace function public.build_whatsapp_sales_context_v1(p_conversation_id uuid,p_message_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare c public.conversations%rowtype; m public.messages%rowtype; customer jsonb; history jsonb; products jsonb; cart jsonb; intelligence jsonb; q text;
begin
  select * into c from public.conversations where id=p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  select * into m from public.messages where id=p_message_id and conversation_id=c.id;
  if not found then raise exception 'message_not_found'; end if;
  q:=left(coalesce(m.body_text,m.transcript,''),120);
  select case when u.id is null then null else jsonb_build_object('id',u.id,'name',u.name,'phone',u.primary_whatsapp_e164,'preferred_reply',u.preferred_reply,'order_count',u.order_count,'last_order_at',u.last_order_at) end into customer from public.customers u where u.id=c.customer_id;
  select coalesce(jsonb_agg(jsonb_build_object('direction',x.direction,'type',x.message_type,'text',left(coalesce(x.body_text,x.transcript,''),500),'at',x.created_at) order by x.created_at),'[]'::jsonb) into history
  from (select direction,message_type,body_text,transcript,created_at from public.messages where conversation_id=c.id order by created_at desc limit 12) x;
  select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) into products from public.search_whatsapp_sellable_products_v1(q,8) s;
  cart:=public.get_whatsapp_sales_cart_v1(c.id);
  intelligence:=public.get_service_intelligence_bundle_v1('whatsapp',null,c.stage);
  return jsonb_build_object(
    'conversation',jsonb_build_object('id',c.id,'stage',c.stage,'mode',c.mode,'service_window_expires_at',c.service_window_expires_at,'fast_checkout',c.fast_checkout,'upsell_declined',c.upsell_declined),
    'message',jsonb_build_object('id',m.id,'type',m.message_type,'text',coalesce(m.body_text,m.transcript,''),'raw_event',m.raw_event),
    'customer',customer,'cart',cart,'product_candidates',products,'history',history,'intelligence',intelligence,
    'catalog_source','counter_verified'
  );
end $$;

revoke all on function public.search_whatsapp_sellable_products_v1(text,integer) from public,anon,authenticated;
revoke all on function public.get_whatsapp_sellable_product_v1(uuid) from public,anon,authenticated;
revoke all on function public.ensure_whatsapp_sales_cart_v1(uuid) from public,anon,authenticated;
revoke all on function public.set_whatsapp_sales_product_quantity_v1(uuid,uuid,numeric) from public,anon,authenticated;
revoke all on function public.add_whatsapp_sales_product_v1(uuid,uuid,numeric) from public,anon,authenticated;
revoke all on function public.replace_whatsapp_sales_product_v1(uuid,uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.get_whatsapp_sales_cart_v1(uuid) from public,anon,authenticated;
revoke all on function public.get_service_intelligence_bundle_v1(text,text,text) from public,anon,authenticated;
revoke all on function public.build_whatsapp_sales_context_v1(uuid,uuid) from public,anon,authenticated;

grant execute on function public.search_whatsapp_sellable_products_v1(text,integer) to service_role;
grant execute on function public.get_whatsapp_sellable_product_v1(uuid) to service_role;
grant execute on function public.ensure_whatsapp_sales_cart_v1(uuid) to service_role;
grant execute on function public.set_whatsapp_sales_product_quantity_v1(uuid,uuid,numeric) to service_role;
grant execute on function public.add_whatsapp_sales_product_v1(uuid,uuid,numeric) to service_role;
grant execute on function public.replace_whatsapp_sales_product_v1(uuid,uuid,uuid,boolean) to service_role;
grant execute on function public.get_whatsapp_sales_cart_v1(uuid) to service_role;
grant execute on function public.get_service_intelligence_bundle_v1(text,text,text) to service_role;
grant execute on function public.build_whatsapp_sales_context_v1(uuid,uuid) to service_role;

commit;
