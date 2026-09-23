// supabase/functions/whatsapp-web-optin-verify/index.ts
//
// Opt-in step 2: verify the OTP and PROMOTE the anonymous node to a known, sendable
// identity. On success: marks the code used, attaches the phone hash to the visitor's
// forward node (attach_phone_to_node), so their web stance links to the phone and the
// nightly claim job folds it into an account if one exists.
//
// Body: { phone_number, code, ref }   ref = the visitor's own forward ref (my_ref).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_PHONE_HASH_SALT
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
    const { phone_number, code, ref } = await req.json();
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const SALT = Deno.env.get("WHATSAPP_PHONE_HASH_SALT");

    if (!SALT) return json({ ok: false, reason: "missing_server_configuration" }, 500);
    if (!/^\+[1-9]\d{6,14}$/.test(phone_number ?? "")) return json({ ok: false, reason: "invalid_phone_format" }, 400);
    if (!/^\d{6}$/.test(code ?? "")) return json({ ok: false, reason: "invalid_code_format" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE);
    const phoneHash = await sha256Hex(phone_number + SALT);

    // Latest unused, unexpired code for this phone.
    const { data: rows } = await supabase
      .from("whatsapp_phone_verifications")
      .select("id, otp_code, expires_at, used")
      .eq("phone_hash", phoneHash)
      .eq("used", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    const row = rows?.[0];
    if (!row) return json({ ok: false, reason: "invalid_or_expired_code" }, 400);
    if (row.otp_code !== code) {
      // Epic AA-13: count the wrong guess; the code is burned on the 5th.
      const { error: failErr } = await supabase.rpc("register_whatsapp_otp_failure", { p_id: row.id });
      if (failErr) console.error("register_whatsapp_otp_failure failed:", failErr.message);
      return json({ ok: false, reason: "invalid_or_expired_code" }, 400);
    }

    // Consume the code (single-use).
    await supabase.from("whatsapp_phone_verifications").update({ used: true }).eq("id", row.id);

    // Promote the node: attach phone hash so it becomes sendable + links the stance.
    if (ref) {
      const { error: attachErr } = await supabase.rpc("attach_phone_to_node", {
        p_ref: ref,
        p_phone_hash: phoneHash,
        p_user_id: null,
      });
      if (attachErr) return json({ ok: false, reason: "attach_failed", detail: attachErr.message }, 500);
    }

    return json({ ok: true, verified: true });
  } catch (e) {
    return json({ ok: false, reason: "exception", detail: String(e) }, 500);
  }
});
