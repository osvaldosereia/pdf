begin;

-- Hardening da migration do provider Vault: funções SECURITY DEFINER usam search_path vazio.
-- Portanto chamadas da extensão pgcrypto devem ser sempre qualificadas com extensions.

create or replace function public.install_conversation_worker_provider_secret_v1(p_openai_api_key text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_key text:=trim(coalesce(p_openai_api_key,''));
  v_id uuid;
  v_hash text;
begin
  if length(v_key)<20 or length(v_key)>500 or v_key !~ '^sk-[A-Za-z0-9_-]+$' then
    raise exception 'invalid_provider_key';
  end if;

  select id into v_id
    from vault.secrets
   where name='openai_conversation_worker_key_v1'
   order by created_at desc
   limit 1;

  if v_id is null then
    v_id:=vault.create_secret(
      v_key,
      'openai_conversation_worker_key_v1',
      'OpenAI provider key for Dona Antonia conversation worker v2'
    );
  else
    perform vault.update_secret(
      v_id,
      v_key,
      'openai_conversation_worker_key_v1',
      'OpenAI provider key for Dona Antonia conversation worker v2'
    );
  end if;

  v_hash:=encode(extensions.digest(v_key,'sha256'),'hex');
  insert into public.system_secrets(key_name,key_hash,is_active,rotated_at)
  values('openai_conversation_worker_v1',v_hash,true,now())
  on conflict(key_name) do update
    set key_hash=excluded.key_hash,is_active=true,rotated_at=now();

  insert into public.whatsapp_ops_events(event_type,severity,details)
  values('worker_provider_secret_installed','info',jsonb_build_object('provider','openai','vault',true));

  return jsonb_build_object('ok',true,'provider','openai','configured',true);
end;
$$;

create or replace function public.get_conversation_worker_provider_secret_v1()
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_key text;
  v_expected_hash text;
  v_active boolean;
begin
  select key_hash,is_active into v_expected_hash,v_active
    from public.system_secrets
   where key_name='openai_conversation_worker_v1';

  if not coalesce(v_active,false) or v_expected_hash is null then
    return null;
  end if;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name='openai_conversation_worker_key_v1'
   order by created_at desc
   limit 1;

  if v_key is null or encode(extensions.digest(v_key,'sha256'),'hex') is distinct from v_expected_hash then
    return null;
  end if;

  return v_key;
end;
$$;

revoke all on function public.install_conversation_worker_provider_secret_v1(text) from public,anon,authenticated;
revoke all on function public.get_conversation_worker_provider_secret_v1() from public,anon,authenticated;
grant execute on function public.install_conversation_worker_provider_secret_v1(text) to service_role;
grant execute on function public.get_conversation_worker_provider_secret_v1() to service_role;

commit;
