import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { token } = await req.json();
    if (!token || typeof token !== "string") {
      return json({ ok: false, reason: "missing_token" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const SITE = Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.stancecapture.com";

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: claimRows, error: claimErr } = await supabase.rpc("claim_whatsapp_signin_token", {
      p_token: token,
    });
    if (claimErr) {
      console.error("[whatsapp-signin-redeem] claim RPC failed:", claimErr.message);
      return json({ ok: false, reason: "exception" }, 500);
    }
    const claim = claimRows?.[0];
    if (!claim?.user_id) {
      return json({ ok: false, reason: "invalid_or_expired_token" }, 400);
    }
    const { data: userRow, error: userErr } = await supabase.auth.admin.getUserById(claim.user_id);
    if (userErr || !userRow?.user?.email) {
      console.error("[whatsapp-signin-redeem] getUserById failed:", userErr?.message ?? "no email on user");
      return json({ ok: false, reason: "account_lookup_failed" }, 500);
    }

    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: userRow.user.email,
      options: { redirectTo: `${SITE}/#/auth/callback` },
    });
    if (linkErr || !linkData?.properties?.action_link) {
      console.error("[whatsapp-signin-redeem] generateLink failed:", linkErr?.message ?? "no action_link returned");
      return json({ ok: false, reason: "link_generation_failed" }, 500);
    }

    return json({
      ok: true,
      action_link: linkData.properties.action_link,
      question_id: claim.question_id ?? null,
    });
  } catch (e) {
    return json({ ok: false, reason: "exception", detail: String(e) }, 500);
  }
});
