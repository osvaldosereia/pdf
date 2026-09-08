-- Dona Antônia — ponte Motor Comercial -> Experience Orchestrator + lifecycle V1
-- Sem side effects comerciais: planejamento permanece somente leitura.

create or replace function public.plan_sales_experience_v1(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_sales jsonb;
  v_experience jsonb;
  v_action text;
  v_count integer:=0;
begin
  v_sales:=public.plan_next_sales_move(p_conversation_id);
  v_action:=coalesce(v_sales->>'action','none');
  v_count:=case when jsonb_typeof(v_sales->'recommendations')='array' then jsonb_array_length(v_sales->'recommendations') else 0 end;

  if v_action='checkout' then
    v_experience:=public.plan_next_experience_v1(p_conversation_id,'checkout',0,0,false,jsonb_build_object('sales_reason',v_sales->>'reason'));
  elsif v_action='help_choose' then
    v_experience:=public.plan_next_experience_v1(p_conversation_id,'build_purchase',0,0,false,jsonb_build_object('sales_reason',v_sales->>'reason'));
  elsif v_action='offer_suggestions' then
    v_experience:=public.plan_next_experience_v1(p_conversation_id,'upsell',v_count,v_count,false,jsonb_build_object('sales_reason',v_sales->>'reason'));
  else
    v_experience:=public.plan_next_experience_v1(p_conversation_id,'conversation',0,0,false,jsonb_build_object('sales_reason',v_sales->>'reason'));
  end if;

  return jsonb_build_object(
    'ok',true,
    'sales_plan',v_sales,
    'experience_plan',v_experience,
    'side_effects',false
  );
end;
$$;

create or replace function public.mark_experience_session_open_v1(
  p_session_id uuid,
  p_provider_session_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.experience_sessions%rowtype;
  d public.experience_definitions%rowtype;
  v_provider text:=nullif(trim(coalesce(p_provider_session_id,'')),'');
begin
  select * into s from public.experience_sessions where id=p_session_id for update;
  if not found then raise exception 'experience_session_not_found'; end if;
  select * into d from public.experience_definitions where id=s.definition_id;
  if s.status='completed' then return jsonb_build_object('ok',true,'duplicate',true,'session_id',s.id,'status',s.status); end if;
  if s.expires_at<=now() then
    update public.experience_sessions set status='expired',updated_at=now() where id=s.id;
    raise exception 'experience_session_expired';
  end if;
  if s.status not in ('offered','open') then raise exception 'experience_session_not_openable'; end if;
  update public.experience_sessions set status='open',opened_at=coalesce(opened_at,now()),provider_session_id=coalesce(v_provider,provider_session_id),updated_at=now() where id=s.id returning * into s;
  if not exists(select 1 from public.experience_events e where e.session_id=s.id and e.event_type='session_opened') then
    insert into public.experience_events(conversation_id,session_id,definition_id,event_type,interface_type,cohort,event_data)
    select s.conversation_id,s.id,s.definition_id,'session_opened',d.experience_type,c.automation_cohort,'{}'::jsonb from public.conversations c where c.id=s.conversation_id;
  end if;
  return jsonb_build_object('ok',true,'duplicate',false,'session_id',s.id,'status',s.status,'opened_at',s.opened_at);
end;
$$;

create or replace function public.abandon_experience_session_v1(
  p_session_id uuid,
  p_reason text default 'customer_abandoned'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  s public.experience_sessions%rowtype;
  d public.experience_definitions%rowtype;
  v_reason text:=left(trim(coalesce(p_reason,'customer_abandoned')),120);
begin
  select * into s from public.experience_sessions where id=p_session_id for update;
  if not found then raise exception 'experience_session_not_found'; end if;
  select * into d from public.experience_definitions where id=s.definition_id;
  if s.status in ('completed','abandoned','expired') then return jsonb_build_object('ok',true,'duplicate',true,'session_id',s.id,'status',s.status); end if;
  if s.status not in ('offered','open') then raise exception 'experience_session_not_abandonable'; end if;
  update public.experience_sessions set status='abandoned',updated_at=now() where id=s.id returning * into s;
  insert into public.experience_events(conversation_id,session_id,definition_id,event_type,interface_type,cohort,event_data)
  select s.conversation_id,s.id,s.definition_id,'session_abandoned',d.experience_type,c.automation_cohort,jsonb_build_object('reason',v_reason) from public.conversations c where c.id=s.conversation_id;
  return jsonb_build_object('ok',true,'duplicate',false,'session_id',s.id,'status',s.status);
end;
$$;

create or replace function public.expire_experience_sessions_v1()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer:=0;
begin
  with expired as (
    update public.experience_sessions s
       set status='expired',updated_at=now()
     where s.status in ('offered','open') and s.expires_at<=now()
     returning s.id,s.conversation_id,s.definition_id
  ), logged as (
    insert into public.experience_events(conversation_id,session_id,definition_id,event_type,interface_type,cohort,event_data)
    select x.conversation_id,x.id,x.definition_id,'session_expired',d.experience_type,c.automation_cohort,'{}'::jsonb
      from expired x
      join public.experience_definitions d on d.id=x.definition_id
      join public.conversations c on c.id=x.conversation_id
    returning 1
  ) select count(*) into v_count from logged;
  return jsonb_build_object('ok',true,'expired',v_count,'checked_at',now());
end;
$$;

create or replace function public.get_experience_funnel_metrics_v1(
  p_since timestamptz default (now()-interval '7 days')
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'since',p_since,
    'definitions',coalesce(jsonb_agg(jsonb_build_object(
      'slug',d.slug,
      'experience_type',d.experience_type,
      'sessions',coalesce(x.sessions,0),
      'opened',coalesce(x.opened,0),
      'completed',coalesce(x.completed,0),
      'abandoned',coalesce(x.abandoned,0),
      'expired',coalesce(x.expired,0),
      'open_rate',case when coalesce(x.sessions,0)=0 then null else round((x.opened::numeric/x.sessions::numeric)*100,2) end,
      'completion_rate',case when coalesce(x.sessions,0)=0 then null else round((x.completed::numeric/x.sessions::numeric)*100,2) end
    ) order by d.slug),'[]'::jsonb)
  )
  from public.experience_definitions d
  left join lateral (
    select count(*)::int sessions,
      count(*) filter(where s.opened_at is not null)::int opened,
      count(*) filter(where s.status='completed')::int completed,
      count(*) filter(where s.status='abandoned')::int abandoned,
      count(*) filter(where s.status='expired')::int expired
    from public.experience_sessions s
    where s.definition_id=d.id and s.created_at>=p_since
  ) x on true;
$$;

revoke execute on function public.plan_sales_experience_v1(uuid) from public,anon,authenticated;
revoke execute on function public.mark_experience_session_open_v1(uuid,text) from public,anon,authenticated;
revoke execute on function public.abandon_experience_session_v1(uuid,text) from public,anon,authenticated;
revoke execute on function public.expire_experience_sessions_v1() from public,anon,authenticated;
revoke execute on function public.get_experience_funnel_metrics_v1(timestamptz) from public,anon,authenticated;
grant execute on function public.plan_sales_experience_v1(uuid) to service_role;
grant execute on function public.mark_experience_session_open_v1(uuid,text) to service_role;
grant execute on function public.abandon_experience_session_v1(uuid,text) to service_role;
grant execute on function public.expire_experience_sessions_v1() to service_role;
grant execute on function public.get_experience_funnel_metrics_v1(timestamptz) to service_role;
