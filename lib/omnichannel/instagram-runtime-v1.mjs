const text=v=>String(v??'').trim();
const arr=v=>Array.isArray(v)?v:[];

export function normalizeInstagramWebhook(body={}){
  const out=[];
  for(const entry of arr(body.entry)){
    const externalAccountId=text(entry.id);
    if(!externalAccountId) continue;

    for(const item of arr(entry.messaging)){
      const senderId=text(item?.sender?.id);
      const recipientId=text(item?.recipient?.id);
      const mid=text(item?.message?.mid);
      if(!senderId||!mid) continue;
      out.push({
        kind:'direct',
        external_account_id:externalAccountId,
        external_user_id:senderId,
        external_message_id:mid,
        message_type:item?.message?.attachments?.length?'image':'text',
        body_text:text(item?.message?.text)||null,
        reply_to:text(item?.message?.reply_to?.mid)||null,
        source:'instagram_direct',
        referral:item?.referral&&typeof item.referral==='object'?item.referral:{},
        timestamp:item?.timestamp?new Date(Number(item.timestamp)).toISOString():new Date().toISOString(),
        context:{recipient_external_id:recipientId||null,is_echo:item?.message?.is_echo===true}
      });
    }

    for(const change of arr(entry.changes)){
      const field=text(change?.field).toLowerCase();
      if(!['comments','live_comments'].includes(field)) continue;
      const value=change?.value&&typeof change.value==='object'?change.value:{};
      const commentId=text(value.id);
      const authorId=text(value?.from?.id);
      if(!commentId||!authorId) continue;
      out.push({
        kind:'comment',
        external_account_id:externalAccountId,
        external_user_id:authorId,
        external_message_id:commentId,
        message_type:'comment',
        body_text:text(value.text)||null,
        reply_to:text(value.parent_id)||null,
        source:'instagram_comment',
        referral:{media_id:text(value?.media?.id)||text(value.media_id)||null,media_product_type:text(value?.media?.media_product_type)||null},
        timestamp:value.created_time||new Date().toISOString(),
        context:{username:text(value?.from?.username)||null,field}
      });
    }
  }
  return out;
}

export function classifyInstagramEvent(event={}){
  if(event.kind==='comment') return 'comment_observation';
  if(event.kind==='direct') return event.context?.is_echo===true?'direct_echo':'direct_inbound';
  return 'unknown';
}

export function instagramAutomationGate(account={},controls={},eventKind='direct'){
  if(!account||account.channel!=='instagram') return {allow:false,reason:'instagram_account_required'};
  if(!['observe','active'].includes(account.status)) return {allow:false,reason:'instagram_account_dormant'};
  if(account.inbound_enabled!==true) return {allow:false,reason:'instagram_inbound_disabled'};
  if(controls.webhook_ingest_enabled!==true) return {allow:false,reason:'instagram_webhook_disabled'};
  if(eventKind==='comment'&&controls.comment_observe_enabled!==true) return {allow:false,reason:'instagram_comment_observe_disabled'};
  if(eventKind==='direct'&&controls.direct_observe_enabled!==true) return {allow:false,reason:'instagram_direct_observe_disabled'};
  return {allow:true,reason:'observe_allowed'};
}

export function privateReplyPreparationGate(account={},controls={},observation={}){
  if(!account||account.channel!=='instagram') return {allow:false,reason:'instagram_account_required'};
  if(controls.private_reply_prepare_enabled!==true) return {allow:false,reason:'instagram_private_reply_prepare_disabled'};
  if(!controls.policy_verified_at||!text(controls.policy_version)||Number(controls.private_reply_window_seconds||0)<=0) return {allow:false,reason:'meta_policy_not_verified'};
  if(!observation.external_comment_id) return {allow:false,reason:'instagram_comment_required'};
  if(observation.private_reply_job_id) return {allow:false,reason:'private_reply_already_prepared'};
  return {allow:true,reason:'draft_only'};
}

export function privateReplyDispatchGate(account={},controls={},job={}){
  if(account?.outbound_enabled!==true) return {allow:false,reason:'instagram_outbound_disabled'};
  if(account?.auto_reply_enabled!==true) return {allow:false,reason:'instagram_auto_reply_disabled'};
  if(controls?.private_reply_send_enabled!==true) return {allow:false,reason:'instagram_private_reply_send_disabled'};
  if(job?.requires_user_response!==true) return {allow:false,reason:'user_response_policy_guard_missing'};
  return {allow:false,reason:'transport_not_implemented'};
}
