// supabase/functions/whatsapp-send-link/index.ts  (v2 — slug URL + headline + trimmed body)
//
// CHANNEL B (web-first): sends a plain WhatsApp text message with a CLEAN, per-question
// share link (/s/<slug>) that renders a question-specific preview card and redirects
// into the SPA. Body is trimmed to a short headline so it doesn't duplicate the card.
//
// Body: { phone_number, question_id, question_text?, question_summary?, broadcast_id?, forward_chain_id? }
// (question_text/summary are now optional — the function fetches the question itself.)
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_PHONE_HASH_SALT,
//      WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, PUBLIC_SITE_URL
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown) =>
  new Response(JSON.stringify(o), { headers: { ...CORS, "Content-Type": "application/json" } });

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function shortRef() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let r = "";
  for (const b of bytes) r += alphabet[b % alphabet.length];
  return r;
}
// Short, human headline: prefer the curated share_headline, else first sentence of the question.
function shortHeadline(question: string, override?: string | null) {
  if (override && override.trim()) return override.trim();
  const t = (question || "").trim();
  const m = t.match(/^(.{20,110}?[.?!])(\s|$)/);
  if (m) return m[1];
  return t.length > 110 ? t.slice(0, 107).trim() + "…" : t;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { phone_number, question_id, question_text, broadcast_id, forward_chain_id } = await req.json();

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SALT = Deno.env.get("WHATSAPP_PHONE_HASH_SALT");
    const TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const SITE = Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.stancecapture.com";

    if (!SALT || !TOKEN || !PHONE_NUMBER_ID) return json({ sent: false, reason: "missing_server_configuration" });
    if (!question_id) return json({ sent: false, reason: "missing_required_fields" });
    if (!/^\+[1-9]\d{6,14}$/.test(phone_number ?? "")) return json({ sent: false, reason: "invalid_phone_format" });

    const supabase = createClient(SUPABASE_URL, SERVICE);

    // Fetch the question (slug + headline + text) — single source of truth for the link.
    const { data: qrow } = await supabase
      .from("questions")
      .select("id, slug, question, share_headline, context_summary, summary")
      .eq("id", question_id)
      .maybeSingle();
    if (!qrow) return json({ sent: false, reason: "question_not_found" });

    const phoneHash = await sha256Hex(phone_number + SALT);

    const { data: optOut } = await supabase
      .from("whatsapp_optouts").select("is_active").eq("phone_hash", phoneHash).eq("is_active", true).maybeSingle();
    if (optOut) return json({ sent: false, reason: "opted_out" });

    // Mint a ref + register the chain node (FK target for the page's stance insert).
    const ref = forward_chain_id ?? shortRef();
    const { error: chainErr } = await supabase.from("whatsapp_forward_chains").insert({
      id: ref, question_id, root_phone_hash: phoneHash, parent_forward_chain_id: forward_chain_id ?? null, depth: 0,
    });
    if (chainErr && chainErr.code !== "23505") console.error("forward_chains insert error:", chainErr.message);

    // Clean per-question share URL (served by /api/s/[slug] -> per-question OG + redirect).
    const slugOrId = qrow.slug || qrow.id;
    const url = `${SITE}/s/${slugOrId}?ref=${ref}`;

    // Option A: the FULL question lives in the body (never truncated by WhatsApp),
    // with the context line beneath it. The preview card carries the short headline.
    const fullQuestion = (qrow.question ?? question_text ?? "").trim();
    const context = (qrow.context_summary ?? qrow.summary ?? "").trim();
    const body =
      `${fullQuestion}\n` +
      (context ? `\n${context}\n` : "") +
      `\nSee where people stand & add yours 👇\n${url}`;

    const resp = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone_number.replace("+", ""),
        type: "text",
        text: { preview_url: true, body },
      }),
    });
    const data = await resp.json();

    if (!resp.ok) {
      if (broadcast_id) {
        await supabase.from("whatsapp_delivery_log")
          .insert({ broadcast_id, phone_hash: phoneHash, status: "failed", error: JSON.stringify(data?.error ?? data) })
          .then(() => {}, () => {});
      }
      return json({ sent: false, reason: "meta_api_error", detail: data?.error?.message ?? data });
    }

    const messageId = data?.messages?.[0]?.id ?? null;
    if (broadcast_id) {
      await supabase.from("whatsapp_delivery_log")
        .insert({ broadcast_id, phone_hash: phoneHash, status: "sent", message_id: messageId })
        .then(() => {}, () => {});
    }
    return json({ sent: true, message_id: messageId, ref, url, mode: "link" });
  } catch (e) {
    return json({ sent: false, reason: "exception", detail: String(e) });
  }
});
