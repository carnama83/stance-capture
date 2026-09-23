// supabase/functions/whatsapp-send-link/index.ts  (v3 — dedup fix: body/card no longer share a field)
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

// ─── Epic AA-05: service-role callers only ──────────────────────────────────
// verify_jwt=true stops unsigned requests, but the PUBLIC anon key is a valid
// JWT, so on its own it let anyone on the internet make this function
// message arbitrary numbers from the business account. Callers must now
// present this project's service-role credential. Same check as
// whatsapp-broadcast-dispatch (W-01). It accepts either credential shape:
//   A - an exact match with this project's SUPABASE_SERVICE_ROLE_KEY;
//   B - a JWT whose role is service_role. This is trustworthy ONLY because
//       verify_jwt=true means the platform already checked the signature,
//       so do NOT set verify_jwt to false on this function.
function isServiceCaller(req: Request): boolean {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim());
  if (!m) return false;
  const token = m[1];
  const envKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (envKey && token === envKey) return true;
  try {
    const seg = token.split(".")[1];
    if (!seg) return false;
    const norm = seg.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(norm + "=".repeat((4 - norm.length % 4) % 4)));
    if (claims?.role !== "service_role") return false;
    const expectedRef = (Deno.env.get("SUPABASE_URL") ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
    return !(expectedRef && claims?.ref && claims.ref !== expectedRef);
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!isServiceCaller(req)) {
    return new Response(JSON.stringify({ sent: false, reason: "unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
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
    // NOTE: context_summary is deliberately NOT selected here. It's the field
    // api/s/[slug].js uses for the unfurled link-preview card's description —
    // this body must not read it too, or the card and the message text show
    // the identical sentence once WhatsApp unfurls the link below the body.
    const { data: qrow } = await supabase
      .from("questions")
      .select("id, slug, question, share_headline, summary, cover_image_url")
      .eq("id", question_id)
      .maybeSingle();
    if (!qrow) return json({ sent: false, reason: "question_not_found" });

    // BUG FIX: hash the digits-only number, not phone_number as given. This
    // function's phone_number parameter requires a leading "+" (validated
    // above), but whatsapp-flow-webhook's hashPhoneNumber() always hashes the
    // raw wa_id from Meta, which never has a "+". Hashing the "+"-prefixed
    // string here produced a DIFFERENT hash for the same real phone number —
    // which meant the opt-out check three lines below could never match a
    // real whatsapp_optouts row (those are written using the no-"+" hash),
    // and any exclusion logic elsewhere keyed on this hash (e.g.
    // pick_next_whatsapp_question's "already sent" check) could never match
    // either. Strip the "+" so this matches the same convention everywhere else.
    const phoneHash = await sha256Hex(phone_number.replace(/^\+/, "") + SALT);

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

    const fullQuestion = (qrow.question ?? question_text ?? "").trim();
    const context = (qrow.summary ?? "").trim();
    const headline = (qrow.share_headline || "").trim();

    // BUG FIX / IMPROVEMENT: previously always sent plain text + preview_url,
    // relying on Meta's crawler to unfurl a brand-new per-send URL (ref=
    // changes every send) into a rich card before delivery — unreliable in
    // practice, unlike the Share button's client-composed messages which
    // unfurl locally and consistently. Sending an actual image message
    // sidesteps that entirely: the card renders immediately, every time,
    // using the same cover_image_url the rest of the app already shows for
    // this question. Falls back to the original text approach only when a
    // question genuinely has no cover image.
    let sendBody;
    if (qrow.cover_image_url) {
      // Image captions are capped at 1024 chars (vs 4096 for text bodies) —
      // build a tighter version: bold headline (WhatsApp markdown, *text*),
      // then the question, then CTA + link, truncated to fit if needed.
      const boldHeadline = headline ? `*${headline}*\n\n` : "";
      let caption = `${boldHeadline}${fullQuestion}\n\nSee where people stand & add yours 👇\n${url}`;
      if (caption.length > 1024) {
        // Trim the question first (least critical once the headline + link
        // are present), keep headline/CTA/link intact.
        const overage = caption.length - 1024 + 1; // +1 for the ellipsis char
        const trimmedQuestion = fullQuestion.slice(0, Math.max(0, fullQuestion.length - overage)).trimEnd() + "…";
        caption = `${boldHeadline}${trimmedQuestion}\n\nSee where people stand & add yours 👇\n${url}`;
      }
      // Try the composite photo+stance-bar card first (whatsapp-card) — falls
      // back to the plain cover_image_url on ANY failure (timeout, non-200,
      // malformed response), so a problem with the newer, less-tested
      // compositing path degrades to exactly today's already-working
      // behavior rather than breaking or sending nothing.
      let imageLink = qrow.cover_image_url;
      try {
        const cardResp = await fetch(
          `${SUPABASE_URL}/functions/v1/whatsapp-card?question_id=${question_id}`,
          { headers: { Authorization: `Bearer ${SERVICE}` }, signal: AbortSignal.timeout(8000) }
        );
        if (cardResp.ok) {
          const cardData = await cardResp.json();
          if (cardData?.image_url) imageLink = cardData.image_url;
        }
      } catch (err) {
        console.error("whatsapp-card fetch failed, falling back to cover_image_url:", String(err));
      }
      sendBody = {
        messaging_product: "whatsapp",
        to: phone_number.replace("+", ""),
        type: "image",
        image: { link: imageLink, caption },
      };
    } else {
      // Option A: the FULL question lives in the body (never truncated by WhatsApp),
      // with the context line beneath it. The preview card carries the short headline
      // AND its own description (context_summary) — sourced separately at publish
      // time so it never repeats this paragraph verbatim.
      const body =
        `${fullQuestion}\n` +
        (context ? `\n${context}\n` : "") +
        `\nSee where people stand & add yours 👇\n${url}`;
      sendBody = {
        messaging_product: "whatsapp",
        to: phone_number.replace("+", ""),
        type: "text",
        text: { preview_url: true, body },
      };
    }

    const resp = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(sendBody),
    });
    const data = await resp.json();

    // Epic AA-07: these inserts used columns that did not exist (error,
    // message_id) and `.then(() => {}, () => {})` hid it — supabase-js resolves
    // with { error } rather than rejecting — so link-mode sends were never
    // logged. The dispatcher reads "has a log row" as "already processed", so
    // that also fed AA-06's endless re-send. Real columns now, errors logged.
    const logDelivery = async (row: Record<string, unknown>) => {
      const { error } = await supabase.from("whatsapp_delivery_log").insert({ broadcast_id, phone_hash: phoneHash, ...row });
      if (error) console.error("whatsapp_delivery_log insert failed:", error.message);
    };

    if (!resp.ok) {
      if (broadcast_id) {
        await logDelivery({
          status: "failed",
          failure_reason: String(data?.error?.message ?? "meta_api_error").slice(0, 500),
        });
      }
      return json({ sent: false, reason: "meta_api_error", detail: data?.error?.message ?? data });
    }

    const messageId = data?.messages?.[0]?.id ?? null;
    if (broadcast_id) {
      await logDelivery({ status: "sent", message_id: messageId });
    }
    return json({ sent: true, message_id: messageId, ref, url, mode: "link" });
  } catch (e) {
    return json({ sent: false, reason: "exception", detail: String(e) });
  }
});
