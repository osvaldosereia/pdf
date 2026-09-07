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

  let body: any = {};
  try { body = await req.json(); } catch { return json({ok:false,error:"invalid_json"},400); }
  const action = clean(body?.action || "dashboard",60).toLowerCase();

  if (action === "dashboard") {
    const [{ data: dashboard, error: dashboardError }, { data: handoffs, error: handoffError }] = await Promise.all([
      sb.rpc("get_whatsapp_ops_dashboard_v1"),
      sb.from("human_handoffs")
        .select("id,conversation_id,customer_id,source_message_id,reason,priority,status,summary,claimed_by,claimed_at,created_at,updated_at,customer:customers(name),conversation:conversations(stage,last_inbound_at,last_outbound_at,mode,status,automation_cohort)")
        .in("status",["open","claimed"]).order("priority",{ascending:false}).order("created_at",{ascending:true}).limit(50),
    ]);
    if (dashboardError || handoffError) return json({ok:false,error:"dashboard_failed"},500);
    return json({ok:true,user:{id:user.id,role:admin.role,display_name:admin.display_name||null},dashboard,handoffs:handoffs||[]});
  }

  if (!canWrite) return json({ok:false,error:"read_only"},403);

  if (action === "claim_handoff") {
    const id = clean(body?.id,80); if(!validUuid(id)) return json({ok:false,error:"invalid_handoff_id"},400);
    const { data, error } = await sb.rpc("claim_human_handoff_admin_v1",{p_handoff_id:id,p_admin_user_id:user.id});
    if(error) return json({ok:false,error:"claim_failed",detail:error.message},400);
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

  // Não é exposto por botão nesta etapa. Existe para uma futura liberação assistida e auditada.
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
