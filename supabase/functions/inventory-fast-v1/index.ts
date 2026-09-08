import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const FIREBASE_PRODUCTS = "https://cedar-chemist-310801-default-rtdb.firebaseio.com/produtos";

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
const finite = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const isoDate = (value: unknown) => {
  const raw = text(value, 40);
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0] || null;
  return iso;
};

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

function variants(value: string) {
  const raw = text(value, 120);
  const numeric = digits(raw);
  const base = numeric || raw;
  const out = [base];
  if (/^\d+$/.test(base)) {
    if (base.length === 12) out.push(`0${base}`);
    if (base.length === 13 && base.startsWith("0")) out.push(base.slice(1));
    const noZero = base.replace(/^0+(?=\d)/, "");
    if (noZero) out.push(noZero);
  }
  return [...new Set(out.filter(Boolean))];
}

async function firebaseGet(url: string) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

async function findLegacyProduct(code: string) {
  const candidates = variants(code);

  for (const candidate of candidates) {
    const data = await firebaseGet(`${FIREBASE_PRODUCTS}/${encodeURIComponent(candidate)}.json`);
    if (data && typeof data === "object") return { key: candidate, product: data };
  }

  const fields = ["gtin", "ean", "codigo", "sku"];
  for (const field of fields) {
    for (const candidate of candidates) {
      const orderBy = encodeURIComponent(JSON.stringify(field));
      const equalTo = encodeURIComponent(JSON.stringify(candidate));
      const data = await firebaseGet(`${FIREBASE_PRODUCTS}.json?orderBy=${orderBy}&equalTo=${equalTo}&limitToFirst=1`);
      if (!data || typeof data !== "object") continue;
      const entry = Object.entries(data)[0];
      if (entry && entry[1] && typeof entry[1] === "object") return { key: entry[0], product: entry[1] };
    }
  }
  return null;
}

function normalizeLegacy(key: string, source: any, scannedCode: string) {
  const gtin = digits(source?.gtin || source?.ean || scannedCode);
  const active = typeof source?.ativo === "boolean"
    ? source.ativo
    : !["I", "INATIVO", "INACTIVE"].includes(text(source?.situacao || source?.status, 30).toUpperCase());
  return {
    id: null,
    firebase_key: text(key, 160) || null,
    sku: text(source?.sku || source?.codigo, 120) || null,
    name: text(source?.nome || source?.name || source?.titulo || source?.codigo, 300) || `EAN ${gtin || scannedCode}`,
    gtin: gtin || null,
    ncm: digits(source?.ncm, 16) || null,
    price: finite(source?.preco ?? source?.price),
    cost: finite(source?.preco_custo ?? source?.custo ?? source?.cost),
    stock: null,
    image_url: text(source?.url_imagem || source?.imagem_url || source?.imagem, 1200) || null,
    brand: text(source?.marca || source?.brand, 160) || null,
    category: text(source?.categoria || source?.category, 160) || null,
    subcategory: text(source?.subcategoria || source?.subcategory, 160) || null,
    subsubcategory: text(source?.subsubcategoria || source?.subsubcategory, 160) || null,
    packaging: text(source?.embalagem || source?.packaging, 120) || null,
    supplier: text(source?.fornecedor || source?.supplier, 200) || null,
    unit: text(source?.unidade || source?.unit, 40) || null,
    validity_date: isoDate(source?.validade || source?.data_validade),
    gondola: text(source?.gondola ?? source?.["gôndola"], 80) || null,
    shelf: text(source?.prateleira || source?.shelf, 80) || null,
    is_active: active,
    is_whatsapp_active: false,
    physically_verified: false,
    updated_at: null,
    fast_source: "firebase_legacy",
  };
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
    return json({ ok: true, products: rows, total: rows.length, truncated: rows.length >= hardLimit, generated_at: new Date().toISOString() });
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
    if (product) return json({ ok: true, product, source: "supabase" });

    const legacy = await findLegacyProduct(code || firebaseKey);
    if (legacy?.product) {
      return json({ ok: true, product: normalizeLegacy(legacy.key, legacy.product, code), source: "firebase_legacy", will_register_on_save: true });
    }
    return json({ ok: true, product: null, source: "none" });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
