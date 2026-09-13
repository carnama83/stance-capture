import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SIGNIN_TOKEN_TTL_MINUTES = 15;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { verification_token, otp } = await req.json();
    if (!verification_token || !otp) {
      return json({ ok: false, reason: "missing_fields" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: rows, error: verifyErr } = await supabase.rpc("verify_whatsapp_otp_for_signin", {
      p_verification_token: verification_token,
      p_otp: otp,
    });
    if (verifyErr) {
      console.error("[whatsapp-otp-verify] verify RPC failed:", verifyErr.message);
      return json({ ok: false, reason: "exception" }, 500);
    }
    const result = rows?.[0];
    if (!result?.otp_valid) {
      return json({ ok: false, reason: "invalid_or_expired_code" }, 400);
    }
    if (!result.user_id) {
      return json({ ok: false, reason: "no_account_for_number" }, 404);
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SIGNIN_TOKEN_TTL_MINUTES * 60_000).toISOString();
    const { error: tokenErr } = await supabase.from("whatsapp_signin_tokens").insert({
      token,
      user_id: result.user_id,
      device_id: null,
      question_id: null,
      expires_at: expiresAt,
    });
    if (tokenErr) {
      console.error("[whatsapp-otp-verify] token insert failed:", tokenErr.message);
      return json({ ok: false, reason: "exception" }, 500);
    }

    return json({ ok: true, token });
  } catch (e) {
    return json({ ok: false, reason: "exception", detail: String(e) }, 500);
  }
});
