begin;

-- Corrige o guard do prepare: ausência de instagram_channel_controls deve falhar fechado.
-- Usa occurred_at já normalizado no banco, evitando cast de timestamp vindo do envelope.
create or replace function public.prepare_instagram_private_reply_v1(
  p_comment_observation_id uuid,
  p_message_text text
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_obs public.instagram_comment_observations%rowtype;
  v_controls public.instagram_channel_controls%rowtype;
  v_event public.normalized_channel_events%rowtype;
  v_existing public.instagram_private_reply_jobs%rowtype;
  v_job_id uuid;
  v_key text;
  v_expires timestamptz;
  v_reason text:='instagram_transport_not_enabled';
  v_state text:='held';
begin
  if nullif(btrim(coalesce(p_message_text,'')),'') is null then raise exception 'private_reply_message_required'; end if;
  if char_length(p_message_text)>1000 then raise exception 'private_reply_message_too_long'; end if;

  select * into v_obs from public.instagram_comment_observations where id=p_comment_observation_id for update;
  if not found then raise exception 'instagram_comment_observation_not_found'; end if;
  if v_obs.private_reply_job_id is not null then
    select * into v_existing from public.instagram_private_reply_jobs where id=v_obs.private_reply_job_id;
    return jsonb_build_object('id',v_obs.private_reply_job_id,'idempotent_replay',true,'state',coalesce(v_existing.state,'held'),'hold_reason',v_existing.hold_reason,'sent',false);
  end if;

  select * into v_controls from public.instagram_channel_controls where channel_account_id=v_obs.channel_account_id;
  select * into v_event from public.normalized_channel_events where id=v_obs.normalized_event_id;
  if not found then raise exception 'normalized_event_not_found'; end if;

  if v_obs.intent not in ('purchase_interest','question','support') then
    v_reason:='comment_intent_not_eligible';
  elsif v_obs.is_live then
    v_reason:='live_state_not_verified';
  elsif v_controls.channel_account_id is null or not coalesce(v_controls.private_reply_prepare_enabled,false) then
    v_reason:='instagram_private_reply_prepare_disabled';
  elsif v_controls.policy_verified_at is null or v_controls.policy_version is null or v_controls.private_reply_window_seconds<=0 then
    v_reason:='meta_policy_not_verified';
  else
    v_expires:=v_event.occurred_at+make_interval(secs=>v_controls.private_reply_window_seconds);
    if v_expires<=now() then
      v_state:='expired';
      v_reason:='meta_private_reply_window_expired';
    else
      v_reason:='human_approval_required';
    end if;
  end if;

  v_key:=encode(extensions.digest((v_obs.channel_account_id::text||':'||v_obs.external_comment_id||':'||coalesce(v_controls.policy_version,'unverified'))::bytea,'sha256'),'hex');
  insert into public.instagram_private_reply_jobs(
    channel_account_id,comment_observation_id,recipient_external_user_id,external_comment_id,message_text,state,hold_reason,
    idempotency_key,requires_user_response,policy_version,policy_expires_at
  ) values(
    v_obs.channel_account_id,v_obs.id,v_obs.external_user_id,v_obs.external_comment_id,btrim(p_message_text),v_state,v_reason,
    v_key,true,v_controls.policy_version,v_expires
  )
  on conflict(comment_observation_id) do update set updated_at=now()
  returning id into v_job_id;

  update public.instagram_comment_observations
     set private_reply_job_id=v_job_id,review_status='human_review',updated_at=now()
   where id=v_obs.id;

  return jsonb_build_object('id',v_job_id,'state',v_state,'hold_reason',v_reason,'idempotent_replay',false,'sent',false);
end;
$$;
revoke all on function public.prepare_instagram_private_reply_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_instagram_private_reply_v1(uuid,text) to service_role;

commit;
