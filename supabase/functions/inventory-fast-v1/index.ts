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

const text = (value: unknown, max = 240) => String(value ?? "")
  .replace(/[\u0000-\u001f\u007f]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

const digits = (value: unknown, max = 32) => String(value ?? "").replace(/\D/g, "").slice(0, max);
const PRODUCT_FIELDS = "id,firebase_key,sku,name,gtin,ncm,price,cost,stock,image_url,brand,category,subcategory,subsubcategory,packaging,supplier,unit,validity_date,gondola,shelf,is_active,is_whatsapp_active,physically_verified,updated_at";

async function authorized(req: Request) {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return { error: json({ ok: false, error: "server_config" }, 500) };

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: json({ ok: false, error: "missing_token" }, 401) };

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await sb.auth.getUser(token);
  if (userError || !userData?.user?.id) return { error: json({ ok: false, error: "invalid_user" }, 401) };

  const { data: admin, error: adminError } = await sb.from("admin_users")
    .select("role,is_active")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (adminError) return { error: json({ ok: false, error: "admin_lookup_failed" }, 500) };
  if (!admin?.is_active) return { error: json({ ok: false, error: "admin_not_authorized" }, 403) };

  return { sb, user: userData.user, admin };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const auth = await authorized(req);
  if (auth.error) return auth.error;
  const sb = auth.sb!;

  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const action = text(body?.action || "catalog", 40).toLowerCase();

  if (action === "catalog") {
    const rows: any[] = [];
    const pageSize = 1000;
    const hardLimit = 5000;

    for (let from = 0; from < hardLimit; from += pageSize) {
      const { data, error } = await sb.from("products")
        .select(PRODUCT_FIELDS)
        .order("name", { ascending: true })
        .range(from, Math.min(from + pageSize - 1, hardLimit - 1));
      if (error) return json({ ok: false, error: "catalog_failed", detail: error.message }, 400);
      const page = data || [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }

    return json({
      ok: true,
      products: rows,
      total: rows.length,
      truncated: rows.length >= hardLimit,
      generated_at: new Date().toISOString(),
    });
  }

  if (action === "lookup") {
    const code = text(body?.code, 120);
    const numeric = digits(code);
    const firebaseKey = text(body?.firebase_key, 160);
    if (!code && !firebaseKey) return json({ ok: false, error: "code_required" }, 400);

    let product: any = null;
    if (numeric) {
      const { data } = await sb.from("products").select(PRODUCT_FIELDS).eq("gtin", numeric).limit(1).maybeSingle();
      product = data || null;
    }
    if (!product && firebaseKey) {
      const { data } = await sb.from("products").select(PRODUCT_FIELDS).eq("firebase_key", firebaseKey).limit(1).maybeSingle();
      product = data || null;
    }
    if (!product && code) {
      const { data } = await sb.from("products").select(PRODUCT_FIELDS).eq("sku", code).limit(1).maybeSingle();
      product = data || null;
    }

    return json({ ok: true, product });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
