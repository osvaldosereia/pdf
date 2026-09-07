-- Edge Functions usam service_role e precisam de acesso explícito aos objetos server-side.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select, update on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;

-- O browser continua fechado por padrão.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
