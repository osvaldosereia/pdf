begin;

-- A personalização usa exatamente as categorias reais do cadastro de produtos.
create or replace function public.get_whatsapp_basket_product_categories_v1()
returns table(category text,product_count integer,sort_order integer)
language sql stable security definer set search_path='' as $$
  with c as (
    select trim(p.category) category,count(*)::integer product_count
    from public.products p
    where p.physically_verified=true
      and p.is_active=true
      and p.price is not null
      and p.price>=0
      and coalesce(p.stock,0)>0
      and nullif(trim(coalesce(p.category,'')),'') is not null
    group by trim(p.category)
  )
  select c.category,c.product_count,row_number() over(order by c.category)::integer
  from c order by c.category
$$;

-- A versão anterior recebia p_sections; removemos a assinatura antes de recriar.
drop function if exists public.create_whatsapp_basket_extras_session_v1(uuid,text[]);
create function public.create_whatsapp_basket_extras_session_v1(p_conversation_id uuid,p_categories text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.conversations%rowtype;
  base_s public.catalog_sessions%rowtype;
  extra_s public.catalog_sessions%rowtype;
  normalized text[]:='{}'::text[];
  cat text;
  canonical text;
  cnt integer:=0;
begin
  select * into c from public.conversations where id=p_conversation_id and status<>'closed';
  if not found then raise exception 'conversation_not_found'; end if;

  select * into base_s
  from public.catalog_sessions
  where conversation_id=c.id and metadata->>'flow'='basket_basic_v1'
  order by created_at desc limit 1;
  if not found or base_s.cart_id is null then raise exception 'basket_session_required'; end if;

  foreach cat in array coalesce(p_categories,'{}'::text[]) loop
    select trim(p.category) into canonical
    from public.products p
    where p.physically_verified=true
      and p.is_active=true
      and p.price is not null
      and coalesce(p.stock,0)>0
      and lower(trim(p.category))=lower(trim(cat))
    limit 1;
    if canonical is not null and not canonical=any(normalized) then normalized:=array_append(normalized,canonical); end if;
  end loop;
  if cardinality(normalized)=0 then raise exception 'categories_required'; end if;

  update public.catalog_sessions
     set status='closed',closed_at=now(),last_activity_at=now()
   where conversation_id=c.id and status='open' and metadata->>'flow'='basket_extras_v1';

  insert into public.catalog_sessions(
    customer_id,conversation_id,cart_id,kind,title,status,expires_at,metadata,experience,current_view,last_activity_at
  ) values(
    c.customer_id,c.id,base_s.cart_id,'browse','Adicionar produtos','open',now()+interval '24 hours',
    jsonb_build_object('flow','basket_extras_v1','parent_basket_session_id',base_s.id,'categories',to_jsonb(normalized)),
    'shopping_room','products',now()
  ) returning * into extra_s;

  insert into public.catalog_session_items(
    catalog_session_id,product_id,rank,reason,recommendation_score,quantity,metadata
  )
  select
    extra_s.id,p.id,row_number() over(order by p.category,p.sort_order nulls last,p.name)::integer,
    p.category,0,coalesce(ci.quantity,0),jsonb_build_object('item_type','extra','category',p.category)
  from public.products p
  left join public.cart_items ci
    on ci.cart_id=base_s.cart_id and ci.product_id=p.id and ci.source='addon'
  where p.physically_verified=true
    and p.is_active=true
    and p.price is not null
    and p.price>=0
    and coalesce(p.stock,0)>0
    and p.category=any(normalized)
  order by p.category,p.sort_order nulls last,p.name
  limit 300;
  get diagnostics cnt=row_count;

  return jsonb_build_object(
    'session_id',extra_s.id,
    'token',extra_s.public_token,
    'item_count',cnt,
    'categories',to_jsonb(normalized),
    'url','https://donaantonia.com.br/cesta/?t='||extra_s.public_token
  );
end $$;

-- Respostas fixas do atendimento básico. São avaliadas antes da IA.
create or replace function public.get_whatsapp_basic_policy_reply_v1(p_message text)
returns jsonb
language plpgsql immutable security definer set search_path=''
as $$
declare
  n text:=translate(lower(trim(regexp_replace(coalesce(p_message,''),'\s+',' ','g'))),'áàãâéêíóôõúç','aaaaeeiooouc');
  payment boolean:=false;
  delivery_time boolean:=false;
  delivery_fee boolean:=false;
begin
  payment := n ~ '(forma(s)? de pagamento|como (posso )?pagar|pagamento|cartao|credito|debito|pix|dinheiro|alelo|sodexo|pluxee|puxee|caju|cajur|flash|ifood|boleto|30 dias|trinta dias)';
  delivery_time := n ~ '(que horas|qual horario|horario da entrega|hora da entrega|quando chega|que hora chega|periodo da entrega)';
  delivery_fee := n ~ '(taxa de entrega|frete|cobra entrega|cobram entrega|entrega e gratis|entrega gratis)';

  if payment then
    return jsonb_build_object(
      'matched',true,
      'kind','payment',
      'handoff',false,
      'reply',E'FORMAS DE PAGAMENTO\n\n• Cartão de Crédito em 3x sem juros\n• Cartão de Débito\n• Pix e Dinheiro\n• Cartão Alimentação Alelo, Sodexo, Puxee, Cajur, Flash e Ifood.\n\nPor enquanto não vendemos pra 30 dias ou no Boleto.'
    );
  end if;

  if delivery_fee then
    return jsonb_build_object('matched',true,'kind','delivery_fee','handoff',false,'reply','Não cobramos taxa de entrega.');
  end if;

  if delivery_time then
    return jsonb_build_object(
      'matched',true,
      'kind','delivery_time',
      'handoff',true,
      'reply','As entregas são por rota e o horário depende do bairro. Vou transferir você para o atendimento humano.'
    );
  end if;

  return jsonb_build_object('matched',false);
end $$;

-- Política de entrega: até 11h de Cuiabá = mesmo dia; após 11h = próximo dia útil.
create or replace function public.whatsapp_basket_delivery_promise_v1(p_at timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  local_ts timestamp:=p_at at time zone 'America/Cuiaba';
  d date;
  same_day boolean;
  dow integer;
begin
  same_day:=(local_ts::time<=time '11:00');
  if same_day then
    d:=local_ts::date;
  else
    d:=local_ts::date+1;
    loop
      dow:=extract(isodow from d);
      exit when dow between 1 and 5;
      d:=d+1;
    end loop;
  end if;
  return jsonb_build_object(
    'timezone','America/Cuiaba',
    'cutoff','11:00',
    'same_day',same_day,
    'delivery_date',d,
    'delivery_fee',0,
    'rule',case when same_day then 'same_day_until_11_cuiaba' else 'next_business_day_after_11_cuiaba' end
  );
end $$;

update public.service_guidance_rules
set title='Formas de pagamento',
    instruction='Se perguntarem formas de pagamento, boleto ou 30 dias, responda exatamente: Cartão de Crédito em 3x sem juros; Cartão de Débito; Pix e Dinheiro; Cartão Alimentação Alelo, Sodexo, Puxee, Cajur, Flash e Ifood. Por enquanto não vendemos pra 30 dias ou no Boleto.',
    behavior_tags=array['mvp_whatsapp','payment','fixed_policy'],channel_scope=array['whatsapp'],priority=100,status='published',updated_at=now()
where rule_key='basic_payment_policy';
insert into public.service_guidance_rules(rule_key,title,instruction,behavior_tags,channel_scope,intent_scope,stage_scope,priority,status)
select 'basic_payment_policy','Formas de pagamento','Se perguntarem formas de pagamento, boleto ou 30 dias, responda exatamente: Cartão de Crédito em 3x sem juros; Cartão de Débito; Pix e Dinheiro; Cartão Alimentação Alelo, Sodexo, Puxee, Cajur, Flash e Ifood. Por enquanto não vendemos pra 30 dias ou no Boleto.',array['mvp_whatsapp','payment','fixed_policy'],array['whatsapp'],array[]::text[],array[]::text[],100,'published'
where not exists(select 1 from public.service_guidance_rules where rule_key='basic_payment_policy');

update public.service_guidance_rules
set title='Horário das entregas',
    instruction='Quando perguntarem horário da entrega, diga que as entregas são por rota e o horário depende do bairro; em seguida transfira para atendimento humano. Não prometa horário específico.',
    behavior_tags=array['mvp_whatsapp','delivery','handoff'],channel_scope=array['whatsapp'],priority=100,status='published',updated_at=now()
where rule_key='delivery_time_handoff_policy';
insert into public.service_guidance_rules(rule_key,title,instruction,behavior_tags,channel_scope,intent_scope,stage_scope,priority,status)
select 'delivery_time_handoff_policy','Horário das entregas','Quando perguntarem horário da entrega, diga que as entregas são por rota e o horário depende do bairro; em seguida transfira para atendimento humano. Não prometa horário específico.',array['mvp_whatsapp','delivery','handoff'],array['whatsapp'],array[]::text[],array[]::text[],100,'published'
where not exists(select 1 from public.service_guidance_rules where rule_key='delivery_time_handoff_policy');

update public.service_guidance_rules
set title='Taxa de entrega',instruction='Não cobramos taxa de entrega.',behavior_tags=array['mvp_whatsapp','delivery','free_delivery'],channel_scope=array['whatsapp'],priority=100,status='published',updated_at=now()
where rule_key='free_delivery_policy';
insert into public.service_guidance_rules(rule_key,title,instruction,behavior_tags,channel_scope,intent_scope,stage_scope,priority,status)
select 'free_delivery_policy','Taxa de entrega','Não cobramos taxa de entrega.',array['mvp_whatsapp','delivery','free_delivery'],array['whatsapp'],array[]::text[],array[]::text[],100,'published'
where not exists(select 1 from public.service_guidance_rules where rule_key='free_delivery_policy');

revoke all on function public.get_whatsapp_basket_product_categories_v1() from public,anon,authenticated;
revoke all on function public.create_whatsapp_basket_extras_session_v1(uuid,text[]) from public,anon,authenticated;
revoke all on function public.get_whatsapp_basic_policy_reply_v1(text) from public,anon,authenticated;
grant execute on function public.get_whatsapp_basket_product_categories_v1() to service_role;
grant execute on function public.create_whatsapp_basket_extras_session_v1(uuid,text[]) to service_role;
grant execute on function public.get_whatsapp_basic_policy_reply_v1(text) to service_role;

commit;