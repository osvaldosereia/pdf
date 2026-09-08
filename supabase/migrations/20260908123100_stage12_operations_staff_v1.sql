begin;

create table if not exists public.operations_staff (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  display_name text not null,
  role text not null check(role in ('picker','checker','loader','supervisor')),
  active boolean not null default false,
  can_pick boolean not null default false,
  can_check boolean not null default false,
  can_package boolean not null default false,
  can_load boolean not null default false,
  can_resolve_exceptions boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.operations_staff enable row level security;
revoke all on public.operations_staff from public,anon,authenticated;
grant select,insert,update,delete on public.operations_staff to service_role;

create or replace function public.operations_staff_context_v1(p_auth_user_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
select case when s.id is null then jsonb_build_object('ok',false,'error','staff_not_found')
else jsonb_build_object('ok',true,'staff_id',s.id,'display_name',s.display_name,'role',s.role,'active',s.active,'can_pick',s.can_pick,'can_check',s.can_check,'can_package',s.can_package,'can_load',s.can_load,'can_resolve_exceptions',s.can_resolve_exceptions) end
from (select 1) x left join public.operations_staff s on s.auth_user_id=p_auth_user_id;
$$;
revoke all on function public.operations_staff_context_v1(uuid) from public,anon,authenticated;
grant execute on function public.operations_staff_context_v1(uuid) to service_role;

commit;
