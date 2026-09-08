begin;

-- O layout da vitrine é fixo pelo produto (mobile/3 colunas). O Admin controla
-- somente decisões comerciais: categoria disponível, nome exibido e ordem.
alter table public.product_categories
  add column if not exists basket_showcase_enabled boolean not null default true,
  add column if not exists basket_showcase_label text,
  add column if not exists basket_showcase_sort_order integer not null default 100;

update public.product_categories
set basket_showcase_label=coalesce(nullif(trim(basket_showcase_label),''),name)
where basket_showcase_label is null or trim(basket_showcase_label)='';

create or replace view public.admin_product_categories
with (security_invoker=true)
as
select c.id,c.name,c.basket_showcase_enabled,
       coalesce(nullif(trim(c.basket_showcase_label),''),c.name) as basket_showcase_label,
       c.basket_showcase_sort_order,c.created_at,c.updated_at,
       count(p.id) filter(where p.physically_verified=true) as product_count
from public.product_categories c
left join public.products p on lower(trim(coalesce(p.category,'')))=lower(trim(c.name))
group by c.id,c.name,c.basket_showcase_enabled,c.basket_showcase_label,
         c.basket_showcase_sort_order,c.created_at,c.updated_at;
revoke all on public.admin_product_categories from public,anon,authenticated;
grant select on public.admin_product_categories to service_role;

create or replace function public.get_whatsapp_product_categories_v1()
returns table(category text,display_name text,product_count integer,sort_order integer)
language sql stable security definer set search_path=''
as $$
  select pc.name,
         coalesce(nullif(trim(pc.basket_showcase_label),''),pc.name),
         count(p.id)::integer,
         pc.basket_showcase_sort_order
  from public.product_categories pc
  join public.products p on lower(trim(coalesce(p.category,'')))=lower(trim(pc.name))
  where pc.basket_showcase_enabled=true
    and p.physically_verified=true and p.is_active=true
    and p.price is not null and p.price>=0 and coalesce(p.stock,0)>0
  group by pc.id,pc.name,pc.basket_showcase_label,pc.basket_showcase_sort_order
  order by pc.basket_showcase_sort_order,
           coalesce(nullif(trim(pc.basket_showcase_label),''),pc.name),pc.name
$$;

