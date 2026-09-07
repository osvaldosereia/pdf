import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function text(value: unknown, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function digits(value: unknown, max = 32) { return String(value ?? "").replace(/\D/g, "").slice(0, max); }
function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
function sanitizeSource(input: any) {
  const tags = Array.isArray(input?.tags) ? input.tags.slice(0, 30).map((v: unknown) => text(v, 80)).filter(Boolean) : [];
  const active = typeof input?.is_active === "boolean" ? input.is_active : typeof input?.ativo === "boolean" ? input.ativo : undefined;
  const out: Record<string, unknown> = {
    firebaseKey: text(input?.firebaseKey || input?.firebase_key || input?.id, 160),
    codigo: text(input?.codigo || input?.sku, 120), sku: text(input?.sku || input?.codigo, 120),
    nome: text(input?.nome || input?.name || input?.titulo, 300),
    gtin: digits(input?.gtin || input?.ean), ean: digits(input?.ean || input?.gtin), ncm: digits(input?.ncm, 16),
    marca: text(input?.marca, 160), fornecedor: text(input?.fornecedor, 200), embalagem: text(input?.embalagem, 120), unidade: text(input?.unidade, 40),
    categoria: text(input?.categoria, 160), subcategoria: text(input?.subcategoria, 160), subsubcategoria: text(input?.subsubcategoria, 160),
    gondola: text(input?.gondola ?? input?.["gôndola"], 80), prateleira: text(input?.prateleira, 80),
    validade: text(input?.validade || input?.data_validade, 40), url_imagem: text(input?.url_imagem || input?.imagem_url || input?.imagem, 1000),
    estoque: finiteNumber(input?.estoque), preco: finiteNumber(input?.preco), preco_custo: finiteNumber(input?.preco_custo),
    ativo: active, situacao: text(input?.situacao || input?.status, 30), tags,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== "" && v !== null && v !== undefined && (!Array.isArray(v) || v.length)));
}
function parseDate(value: unknown): string | null {
  const raw = text(value, 40); if (!raw) return null;
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = raw.match(/^(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})$/); if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`; const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server_config" }, 500);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ ok: false, error: "missing_token" }, 401);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user?.id) return json({ ok: false, error: "invalid_user" }, 401);
  const { data: admin, error: adminError } = await supabase.from("admin_users").select("role,is_active,display_name").eq("user_id", user.id).maybeSingle();
  if (adminError) return json({ ok: false, error: "admin_lookup_failed" }, 500);
  if (!admin?.is_active) return json({ ok: false, error: "admin_not_authorized" }, 403);

  let body: any; try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const action = text(body?.action || "health", 40).toLowerCase();

  if (action === "health") {
    const [{ count: verified }, { count: pending }] = await Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true }).eq("physically_verified", true),
      supabase.from("bling_commands").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    return json({ ok: true, user: { id: user.id, role: admin.role, display_name: admin.display_name || null }, verified_products: verified || 0, pending_bling: pending || 0 });
  }
  if (action === "start") {
    if (admin.role === "viewer") return json({ ok: false, error: "read_only" }, 403);
    const { data, error } = await supabase.rpc("start_inventory_count", { p_user_id: user.id, p_device_label: text(body?.device_label, 120) || null });
    if (error) return json({ ok: false, error: "start_failed", detail: error.message }, 400);
    return json({ ok: true, inventory_count_id: data });
  }
  if (action === "save") {
    if (admin.role === "viewer") return json({ ok: false, error: "read_only" }, 403);
    const source = sanitizeSource(body?.product || body?.source || {});
    const stock = finiteNumber(body?.counted_stock);
    if (stock === null || stock < 0) return json({ ok: false, error: "invalid_stock" }, 400);
    const gtin = digits((source as any).gtin || (source as any).ean);
    if (!gtin) return json({ ok: false, error: "gtin_required" }, 400);
    const price = finiteNumber((source as any).preco);
    const cost = finiteNumber((source as any).preco_custo);
    if (price !== null && price < 0) return json({ ok: false, error: "invalid_price" }, 400);
    if (cost !== null && cost < 0) return json({ ok: false, error: "invalid_cost" }, 400);
    const validity = parseDate(body?.validity_date);
    if (body?.validity_date && !validity) return json({ ok: false, error: "invalid_validity_date" }, 400);

    const { data: before } = await supabase.from("products")
      .select("id,is_active,price,cost,gondola,shelf")
      .eq("gtin", gtin).maybeSingle();

    let requestedActive = true;
    if (typeof body?.is_active === "boolean") requestedActive = body.is_active;
    else if (typeof (source as any).ativo === "boolean") requestedActive = (source as any).ativo;
    else if (["I", "INATIVO", "INACTIVE"].includes(text((source as any).situacao, 30).toUpperCase())) requestedActive = false;
    if (stock <= 0) requestedActive = false;

    const { data, error } = await supabase.rpc("save_verified_inventory_count", {
      p_inventory_count_id: body?.inventory_count_id || null,
      p_user_id: user.id,
      p_firebase_key: text(body?.firebase_key || (source as any).firebaseKey, 160) || null,
      p_source: source,
      p_counted_stock: stock,
      p_validity_date: validity,
      p_gondola: text(body?.gondola || (source as any).gondola, 80) || null,
      p_shelf: text(body?.shelf || (source as any).prateleira, 80) || null,
    });
    if (error) return json({ ok: false, error: "save_failed", detail: error.message }, 400);

    const productId = data?.product_id;
    if (productId) {
      const patch: Record<string, unknown> = { is_active: requestedActive };
      if (!requestedActive) patch.is_whatsapp_active = false;
      const { error: patchError } = await supabase.from("products").update(patch).eq("id", productId);
      if (patchError) return json({ ok: false, error: "product_status_save_failed", detail: patchError.message }, 400);

      if ((!before && !requestedActive) || (before && before.is_active !== requestedActive)) {
        await supabase.from("bling_commands").insert({
          command_type: requestedActive ? "activate_product" : "inactivate_product",
          product_id: productId,
          payload: { desired_status: requestedActive ? "A" : "I", source: "inventory_count" },
          status: "pending",
          created_by: user.id,
        });
      }
    }
    return json({ ok: true, ...data, is_active: requestedActive, price, cost });
  }
  if (action === "close") {
    if (admin.role === "viewer") return json({ ok: false, error: "read_only" }, 403);
    const countId = text(body?.inventory_count_id, 80);
    if (!countId) return json({ ok: false, error: "inventory_count_id_required" }, 400);
    const { data, error } = await supabase.rpc("close_inventory_count", { p_inventory_count_id: countId, p_user_id: user.id });
    if (error) return json({ ok: false, error: "close_failed", detail: error.message }, 400);
    return json({ ok: true, ...data });
  }
  if (action === "recent") {
    const limit = Math.min(50, Math.max(1, Number(body?.limit || 20)));
    let query = supabase.from("inventory_count_items")
      .select("id,inventory_count_id,ean,counted_stock,validity_date,counted_at,sync_status,product:products(id,name,image_url,brand,packaging,gondola,shelf,price,cost,is_active)")
      .order("counted_at", { ascending: false }).limit(limit);
    if (body?.inventory_count_id) query = query.eq("inventory_count_id", body.inventory_count_id);
    const { data, error } = await query;
    if (error) return json({ ok: false, error: "recent_failed", detail: error.message }, 400);
    return json({ ok: true, items: data || [] });
  }
  return json({ ok: false, error: "unknown_action" }, 400);
});
