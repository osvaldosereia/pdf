begin;

-- Checkout local: a cidade precisa estar explícita para separar Cuiabá de Várzea Grande.
-- Mantém a coleta em uma única mensagem e não cria chamada externa.
create or replace function public.normalize_local_delivery_city_v1(p_city text)
returns text
language sql
immutable
set search_path=''
as $$
  select case translate(lower(trim(coalesce(p_city,''))),'áàãâéêíóôõúç','aaaaeeiooouc')
    when 'cuiaba' then 'Cuiabá'
    when 'varzea grande' then 'Várzea Grande'
    else null
  end
$$;

create or replace function public.get_whatsapp_basket_customer_status_v1(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  c public.conversations%rowtype;
  u public.customers%rowtype;
  a public.customer_addresses%rowtype;
  registered boolean:=false;
begin
  select * into c from public.conversations where id=p_conversation_id;
  if not found then raise exception 'conversation_not_found'; end if;
  if c.customer_id is not null then select * into u from public.customers where id=c.customer_id; end if;
  if u.id is not null then
    select * into a from public.customer_addresses
    where customer_id=u.id and is_active=true
    order by is_default desc,updated_at desc limit 1;
  end if;
  registered:=u.id is not null
    and nullif(trim(coalesce(u.name,'')),'') is not null
    and a.id is not null
    and nullif(trim(coalesce(a.street,'')),'') is not null
    and nullif(trim(coalesce(a.number,'')),'') is not null
    and nullif(trim(coalesce(a.neighborhood,'')),'') is not null
    and public.normalize_local_delivery_city_v1(a.city) is not null;
  return jsonb_build_object(
    'registered',registered,
    'customer',case when u.id is null then null else jsonb_build_object(
      'id',u.id,'name',u.name,'phone',u.primary_whatsapp_e164,'bling_contact_id',u.bling_contact_id
    ) end,
    'address',case when a.id is null then null else jsonb_build_object(
      'id',a.id,'street',a.street,'block',a.complement,'house',a.number,
      'neighborhood',a.neighborhood,'locator',a.reference,'city',a.city,'state',a.state
    ) end
  );
end $$;

-- V2 preserva a assinatura V1 para compatibilidade, mas grava cidade canônica e bloqueia município fora da área de entrega.
create or replace function public.save_whatsapp_basket_customer_v2(
  p_conversation_id uuid,
  p_name text,
  p_street text,
  p_block text,
  p_house text,
  p_neighborhood text,
  p_city text,
  p_locator text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  c public.conversations%rowtype;
  u public.customers%rowtype;
  a public.customer_addresses%rowtype;
  phone text;
  city_canonical text;
begin
  city_canonical:=public.normalize_local_delivery_city_v1(p_city);
  if nullif(trim(coalesce(p_name,'')),'') is null
     or nullif(trim(coalesce(p_street,'')),'') is null
     or nullif(trim(coalesce(p_house,'')),'') is null
     or nullif(trim(coalesce(p_neighborhood,'')),'') is null
     or nullif(trim(coalesce(p_locator,'')),'') is null then
    raise exception 'customer_data_incomplete';
  end if;
  if city_canonical is null then raise exception 'delivery_city_not_supported'; end if;

  select * into c from public.conversations where id=p_conversation_id for update;
  if not found then raise exception 'conversation_not_found'; end if;
  phone:=c.wa_contact_e164;

  if c.customer_id is not null then select * into u from public.customers where id=c.customer_id for update; end if;
  if u.id is null then select * into u from public.customers where primary_whatsapp_e164=phone for update; end if;
  if u.id is null then
    insert into public.customers(name,primary_whatsapp_e164,is_active)
    values(trim(p_name),phone,true) returning * into u;
  else
    update public.customers
       set name=trim(p_name),primary_whatsapp_e164=coalesce(primary_whatsapp_e164,phone),is_active=true,updated_at=now()
     where id=u.id returning * into u;
  end if;
  update public.conversations set customer_id=u.id,updated_at=now() where id=c.id;

  select * into a from public.customer_addresses
  where customer_id=u.id and is_active=true
  order by is_default desc,updated_at desc limit 1 for update;

  if a.id is null then
    insert into public.customer_addresses(
      customer_id,label,street,number,complement,neighborhood,city,state,reference,is_default,is_active,last_confirmed_at
    ) values(
      u.id,'Entrega',trim(p_street),trim(p_house),nullif(trim(coalesce(p_block,'')),''),trim(p_neighborhood),
      city_canonical,'MT',trim(p_locator),true,true,now()
    ) returning * into a;
  else
    update public.customer_addresses
       set street=trim(p_street),number=trim(p_house),complement=nullif(trim(coalesce(p_block,'')),''),
           neighborhood=trim(p_neighborhood),city=city_canonical,state='MT',reference=trim(p_locator),
           is_default=true,is_active=true,last_confirmed_at=now(),updated_at=now()
     where id=a.id returning * into a;
  end if;
  return public.get_whatsapp_basket_customer_status_v1(c.id);
end $$;

create or replace function public.parse_and_save_whatsapp_basket_customer_v1(p_conversation_id uuid,p_text text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  parts text[];
  normalized text:=trim(coalesce(p_text,''));
  city_canonical text;
begin
  normalized:=replace(normalized,';','|');
  parts:=regexp_split_to_array(normalized,'\s*\|\s*');
  if cardinality(parts)<>7 then
    return jsonb_build_object('ok',false,'error','expected_seven_fields');
  end if;
  if exists(select 1 from unnest(parts) x where nullif(trim(x),'') is null) then
    return jsonb_build_object('ok',false,'error','empty_field');
  end if;
  city_canonical:=public.normalize_local_delivery_city_v1(parts[6]);
  if city_canonical is null then
    return jsonb_build_object('ok',false,'error','delivery_city_not_supported','allowed_cities',jsonb_build_array('Cuiabá','Várzea Grande'));
  end if;
  return jsonb_build_object('ok',true,'status',public.save_whatsapp_basket_customer_v2(
    p_conversation_id,trim(parts[1]),trim(parts[2]),trim(parts[3]),trim(parts[4]),trim(parts[5]),city_canonical,trim(parts[7])
  ));
end $$;

create or replace function public.whatsapp_basket_customer_confirm_interactive_v1(p_status jsonb)
returns jsonb
language sql
immutable
set search_path=''
as $$
  select jsonb_build_object(
    'type','button',
    'body',jsonb_build_object('text',left(
      'Confirme seus dados de entrega:'||E'\n\nNome: '||coalesce(p_status->'customer'->>'name','')||
      E'\nRua: '||coalesce(p_status->'address'->>'street','')||
      E'\nQuadra: '||coalesce(p_status->'address'->>'block','')||
      E'\nCasa: '||coalesce(p_status->'address'->>'house','')||
      E'\nBairro: '||coalesce(p_status->'address'->>'neighborhood','')||
      E'\nCidade: '||coalesce(p_status->'address'->>'city','')||
      E'\nLocalizador: '||coalesce(p_status->'address'->>'locator',''),1024)),
    'action',jsonb_build_object('buttons',jsonb_build_array(
      jsonb_build_object('type','reply','reply',jsonb_build_object('id','da_basket_customer_confirm','title','Confirmar dados')),
      jsonb_build_object('type','reply','reply',jsonb_build_object('id','da_basket_customer_change','title','Alterar dados'))
    ))
  )
$$;

-- Atualiza apenas os textos da rota determinística; nenhuma regra de release/canary é tocada.
do $patch$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='route_whatsapp_basic_sales_ai_job_v1'
  limit 1;
  if v_def is null then raise exception 'route_whatsapp_basic_sales_ai_job_v1_not_found'; end if;

  v_new:=replace(v_def,'6 dados','7 dados');
  v_new:=replace(v_new,'Nome | Rua | Quadra | Casa | Bairro | Localizador','Nome | Rua | Quadra | Casa | Bairro | Cidade | Localizador');
  v_new:=replace(v_new,'Maria Silva | Rua A | 12 | 34 | Centro | perto da igreja','Maria Silva | Rua A | 12 | 34 | Centro | Cuiabá | perto da igreja');
  if v_new=v_def then raise exception 'basket_customer_prompt_patch_not_applied'; end if;
  execute v_new;
end
$patch$;

revoke all on function public.normalize_local_delivery_city_v1(text) from public,anon,authenticated;
grant execute on function public.normalize_local_delivery_city_v1(text) to service_role;
revoke all on function public.save_whatsapp_basket_customer_v2(uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.save_whatsapp_basket_customer_v2(uuid,text,text,text,text,text,text,text) to service_role;
revoke all on function public.get_whatsapp_basket_customer_status_v1(uuid) from public,anon,authenticated;
grant execute on function public.get_whatsapp_basket_customer_status_v1(uuid) to service_role;
revoke all on function public.parse_and_save_whatsapp_basket_customer_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.parse_and_save_whatsapp_basket_customer_v1(uuid,text) to service_role;
revoke all on function public.whatsapp_basket_customer_confirm_interactive_v1(jsonb) from public,anon,authenticated;
grant execute on function public.whatsapp_basket_customer_confirm_interactive_v1(jsonb) to service_role;

commit;
