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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
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
    if (!row || row.otp_code !== code) return json({ ok: false, reason: "invalid_or_expired_code" }, 400);

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
