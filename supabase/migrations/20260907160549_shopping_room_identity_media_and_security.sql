begin;

-- Conversas agora podem nascer no site e depois migrar para WhatsApp/híbrido.
alter table public.conversations add column if not exists channel text not null default 'whatsapp';
alter table public.conversations drop constraint if exists conversations_channel_check;
alter table public.conversations add constraint conversations_channel_check check (channel in ('whatsapp','web','hybrid'));
alter table public.conversations alter column wa_contact_e164 drop not null;
alter table public.conversations drop constraint if exists conversations_source_check;
alter table public.conversations add constraint conversations_source_check check (source in ('organic','meta_ad','campaign','catalog','website','unknown'));

create or replace function public.phone_variants_br(p_phone text)
returns text[]
language plpgsql
immutable
set search_path=''
as $$
declare
  d text := regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
  v text[] := array[]::text[];
  base text;
begin
  if d='' then return v; end if;
  v:=array_append(v,d);
  if left(d,2)='55' and length(d) in (12,13) then
    base:=substr(d,3); v:=array_append(v,base);
  elsif length(d) in (10,11) then
    base:=d; v:=array_append(v,'55'||d);
  else base:=d;
  end if;
  if length(base)=10 then
    v:=array_append(v,substr(base,1,2)||'9'||substr(base,3));
    v:=array_append(v,'55'||substr(base,1,2)||'9'||substr(base,3));
  elsif length(base)=11 and substr(base,3,1)='9' then
    v:=array_append(v,substr(base,1,2)||substr(base,4));
    v:=array_append(v,'55'||substr(base,1,2)||substr(base,4));
  end if;
  select coalesce(array_agg(x order by length(x),x),array[]::text[]) into v from (select distinct x from unnest(v) x where length(x) between 10 and 13) s;
  return v;
end;
$$;

create or replace function public.canonical_phone_br(p_phone text)
returns text language plpgsql immutable set search_path=''
as $$
declare d text:=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
begin
  if length(d) in (10,11) then d:='55'||d; end if;
  if left(d,2)<>'55' or length(d) not in (12,13) then return null; end if;
  return '+'||d;
end;
$$;

create or replace function public.lookup_customer_by_phone(p_phone text)
returns table(customer_id uuid, bling_contact_id bigint, customer_name text, preferred_reply text)
language sql security definer set search_path=''
as $$
  with vars as (select public.phone_variants_br(p_phone) variants), matches as (
    select c.id,c.bling_contact_id,c.name,c.preferred_reply,case when public.normalize_phone_digits(c.primary_whatsapp_e164)=public.normalize_phone_digits(p_phone) then 0 else 1 end rank
    from public.customers c, vars v where public.normalize_phone_digits(c.primary_whatsapp_e164)=any(v.variants)
    union all
    select c.id,c.bling_contact_id,c.name,c.preferred_reply,case when public.normalize_phone_digits(cp.phone_e164)=public.normalize_phone_digits(p_phone) then 0 else 2 end rank
    from public.customer_phones cp join public.customers c on c.id=cp.customer_id, vars v where public.normalize_phone_digits(cp.phone_e164)=any(v.variants)
  ) select id,bling_contact_id,name,preferred_reply from matches order by rank,id limit 1
$$;

create unique index if not exists customers_document_digits_uidx on public.customers ((regexp_replace(cpf_cnpj,'[^0-9]','','g'))) where nullif(regexp_replace(cpf_cnpj,'[^0-9]','','g'),'') is not null;

create or replace function public.room_start_web_session()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_account uuid;v_conversation uuid;v_session public.catalog_sessions%rowtype;
begin
  select id into v_account from public.whatsapp_accounts where is_active=true order by created_at limit 1;
  if v_account is null then raise exception 'whatsapp_account_unavailable'; end if;
  insert into public.conversations(whatsapp_account_id,customer_id,wa_contact_e164,source,status,stage,response_preference,mode,channel,referral)
  values(v_account,null,null,'website','open','new','auto','ai','web',jsonb_build_object('entry_channel','website')) returning id into v_conversation;
  insert into public.catalog_sessions(customer_id,conversation_id,cart_id,kind,title,status,expires_at,metadata,experience,current_view,last_activity_at)
  values(null,v_conversation,null,'browse','Sala de Compra Dona Antônia','open',now()+interval '24 hours',jsonb_build_object('entry_channel','website','shopping_mode','auto'),'shopping_room','home',now()) returning * into v_session;
  return jsonb_build_object('token',v_session.public_token,'expires_at',v_session.expires_at,'conversation_id',v_conversation);
end;
$$;

