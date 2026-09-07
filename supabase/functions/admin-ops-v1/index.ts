import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const text = (v: unknown, max = 300) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const int = (v: unknown, min = 0, max = 500) => Math.min(max, Math.max(min, Number.parseInt(String(v ?? min), 10) || min));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ ok: false, error: "server_config" }, 500);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "missing_token" }, 401);

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: ud, error: ue } = await sb.auth.getUser(token);
  if (ue || !ud?.user?.id) return json({ ok: false, error: "invalid_user" }, 401);
  const user = ud.user;
  const { data: admin, error: ae } = await sb.from("admin_users").select("role,is_active,display_name").eq("user_id", user.id).maybeSingle();
  if (ae) return json({ ok: false, error: "admin_lookup_failed" }, 500);
  if (!admin?.is_active) return json({ ok: false, error: "admin_not_authorized" }, 403);

  let body: any; try { body = await req.json(); } catch { body = {}; }
  const action = text(body?.action || "health", 50).toLowerCase();
  const canWrite = admin.role === "owner" || admin.role === "operator";

  if (action === "health") {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const [verified, pending, errors, openCounts, countedToday, whatsapp] = await Promise.all([
      sb.from("products").select("id", { count: "exact", head: true }).eq("physically_verified", true),
      sb.from("bling_commands").select("id", { count: "exact", head: true }).eq("status", "pending"),
      sb.from("bling_commands").select("id", { count: "exact", head: true }).eq("status", "error"),
      sb.from("inventory_counts").select("id", { count: "exact", head: true }).eq("status", "open"),
      sb.from("inventory_count_items").select("id", { count: "exact", head: true }).gte("counted_at", today.toISOString()),
      sb.from("products").select("id", { count: "exact", head: true }).eq("is_whatsapp_active", true),
    ]);
    const { data: recentCounts } = await sb.from("inventory_counts").select("id,status,item_count,pending_sync,device_label,started_at,closed_at").order("started_at", { ascending: false }).limit(6);
    const { data: recentErrors } = await sb.from("bling_commands").select("id,command_type,status,attempts,error_message,created_at,updated_at,product:products(name,gtin)").eq("status", "error").order("updated_at", { ascending: false }).limit(6);
    return json({ ok: true, user: { id: user.id, email: user.email || null, role: admin.role, display_name: admin.display_name || null }, metrics: { verified_products: verified.count || 0, pending_bling: pending.count || 0, bling_errors: errors.count || 0, open_counts: openCounts.count || 0, counted_today: countedToday.count || 0, whatsapp_active: whatsapp.count || 0 }, recent_counts: recentCounts || [], recent_errors: recentErrors || [] });
  }

  if (action === "products") {
    const limit = int(body?.limit, 10, 100); const page = int(body?.page, 1, 100000); const from = (page - 1) * limit; const to = from + limit - 1;
    const q = text(body?.q, 100); const sync = text(body?.sync_status, 50); const status = text(body?.status, 30);
    let query = sb.from("products").select("id,bling_product_id,sku,name,gtin,ncm,price,cost,stock,image_url,brand,category,subcategory,packaging,validity_date,gondola,shelf,is_active,is_whatsapp_active,is_offer,physically_verified,last_counted_at,sync_status,sync_error,updated_at", { count: "exact" }).eq("physically_verified", true).order("last_counted_at", { ascending: false }).range(from, to);
    if (q) { const safe = q.replace(/[,%()]/g, " ").trim(); if (safe) query = query.or(`name.ilike.%${safe}%,gtin.ilike.%${safe}%,sku.ilike.%${safe}%,brand.ilike.%${safe}%`); }
    if (sync) query = query.eq("sync_status", sync);
    if (status === "whatsapp") query = query.eq("is_whatsapp_active", true);
    if (status === "offer") query = query.eq("is_offer", true);
    if (status === "no-stock") query = query.eq("stock", 0);
    const { data, error, count } = await query;
    if (error) return json({ ok: false, error: "products_failed", detail: error.message }, 400);
    return json({ ok: true, products: data || [], total: count || 0, page, limit });
  }

  if (action === "product") {
    const id = text(body?.id, 80); if (!id) return json({ ok: false, error: "id_required" }, 400);
    const { data: product, error } = await sb.from("products").select("*").eq("id", id).maybeSingle();
    if (error || !product) return json({ ok: false, error: "product_not_found" }, 404);
    const { data: history } = await sb.from("inventory_count_items").select("id,previous_stock,counted_stock,previous_validity_date,validity_date,counted_at,sync_status,sync_error,gondola,shelf").eq("product_id", id).order("counted_at", { ascending: false }).limit(20);
    return json({ ok: true, product, count_history: history || [] });
  }

  if (action === "update_merchandising") {
    if (!canWrite) return json({ ok: false, error: "read_only" }, 403);
    const id = text(body?.id, 80); if (!id) return json({ ok: false, error: "id_required" }, 400);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body?.is_whatsapp_active === "boolean") patch.is_whatsapp_active = body.is_whatsapp_active;
    if (typeof body?.is_offer === "boolean") patch.is_offer = body.is_offer;
    if (body?.whatsapp_category !== undefined) patch.whatsapp_category = text(body.whatsapp_category, 120) || null;
    const { data, error } = await sb.from("products").update(patch).eq("id", id).select("id,is_whatsapp_active,is_offer,whatsapp_category,updated_at").single();
    if (error) return json({ ok: false, error: "update_failed", detail: error.message }, 400);
    return json({ ok: true, product: data });
  }

  if (action === "counts") {
    const limit = int(body?.limit, 10, 100);
    const { data, error } = await sb.from("inventory_counts").select("id,status,device_label,item_count,pending_sync,started_at,closed_at,opened_by").order("started_at", { ascending: false }).limit(limit);
    if (error) return json({ ok: false, error: "counts_failed", detail: error.message }, 400);
    return json({ ok: true, counts: data || [] });
  }

  if (action === "count_items") {
    const id = text(body?.id, 80); if (!id) return json({ ok: false, error: "id_required" }, 400);
    const { data, error } = await sb.from("inventory_count_items").select("id,ean,previous_stock,counted_stock,previous_validity_date,validity_date,counted_at,sync_status,sync_error,gondola,shelf,product:products(id,name,image_url,brand,packaging)").eq("inventory_count_id", id).order("counted_at", { ascending: false }).limit(300);
    if (error) return json({ ok: false, error: "count_items_failed", detail: error.message }, 400);
    return json({ ok: true, items: data || [] });
  }

  if (action === "queue") {
    const limit = int(body?.limit, 10, 100); const status = text(body?.status, 30);
    let query = sb.from("bling_commands").select("id,command_type,status,attempts,max_attempts,available_at,locked_at,finished_at,error_message,created_at,updated_at,product:products(id,name,gtin,stock)").order("created_at", { ascending: false }).limit(limit);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return json({ ok: false, error: "queue_failed", detail: error.message }, 400);
    return json({ ok: true, commands: data || [] });
  }

  if (action === "retry_command") {
    if (!canWrite) return json({ ok: false, error: "read_only" }, 403);
    const id = text(body?.id, 80); if (!id) return json({ ok: false, error: "id_required" }, 400);
    const { data, error } = await sb.from("bling_commands").update({ status: "pending", available_at: new Date().toISOString(), error_message: null, locked_at: null, locked_by: null, finished_at: null, updated_at: new Date().toISOString() }).eq("id", id).eq("status", "error").select("id,status").maybeSingle();
    if (error) return json({ ok: false, error: "retry_failed", detail: error.message }, 400);
    if (!data) return json({ ok: false, error: "command_not_retryable" }, 409);
    return json({ ok: true, command: data });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
