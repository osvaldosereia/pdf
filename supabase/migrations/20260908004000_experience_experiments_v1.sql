-- Dona Antônia — Experimentos de Experiência V1
-- Fundação para IA sem Flow vs IA + Flow. Todos os experimentos nascem DRAFT / allocation 0.

create table if not exists public.experience_experiments (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  objective text not null,
  status text not null default 'draft',
  allocation_percent smallint not null default 0,
  variants jsonb not null,
  eligibility jsonb not null default '{}'::jsonb,
  success_metrics jsonb not null default '[]'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint experience_experiment_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{2,100}$'),
  constraint experience_experiment_status_check check (status in ('draft','running','paused','completed','cancelled')),
  constraint experience_experiment_allocation_check check (allocation_percent between 0 and 100),
  constraint experience_experiment_variants_check check (jsonb_typeof(variants)='array' and jsonb_array_length(variants)>=2)
);

create table if not exists public.experience_experiment_assignments (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experience_experiments(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  bucket smallint not null,
  variant text not null,
  assigned_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique(experiment_id,conversation_id),
  constraint experience_experiment_assignment_bucket_check check (bucket between 0 and 99),
  constraint experience_experiment_assignment_variant_check check (variant ~ '^[a-z0-9_]{1,80}$')
);

create index if not exists idx_experience_experiment_assignments_conversation on public.experience_experiment_assignments(conversation_id,assigned_at desc);
create index if not exists idx_experience_experiment_assignments_variant on public.experience_experiment_assignments(experiment_id,variant,assigned_at desc);

insert into public.experience_experiments(slug,name,objective,status,allocation_percent,variants,eligibility,success_metrics)
values(
  'basket-flow-vs-conversation-v1',
  'Personalização de cesta: conversa vs Flow',
  'Medir se o WhatsApp Flow reduz atrito e custo sem prejudicar conversão ou satisfação.',
  'draft',0,
  jsonb_build_array(
    jsonb_build_object('key','conversation_control','interface','conversation','weight',50),
    jsonb_build_object('key','flow_treatment','interface','whatsapp_flow','feature_key','flow_personalize_basket','weight',50)
  ),
  jsonb_build_object('channel','whatsapp','task','basket_customize'),
  jsonb_build_array('flow_open_rate','flow_completion_rate','order_conversion','time_to_order','messages_to_order','ticket_average','human_handoff_rate','ai_tokens_per_order')
)
on conflict(slug) do nothing;

create or replace function public.preview_experience_experiment_v1(
  p_experiment_slug text,
  p_conversation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  e public.experience_experiments%rowtype;
  c public.conversations%rowtype;
  v_bucket smallint;
  v_variants jsonb;
  v_total numeric:=0;
  v_cursor numeric:=0;
  v_target numeric:=0;
  v_variant jsonb;
  v_variant_key text;
  v_eligible boolean:=false;
  v_reason text:='not_running';
begin
  select * into e from public.experience_experiments where slug=p_experiment_slug;
  if not found then return jsonb_build_object('eligible',false,'reason','experiment_unknown'); end if;
  select * into c from public.conversations where id=p_conversation_id;
  if not found then return jsonb_build_object('eligible',false,'reason','conversation_not_found','experiment',e.slug); end if;
  v_bucket:=mod(abs(pg_catalog.hashtext(p_conversation_id::text||':'||e.slug)::bigint),100)::smallint;
  if e.status<>'running' then
    return jsonb_build_object('eligible',false,'reason','experiment_not_running','experiment',e.slug,'status',e.status,'bucket',v_bucket,'allocation_percent',e.allocation_percent);
  end if;
  if e.starts_at is not null and now()<e.starts_at then
    return jsonb_build_object('eligible',false,'reason','experiment_not_started','experiment',e.slug,'bucket',v_bucket);
  end if;
  if e.ends_at is not null and now()>=e.ends_at then
    return jsonb_build_object('eligible',false,'reason','experiment_ended','experiment',e.slug,'bucket',v_bucket);
  end if;
  if c.human_required or c.mode='human' then
    return jsonb_build_object('eligible',false,'reason','human_takeover','experiment',e.slug,'bucket',v_bucket);
  end if;
  if e.allocation_percent<=0 or v_bucket>=e.allocation_percent then
    return jsonb_build_object('eligible',false,'reason','outside_allocation','experiment',e.slug,'bucket',v_bucket,'allocation_percent',e.allocation_percent);
  end if;
  if coalesce(e.eligibility->>'channel','')<>'' and e.eligibility->>'channel'<>'any' and c.channel<>e.eligibility->>'channel' then
    return jsonb_build_object('eligible',false,'reason','channel_not_eligible','experiment',e.slug,'bucket',v_bucket);
  end if;

  v_variants:=e.variants;
  select coalesce(sum(greatest(0,coalesce((x->>'weight')::numeric,0))),0) into v_total from jsonb_array_elements(v_variants) x;
  if v_total<=0 then return jsonb_build_object('eligible',false,'reason','invalid_variant_weights','experiment',e.slug,'bucket',v_bucket); end if;
  v_target:=mod(abs(pg_catalog.hashtext('variant:'||p_conversation_id::text||':'||e.slug)::bigint),1000000)::numeric/1000000*v_total;
  for v_variant in select value from jsonb_array_elements(v_variants)
  loop
    v_cursor:=v_cursor+greatest(0,coalesce((v_variant->>'weight')::numeric,0));
    if v_variant_key is null and v_target<v_cursor then v_variant_key:=v_variant->>'key'; end if;
  end loop;
  if v_variant_key is null then v_variant_key:=(v_variants->(jsonb_array_length(v_variants)-1))->>'key'; end if;
  v_eligible:=true;v_reason:='eligible';
  return jsonb_build_object('eligible',v_eligible,'reason',v_reason,'experiment',e.slug,'bucket',v_bucket,'allocation_percent',e.allocation_percent,'variant',v_variant_key,'objective',e.objective,'success_metrics',e.success_metrics);
end;
$$;

create or replace function public.assign_experience_experiment_v1(
  p_experiment_slug text,
  p_conversation_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  e public.experience_experiments%rowtype;
  c public.conversations%rowtype;
  a public.experience_experiment_assignments%rowtype;
  v_preview jsonb;
begin
  select * into e from public.experience_experiments where slug=p_experiment_slug for share;
  if not found then raise exception 'experiment_unknown'; end if;
  select * into a from public.experience_experiment_assignments where experiment_id=e.id and conversation_id=p_conversation_id;
  if found then return jsonb_build_object('ok',true,'duplicate',true,'assignment_id',a.id,'variant',a.variant,'bucket',a.bucket); end if;
  v_preview:=public.preview_experience_experiment_v1(p_experiment_slug,p_conversation_id);
  if not coalesce((v_preview->>'eligible')::boolean,false) then return jsonb_build_object('ok',true,'assigned',false,'preview',v_preview); end if;
  select * into c from public.conversations where id=p_conversation_id;
  insert into public.experience_experiment_assignments(experiment_id,conversation_id,customer_id,bucket,variant,metadata)
  values(e.id,c.id,c.customer_id,(v_preview->>'bucket')::smallint,v_preview->>'variant',coalesce(p_metadata,'{}'::jsonb)) returning * into a;
  insert into public.experience_events(conversation_id,event_type,interface_type,cohort,event_data)
  values(c.id,'experiment_assigned','conversation',c.automation_cohort,jsonb_build_object('experiment',e.slug,'variant',a.variant,'bucket',a.bucket));
  return jsonb_build_object('ok',true,'assigned',true,'duplicate',false,'assignment_id',a.id,'variant',a.variant,'bucket',a.bucket);
end;
$$;

create or replace function public.get_experience_experiment_dashboard_v1()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'experiments',coalesce(jsonb_agg(jsonb_build_object(
      'id',e.id,'slug',e.slug,'name',e.name,'objective',e.objective,'status',e.status,'allocation_percent',e.allocation_percent,
      'variants',e.variants,'eligibility',e.eligibility,'success_metrics',e.success_metrics,'starts_at',e.starts_at,'ends_at',e.ends_at,
      'assignments',(select count(*) from public.experience_experiment_assignments a where a.experiment_id=e.id),
      'variant_counts',coalesce((select jsonb_object_agg(x.variant,x.n) from (select a.variant,count(*) n from public.experience_experiment_assignments a where a.experiment_id=e.id group by a.variant) x),'{}'::jsonb)
    ) order by e.created_at desc),'[]'::jsonb)
  ) from public.experience_experiments e;
$$;

alter table public.experience_experiments enable row level security;
alter table public.experience_experiment_assignments enable row level security;
revoke all on table public.experience_experiments from public,anon,authenticated;
revoke all on table public.experience_experiment_assignments from public,anon,authenticated;
grant select,insert,update,delete on table public.experience_experiments to service_role;
grant select,insert,update,delete on table public.experience_experiment_assignments to service_role;

revoke execute on function public.preview_experience_experiment_v1(text,uuid) from public,anon,authenticated;
revoke execute on function public.assign_experience_experiment_v1(text,uuid,jsonb) from public,anon,authenticated;
revoke execute on function public.get_experience_experiment_dashboard_v1() from public,anon,authenticated;
grant execute on function public.preview_experience_experiment_v1(text,uuid) to service_role;
grant execute on function public.assign_experience_experiment_v1(text,uuid,jsonb) to service_role;
grant execute on function public.get_experience_experiment_dashboard_v1() to service_role;
