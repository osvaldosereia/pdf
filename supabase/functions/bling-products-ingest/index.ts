import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "server_config" }, 500);
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const supplied = req.headers.get("x-da-ingest-key") || "";
  const { data: secret } = await supabase.from("system_secrets").select("key_hash,is_active").eq("key_name", "make_whatsapp_ingest").maybeSingle();
  if (!supplied || !secret?.is_active || (await sha256Hex(supplied)) !== secret.key_hash) return json({ ok: false, error: "unauthorized" }, 401);

  // O novo catálogo é seletivo: uma importação em massa só pode ocorrer durante
  // uma janela temporária liberada explicitamente em automation_config.
  const gate = await supabase.rpc("claim_bling_import_gate");
  if (gate.error || gate.data !== true) return json({ ok: false, error: "bulk_product_import_disabled" }, 403);

  let body: any; try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const page = Number(body?.page || 1);
  const payload = body?.bling ?? body;
  const rowsRaw = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : payload?.data ? [payload.data] : [];
  const runInsert = await supabase.from("sync_runs").insert({ source: "bling", entity: "products", page, records_received: rowsRaw.length }).select("id").single();
  const runId = runInsert.data?.id ?? null;

  try {
    const rows = rowsRaw.filter((p: any) => p?.id && p?.nome).map((p: any) => ({
      bling_product_id: Number(p.id), sku: p.codigo ? String(p.codigo) : null, name: String(p.nome),
      gtin: p.gtin ? String(p.gtin) : (p.gtinEmbalagem ? String(p.gtinEmbalagem) : null), ncm: p.ncm ? String(p.ncm) : null,
      price: p.preco == null ? null : Number(p.preco), image_url: p.imagemURL || p.urlImagem || null,
      is_whatsapp_active: false, source_system: "bling_bulk_manual", sync_status: "imported_unverified",
      metadata: { situacao: p.situacao ?? null, tipo: p.tipo ?? null, formato: p.formato ?? null, descricaoCurta: p.descricaoCurta ?? null, original: p },
      last_bling_sync_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }));
    let upserted = 0;
    if (rows.length) {
      const { data, error } = await supabase.from("products").upsert(rows, { onConflict: "bling_product_id" }).select("id");
      if (error) throw error;
      upserted = data?.length || 0;
    }
    if (runId) await supabase.from("sync_runs").update({ status: "success", records_upserted: upserted, finished_at: new Date().toISOString() }).eq("id", runId);
    return json({ ok: true, page, received: rowsRaw.length, upserted, has_more: rowsRaw.length >= 100 });
  } catch (e) {
    if (runId) await supabase.from("sync_runs").update({ status: "error", error_text: String((e as any)?.message || e), finished_at: new Date().toISOString() }).eq("id", runId);
    return json({ ok: false, error: "product_sync_failed", detail: String((e as any)?.message || e) }, 500);
  }
});
