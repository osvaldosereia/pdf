import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

const text = (value: unknown, max = 80) => String(value ?? "")
  .replace(/[\u0000-\u001f\u007f]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ ok: false, error: "server_config" }, 500);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "missing_token" }, 401);

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await sb.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.id) return json({ ok: false, error: "invalid_user" }, 401);

  const { data: admin, error: adminError } = await sb.from("admin_users")
    .select("role,is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (adminError) return json({ ok: false, error: "admin_lookup_failed" }, 500);
  if (!admin?.is_active) return json({ ok: false, error: "admin_not_authorized" }, 403);
  if (admin.role === "viewer") return json({ ok: false, error: "read_only" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const action = text(body?.action || "save_batch", 40).toLowerCase();
  if (action !== "save_batch") return json({ ok: false, error: "unknown_action" }, 400);

  const mode = text(body?.mode, 20).toLowerCase();
  if (!["add", "balance"].includes(mode)) return json({ ok: false, error: "invalid_mode" }, 400);
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items) return json({ ok: false, error: "items_array_required" }, 400);
  if (items.length > 1000) return json({ ok: false, error: "too_many_items" }, 400);

  const { data, error } = await sb.rpc("save_fast_inventory_batch_v1", {
    p_user_id: user.id,
    p_mode: mode,
    p_items: items,
  });
  if (error) return json({ ok: false, error: "save_fast_batch_failed", detail: error.message }, 400);

  return json({ ok: true, ...data });
});
