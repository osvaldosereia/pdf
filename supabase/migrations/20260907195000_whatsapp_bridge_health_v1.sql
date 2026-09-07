begin;

create or replace function public.get_whatsapp_bridge_health_v1()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_cfg public.automation_config%rowtype;
  v_result jsonb;
begin
  select * into v_cfg from public.automation_config where id=1;

  select jsonb_build_object(
    'checked_at',now(),
    'release_mode',coalesce(v_cfg.whatsapp_release_mode,'off'),
    'gates',jsonb_build_object(
      'automation_enabled',coalesce(v_cfg.automation_enabled,false),
      'outbound_enabled',coalesce(v_cfg.outbound_enabled,false),
      'ai_enabled',coalesce(v_cfg.ai_enabled,false),
      'conversation_worker_enabled',coalesce(v_cfg.conversation_worker_enabled,false),
      'whatsapp_inbound_enabled',coalesce(v_cfg.whatsapp_inbound_enabled,false),
      'whatsapp_auto_reply_enabled',coalesce(v_cfg.whatsapp_auto_reply_enabled,false),
      'whatsapp_inbound_since',v_cfg.whatsapp_inbound_since
    ),
    'allowlist',jsonb_build_object(
      'active',coalesce((select count(*) from public.whatsapp_test_allowlist where enabled=true and expires_at>now()),0),
      'next_expiry',(select min(expires_at) from public.whatsapp_test_allowlist where enabled=true and expires_at>now())
    ),
    'outbound',jsonb_build_object(
      'pending',coalesce((select count(*) from public.outbound_jobs where job_type='seller_message' and status='pending'),0),
      'processing',coalesce((select count(*) from public.outbound_jobs where job_type='seller_message' and status='processing'),0),
      'error',coalesce((select count(*) from public.outbound_jobs where job_type='seller_message' and status='error'),0),
      'review_required',coalesce((select count(*) from public.outbound_jobs where job_type='seller_message' and status='error' and coalesce(last_error,'') like '%review_required%'),0),
      'last_sent_at',(select max(sent_at) from public.outbound_jobs where job_type='seller_message' and status='sent')
    ),
    'ai_jobs',jsonb_build_object(
      'pending',coalesce((select count(*) from public.ai_jobs where status='pending'),0),
      'processing',coalesce((select count(*) from public.ai_jobs where status='processing'),0),
      'error',coalesce((select count(*) from public.ai_jobs where status='error'),0)
    ),
    'messages',jsonb_build_object(
      'last_whatsapp_inbound_at',(select max(created_at) from public.messages where direction='inbound' and raw_event->>'source'='whatsapp'),
      'inbound_last_hour',coalesce((select count(*) from public.messages where direction='inbound' and raw_event->>'source'='whatsapp' and created_at>now()-interval '1 hour'),0),
      'outbound_last_hour',coalesce((select count(*) from public.messages where direction='outbound' and raw_event->>'source'='whatsapp' and created_at>now()-interval '1 hour'),0)
    ),
    'cron',jsonb_build_object(
      'outbound_recovery',exists(select 1 from cron.job where jobname='dona-antonia-whatsapp-outbound-recovery-v2' and active=true),
      'homologation_expiry',exists(select 1 from cron.job where jobname='dona-antonia-whatsapp-homologation-expiry-v1' and active=true)
    )
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.whatsapp_bridge_emergency_stop_v1(p_reason text default 'manual_emergency_stop')
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reason text:=left(coalesce(nullif(trim(p_reason),''),'manual_emergency_stop'),200);
  v_cancelled integer:=0;
  v_review integer:=0;
begin
  update public.automation_config
     set whatsapp_release_mode='off',
         whatsapp_inbound_enabled=false,
         whatsapp_auto_reply_enabled=false,
         ai_enabled=false,
         conversation_worker_enabled=false,
         whatsapp_inbound_since=now(),
         updated_at=now()
   where id=1;

  update public.whatsapp_test_allowlist
     set enabled=false,updated_at=now()
   where enabled=true;

  update public.outbound_jobs
     set status='cancelled',last_error='emergency_stop_cancelled_before_send:'||v_reason,
         locked_at=null,locked_by=null,updated_at=now()
   where job_type='seller_message'
     and payload->>'message_kind'='conversation_reply'
     and status in ('pending','error')
     and coalesce(last_error,'') not like '%review_required%';
  get diagnostics v_cancelled=row_count;

  update public.outbound_jobs
     set status='error',last_error='emergency_stop_delivery_uncertain_review_required:'||v_reason,
         not_before=now()+interval '100 years',locked_at=null,locked_by=null,
         dispatch_response_checked_at=coalesce(dispatch_response_checked_at,now()),updated_at=now()
   where job_type='seller_message'
     and payload->>'message_kind'='conversation_reply'
     and status='processing';
  get diagnostics v_review=row_count;

  return jsonb_build_object(
    'stopped',true,
    'reason',v_reason,
    'cancelled_before_send',v_cancelled,
    'processing_moved_to_review',v_review,
    'health',public.get_whatsapp_bridge_health_v1()
  );
end;
$$;

revoke all on function public.get_whatsapp_bridge_health_v1() from public,anon,authenticated;
grant execute on function public.get_whatsapp_bridge_health_v1() to service_role;
revoke all on function public.whatsapp_bridge_emergency_stop_v1(text) from public,anon,authenticated;
grant execute on function public.whatsapp_bridge_emergency_stop_v1(text) to service_role;

commit;
