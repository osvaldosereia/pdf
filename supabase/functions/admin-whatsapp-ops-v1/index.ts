import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization,x-client-info,apikey,content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});
const clean = (value: unknown, max = 500) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const validUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value,80));
const CHANNELS = new Set(["whatsapp","web","hybrid","instagram","messenger"]);
const HANDOFF_STATUSES = new Set(["open","claimed"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok:false,error:"method_not_allowed" },405);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ok:false,error:"server_config"},500);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ok:false,error:"missing_token"},401);

  const sb = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const { data: userData, error: userError } = await sb.auth.getUser(token);
  if (userError || !userData?.user?.id) return json({ok:false,error:"invalid_user"},401);
  const user = userData.user;
  const { data: admin, error: adminError } = await sb.from("admin_users")
    .select("role,is_active,display_name,email").eq("user_id",user.id).maybeSingle();
  if (adminError) return json({ok:false,error:"admin_lookup_failed"},500);
  if (!admin?.is_active) return json({ok:false,error:"admin_not_authorized"},403);
  const canWrite = admin.role === "owner" || admin.role === "operator";
  const isOwner = admin.role === "owner";

  let body: Record<string,unknown> = {};
  try { body = await req.json(); } catch { return json({ok:false,error:"invalid_json"},400); }
  const action = clean(body?.action || "dashboard",60).toLowerCase();

  if (action === "dashboard") {
    const [dashboardResult, inboxResult, metricsResult] = await Promise.all([
      sb.rpc("get_whatsapp_ops_dashboard_v1"),
      sb.from("unified_inbox_v1")
        .select("conversation_id,customer_id,channel,conversation_status,stage,mode,human_required,customer_name,handoff_id,handoff_status,handoff_reason,priority,claimed_by,claimed_at,first_response_at,last_operator_reply_at,sla_due_at,last_activity_at,last_direction,last_event_kind,last_event_title,last_preview,sla_overdue")
        .not("handoff_id","is",null)
        .in("handoff_status",["open","claimed"])
        .order("priority",{ascending:false})
        .order("sla_due_at",{ascending:true,nullsFirst:false})
        .limit(50),
      sb.rpc("get_unified_inbox_metrics_v1"),
    ]);
    if (dashboardResult.error || inboxResult.error || metricsResult.error) {
      return json({ok:false,error:"dashboard_failed",detail:dashboardResult.error?.message||inboxResult.error?.message||metricsResult.error?.message},500);
    }
    return json({
      ok:true,
      user:{id:user.id,role:admin.role,display_name:admin.display_name||null},
      dashboard:dashboardResult.data,
      inbox:inboxResult.data||[],
      inbox_metrics:metricsResult.data||{},
      // Compatibilidade temporária com o painel anterior.
      handoffs:(inboxResult.data||[]).map((x:any)=>({
        id:x.handoff_id,conversation_id:x.conversation_id,customer_id:x.customer_id,reason:x.handoff_reason,
        priority:x.priority,status:x.handoff_status,claimed_by:x.claimed_by,claimed_at:x.claimed_at,
        customer:{name:x.customer_name},conversation:{stage:x.stage,mode:x.mode,status:x.conversation_status},channel:x.channel,
      })),
    });
  }

  if (action === "inbox") {
    const channel = clean(body?.channel,20).toLowerCase();
    const status = clean(body?.status,20).toLowerCase();
    const priorityRaw = Number(body?.priority ?? 0);
    const priority = Number.isFinite(priorityRaw) ? Math.max(0,Math.min(9,Math.trunc(priorityRaw))) : 0;
    const limitRaw = Number(body?.limit ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1,Math.min(100,Math.trunc(limitRaw))) : 50;
    if (channel && !CHANNELS.has(channel)) return json({ok:false,error:"invalid_channel"},400);
    if (status && !HANDOFF_STATUSES.has(status)) return json({ok:false,error:"invalid_handoff_status"},400);

    let q = sb.from("unified_inbox_v1")
      .select("conversation_id,customer_id,channel,conversation_status,stage,mode,human_required,customer_name,handoff_id,handoff_status,handoff_reason,priority,claimed_by,claimed_at,first_response_at,last_operator_reply_at,sla_due_at,last_activity_at,last_direction,last_event_kind,last_event_title,last_preview,sla_overdue")
      .not("handoff_id","is",null)
      .in("handoff_status",["open","claimed"])
      .order("priority",{ascending:false})
      .order("sla_due_at",{ascending:true,nullsFirst:false})
      .limit(limit);
    if (channel) q=q.eq("channel",channel);
    if (status) q=q.eq("handoff_status",status);
    if (priority>0) q=q.eq("priority",priority);
    const [{data,error},{data:metrics,error:metricsError}] = await Promise.all([q,sb.rpc("get_unified_inbox_metrics_v1")]);
    if (error || metricsError) return json({ok:false,error:"inbox_failed",detail:error?.message||metricsError?.message},500);
    return json({ok:true,inbox:data||[],metrics:metrics||{}});
  }

  if (action === "timeline") {
    const conversationId=clean(body?.conversation_id,80);
    const customerId=clean(body?.customer_id,80);
    if (!validUuid(conversationId) && !validUuid(customerId)) return json({ok:false,error:"conversation_or_customer_required"},400);
    let q=sb.from("customer_timeline_v1")
      .select("customer_id,conversation_id,occurred_at,channel,event_kind,direction,title,body_text,reference_id,metadata")
      .order("occurred_at",{ascending:false}).limit(150);
    if(validUuid(conversationId)) q=q.eq("conversation_id",conversationId);
    else q=q.eq("customer_id",customerId);
    const {data,error}=await q;
    if(error) return json({ok:false,error:"timeline_failed",detail:error.message},500);
    return json({ok:true,timeline:data||[]});
  }

  if (action === "customer_identity_summary") {
    const customerId=clean(body?.customer_id,80);
    if(!validUuid(customerId)) return json({ok:false,error:"invalid_customer_id"},400);
    const [customerResult,channelResult,emailResult,consentResult]=await Promise.all([
      sb.from("customers").select("id,name,primary_whatsapp_e164,birthday_day,birthday_month,marketing_opt_in,order_count,lifetime_value,last_order_at").eq("id",customerId).maybeSingle(),
      sb.from("customer_channel_identities").select("id,channel,external_user_id,identity_kind,verification_status,verified_at,linked_at").eq("customer_id",customerId).order("created_at",{ascending:true}),
      sb.from("customer_emails").select("id,email_normalized,verification_status,is_primary,verified_at,linked_at").eq("customer_id",customerId).order("created_at",{ascending:true}),
      sb.from("customer_channel_consents").select("id,channel,purpose,status,source,occurred_at").eq("customer_id",customerId).order("occurred_at",{ascending:false}),
    ]);
    if(customerResult.error||channelResult.error||emailResult.error||consentResult.error) return json({ok:false,error:"identity_summary_failed"},500);
    if(!customerResult.data) return json({ok:false,error:"customer_not_found"},404);
    return json({ok:true,customer:customerResult.data,channel_identities:channelResult.data||[],emails:emailResult.data||[],consents:consentResult.data||[]});
  }

  if (!canWrite) return json({ok:false,error:"read_only"},403);

  if (action === "claim_handoff") {
    const id = clean(body?.id,80); if(!validUuid(id)) return json({ok:false,error:"invalid_handoff_id"},400);
    const { data, error } = await sb.rpc("claim_human_handoff_admin_v1",{p_handoff_id:id,p_admin_user_id:user.id});
    if(error) return json({ok:false,error:"claim_failed",detail:error.message},400);
    return json({ok:true,result:data});
  }

  if (action === "operator_reply") {
    const conversationId=clean(body?.conversation_id,80);
    const message=clean(body?.message,4096);
    if(!validUuid(conversationId)) return json({ok:false,error:"invalid_conversation_id"},400);
    if(!message) return json({ok:false,error:"message_required"},400);
    const {data,error}=await sb.rpc("queue_operator_reply_v1",{p_conversation_id:conversationId,p_admin_user_id:user.id,p_body_text:message});
    if(error) return json({ok:false,error:"operator_reply_failed",detail:error.message},400);
    return json({ok:true,result:data});
  }

  if (action === "resolve_handoff") {
    const id = clean(body?.id,80); if(!validUuid(id)) return json({ok:false,error:"invalid_handoff_id"},400);
    const notes = clean(body?.notes,2000) || null;
    const { data, error } = await sb.rpc("resolve_human_handoff_admin_v1",{p_handoff_id:id,p_admin_user_id:user.id,p_notes:notes});
    if(error) return json({ok:false,error:"resolve_failed",detail:error.message},400);
    return json({ok:true,result:data});
  }

  if (action === "resume_ai") {
    const conversationId = clean(body?.conversation_id,80); if(!validUuid(conversationId)) return json({ok:false,error:"invalid_conversation_id"},400);
    const { data, error } = await sb.rpc("resume_conversation_ai_admin_v1",{p_conversation_id:conversationId,p_admin_user_id:user.id});
    if(error) return json({ok:false,error:"resume_failed",detail:error.message},400);
    return json({ok:true,result:data});
  }

  if (action === "emergency_stop") {
    const reason = clean(body?.reason,200) || "admin_emergency_stop";
    const { data, error } = await sb.rpc("whatsapp_bridge_emergency_stop_v1",{p_reason:reason});
    if(error) return json({ok:false,error:"emergency_stop_failed"},500);
    return json({ok:true,result:data});
  }

  // Mantido sem botão de liberação ampla. Mudanças de release continuam owner-only e auditadas.
  if (action === "configure_release") {
    if(!isOwner) return json({ok:false,error:"owner_required"},403);
    const mode = clean(body?.mode,20).toLowerCase();
    const canary = Math.max(0,Math.min(100,Number(body?.canary_percent)||0));
    const note = clean(body?.note,500) || null;
    const confirmation = clean(body?.confirmation,80) || null;
    const { data, error } = await sb.rpc("configure_whatsapp_release_v1",{
      p_mode:mode,p_canary_percent:canary,p_note:note,p_confirmation:confirmation,
    });
    if(error) return json({ok:false,error:"release_config_failed",detail:error.message},400);
    return json({ok:true,result:data});
  }

  return json({ok:false,error:"unknown_action"},400);
});
