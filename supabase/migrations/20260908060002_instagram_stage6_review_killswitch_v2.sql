begin;

-- Se o gate de preparação for desligado depois da criação do rascunho,
-- a revisão também falha fechada. Continua sem dispatcher/transporte.
create or replace function public.review_instagram_private_reply_v2(
  p_job_id uuid,
  p_admin_user_id uuid,
  p_decision text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_admin public.admin_users%rowtype;
  v_job public.instagram_private_reply_jobs%rowtype;
  v_obs public.instagram_comment_observations%rowtype;
  v_controls public.instagram_channel_controls%rowtype;
  v_account public.channel_accounts%rowtype;
  v_decision text:=lower(btrim(coalesce(p_decision,'')));
begin
  select * into v_admin from public.admin_users where user_id=p_admin_user_id and is_active=true;
  if not found or v_admin.role not in ('owner','operator') then raise exception 'admin_not_authorized'; end if;
  if v_decision not in ('approve','cancel') then raise exception 'invalid_review_decision'; end if;

  select * into v_job from public.instagram_private_reply_jobs where id=p_job_id for update;
  if not found then raise exception 'private_reply_job_not_found'; end if;
  if v_job.state='sent' then raise exception 'private_reply_already_sent'; end if;

  if v_decision='cancel' then
    update public.instagram_private_reply_jobs
       set state='cancelled',hold_reason='cancelled_by_operator',review_decision='cancelled',
           approved_by_admin_user_id=null,approved_at=null,updated_at=now()
     where id=v_job.id;
    return jsonb_build_object('ok',true,'job_id',v_job.id,'state','cancelled','sent',false);
  end if;
  if v_job.state='cancelled' then raise exception 'private_reply_cancelled'; end if;

  select * into v_obs from public.instagram_comment_observations where id=v_job.comment_observation_id;
  select * into v_controls from public.instagram_channel_controls where channel_account_id=v_job.channel_account_id;
  if not found or not coalesce(v_controls.private_reply_prepare_enabled,false) then raise exception 'instagram_private_reply_prepare_disabled'; end if;
  select * into v_account from public.channel_accounts where id=v_job.channel_account_id and channel='instagram';
  if not found then raise exception 'instagram_account_not_found'; end if;

  if v_obs.intent not in ('purchase_interest','question','support') then raise exception 'comment_intent_not_eligible'; end if;
  if v_obs.is_live then raise exception 'live_state_not_verified'; end if;
  if v_controls.policy_verified_at is null or v_controls.policy_version is null or v_controls.private_reply_window_seconds<=0 then raise exception 'meta_policy_not_verified'; end if;
  if v_job.policy_expires_at is null or now()>v_job.policy_expires_at then raise exception 'meta_private_reply_window_expired'; end if;
  if v_account.status not in ('observe','active') or not v_account.inbound_enabled then raise exception 'instagram_account_inbound_disabled'; end if;

  update public.instagram_private_reply_jobs
     set state='held',hold_reason='instagram_transport_not_enabled',review_decision='approved',
         approved_by_admin_user_id=p_admin_user_id,approved_at=now(),updated_at=now()
   where id=v_job.id;
  return jsonb_build_object('ok',true,'job_id',v_job.id,'state','held','approved',true,'sent',false,'hold_reason','instagram_transport_not_enabled');
end;
$$;
revoke all on function public.review_instagram_private_reply_v2(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_instagram_private_reply_v2(uuid,uuid,text) to service_role;

create or replace view public.instagram_private_reply_review_v2
with (security_invoker=true)
as
select
  j.id as job_id,j.state,j.hold_reason,j.message_text,j.policy_version,j.policy_expires_at,j.requires_user_response,
  j.review_decision,j.approved_by_admin_user_id,j.approved_at,j.sent_at,j.external_message_id,
  o.id as observation_id,o.external_comment_id,o.external_media_id,o.external_user_id,o.comment_text,o.comment_created_at,o.is_live,
  o.intent,o.intent_confidence,o.intent_source,o.review_status,
  c.channel_account_id,c.policy_verified_at,c.private_reply_window_seconds,c.private_reply_prepare_enabled,c.private_reply_send_enabled,
  a.status as account_status,a.inbound_enabled,a.outbound_enabled,a.auto_reply_enabled,
  (o.intent in ('purchase_interest','question','support') and not o.is_live and c.policy_verified_at is not null
    and c.private_reply_prepare_enabled and j.policy_expires_at>now()
    and a.status in ('observe','active') and a.inbound_enabled and j.state='held') as can_review
from public.instagram_private_reply_jobs j
join public.instagram_comment_observations o on o.id=j.comment_observation_id
join public.instagram_channel_controls c on c.channel_account_id=j.channel_account_id
join public.channel_accounts a on a.id=j.channel_account_id and a.channel='instagram';
revoke all on public.instagram_private_reply_review_v2 from public,anon,authenticated;
grant select on public.instagram_private_reply_review_v2 to service_role;

commit;
