import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const text = (value: unknown) => String(value ?? "").trim();

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server_config" }, 500);
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "unauthorized" }, 401);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ ok: false, error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const code = text(body?.bootstrap_code);
  const displayName = text(body?.display_name) || text(user.user_metadata?.display_name) || "Administrador";
  if (!code) return json({ ok: false, error: "bootstrap_code_required" }, 400);

  const { count } = await admin.from("admin_users").select("user_id", { count: "exact", head: true });
  if ((count || 0) > 0) return json({ ok: false, error: "bootstrap_closed" }, 409);
  const { data: secret } = await admin.from("system_secrets").select("id,key_hash,is_active").eq("key_name", "bootstrap_owner_v1").maybeSingle();
  if (!secret?.is_active) return json({ ok: false, error: "bootstrap_closed" }, 409);
  if ((await sha256Hex(code)) !== secret.key_hash) return json({ ok: false, error: "invalid_bootstrap_code" }, 401);

  const { error: insertError } = await admin.from("admin_users").insert({ user_id: user.id, role: "owner", is_active: true, display_name: displayName, email: user.email || null });
  if (insertError) return json({ ok: false, error: "create_admin_failed", detail: insertError.message }, 500);
  await admin.from("system_secrets").update({ is_active: false, rotated_at: new Date().toISOString() }).eq("id", secret.id);
  return json({ ok: true, user_id: user.id, email: user.email || null, role: "owner", bootstrap_closed: true });
});
