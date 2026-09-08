begin;

-- ETAPA 6: private reply permanece humano-aprovado e sem dispatcher Meta.
-- Comentários sem intenção comercial/suporte clara não viram abordagem privada automática.

create or replace function public.evaluate_instagram_private_reply_candidate_v1(p_comment_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_comment public.instagram_comment_events%rowtype;
  v_account public.channel_accounts%rowtype;
  v_deadline timestamptz;
  v_eligible boolean:=false;
  v_status text:='held';
  v_reason text;
  v_draft text;
  v_job uuid;
begin
  select * into v_comment from public.instagram_comment_events where id=p_comment_event_id for update;
  if not found then raise exception 'instagram_comment_not_found'; end if;
  select * into v_account from public.channel_accounts where id=v_comment.channel_account_id and channel='instagram';
  if not found then raise exception 'instagram_account_not_found'; end if;

  v_deadline:=v_comment.comment_created_at + interval '7 days';
  if v_comment.intent not in ('purchase_interest','question','support') then
    v_reason:='comment_intent_not_eligible';
  elsif v_comment.is_live then
    v_reason:='live_state_not_verified';
  elsif now()>v_deadline then
    v_status:='expired'; v_reason:='private_reply_window_expired';
  else
    v_eligible:=true;
    if v_account.status not in ('observe','active') or not v_account.inbound_enabled then
      v_reason:='instagram_observe_gate_closed';
    elsif not v_account.outbound_enabled then
      v_reason:='channel_outbound_disabled';
    else
      -- Nesta etapa, até uma conta futura com todos os gates abertos exige revisão humana.
      v_status:='draft'; v_reason:='human_approval_required';
    end if;
  end if;

  v_draft:=case v_comment.intent
    when 'purchase_interest' then 'Oi! Vi seu comentário. Posso te ajudar por aqui com opções e disponibilidade. Se quiser continuar, responda esta mensagem.'
    when 'question' then 'Oi! Vi sua dúvida no comentário. Posso te explicar por aqui. Se quiser continuar, responda esta mensagem.'
    when 'support' then 'Oi! Vi seu comentário e quero entender melhor para ajudar. Se puder, responda esta mensagem com os detalhes.'
    else 'Oi! Vi seu comentário. Se quiser conversar com a Dona Antônia por aqui, responda esta mensagem.'
  end;

  update public.instagram_comment_events
     set private_reply_policy_eligible=v_eligible,
         private_reply_eligible_until=case when v_comment.is_live then null else v_deadline end,
         updated_at=now()
   where id=v_comment.id;

  insert into public.instagram_private_reply_jobs(
    comment_event_id,channel_account_id,external_comment_id,external_user_id,intent,draft_text,status,blocked_reason,policy_eligible,eligible_until
  ) values(
    v_comment.id,v_comment.channel_account_id,v_comment.external_comment_id,v_comment.external_user_id,v_comment.intent,v_draft,v_status,v_reason,v_eligible,
    case when v_comment.is_live then null else v_deadline end
  )
  on conflict(comment_event_id) do update set
    intent=excluded.intent,draft_text=excluded.draft_text,
    status=case when public.instagram_private_reply_jobs.status in ('sent','cancelled') then public.instagram_private_reply_jobs.status else excluded.status end,
    blocked_reason=case when public.instagram_private_reply_jobs.status in ('sent','cancelled') then public.instagram_private_reply_jobs.blocked_reason else excluded.blocked_reason end,
    policy_eligible=excluded.policy_eligible,eligible_until=excluded.eligible_until,updated_at=now()
  returning id into v_job;

  return jsonb_build_object('ok',true,'job_id',v_job,'status',v_status,'blocked_reason',v_reason,'policy_eligible',v_eligible,'eligible_until',case when v_comment.is_live then null else v_deadline end);
end;
$$;
revoke all on function public.evaluate_instagram_private_reply_candidate_v1(uuid) from public,anon,authenticated;
grant execute on function public.evaluate_instagram_private_reply_candidate_v1(uuid) to service_role;

create or replace function public.review_instagram_private_reply_v1(
  p_job_id uuid,
  p_admin_user_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin public.admin_users%rowtype;
  v_job public.instagram_private_reply_jobs%rowtype;
  v_comment public.instagram_comment_events%rowtype;
  v_account public.channel_accounts%rowtype;
  v_decision text:=lower(btrim(coalesce(p_decision,'')));
begin
  select * into v_admin from public.admin_users where user_id=p_admin_user_id and is_active=true;
  if not found or v_admin.role not in ('owner','operator') then raise exception 'admin_not_authorized'; end if;
  if v_decision not in ('approve','cancel') then raise exception 'invalid_review_decision'; end if;

  select * into v_job from public.instagram_private_reply_jobs where id=p_job_id for update;
  if not found then raise exception 'private_reply_job_not_found'; end if;
  if v_job.status='sent' then raise exception 'private_reply_already_sent'; end if;

  if v_decision='cancel' then
    update public.instagram_private_reply_jobs
       set status='cancelled',blocked_reason='cancelled_by_operator',approved_by_admin_user_id=null,approved_at=null,updated_at=now()
     where id=v_job.id;
    return jsonb_build_object('ok',true,'job_id',v_job.id,'status','cancelled','sent',false);
  end if;

  if v_job.status='cancelled' then raise exception 'private_reply_cancelled'; end if;
  select * into v_comment from public.instagram_comment_events where id=v_job.comment_event_id;
  select * into v_account from public.channel_accounts where id=v_job.channel_account_id and channel='instagram';
  if not found then raise exception 'instagram_account_not_found'; end if;

  if v_comment.intent not in ('purchase_interest','question','support') then raise exception 'comment_intent_not_eligible'; end if;
  if v_comment.is_live then raise exception 'live_state_not_verified'; end if;
  if not v_job.policy_eligible or v_job.eligible_until is null or now()>v_job.eligible_until then raise exception 'private_reply_not_policy_eligible'; end if;
  if v_account.status not in ('observe','active') or not v_account.inbound_enabled then raise exception 'instagram_observe_gate_closed'; end if;
  if not v_account.outbound_enabled then raise exception 'channel_outbound_disabled'; end if;

  update public.instagram_private_reply_jobs
     set status='approved',approved_by_admin_user_id=p_admin_user_id,approved_at=now(),blocked_reason='dispatcher_not_released',updated_at=now()
   where id=v_job.id;

  -- Aprovar NÃO envia. O dispatcher Meta não existe nesta etapa.
  return jsonb_build_object('ok',true,'job_id',v_job.id,'status','approved','sent',false,'blocked_reason','dispatcher_not_released');
end;
$$;
revoke all on function public.review_instagram_private_reply_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_instagram_private_reply_v1(uuid,uuid,text) to service_role;

create or replace view public.instagram_private_reply_review_v1
with (security_invoker=true)
as
select
  j.id as job_id,
  j.status,
  j.blocked_reason,
  j.intent,
  j.draft_text,
  j.policy_eligible,
  j.eligible_until,
  j.approved_by_admin_user_id,
  j.approved_at,
  j.sent_at,
  c.external_comment_id,
  c.comment_text,
  c.comment_created_at,
  c.is_live,
  c.media_id,
  c.media_product_type,
  a.id as channel_account_id,
  a.external_account_id,
  a.display_name as account_display_name,
  a.status as account_status,
  a.inbound_enabled,
  a.outbound_enabled,
  (j.policy_eligible and j.eligible_until>now() and not c.is_live and c.intent in ('purchase_interest','question','support')
    and a.status in ('observe','active') and a.inbound_enabled and a.outbound_enabled and j.status in ('held','draft','approved')) as can_approve
from public.instagram_private_reply_jobs j
join public.instagram_comment_events c on c.id=j.comment_event_id
join public.channel_accounts a on a.id=j.channel_account_id and a.channel='instagram';
revoke all on public.instagram_private_reply_review_v1 from public,anon,authenticated;
grant select on public.instagram_private_reply_review_v1 to service_role;

create or replace function public.get_instagram_stage6_metrics_v1()
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'accounts_total',(select count(*) from public.channel_accounts where channel='instagram'),
    'accounts_active',(select count(*) from public.channel_accounts where channel='instagram' and status='active'),
    'comments_total',(select count(*) from public.instagram_comment_events),
    'private_reply_candidates',(select count(*) from public.instagram_private_reply_jobs),
    'private_reply_approved',(select count(*) from public.instagram_private_reply_jobs where status='approved'),
    'private_reply_sent',(select count(*) from public.instagram_private_reply_jobs where status='sent'),
    'direct_handoffs_active',(select count(*) from public.human_handoffs where channel='instagram' and status in ('open','claimed')),
    'transport_released',false
  );
$$;
revoke all on function public.get_instagram_stage6_metrics_v1() from public,anon,authenticated;
grant execute on function public.get_instagram_stage6_metrics_v1() to service_role;

commit;
