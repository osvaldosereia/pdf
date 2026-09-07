create table if not exists public.order_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','processing','done','error','review','cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  worker_id text,
  external_key text not null unique,
  result jsonb not null default '{}'::jsonb,
  error_message text,
  locked_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.order_sync_jobs enable row level security;
revoke all on public.order_sync_jobs from public,anon,authenticated;
grant select,insert,update,delete on public.order_sync_jobs to service_role;
create index if not exists idx_order_sync_jobs_pending on public.order_sync_jobs(status,next_attempt_at,created_at) where status in ('pending','error');

alter table public.orders add column if not exists sync_status text not null default 'local';
alter table public.orders add column if not exists sync_error text;
alter table public.orders add column if not exists last_sync_at timestamptz;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='orders_sync_status_check') then
    alter table public.orders add constraint orders_sync_status_check check(sync_status in ('local','pending_bling','processing_bling','sent_to_bling','error_bling','review_bling'));
  end if;
end $$;

create or replace function public.queue_order_for_bling()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='confirmed' and new.bling_order_id is null then
    insert into public.order_sync_jobs(order_id,external_key,status)
    values(new.id,'DA-'||replace(new.id::text,'-',''),'pending')
    on conflict(order_id) do nothing;
    update public.orders set sync_status='pending_bling',sync_error=null where id=new.id;
  end if;
  return new;
end; $$;

drop trigger if exists trg_queue_order_for_bling on public.orders;
create trigger trg_queue_order_for_bling after insert on public.orders for each row execute function public.queue_order_for_bling();

insert into public.order_sync_jobs(order_id,external_key,status)
select o.id,'DA-'||replace(o.id::text,'-',''),'pending' from public.orders o
where o.status='confirmed' and o.bling_order_id is null
on conflict(order_id) do nothing;
update public.orders o set sync_status='pending_bling'
where o.status='confirmed' and o.bling_order_id is null and o.sync_status='local';

create or replace function public.claim_order_sync_jobs(p_worker text,p_limit integer default 10)
returns setof public.order_sync_jobs language plpgsql security definer set search_path='' as $$
begin
  return query
  with picked as (
    select j.id from public.order_sync_jobs j
    where j.status in ('pending','error') and j.next_attempt_at<=now() and j.attempts<j.max_attempts
    order by j.created_at for update skip locked
    limit greatest(1,least(coalesce(p_limit,10),50))
  ), upd as (
    update public.order_sync_jobs j set status='processing',worker_id=p_worker,locked_at=now(),attempts=j.attempts+1,updated_at=now()
    from picked where j.id=picked.id returning j.*
  ) select * from upd;
end; $$;

create or replace function public.finish_order_sync_job(p_job_id uuid,p_outcome text,p_bling_order_id bigint default null,p_result jsonb default '{}'::jsonb,p_error text default null,p_retry_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.order_sync_jobs%rowtype; s text;
begin
  select * into j from public.order_sync_jobs where id=p_job_id for update;
  if not found then raise exception 'order_sync_job_not_found'; end if;
  if p_outcome not in ('done','error','review','cancelled') then raise exception 'invalid_outcome'; end if;
  s:=p_outcome;
  update public.order_sync_jobs set status=s,result=coalesce(p_result,'{}'::jsonb),error_message=left(p_error,1800),next_attempt_at=case when s='error' then now()+make_interval(secs=>greatest(30,least(coalesce(p_retry_seconds,120),3600))) else next_attempt_at end,finished_at=case when s in ('done','review','cancelled') then now() else null end,worker_id=null,locked_at=null,updated_at=now() where id=p_job_id;
  if s='done' then
    if p_bling_order_id is null then raise exception 'bling_order_id_required'; end if;
    update public.orders set bling_order_id=p_bling_order_id,status='sent_to_bling',sync_status='sent_to_bling',sync_error=null,bling_synced_at=now(),last_sync_at=now(),updated_at=now() where id=j.order_id;
  elsif s='review' then
    update public.orders set sync_status='review_bling',sync_error=left(p_error,1800),last_sync_at=now(),updated_at=now() where id=j.order_id;
  elsif s='error' then
    update public.orders set sync_status='error_bling',sync_error=left(p_error,1800),last_sync_at=now(),updated_at=now() where id=j.order_id;
  end if;
  return jsonb_build_object('job_id',p_job_id,'order_id',j.order_id,'status',s);
end; $$;

revoke execute on function public.queue_order_for_bling() from public,anon,authenticated;
revoke execute on function public.claim_order_sync_jobs(text,integer) from public,anon,authenticated;
revoke execute on function public.finish_order_sync_job(uuid,text,bigint,jsonb,text,integer) from public,anon,authenticated;
grant execute on function public.claim_order_sync_jobs(text,integer) to service_role;
grant execute on function public.finish_order_sync_job(uuid,text,bigint,jsonb,text,integer) to service_role;
