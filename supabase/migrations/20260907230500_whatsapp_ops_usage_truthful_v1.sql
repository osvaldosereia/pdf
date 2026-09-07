begin;

-- Observabilidade deve distinguir custo realmente zero de custo ainda não precificado.
-- Tokens continuam exatos; estimated_cost_usd só é somado quando TODOS os eventos
-- concluídos do dia possuem estimativa gravada.
create or replace function public.get_whatsapp_ops_dashboard_v1()
returns jsonb
language sql
security definer
set search_path=''
as $$
with today_usage as (
  select
    count(*)::bigint as total_events,
    count(*) filter (where estimated_cost_usd is not null)::bigint as priced_events,
    count(*) filter (where estimated_cost_usd is null)::bigint as unpriced_events,
    coalesce(sum(input_tokens),0)::bigint as input_tokens,
    coalesce(sum(output_tokens),0)::bigint as output_tokens,
    case
      when count(*)=0 then 0::numeric
      when count(*) filter (where estimated_cost_usd is null)>0 then null::numeric
      else coalesce(sum(estimated_cost_usd),0)::numeric
    end as estimated_cost_usd
  from public.ai_usage_events
  where status='done'
    and (created_at at time zone 'America/Cuiaba')::date=(now() at time zone 'America/Cuiaba')::date
)
select jsonb_build_object(
  'checked_at',now(),
  'config',(
    select jsonb_build_object(
      'release_mode',whatsapp_release_mode,
      'inbound_enabled',whatsapp_inbound_enabled,
      'auto_reply_enabled',whatsapp_auto_reply_enabled,
      'ai_enabled',ai_enabled,
      'worker_enabled',conversation_worker_enabled,
      'dispatch_enabled',conversation_worker_dispatch_enabled,
      'canary_percent',whatsapp_live_canary_percent,
      'max_new_conversations_per_hour',whatsapp_live_max_new_conversations_per_hour,
      'max_ai_jobs_per_hour',whatsapp_live_max_ai_jobs_per_hour,
      'max_outbound_per_hour',whatsapp_live_max_outbound_per_hour,
      'daily_input_tokens_soft_limit',ai_daily_input_tokens_soft_limit,
      'daily_output_tokens_soft_limit',ai_daily_output_tokens_soft_limit,
      'human_fallback_enabled',human_fallback_enabled,
      'emergency_stop_reason',emergency_stop_reason,
      'rollout_note',whatsapp_rollout_note
    )
    from public.automation_config where id=1
  ),
  'queues',jsonb_build_object(
    'ai_pending',(select count(*) from public.ai_jobs where status='pending'),
    'ai_processing',(select count(*) from public.ai_jobs where status='processing'),
    'ai_error',(select count(*) from public.ai_jobs where status='error'),
    'outbound_pending',(select count(*) from public.outbound_jobs where job_type='seller_message' and status='pending'),
    'outbound_processing',(select count(*) from public.outbound_jobs where job_type='seller_message' and status='processing'),
    'outbound_review',(select count(*) from public.outbound_jobs where job_type='seller_message' and status='error' and coalesce(last_error,'') like '%review_required%'),
    'human_open',(select count(*) from public.human_handoffs where status='open'),
    'human_claimed',(select count(*) from public.human_handoffs where status='claimed')
  ),
  'last_hour',jsonb_build_object(
    'inbound',(select count(*) from public.messages where direction='inbound' and raw_event->>'source'='whatsapp' and created_at>=now()-interval '1 hour'),
    'ai_calls',(select count(*) from public.ai_usage_events u join public.messages m on m.id=u.message_id where m.raw_event->>'source'='whatsapp' and u.created_at>=now()-interval '1 hour'),
    'ai_errors',(select count(*) from public.ai_usage_events u join public.messages m on m.id=u.message_id where m.raw_event->>'source'='whatsapp' and u.created_at>=now()-interval '1 hour' and u.status='error'),
    'outbound_sent',(select count(*) from public.outbound_jobs where job_type='seller_message' and status='sent' and sent_at>=now()-interval '1 hour'),
    'new_ai_canary_conversations',(select count(*) from public.conversations where automation_cohort='ai_canary' and created_at>=now()-interval '1 hour')
  ),
  'today_usage',(
    select jsonb_build_object(
      'input_tokens',input_tokens,
      'output_tokens',output_tokens,
      'total_events',total_events,
      'priced_events',priced_events,
      'unpriced_events',unpriced_events,
      'estimated_cost_usd',estimated_cost_usd,
      'cost_status',case
        when total_events=0 then 'no_usage'
        when unpriced_events>0 then 'unpriced'
        else 'priced'
      end
    ) from today_usage
  ),
  'recent_ai_errors',(
    select coalesce(jsonb_agg(x),'[]'::jsonb)
    from (
      select id,conversation_id,message_id,job_type,error_message,updated_at
      from public.ai_jobs
      where status='error'
      order by updated_at desc
      limit 10
    ) x
  ),
  'recent_ops_events',(
    select coalesce(jsonb_agg(x),'[]'::jsonb)
    from (
      select id,event_type,severity,conversation_id,ai_job_id,details,created_at
      from public.whatsapp_ops_events
      order by created_at desc
      limit 20
    ) x
  )
);
$$;

revoke all on function public.get_whatsapp_ops_dashboard_v1() from public,anon,authenticated;
grant execute on function public.get_whatsapp_ops_dashboard_v1() to service_role;

commit;
