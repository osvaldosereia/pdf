import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type,x-da-ingest-key",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "no-store",
};
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const MIME: Record<string, Set<string>> = {
  audio: new Set(["audio/aac","audio/mp4","audio/mpeg","audio/amr","audio/ogg","audio/opus","audio/webm"]),
  image: new Set(["image/jpeg","image/png","image/webp"]),
};
const EXT: Record<string,string> = {
  "audio/aac":"aac","audio/mp4":"m4a","audio/mpeg":"mp3","audio/amr":"amr","audio/ogg":"ogg","audio/opus":"opus","audio/webm":"webm",
  "image/jpeg":"jpg","image/png":"png","image/webp":"webp",
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function clean(value: unknown, max = 500): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function isoTimestamp(value: unknown): string {
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) return new Date(Number(value) * 1000).toISOString();
    const d = new Date(value); if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}
function first<T>(value: T[] | undefined | null): T | null { return Array.isArray(value) && value.length ? value[0] : null; }
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function validUuid(v: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(v,80));
}

function normalizeInbound(raw: any) {
  if (raw?.phone_number_id && raw?.message_id && raw?.from) {
    const type = clean(raw.message_type || "other", 30).toLowerCase();
    const mediaId = clean(raw.media_id || raw.audio_id || raw.image_id || raw.video_id || raw.document_id, 200) || null;
    const interactivePayload = type === "interactive" ? {
      type: clean(raw.interactive_type,40) || null,
      id: clean(raw.interactive_id,256) || null,
      title: clean(raw.interactive_title,256) || null,
      raw: {},
    } : {};
    return {
      wabaId: clean(raw.waba_id,100) || null,
      phoneNumberId: clean(raw.phone_number_id,100),
      from: clean(raw.from,40),
      profileName: clean(raw.contact_name,160) || null,
      messageId: clean(raw.message_id,240),
      timestamp: isoTimestamp(raw.timestamp),
      messageType: type,
      bodyText: type === "interactive" ? interactivePayload.title : (clean(raw.text_body || raw.caption,4000) || null),
      mediaId,
      interactivePayload,
      referral: raw.referral && typeof raw.referral === "object" ? raw.referral : {},
      rawEvent: {
        source: "whatsapp",
        bridge: "make_flat_v1",
        phone_number_id: clean(raw.phone_number_id,100),
        display_phone_number: clean(raw.display_phone_number,40) || null,
        message_id: clean(raw.message_id,240),
        message_type: type,
      },
    };
  }

  const metadata = raw?.metadata || {};
  const contact = first<any>(raw?.contacts) || {};
  const message = first<any>(raw?.messages) || {};
  const type = String(message?.type || "other");
  let bodyText: string | null = null;
  let mediaId: string | null = null;
  let interactivePayload: any = {};
  if (type === "text") bodyText = message?.text?.body ?? null;
  if (["audio","image","video","document","sticker"].includes(type)) {
    mediaId = message?.[type]?.id ?? null;
    bodyText = message?.[type]?.caption ?? null;
  }
  if (type === "interactive") {
    const br = message?.interactive?.button_reply;
    const lr = message?.interactive?.list_reply;
    interactivePayload = { type: message?.interactive?.type ?? null, id: br?.id ?? lr?.id ?? null, title: br?.title ?? lr?.title ?? null, raw: message?.interactive ?? {} };
    bodyText = interactivePayload.title;
  }
  return {
    wabaId: raw?.id ? String(raw.id) : null,
    phoneNumberId: metadata?.phone_number_id ? String(metadata.phone_number_id) : "",
    from: message?.from ? String(message.from) : "",
    profileName: contact?.profile?.name || null,
    messageId: message?.id ? String(message.id) : "",
    timestamp: isoTimestamp(message?.timestamp),
    messageType: type,
    bodyText,
    mediaId,
    interactivePayload,
    referral: message?.referral || raw?.referral || {},
    rawEvent: { ...raw, source: "whatsapp" },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok:false, error:"method_not_allowed" },405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return jsonResponse({ ok:false,error:"server_config" },500);
  const supabase = createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});

  const suppliedKey = req.headers.get("x-da-ingest-key") || "";
  if (!suppliedKey) return jsonResponse({ok:false,error:"unauthorized"},401);
  const {data:secretRow,error:secretError} = await supabase.from("system_secrets").select("key_hash,is_active").eq("key_name","make_whatsapp_ingest").maybeSingle();
  if (secretError || !secretRow?.is_active || (await sha256Hex(suppliedKey)) !== secretRow.key_hash) return jsonResponse({ok:false,error:"unauthorized"},401);

  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); } catch { return jsonResponse({ok:false,error:"invalid_form"},400); }
    if (clean(form.get("action"),40) !== "attach_media") return jsonResponse({ok:false,error:"invalid_action"},400);
    const messageRowId = clean(form.get("message_row_id"),80);
    const kind = clean(form.get("kind"),20).toLowerCase();
    const mediaId = clean(form.get("meta_media_id"),200);
    const f = form.get("file");
    if (!validUuid(messageRowId) || !["audio","image"].includes(kind) || !(f instanceof File)) return jsonResponse({ok:false,error:"invalid_media_request"},400);
    if (f.size <= 0 || f.size > MAX_MEDIA_BYTES) return jsonResponse({ok:false,error:"media_too_large"},413);
    const mime = f.type.split(";")[0].trim().toLowerCase();
    if (!MIME[kind]?.has(mime)) return jsonResponse({ok:false,error:"unsupported_media_type",mime},415);

    const {data:msg,error:msgError} = await supabase.from("messages")
      .select("id,conversation_id,message_type,media_id,raw_event,conversation:conversations(customer_id)")
      .eq("id",messageRowId).maybeSingle();
    if (msgError || !msg) return jsonResponse({ok:false,error:"message_not_found"},404);
    if (msg.raw_event?.source !== "whatsapp" || msg.message_type !== kind) return jsonResponse({ok:false,error:"media_scope_mismatch"},409);
    if (mediaId && msg.media_id && String(msg.media_id) !== mediaId) return jsonResponse({ok:false,error:"meta_media_mismatch"},409);

    const {data:existing} = await supabase.from("room_media")
      .select("id,processing_status,mime_type,bytes,object_path").eq("message_id",messageRowId).eq("conversation_id",msg.conversation_id).maybeSingle();
    if (existing) return jsonResponse({ok:true,duplicate:true,room_media:existing});

    const {data:sessionId,error:sessionError} = await supabase.rpc("ensure_whatsapp_catalog_session",{p_conversation_id:msg.conversation_id});
    if (sessionError || !sessionId) return jsonResponse({ok:false,error:"session_unavailable"},500);
    const ext = EXT[mime] || "bin";
    const objectPath = `sessions/${sessionId}/${kind}/whatsapp/${crypto.randomUUID()}.${ext}`;
    const {error:uploadError} = await supabase.storage.from("shopping-room-media").upload(objectPath,f,{contentType:mime,upsert:false});
    if (uploadError) return jsonResponse({ok:false,error:"media_upload_failed"},500);

    const {data:roomMedia,error:mediaError} = await supabase.from("room_media").insert({
      catalog_session_id:sessionId,conversation_id:msg.conversation_id,customer_id:(msg as any)?.conversation?.customer_id ?? null,
      message_id:messageRowId,kind,bucket:"shopping-room-media",object_path:objectPath,mime_type:mime,bytes:f.size,
      processing_status:"uploaded",metadata:{source:"whatsapp",meta_media_id:mediaId||null}
    }).select("id,processing_status,mime_type,bytes,object_path").single();
    if (mediaError) {
      await supabase.storage.from("shopping-room-media").remove([objectPath]);
      return jsonResponse({ok:false,error:"media_record_failed"},500);
    }

    const jobType = kind === "audio" ? "transcription" : "vision";
    const {data:job,error:jobError} = await supabase.rpc("queue_ai_job_for_message",{
      p_message_id:messageRowId,p_job_type:jobType,p_input:{source:"whatsapp",room_media_id:roomMedia.id,object_path:objectPath,mime_type:mime}
    });
    if (jobError) return jsonResponse({ok:false,error:"media_queue_failed"},500);
    await supabase.from("room_media").update({processing_status:job?.status === "pending" ? "queued" : "held"}).eq("id",roomMedia.id);
    return jsonResponse({ok:true,duplicate:false,message_row_id:messageRowId,conversation_id:msg.conversation_id,room_media:{...roomMedia,processing_status:job?.status === "pending" ? "queued" : "held"},ai_job:job});
  }

  let raw: any;
  try { raw = await req.json(); if (typeof raw === "string") raw = JSON.parse(raw); }
  catch { return jsonResponse({ok:false,error:"invalid_json"},400); }
  const input = normalizeInbound(raw);
  if (!input.phoneNumberId || !input.messageId || !input.from) return jsonResponse({ok:false,error:"not_inbound_message",should_reply:false},200);

  const {data,error} = await supabase.rpc("ingest_whatsapp_message",{
    p_phone_number_id:input.phoneNumberId,p_waba_id:input.wabaId,p_from:input.from,p_profile_name:input.profileName,
    p_message_id:input.messageId,p_message_timestamp:input.timestamp,p_message_type:input.messageType,
    p_body_text:input.bodyText,p_media_id:input.mediaId,p_interactive_payload:input.interactivePayload,
    p_referral:input.referral,p_raw_event:input.rawEvent,
  });
  if (error) return jsonResponse({ok:false,error:"database_ingest_failed",detail:error.message},500);

  const result:any = data || {};
  if (result?.ignored === true) {
    return jsonResponse({
      ok:result?.ok===true,
      ignored:true,
      stale_ignored:result?.stale_ignored===true,
      reason:result?.reason||"ignored",
      should_reply:false,
      reply_type:"none",
      media_kind:null,
      media_id:null,
      conversation_id:null,
      message_row_id:null,
    },200);
  }

  const kind = result?.reply?.kind || "none";
  const out:any = {
    ok:result?.ok===true,duplicate:result?.duplicate===true,should_reply:result?.should_reply===true,
    conversation_id:result?.conversation_id??null,customer_id:result?.customer_id??null,
    message_row_id:result?.message_row_id??null,session_id:result?.session_id??null,media_id:input.mediaId,
    media_kind:["audio","image"].includes(input.messageType)?input.messageType:null,
    to:result?.customer_phone??`+${String(input.from).replace(/\D/g,"")}`,
    mode:result?.mode??"ai",action:kind,ai_job:result?.ai_job??result?.reply?.ai_job??null,
  };

  if (kind === "interactive_buttons") {
    const buttons = Array.isArray(result?.reply?.buttons) ? result.reply.buttons : [];
    out.reply_type="interactive"; out.reply_body=result?.reply?.body_text||"Como posso te ajudar?";
    out.button1_id=buttons?.[0]?.id||"menu_cestas"; out.button1_title=buttons?.[0]?.title||"Ver cestas";
    out.button2_id=buttons?.[1]?.id||"menu_pagamento"; out.button2_title=buttons?.[1]?.title||"Pagamento";
    out.button3_id=buttons?.[2]?.id||"menu_ofertas"; out.button3_title=buttons?.[2]?.title||"Ofertas";
  } else if (kind === "route_interactive") {
    const id = result?.reply?.payload?.id || "";
    out.reply_type="text"; out.should_reply=true;
    if (id === "menu_cestas") out.reply_body="Perfeito! 🧺 Me diga qual cesta você procura ou mande um áudio contando o que precisa. Você também pode pedir para retirar, trocar ou acrescentar produtos.";
    else if (id === "menu_pagamento") out.reply_body="O pagamento é feito somente na entrega. Se quiser, posso continuar e montar seu pedido agora.";
    else if (id === "menu_ofertas") out.reply_body="Certo! Vou considerar as ofertas disponíveis enquanto montamos seu pedido. Você pode me dizer o que procura ou mandar um áudio.";
    else out.reply_body="Recebi sua escolha. Pode continuar me dizendo o que precisa.";
  } else {
    out.reply_type="none";
  }
  return jsonResponse(out,200);
});
