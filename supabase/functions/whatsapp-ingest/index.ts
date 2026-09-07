import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-da-ingest-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isoTimestamp(value: unknown): string {
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return new Date(Number(value) * 1000).toISOString();
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function first<T>(value: T[] | undefined | null): T | null {
  return Array.isArray(value) && value.length ? value[0] : null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return jsonResponse({ ok: false, error: "server_config" }, 500);

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const suppliedKey = req.headers.get("x-da-ingest-key") || "";
  if (!suppliedKey) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

  const { data: secretRow, error: secretError } = await supabase
    .from("system_secrets").select("key_hash,is_active").eq("key_name", "make_whatsapp_ingest").maybeSingle();
  if (secretError || !secretRow?.is_active) return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  if ((await sha256Hex(suppliedKey)) !== secretRow.key_hash) return jsonResponse({ ok: false, error: "unauthorized" }, 401);

  let raw: any;
  try { raw = await req.json(); if (typeof raw === "string") raw = JSON.parse(raw); }
  catch { return jsonResponse({ ok: false, error: "invalid_json" }, 400); }

  const metadata = raw?.metadata || {};
  const contact = first<any>(raw?.contacts) || {};
  const message = first<any>(raw?.messages) || {};
  if (!metadata?.phone_number_id || !message?.id || !message?.from) {
    return jsonResponse({ ok: false, error: "not_inbound_message", should_reply: false }, 200);
  }

  const messageType = String(message?.type || "other");
  let bodyText: string | null = null;
  let mediaId: string | null = null;
  let interactivePayload: any = {};
  if (messageType === "text") bodyText = message?.text?.body ?? null;
  if (["audio", "image", "video", "document", "sticker"].includes(messageType)) {
    mediaId = message?.[messageType]?.id ?? null;
    bodyText = message?.[messageType]?.caption ?? null;
  }
  if (messageType === "interactive") {
    const br = message?.interactive?.button_reply;
    const lr = message?.interactive?.list_reply;
    interactivePayload = { type: message?.interactive?.type ?? null, id: br?.id ?? lr?.id ?? null, title: br?.title ?? lr?.title ?? null, raw: message?.interactive ?? {} };
    bodyText = interactivePayload.title;
  }

  const referral = message?.referral || raw?.referral || {};
  const profileName = contact?.profile?.name || null;
  const { data, error } = await supabase.rpc("ingest_whatsapp_message", {
    p_phone_number_id: String(metadata.phone_number_id), p_waba_id: raw?.id ? String(raw.id) : null,
    p_from: String(message.from), p_profile_name: profileName, p_message_id: String(message.id),
    p_message_timestamp: isoTimestamp(message.timestamp), p_message_type: messageType,
    p_body_text: bodyText, p_media_id: mediaId, p_interactive_payload: interactivePayload,
    p_referral: referral, p_raw_event: raw,
  });
  if (error) return jsonResponse({ ok: false, error: "database_ingest_failed", detail: error.message }, 500);

  const result: any = data || {};
  const kind = result?.reply?.kind || "none";
  const out: any = {
    ok: result?.ok === true, duplicate: result?.duplicate === true, should_reply: result?.should_reply === true,
    conversation_id: result?.conversation_id ?? null, customer_id: result?.customer_id ?? null,
    to: result?.customer_phone ?? (message?.from ? `+${String(message.from).replace(/\D/g, "")}` : null),
    mode: result?.mode ?? "ai", action: kind,
  };
  if (kind === "interactive_buttons") {
    const buttons = Array.isArray(result?.reply?.buttons) ? result.reply.buttons : [];
    out.reply_type = "interactive"; out.reply_body = result?.reply?.body_text || "Como posso te ajudar?";
    out.button1_id = buttons?.[0]?.id || "menu_cestas"; out.button1_title = buttons?.[0]?.title || "Ver cestas";
    out.button2_id = buttons?.[1]?.id || "menu_pagamento"; out.button2_title = buttons?.[1]?.title || "Pagamento";
    out.button3_id = buttons?.[2]?.id || "menu_ofertas"; out.button3_title = buttons?.[2]?.title || "Ofertas";
  } else if (kind === "route_interactive") {
    const id = result?.reply?.payload?.id || ""; out.reply_type = "text";
    if (id === "menu_cestas") out.reply_body = "Perfeito! 🧺 Me diga qual cesta você procura ou mande um áudio contando o que precisa. Você também pode pedir para retirar, trocar ou acrescentar produtos.";
    else if (id === "menu_pagamento") out.reply_body = "O pagamento é feito somente na entrega. Se quiser, posso continuar e montar seu pedido agora.";
    else if (id === "menu_ofertas") out.reply_body = "Certo! Vou considerar as ofertas disponíveis enquanto montamos seu pedido. Você pode me dizer o que procura ou mandar um áudio.";
    else out.reply_body = "Recebi sua escolha. Pode continuar me dizendo o que precisa.";
    out.should_reply = true;
  } else if (kind === "needs_media_ai" || kind === "needs_ai") out.reply_type = "none";
  else out.reply_type = "none";
  return jsonResponse(out, 200);
});
