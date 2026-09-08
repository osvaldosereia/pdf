begin;

-- Security hardening discovered by Supabase Advisor after Stage 13A deployment.
-- The append-only trigger function does not require definer privileges and must not be directly callable by client roles.

alter function public.prevent_financial_append_only_mutation_v1() security invoker;

revoke all on function public.prevent_financial_append_only_mutation_v1() from public, anon, authenticated;
grant execute on function public.prevent_financial_append_only_mutation_v1() to service_role;

comment on function public.prevent_financial_append_only_mutation_v1() is
  'Stage 13 append-only trigger guard. SECURITY INVOKER; direct execution revoked from public/anon/authenticated.';

commit;
