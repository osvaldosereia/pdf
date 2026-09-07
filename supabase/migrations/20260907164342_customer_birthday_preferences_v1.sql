begin;
alter table public.customers add column if not exists birthday_day smallint,
 add column if not exists birthday_month smallint,
 add column if not exists marketing_opt_in boolean not null default false,
 add column if not exists marketing_consent_updated_at timestamptz;
alter table public.customers add constraint customers_birthday_valid check (
 (birthday_day is null and birthday_month is null) or
 (birthday_day is not null and birthday_month is not null and birthday_month between 1 and 12 and
 birthday_day between 1 and case when birthday_month=2 then 29 when birthday_month in (4,6,9,11) then 30 else 31 end));
create table public.customer_consent_events (
 id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.customers(id) on delete cascade,
 catalog_session_id uuid references public.catalog_sessions(id) on delete set null,
 purpose text not null default 'whatsapp_marketing' check(purpose='whatsapp_marketing'),
 granted boolean not null,notice_version text not null default '2026-09-07-v1',source text not null default 'shopping_room',
 occurred_at timestamptz not null default now()
);
create index customer_consent_customer_idx on public.customer_consent_events(customer_id,occurred_at desc);
create index customer_consent_session_idx on public.customer_consent_events(catalog_session_id);
alter table public.customer_consent_events enable row level security;
revoke all on public.customer_consent_events from public,anon,authenticated;
grant select,insert,update,delete on public.customer_consent_events to service_role;
create function public.room_save_customer_preferences(p_public_token text,p_day integer default null,p_month integer default null,p_marketing_opt_in boolean default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.catalog_sessions%rowtype; c public.customers%rowtype;
begin
 select * into s from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now() for update;
 if not found then raise exception 'room_unavailable'; end if;
 if s.customer_id is null then raise exception 'customer_identification_required'; end if;
 if (p_day is null)<>(p_month is null) then raise exception 'Informe dia e mês do aniversário.'; end if;
 if p_day is not null then
  if p_month not between 1 and 12 or p_day not between 1 and 31 then raise exception 'Aniversário inválido.'; end if;
  begin perform make_date(2000,p_month,p_day); exception when others then raise exception 'Aniversário inválido.'; end;
 end if;
 select * into c from public.customers where id=s.customer_id for update;
 if p_day is not null then update public.customers set birthday_day=p_day,birthday_month=p_month,updated_at=now() where id=c.id; end if;
 if p_marketing_opt_in is not null and (p_marketing_opt_in is distinct from c.marketing_opt_in or c.marketing_consent_updated_at is null) then
  update public.customers set marketing_opt_in=p_marketing_opt_in,marketing_consent_updated_at=now(),updated_at=now() where id=c.id;
  insert into public.customer_consent_events(customer_id,catalog_session_id,granted) values(c.id,s.id,p_marketing_opt_in);
 end if;
 return jsonb_build_object('saved',true);
end $$;
-- Preview only. Integration into pricing/checkout and inventory lots is a separate release.
create function public.preview_expiry_offer(p_price numeric,p_validity date,p_today date default (now() at time zone 'America/Cuiaba')::date)
returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('days_remaining',p_validity-p_today,'expired',coalesce(p_validity<p_today,false),
 'discount_percent',case when p_validity<p_today then 0 when p_validity-p_today<=30 then 30 when p_validity-p_today<=60 then 20 else 0 end,
 'suggested_price',case when p_price is null or p_price<0 or p_validity<p_today then null when p_validity-p_today<=30 then round(p_price*0.70,2) when p_validity-p_today<=60 then round(p_price*0.80,2) else p_price end,
 'applied',false)
$$;
create index if not exists products_verified_validity_idx on public.products(validity_date,id) where physically_verified=true;
create index if not exists products_verified_category_idx on public.products(category,id) where physically_verified=true;
revoke execute on function public.room_save_customer_preferences(text,integer,integer,boolean),public.preview_expiry_offer(numeric,date,date) from public,anon,authenticated;
grant execute on function public.room_save_customer_preferences(text,integer,integer,boolean),public.preview_expiry_offer(numeric,date,date) to service_role;
commit;