create or replace function public.room_identify_customer(p_public_token text,p_name text,p_phone text,p_document text default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_session public.catalog_sessions%rowtype;v_name text:=nullif(trim(coalesce(p_name,'')),'');v_phone text:=public.canonical_phone_br(p_phone);
  v_doc text:=nullif(regexp_replace(coalesce(p_document,''),'[^0-9]','','g'),'');v_variants text[]:=public.phone_variants_br(p_phone);
  v_customer public.customers%rowtype;v_phone_matches uuid[];v_doc_customer uuid;
begin
  select * into v_session from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now() for update;
  if not found then raise exception 'room_unavailable'; end if;
  if v_name is null or length(v_name)<2 then raise exception 'customer_name_required'; end if;
  if v_phone is null or coalesce(array_length(v_variants,1),0)=0 then raise exception 'valid_whatsapp_required'; end if;
  if v_doc is not null and length(v_doc) not in (11,14) then raise exception 'invalid_document'; end if;
  if v_doc is not null then select id into v_doc_customer from public.customers where regexp_replace(cpf_cnpj,'[^0-9]','','g')=v_doc limit 1; end if;
  select array_agg(distinct id) into v_phone_matches from (
    select c.id from public.customers c where public.normalize_phone_digits(c.primary_whatsapp_e164)=any(v_variants)
    union select cp.customer_id id from public.customer_phones cp where public.normalize_phone_digits(cp.phone_e164)=any(v_variants)
  ) q;
  if v_doc_customer is not null then
    if coalesce(array_length(v_phone_matches,1),0)>0 and exists(select 1 from unnest(v_phone_matches) x where x<>v_doc_customer) then raise exception 'customer_identity_conflict'; end if;
    select * into v_customer from public.customers where id=v_doc_customer for update;
  elsif coalesce(array_length(v_phone_matches,1),0)=1 then select * into v_customer from public.customers where id=v_phone_matches[1] for update;
  elsif coalesce(array_length(v_phone_matches,1),0)>1 then raise exception 'ambiguous_customer_phone';
  else insert into public.customers(name,cpf_cnpj,primary_whatsapp_e164,preferred_reply,is_active) values(v_name,v_doc,v_phone,'auto',true) returning * into v_customer;
  end if;
  update public.customers set name=coalesce(v_name,name),cpf_cnpj=case when v_doc is not null then v_doc else cpf_cnpj end,primary_whatsapp_e164=coalesce(primary_whatsapp_e164,v_phone),updated_at=now() where id=v_customer.id returning * into v_customer;
  insert into public.customer_phones(customer_id,phone_e164,source,is_primary,verified_at) values(v_customer.id,v_phone,'manual',true,now())
  on conflict (phone_e164) do update set is_primary=(public.customer_phones.customer_id=excluded.customer_id),verified_at=case when public.customer_phones.customer_id=excluded.customer_id then now() else public.customer_phones.verified_at end;
  update public.conversations set customer_id=v_customer.id,wa_contact_e164=v_phone,channel=case when channel='web' then 'hybrid' else channel end,updated_at=now() where id=v_session.conversation_id;
  update public.carts set customer_id=v_customer.id,updated_at=now() where conversation_id=v_session.conversation_id and status='draft';
  update public.catalog_sessions set customer_id=v_customer.id,last_activity_at=now() where id=v_session.id;
  insert into public.customer_behavior_events(customer_id,conversation_id,event_type,event_data) values(v_customer.id,v_session.conversation_id,'room_identified',jsonb_build_object('source','shopping_room'));
  return jsonb_build_object('id',v_customer.id,'name',v_customer.name,'phone',v_phone,'has_bling_contact',(v_customer.bling_contact_id is not null),'has_document',(nullif(regexp_replace(coalesce(v_customer.cpf_cnpj,''),'[^0-9]','','g'),'') is not null),'requires_document',(v_customer.bling_contact_id is null and nullif(regexp_replace(coalesce(v_customer.cpf_cnpj,''),'[^0-9]','','g'),'') is null));
end;
$$;

create or replace function public.room_save_address(p_public_token text,p_address jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_session public.catalog_sessions%rowtype;v_id uuid;v_street text:=nullif(trim(coalesce(p_address->>'street','')),'');v_number text:=nullif(trim(coalesce(p_address->>'number','')),'');v_city text:=nullif(trim(coalesce(p_address->>'city','')),'');
begin
  select * into v_session from public.catalog_sessions where public_token=p_public_token and status='open' and expires_at>now();
  if not found then raise exception 'room_unavailable'; end if;if v_session.customer_id is null then raise exception 'customer_identification_required'; end if;if v_street is null or v_number is null or v_city is null then raise exception 'delivery_address_required'; end if;
  update public.customer_addresses set is_default=false,updated_at=now() where customer_id=v_session.customer_id and is_default=true;
  insert into public.customer_addresses(customer_id,label,street,number,complement,neighborhood,city,state,postal_code,reference,is_default,is_active,last_confirmed_at)
  values(v_session.customer_id,coalesce(nullif(trim(p_address->>'label'),''),'Entrega'),v_street,v_number,nullif(trim(p_address->>'complement'),''),nullif(trim(p_address->>'neighborhood'),''),v_city,upper(coalesce(nullif(trim(p_address->>'state'),''),'MT')),regexp_replace(coalesce(p_address->>'postal_code',''),'[^0-9]','','g'),nullif(trim(p_address->>'reference'),''),true,true,now()) returning id into v_id;
  return jsonb_build_object('id',v_id,'saved',true);
end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('shopping-room-media','shopping-room-media',false,10485760,array['audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/aac','image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.room_media(
  id uuid primary key default gen_random_uuid(),catalog_session_id uuid not null references public.catalog_sessions(id) on delete cascade,conversation_id uuid references public.conversations(id) on delete cascade,customer_id uuid references public.customers(id) on delete set null,message_id uuid references public.messages(id) on delete set null,kind text not null check(kind in ('audio','image')),bucket text not null default 'shopping-room-media',object_path text not null unique,mime_type text not null,bytes bigint not null check(bytes>=0),duration_ms integer,processing_status text not null default 'uploaded' check(processing_status in ('uploaded','held','queued','processed','error','ignored')),processing_error text,created_at timestamptz not null default now(),expires_at timestamptz not null default (now()+interval '90 days'));
create index if not exists room_media_conversation_idx on public.room_media(conversation_id,created_at desc);alter table public.room_media enable row level security;

create table if not exists public.ai_jobs(
  id uuid primary key default gen_random_uuid(),conversation_id uuid references public.conversations(id) on delete cascade,message_id uuid references public.messages(id) on delete cascade,job_type text not null check(job_type in ('transcription','vision','tts','conversation')),status text not null default 'held' check(status in ('held','pending','processing','done','error','cancelled')),input jsonb not null default '{}'::jsonb,result jsonb not null default '{}'::jsonb,attempts integer not null default 0,max_attempts integer not null default 3,not_before timestamptz not null default now(),locked_at timestamptz,locked_by text,error_message text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(message_id,job_type));
create index if not exists ai_jobs_status_idx on public.ai_jobs(status,not_before,created_at);alter table public.ai_jobs enable row level security;

create or replace function public.queue_ai_job_for_message(p_message_id uuid,p_job_type text,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_enabled boolean:=false;v_conversation uuid;v_id uuid;v_status text;
begin
  if p_job_type not in ('transcription','vision','tts','conversation') then raise exception 'invalid_ai_job_type'; end if;
  select conversation_id into v_conversation from public.messages where id=p_message_id;if not found then raise exception 'message_not_found'; end if;
  select ai_enabled into v_enabled from public.automation_config where id=1;v_status:=case when coalesce(v_enabled,false) then 'pending' else 'held' end;
  insert into public.ai_jobs(conversation_id,message_id,job_type,status,input) values(v_conversation,p_message_id,p_job_type,v_status,coalesce(p_input,'{}'::jsonb)) on conflict(message_id,job_type) do update set input=excluded.input,updated_at=now() returning id into v_id;
  return jsonb_build_object('id',v_id,'status',v_status);
end;
$$;

create table if not exists public.public_rate_limits(rate_key text not null,bucket text not null,window_started_at timestamptz not null default now(),hit_count integer not null default 0,updated_at timestamptz not null default now(),primary key(rate_key,bucket));alter table public.public_rate_limits enable row level security;
create or replace function public.consume_public_rate_limit(p_rate_key text,p_bucket text,p_limit integer,p_window_seconds integer)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_count integer;v_start timestamptz;
begin
  if p_limit<1 or p_window_seconds<1 then return false; end if;
  insert into public.public_rate_limits(rate_key,bucket,window_started_at,hit_count,updated_at) values(left(coalesce(p_rate_key,''),180),left(coalesce(p_bucket,''),80),now(),1,now())
  on conflict(rate_key,bucket) do update set hit_count=case when public.public_rate_limits.window_started_at <= now()-make_interval(secs=>p_window_seconds) then 1 else public.public_rate_limits.hit_count+1 end,window_started_at=case when public.public_rate_limits.window_started_at <= now()-make_interval(secs=>p_window_seconds) then now() else public.public_rate_limits.window_started_at end,updated_at=now()
  returning hit_count,window_started_at into v_count,v_start;return v_count<=p_limit;
end;
$$;

revoke execute on function public.apply_catalog_behavior_event() from public,anon,authenticated;
revoke execute on function public.refresh_purchase_profile_from_order() from public,anon,authenticated;
revoke execute on function public.refresh_purchase_profile_from_order_item() from public,anon,authenticated;
revoke execute on function public.track_customer_message_preference() from public,anon,authenticated;
revoke all on public.room_media,public.ai_jobs,public.public_rate_limits from public,anon,authenticated;
grant select,insert,update,delete on public.room_media,public.ai_jobs,public.public_rate_limits to service_role;
revoke execute on function public.phone_variants_br(text),public.canonical_phone_br(text),public.room_start_web_session(),public.room_identify_customer(text,text,text,text),public.room_save_address(text,jsonb),public.queue_ai_job_for_message(uuid,text,jsonb),public.consume_public_rate_limit(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.phone_variants_br(text),public.canonical_phone_br(text),public.room_start_web_session(),public.room_identify_customer(text,text,text,text),public.room_save_address(text,jsonb),public.queue_ai_job_for_message(uuid,text,jsonb),public.consume_public_rate_limit(text,text,integer,integer) to service_role;

commit;
