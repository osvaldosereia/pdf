begin;

-- Hardening de privilégio apenas. Não altera corpo, vínculo ou estado dos triggers.
-- Trigger functions SECURITY DEFINER não são API pública e não devem herdar EXECUTE de PUBLIC.
revoke all on function public.ai_job_dispatch_trigger_v2() from public, anon, authenticated;
revoke all on function public.ai_job_human_fallback_trigger_v1() from public, anon, authenticated;
revoke all on function public.guard_whatsapp_ai_outbound_rate_v1() from public, anon, authenticated;
revoke all on function public.message_human_intent_trigger_v1() from public, anon, authenticated;

-- Backends internos continuam autorizados explicitamente.
grant execute on function public.ai_job_dispatch_trigger_v2() to service_role;
grant execute on function public.ai_job_human_fallback_trigger_v1() to service_role;
grant execute on function public.guard_whatsapp_ai_outbound_rate_v1() to service_role;
grant execute on function public.message_human_intent_trigger_v1() to service_role;

commit;
