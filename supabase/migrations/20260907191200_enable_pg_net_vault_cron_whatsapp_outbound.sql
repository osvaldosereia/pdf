begin;

-- Event-driven outbound: Postgres notifica o Make somente quando há trabalho.
-- Vault mantém o webhook fora do código; pg_cron faz apenas recuperação de jobs não reivindicados.
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists pg_cron;

commit;