create or replace function public.create_whatsapp_basket_replacement_session_v1(
  p_conversation_id uuid,
  p_source_product_id uuid,
  p_target_query text default null,
  p_categories text[] default '{}'::text[]
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  c public.conversations%rowtype;
  base_s public.catalog_sessions%rowtype;
  swap_s public.catalog_sessions%rowtype;
  src_name text;
  selected text[]:='{}'::text[];
  cat text;
  q text:=trim(coalesce(p_target_query,''));
  cnt integer:=0;
begin
  select * into c from public.conversations where id=p_conversation_id and status<>'closed';
  if not found then raise exception 'conversation_not_found'; end if;
  select * into base_s from public.catalog_sessions
   where conversation_id=c.id and metadata->>'flow'='basket_basic_v1'
   order by created_at desc limit 1;
  if not found then raise exception 'basket_session_required'; end if;

  select p.name into src_name
  from public.catalog_session_items i join public.products p on p.id=i.product_id
  where i.catalog_session_id=base_s.id and i.product_id=p_source_product_id;
  if src_name is null then raise exception 'basket_source_product_not_found'; end if;

  foreach cat in array coalesce(p_categories,'{}'::text[]) loop
    cat:=trim(cat);
    if cat<>'' and exists(select 1 from public.product_categories pc where lower(trim(pc.name))=lower(cat) and pc.basket_showcase_enabled=true)
       and not lower(cat)=any(select lower(x) from unnest(selected) x)
    then selected:=array_append(selected,cat); end if;
  end loop;

  update public.catalog_sessions set status='closed',closed_at=now(),last_activity_at=now()
   where conversation_id=c.id and status='open' and metadata->>'flow'='basket_replace_v1';

  insert into public.catalog_sessions(customer_id,conversation_id,cart_id,kind,title,status,expires_at,metadata,experience,current_view,last_activity_at)
  values(c.customer_id,c.id,base_s.cart_id,'browse','Trocar '||src_name,'open',now()+interval '24 hours',
    jsonb_build_object('flow','basket_replace_v1','parent_basket_session_id',base_s.id,
      'source_product_id',p_source_product_id,'source_product_name',src_name,
      'target_query',nullif(q,''),'categories',to_jsonb(selected)),
    'shopping_room','replacement',now()) returning * into swap_s;

  if q<>'' then
    insert into public.catalog_session_items(catalog_session_id,product_id,rank,reason,recommendation_score,quantity,metadata)
    select swap_s.id,s.id,row_number() over(order by s.score desc,s.name)::integer,
           'Sugestão para substituir '||src_name,s.score,0,
           jsonb_build_object('item_type','replacement_candidate','category',s.category)
    from public.search_whatsapp_sellable_products_v1(q,20) s
    left join public.product_categories pc on lower(trim(pc.name))=lower(trim(coalesce(s.category,'')))
    where s.id<>p_source_product_id and coalesce(pc.basket_showcase_enabled,true)=true
      and (cardinality(selected)=0 or s.category=any(selected));
    get diagnostics cnt=row_count;
  elsif cardinality(selected)>0 then
    insert into public.catalog_session_items(catalog_session_id,product_id,rank,reason,recommendation_score,quantity,metadata)
    select swap_s.id,p.id,row_number() over(order by pc.basket_showcase_sort_order,p.sort_order nulls last,p.name)::integer,
           'Opção para substituir '||src_name,0,0,
           jsonb_build_object('item_type','replacement_candidate','category',p.category)
    from public.products p
    join public.product_categories pc on lower(trim(pc.name))=lower(trim(coalesce(p.category,'')))
    where pc.basket_showcase_enabled=true and p.category=any(selected)
      and p.id<>p_source_product_id and p.physically_verified=true and p.is_active=true
      and p.price is not null and p.price>=0 and coalesce(p.stock,0)>0
    order by pc.basket_showcase_sort_order,p.sort_order nulls last,p.name
    limit 300;
    get diagnostics cnt=row_count;
  end if;

  return jsonb_build_object('session_id',swap_s.id,'token',swap_s.public_token,
    'source_product_id',p_source_product_id,'source_product_name',src_name,
    'target_query',nullif(q,''),'categories',to_jsonb(selected),'item_count',cnt,
    'url','https://donaantonia.com.br/cesta/?t='||swap_s.public_token);
end $$;

create or replace function public.set_whatsapp_basket_replacement_categories_v1(
  p_public_token text,p_categories text[]
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  s public.catalog_sessions%rowtype;
  src uuid;
  src_name text;
  selected text[]:='{}'::text[];
  cat text;
  cnt integer:=0;
begin
  select * into s from public.catalog_sessions
   where public_token=p_public_token and status='open' and expires_at>now()
     and metadata->>'flow'='basket_replace_v1' for update;
  if not found then raise exception 'replacement_session_unavailable'; end if;
  src:=nullif(s.metadata->>'source_product_id','')::uuid;
  src_name:=coalesce(s.metadata->>'source_product_name','produto');
  foreach cat in array coalesce(p_categories,'{}'::text[]) loop
    cat:=trim(cat);
    if cat<>'' and exists(select 1 from public.product_categories pc where lower(trim(pc.name))=lower(cat) and pc.basket_showcase_enabled=true)
       and not lower(cat)=any(select lower(x) from unnest(selected) x)
    then selected:=array_append(selected,cat); end if;
  end loop;
  if cardinality(selected)=0 then raise exception 'categories_required'; end if;
  delete from public.catalog_session_items where catalog_session_id=s.id;
  insert into public.catalog_session_items(catalog_session_id,product_id,rank,reason,recommendation_score,quantity,metadata)
  select s.id,p.id,row_number() over(order by pc.basket_showcase_sort_order,p.sort_order nulls last,p.name)::integer,
         'Opção para substituir '||src_name,0,0,jsonb_build_object('item_type','replacement_candidate','category',p.category)
  from public.products p
  join public.product_categories pc on lower(trim(pc.name))=lower(trim(coalesce(p.category,'')))
  where pc.basket_showcase_enabled=true and p.category=any(selected) and p.id<>src
    and p.physically_verified=true and p.is_active=true and p.price is not null and p.price>=0 and coalesce(p.stock,0)>0
  order by pc.basket_showcase_sort_order,p.sort_order nulls last,p.name limit 300;
  get diagnostics cnt=row_count;
  update public.catalog_sessions set metadata=jsonb_set(metadata,'{categories}',to_jsonb(selected),true),last_activity_at=now() where id=s.id;
  return jsonb_build_object('ok',true,'item_count',cnt,'categories',to_jsonb(selected));
end $$;

create or replace function public.choose_whatsapp_basket_replacement_v1(
  p_public_token text,p_replacement_product_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  s public.catalog_sessions%rowtype;
  parent_id uuid;
  src uuid;
  src_name text;
  repl public.products%rowtype;
  substitution jsonb;
begin
  select * into s from public.catalog_sessions
   where public_token=p_public_token and status='open' and expires_at>now()
     and metadata->>'flow'='basket_replace_v1' for update;
  if not found then raise exception 'replacement_session_unavailable'; end if;
  if not exists(select 1 from public.catalog_session_items where catalog_session_id=s.id and product_id=p_replacement_product_id)
    then raise exception 'replacement_not_in_showcase'; end if;
  select * into repl from public.products where id=p_replacement_product_id and physically_verified=true and is_active=true and coalesce(stock,0)>0;
  if not found then raise exception 'replacement_product_unavailable'; end if;
  parent_id:=nullif(s.metadata->>'parent_basket_session_id','')::uuid;
  src:=nullif(s.metadata->>'source_product_id','')::uuid;
  src_name:=coalesce(s.metadata->>'source_product_name','Produto');
  substitution:=jsonb_build_object('source_product_id',src,'source_name',src_name,
    'replacement_product_id',repl.id,'replacement_name',repl.name,
    'replacement_category',repl.category,'requested_at',now(),
    'commercial_price_unchanged',true,'requires_human_review',true);
  update public.catalog_session_items
    set metadata=metadata||jsonb_build_object('substitution',substitution),updated_at=now()
    where catalog_session_id=parent_id and product_id=src;
  update public.catalog_sessions
    set metadata=metadata||jsonb_build_object('selected_replacement',substitution),current_view='replacement_selected',last_activity_at=now()
    where id=s.id;
  return jsonb_build_object('ok',true,'substitution',substitution,'basket_price_unchanged',true);
end $$;

create or replace function public.enrich_whatsapp_basket_order_substitutions_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
declare enriched jsonb;
begin
  select coalesce(jsonb_agg(
    case when i.metadata ? 'substitution' then e || jsonb_build_object('substitution',i.metadata->'substitution') else e end
    order by ord
  ),'[]'::jsonb)
  into enriched
  from jsonb_array_elements(coalesce(new.basket_selection,'[]'::jsonb)) with ordinality a(e,ord)
  left join public.catalog_session_items i
    on i.catalog_session_id=new.basket_session_id
   and i.product_id=case when coalesce(e->>'product_id','') ~* '^[0-9a-f-]{36}$' then (e->>'product_id')::uuid else null end;
  new.basket_selection:=coalesce(enriched,new.basket_selection);
  return new;
end $$;
drop trigger if exists trg_enrich_whatsapp_basket_order_substitutions_v1 on public.whatsapp_basket_order_requests;
create trigger trg_enrich_whatsapp_basket_order_substitutions_v1
before insert or update of basket_selection on public.whatsapp_basket_order_requests
for each row execute function public.enrich_whatsapp_basket_order_substitutions_v1();

-- Intercepta pedidos de troca antes do worker livre. A troca em si nunca ocorre
-- no WhatsApp: ele somente cria/abre a vitrine externa temporária.
create or replace function public.route_whatsapp_basket_swap_ai_job_v1()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  m public.messages%rowtype;
  txt text;
  norm text;
  bs public.catalog_sessions%rowtype;
  source_part text:='';
  target_part text:='';
  src uuid;
  src_name text;
  swap jsonb;
  reply text;
begin
  if new.job_type<>'conversation' or new.status<>'pending' then return new; end if;
  select * into m from public.messages where id=new.message_id and direction='inbound';
  if not found then return new; end if;
  txt:=trim(coalesce(m.body_text,m.transcript,''));
  norm:=translate(lower(txt),'áàãâäéèêëíìîïóòõôöúùûüç','aaaaaeeeeiiiiooooouuuuc');
  if norm !~ '(^| )(trocar|troca|substituir|substitui|mudar|muda)( |$)' then return new; end if;
  select * into bs from public.catalog_sessions where conversation_id=new.conversation_id and metadata->>'flow'='basket_basic_v1' order by created_at desc limit 1;
  if not found then return new; end if;

  if position(' por ' in norm)>0 then
    source_part:=trim(regexp_replace(split_part(norm,' por ',1),'^.*?(trocar|troca|substituir|substitui|mudar|muda)\s+','','i'));
    target_part:=trim(split_part(norm,' por ',2));
  else
    source_part:=trim(regexp_replace(norm,'^.*?(trocar|troca|substituir|substitui|mudar|muda)\s+','','i'));
  end if;

  if source_part<>'' then
    select i.product_id,p.name into src,src_name
    from public.catalog_session_items i join public.products p on p.id=i.product_id
    where i.catalog_session_id=bs.id
      and translate(lower(p.name),'áàãâäéèêëíìîïóòõôöúùûüç','aaaaaeeeeiiiiooooouuuuc') like '%'||source_part||'%'
    order by length(p.name),i.rank limit 1;
  end if;

  if src is null then
    reply:='A troca é feita na sua cesta, fora do WhatsApp. Abra a cesta e toque em “Trocar” no produto que deseja substituir:\nhttps://donaantonia.com.br/cesta/?t='||bs.public_token;
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'basket_swap_open_showcase',jsonb_build_object('deterministic',true),1);
  else
    swap:=public.create_whatsapp_basket_replacement_session_v1(new.conversation_id,src,nullif(target_part,''),array[]::text[]);
    reply:=case when coalesce((swap->>'item_count')::integer,0)>0
      then 'Entendi a troca de '||src_name||'. Separei as opções na vitrine. Escolha por lá para eu registrar a substituição:\n'||swap->>'url'
      else 'Vamos trocar '||src_name||'. Abra a vitrine, marque a categoria do produto que quer colocar e escolha a opção:\n'||swap->>'url' end;
    perform public.queue_whatsapp_sales_reply_v1(new.conversation_id,m.id,reply,'text',null,null,'basket_swap_showcase',swap,1);
  end if;
  new.status:='done';new.result:=jsonb_build_object('deterministic',true,'action','basket_swap_showcase');new.updated_at:=now();
  return new;
end $$;

drop trigger if exists trg_00_route_whatsapp_basket_swap_v1 on public.ai_jobs;
create trigger trg_00_route_whatsapp_basket_swap_v1
before insert or update of status on public.ai_jobs
for each row execute function public.route_whatsapp_basket_swap_ai_job_v1();

revoke all on function public.get_whatsapp_product_categories_v1() from public,anon,authenticated;
revoke all on function public.create_whatsapp_basket_replacement_session_v1(uuid,uuid,text,text[]) from public,anon,authenticated;
revoke all on function public.set_whatsapp_basket_replacement_categories_v1(text,text[]) from public,anon,authenticated;
revoke all on function public.choose_whatsapp_basket_replacement_v1(text,uuid) from public,anon,authenticated;
revoke all on function public.enrich_whatsapp_basket_order_substitutions_v1() from public,anon,authenticated;
revoke all on function public.route_whatsapp_basket_swap_ai_job_v1() from public,anon,authenticated;
grant execute on function public.get_whatsapp_product_categories_v1() to service_role;
grant execute on function public.create_whatsapp_basket_replacement_session_v1(uuid,uuid,text,text[]) to service_role;
grant execute on function public.set_whatsapp_basket_replacement_categories_v1(text,text[]) to service_role;
grant execute on function public.choose_whatsapp_basket_replacement_v1(text,uuid) to service_role;

commit;