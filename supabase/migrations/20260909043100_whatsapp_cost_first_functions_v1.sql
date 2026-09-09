begin;

create or replace function public.normalize_service_text_v1(p_text text)
returns text
language sql
immutable
parallel safe
set search_path=''
as $$
  select trim(regexp_replace(
    translate(lower(coalesce(p_text,'')),
      'áàãâäéèêëíìîïóòõôöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+',' ','g'))
$$;

-- Resolvedor local: prioriza SKU/GTIN/nome/alias e usa sobreposição de termos.
-- Não inventa produto: somente produtos counter_verified, ativos e com estoque.
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
    select coalesce(public.normalize_service_text_v1((select canonical_query from alias_rewrite)),raw.raw_term) term,
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
        least(86, 45 + 12 * (
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
         s.final_score,
         round((s.final_score::numeric/100),4),
         s.reason
  from scored s
  where s.final_score>=55
  order by s.final_score desc,s.sort_order nulls last,s.name,s.id
  limit (select lim from q)
$$;

create or replace function public.get_service_intelligence_bundle_v2(
  p_channel text default 'whatsapp',
  p_intent text default null,
  p_stage text default null,
  p_topic text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  cfg public.service_intelligence_runtime_config%rowtype;
  k jsonb:='[]'::jsonb;
  core jsonb:='[]'::jsonb;
  dyn jsonb:='[]'::jsonb;
  procs jsonb:='[]'::jsonb;
  max_core integer:=10;
  max_dyn integer:=8;
  max_k integer:=8;
  max_p integer:=4;
begin
  select * into cfg from public.service_intelligence_runtime_config where id=1;
  if not found or not cfg.enabled or cfg.execution_mode='off' then
    return jsonb_build_object('enabled',false,'knowledge','[]'::jsonb,'core_guidance','[]'::jsonb,'guidance','[]'::jsonb,'procedures','[]'::jsonb,'selection','off');
  end if;

  max_core:=greatest(1,least(coalesce(cfg.max_core_guidance_items,10),20));
  max_dyn:=greatest(1,least(coalesce(cfg.max_dynamic_guidance_items,8),20));
  max_k:=greatest(1,least(coalesce(cfg.max_dynamic_knowledge_items,8),20));
  max_p:=greatest(1,least(coalesce(cfg.max_dynamic_procedure_items,4),12));

  if cfg.knowledge_enabled then
    select coalesce(jsonb_agg(jsonb_build_object(
      'key',x.knowledge_key,'category',x.category,'title',x.title,'content',x.content
    ) order by x.priority desc,x.updated_at desc),'[]'::jsonb)
    into k
    from (
      select * from public.service_knowledge_items
      where status='published'
        and p_channel=any(channel_scope)
        and (valid_from is null or valid_from<=now())
        and (valid_until is null or valid_until>now())
        and (
          p_topic is null
          or public.normalize_service_text_v1(category)=public.normalize_service_text_v1(p_topic)
          or exists(select 1 from unnest(keywords) kw where public.normalize_service_text_v1(p_topic) like '%'||public.normalize_service_text_v1(kw)||'%' or public.normalize_service_text_v1(kw) like '%'||public.normalize_service_text_v1(p_topic)||'%')
          or priority>=95
        )
      order by
        case when p_topic is not null and public.normalize_service_text_v1(category)=public.normalize_service_text_v1(p_topic) then 0 else 1 end,
        priority desc,updated_at desc
      limit max_k
    ) x;
  end if;

  if cfg.guidance_enabled then
    select coalesce(jsonb_agg(jsonb_build_object(
      'key',x.rule_key,'title',x.title,'instruction',x.instruction,'behavior_tags',x.behavior_tags,'scope','core'
    ) order by x.priority desc,x.updated_at desc),'[]'::jsonb)
    into core
    from (
      select * from public.service_guidance_rules
      where status='published'
        and p_channel=any(channel_scope)
        and cardinality(intent_scope)=0
        and cardinality(stage_scope)=0
        and behavior_tags && array['core','cordiality','trust','safety','brand','name','identity','minimal_interactions','customer_effort']::text[]
      order by priority desc,updated_at desc
      limit max_core
    ) x;

    select coalesce(jsonb_agg(jsonb_build_object(
      'key',x.rule_key,'title',x.title,'instruction',x.instruction,'behavior_tags',x.behavior_tags,'scope','dynamic'
    ) order by x.priority desc,x.updated_at desc),'[]'::jsonb)
    into dyn
    from (
      select g.* from public.service_guidance_rules g
      where g.status='published'
        and p_channel=any(g.channel_scope)
        and not (g.behavior_tags && array['core','cordiality','trust','safety','brand','name','identity','minimal_interactions','customer_effort']::text[] and cardinality(g.intent_scope)=0 and cardinality(g.stage_scope)=0)
        and (
          (p_intent is not null and p_intent=any(g.intent_scope))
          or (p_stage is not null and p_stage=any(g.stage_scope))
          or (cardinality(g.intent_scope)=0 and cardinality(g.stage_scope)=0 and g.priority>=98)
        )
      order by
        case when p_intent is not null and p_intent=any(g.intent_scope) then 0 when p_stage is not null and p_stage=any(g.stage_scope) then 1 else 2 end,
        g.priority desc,g.updated_at desc
      limit max_dyn
    ) x;
  end if;

  if cfg.procedures_enabled then
    select coalesce(jsonb_agg(jsonb_build_object(
      'key',x.procedure_key,'title',x.title,'trigger',x.trigger_description,'steps',x.steps,
      'allowed_actions',x.allowed_actions,'confirmation_actions',x.confirmation_actions,'fallback',x.fallback
    ) order by x.priority desc,x.updated_at desc),'[]'::jsonb)
    into procs
    from (
      select p.* from public.service_procedures p
      where p.status='published'
        and (
          (p_intent is not null and p_intent=any(p.intent_scope))
          or (p_stage is not null and p_stage=any(p.stage_scope))
          or (cardinality(p.intent_scope)=0 and cardinality(p.stage_scope)=0 and p.priority>=98)
        )
      order by
        case when p_intent is not null and p_intent=any(p.intent_scope) then 0 when p_stage is not null and p_stage=any(p.stage_scope) then 1 else 2 end,
        p.priority desc,p.updated_at desc
      limit max_p
    ) x;
  end if;

  return jsonb_build_object(
    'enabled',true,
    'knowledge',k,
    'core_guidance',core,
    'guidance',dyn,
    'procedures',procs,
    'selection',jsonb_build_object('channel',p_channel,'intent',p_intent,'stage',p_stage,'topic',p_topic,'mode','core_plus_dynamic')
  );
end
$$;

create or replace function public.get_service_trigger_match_v1(
  p_channel text,
  p_text text,
  p_stage text default null,
  p_mode text default 'ai',
  p_conversation_id uuid default null,
  p_intent text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  cfg public.service_intelligence_runtime_config%rowtype;
  r public.service_trigger_rules%rowtype;
  b public.service_message_blocks%rowtype;
  ntext text:=public.normalize_service_text_v1(p_text);
begin
  select * into cfg from public.service_intelligence_runtime_config where id=1;
  if not found or not cfg.enabled or not coalesce(cfg.trigger_engine_enabled,false) then
    return jsonb_build_object('matched',false,'reason','trigger_engine_disabled');
  end if;

  select t.* into r
  from public.service_trigger_rules t
  where t.status='published'
    and coalesce(p_channel,'whatsapp')=any(t.channel_scope)
    and (not t.requires_ai_mode or coalesce(p_mode,'ai')='ai')
    and (cardinality(t.intent_scope)=0 or (p_intent is not null and p_intent=any(t.intent_scope)))
    and (cardinality(t.stage_scope)=0 or (p_stage is not null and p_stage=any(t.stage_scope)))
    and (
      t.match_mode='always'
      or (t.match_mode='stage' and p_stage is not null and p_stage=any(t.patterns))
      or (t.match_mode='exact' and exists(select 1 from unnest(t.patterns) pat where ntext=public.normalize_service_text_v1(pat)))
      or (t.match_mode='contains' and exists(select 1 from unnest(t.patterns) pat where length(public.normalize_service_text_v1(pat))>=3 and ntext like '%'||public.normalize_service_text_v1(pat)||'%'))
      or (t.match_mode='regex' and exists(select 1 from unnest(t.patterns) pat where coalesce(p_text,'') ~* pat))
    )
    and (
      not t.once_per_conversation
      or p_conversation_id is null
      or not exists(select 1 from public.service_trigger_events e where e.conversation_id=p_conversation_id and e.trigger_key=t.trigger_key and e.execution_mode='deterministic')
    )
    and (
      t.cooldown_seconds=0
      or p_conversation_id is null
      or not exists(select 1 from public.service_trigger_events e where e.conversation_id=p_conversation_id and e.trigger_key=t.trigger_key and e.created_at>now()-make_interval(secs=>t.cooldown_seconds))
    )
  order by t.priority desc,t.updated_at desc,t.id
  limit 1;

  if not found then return jsonb_build_object('matched',false,'reason','no_trigger_match'); end if;

  if r.message_block_key is not null then
    select * into b from public.service_message_blocks where block_key=r.message_block_key and status='published';
  end if;

  return jsonb_build_object(
    'matched',true,
    'trigger',jsonb_build_object(
      'id',r.id,'key',r.trigger_key,'title',r.title,'action_type',r.action_type,
      'action_payload',r.action_payload,'priority',r.priority,'stop_on_match',r.stop_on_match
    ),
    'block',case when b.id is null then null else jsonb_build_object(
      'id',b.id,'key',b.block_key,'title',b.title,'body_template',b.body_template,
      'delivery_mode',b.delivery_mode,'image_url_template',b.image_url_template,
      'interactive_template',b.interactive_template,'variables',b.variables
    ) end
  );
end
$$;

create or replace function public.record_service_trigger_event_v1(
  p_conversation_id uuid,
  p_message_id uuid,
  p_trigger_id uuid,
  p_trigger_key text,
  p_action_type text,
  p_execution_mode text,
  p_result jsonb default '{}'::jsonb,
  p_estimated_ai_calls_saved numeric default 0,
  p_estimated_input_tokens_avoided integer default 0
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_id uuid;
begin
  if p_execution_mode not in ('deterministic','shadow','fallback_ai') then raise exception 'invalid_execution_mode'; end if;
  insert into public.service_trigger_events(
    conversation_id,message_id,trigger_id,trigger_key,action_type,execution_mode,result,
    estimated_ai_calls_saved,estimated_input_tokens_avoided
  ) values(
    p_conversation_id,p_message_id,p_trigger_id,left(coalesce(p_trigger_key,''),100),left(coalesce(p_action_type,'reply'),80),p_execution_mode,
    coalesce(p_result,'{}'::jsonb),coalesce(p_estimated_ai_calls_saved,0),greatest(0,coalesce(p_estimated_input_tokens_avoided,0))
  ) returning id into v_id;
  return v_id;
end
$$;

create or replace function public.get_whatsapp_cost_first_preflight_v1(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  cfg public.automation_config%rowtype;
  j public.ai_jobs%rowtype;
  c public.conversations%rowtype;
  m public.messages%rowtype;
  customer jsonb;
  trig jsonb;
  candidates jsonb:='[]'::jsonb;
  ntext text;
  first_name text;
begin
  select * into cfg from public.automation_config where id=1;
  select * into j from public.ai_jobs where id=p_job_id;
  if not found then return jsonb_build_object('eligible',false,'reason','job_not_found'); end if;
  if j.job_type not in ('conversation','vision') then return jsonb_build_object('eligible',false,'reason','unsupported_job_type'); end if;
  select * into c from public.conversations where id=j.conversation_id;
  select * into m from public.messages where id=j.message_id and conversation_id=j.conversation_id;
  if c.id is null or m.id is null then return jsonb_build_object('eligible',false,'reason','context_missing'); end if;

  select case when u.id is null then null else jsonb_build_object(
    'id',u.id,'name',u.name,'phone',u.primary_whatsapp_e164,'preferred_reply',u.preferred_reply,
    'order_count',u.order_count,'last_order_at',u.last_order_at
  ) end,
  case when u.id is null then null else nullif(split_part(trim(coalesce(u.name,'')),' ',1),'') end
  into customer,first_name
  from public.customers u where u.id=c.customer_id;

  ntext:=public.normalize_service_text_v1(coalesce(m.body_text,m.transcript,''));
  trig:=public.get_service_trigger_match_v1('whatsapp',coalesce(m.body_text,m.transcript,''),c.stage,c.mode,c.id,null);

  select coalesce(jsonb_agg(to_jsonb(x) order by x.score desc,x.name),'[]'::jsonb)
  into candidates
  from public.resolve_whatsapp_product_candidates_v2(coalesce(m.body_text,m.transcript,''),8) x;

  return jsonb_build_object(
    'eligible',coalesce(cfg.whatsapp_cost_first_router_enabled,false),
    'shadow_mode',coalesce(cfg.whatsapp_cost_first_shadow_mode,true),
    'conversation',jsonb_build_object('id',c.id,'stage',c.stage,'mode',c.mode,'status',c.status),
    'message',jsonb_build_object('id',m.id,'type',m.message_type,'text',coalesce(m.body_text,m.transcript,''),'normalized',ntext,'interactive',coalesce(m.ai_interpretation,'{}'::jsonb)),
    'customer',customer,
    'first_name',first_name,
    'trigger',trig,
    'product_candidates',candidates
  );
end
$$;

commit;
