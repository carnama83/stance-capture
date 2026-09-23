// supabase/functions/whatsapp-web-optin-start/index.ts
//
// Opt-in step 1: a web visitor enters their phone to "track stances / get updates".
// We generate a 6-digit OTP, store it in whatsapp_phone_verifications (your existing
// table), and send it over WhatsApp via an APPROVED AUTHENTICATION TEMPLATE.
//
// IMPORTANT prerequisite: cold numbers (a visitor who never messaged you) can only be
// reached with a template, not free-form text. Create + get approved an *authentication*
// category template (e.g. "web_optin_otp") in WhatsApp Manager, then set its name in
// WHATSAPP_OTP_TEMPLATE. The template's body takes the code as one parameter.
//
// Body: { phone_number }   Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   WHATSAPP_PHONE_HASH_SALT, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
//   WHATSAPP_OTP_TEMPLATE (default "web_optin_otp"), WHATSAPP_OTP_TEMPLATE_LANG (default "en")
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
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
    return new Response(JSON.stringify({ ok: false, reason: "unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  try {
    const { phone_number } = await req.json();
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SALT = Deno.env.get("WHATSAPP_PHONE_HASH_SALT");
    const TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const TEMPLATE = Deno.env.get("WHATSAPP_OTP_TEMPLATE") ?? "web_optin_otp";
    const LANG = Deno.env.get("WHATSAPP_OTP_TEMPLATE_LANG") ?? "en";

    if (!SALT || !TOKEN || !PHONE_NUMBER_ID) return json({ ok: false, reason: "missing_server_configuration" }, 500);
    if (!/^\+[1-9]\d{6,14}$/.test(phone_number ?? "")) return json({ ok: false, reason: "invalid_phone_format" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE);
    const phoneHash = await sha256Hex(phone_number + SALT);

    // Simple rate-limit: max 3 codes per phone in the last 10 minutes.
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await supabase
      .from("whatsapp_phone_verifications")
      .select("id", { count: "exact", head: true })
      .eq("phone_hash", phoneHash)
      .gte("created_at", tenMinAgo);
    if ((count ?? 0) >= 3) return json({ ok: false, reason: "too_many_requests" }, 429);

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const { error: insErr } = await supabase
      .from("whatsapp_phone_verifications")
      .insert({ phone_hash: phoneHash, otp_code: otp });
    if (insErr) return json({ ok: false, reason: "db_error", detail: insErr.message }, 500);

    // Send via authentication template. Auth templates take the code as the body param
    // and (commonly) a copy-code button param. Adjust components to match YOUR template.
    const resp = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone_number.replace("+", ""),
        type: "template",
        template: {
          name: TEMPLATE,
          language: { code: LANG },
          components: [
            { type: "body", parameters: [{ type: "text", text: otp }] },
            { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: otp }] },
          ],
        },
      }),
    });
    const data = await resp.json();
    if (!resp.ok) return json({ ok: false, reason: "send_failed", detail: data?.error?.message ?? data }, 502);

    // Surface delivery diagnostics: message id (to trace status), the WA id WhatsApp
    // resolved the number to (a mismatch/absence hints the number isn't a reachable
    // WhatsApp user), and the raw response Meta echoes back.
    return json({
      ok: true,
      expires_in: 600,
      message_id: data?.messages?.[0]?.id ?? null,
      message_status: data?.messages?.[0]?.message_status ?? null,
      input_number: data?.contacts?.[0]?.input ?? null,
      resolved_wa_id: data?.contacts?.[0]?.wa_id ?? null,
      raw: data,
    });
  } catch (e) {
    return json({ ok: false, reason: "exception", detail: String(e) }, 500);
  }
});
