// supabase/functions/whatsapp-status/index.ts
// Epic AA — AA1.1, rebuilt for defect AA-15 (Dev reconciliation, 23 Sep 2026).
//
// READ-ONLY status for /admin/whatsapp. The runtime configuration of every
// WhatsApp function lives in Supabase Edge secrets, not in whatsapp_config —
// no function ever read that table, so the old Save/Disconnect page changed
// nothing. This reports what is ACTUALLY in effect:
//   * which secrets are set (never their values),
//   * the effective non-secret settings (send mode, template names), including
//     where a default is being used because a variable is unset,
//   * a live, read-only check against Meta: the sending number, the message
//     templates' approval status, and the Flow's status.
// It changes nothing, anywhere.
//
// Auth: admin only. verify_jwt=true (the platform verifies the caller's JWT),
// then is_admin_me() is evaluated AS the caller.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const GRAPH = "https://graph.facebook.com/v21.0";

// Secrets the WhatsApp functions read, and who reads them. Values are never returned.
const SECRETS: Array<{ name: string; purpose: string; required: boolean }> = [
  { name: "WHATSAPP_ACCESS_TOKEN", purpose: "Meta API token, used by every send and by this status check", required: true },
  { name: "WHATSAPP_PHONE_NUMBER_ID", purpose: "Sending phone number", required: true },
  { name: "WHATSAPP_WABA_ID", purpose: "Business account, used to read template approval status", required: false },
  { name: "WHATSAPP_PHONE_HASH_SALT", purpose: "Salt for phone hashing; changing it orphans every stored hash", required: true },
  { name: "WHATSAPP_APP_SECRET", purpose: "Verifies Meta's webhook and Flow request signatures", required: true },
  { name: "WHATSAPP_WEBHOOK_VERIFY_TOKEN", purpose: "Webhook subscription handshake; unset falls back to a public default", required: true },
  { name: "WHATSAPP_FLOW_ID", purpose: "Published Flow for the Flow send mode", required: false },
  { name: "WHATSAPP_FLOW_PRIVATE_KEY", purpose: "Decrypts Flow data exchange in whatsapp-flow-endpoint", required: false },
];

async function metaGet(path: string, token: string) {
  try {
    const r = await fetch(`${GRAPH}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: body?.error?.message ?? `HTTP ${r.status}` };
    return { ok: true, data: body };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(authHeader)) return json({ ok: false, reason: "unauthorized" }, 401);

  // Evaluate is_admin_me() as the caller (their JWT, not the service role).
  const asCaller = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: isAdmin, error: adminErr } = await asCaller.rpc("is_admin_me");
  if (adminErr || isAdmin !== true) return json({ ok: false, reason: "forbidden" }, 403);

  const env = (n: string) => Deno.env.get(n) ?? "";
  const token = env("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const wabaId = env("WHATSAPP_WABA_ID");
  const flowId = env("WHATSAPP_FLOW_ID");

  const secrets = SECRETS.map((s) => ({ ...s, set: env(s.name) !== "" }));

  // Effective values, exactly as the functions resolve them (same defaults).
  const setting = (name: string, fallback: string, readBy: string) => ({
    name, value: env(name) || fallback, source: env(name) ? "secret" : "default", read_by: readBy,
  });
  const settings = [
    setting("WHATSAPP_SEND_MODE", "flow", "whatsapp-broadcast-dispatch"),
    setting("WHATSAPP_TEMPLATE_NAME", "stance_question_flow", "whatsapp-send-flow (question sends)"),
    setting("WHATSAPP_OTP_TEMPLATE_NAME", "web_optin_otp", "whatsapp-send-flow (verification codes)"),
    setting("WHATSAPP_OTP_TEMPLATE_LANGUAGE", "en", "whatsapp-send-flow (verification codes)"),
    setting("WHATSAPP_UPDATE_TEMPLATE_NAME", "stance_update_notification", "whatsapp-send-update"),
    setting("WHATSAPP_OTP_PER_IP_HOURLY", "10", "whatsapp-send-flow rate limit"),
    setting("WHATSAPP_OTP_HOURLY_CAP", "100", "whatsapp-send-flow rate limit"),
    setting("PUBLIC_SITE_URL", "https://www.stancecapture.com", "links in messages and sign-in"),
  ];
  const warnings: string[] = [];
  // A variable that no function reads is a configuration trap: someone set it
  // expecting an effect. Known case: the OTP template name.
  if (env("WHATSAPP_OTP_TEMPLATE") && !env("WHATSAPP_OTP_TEMPLATE_NAME")) {
    warnings.push("WHATSAPP_OTP_TEMPLATE is set, but whatsapp-send-flow reads WHATSAPP_OTP_TEMPLATE_NAME, so verification codes use the default template name (web_optin_otp). The set variable was only read by the retired whatsapp-web-optin-start.");
  }
  for (const s of secrets) if (s.required && !s.set) warnings.push(`${s.name} is not set: ${s.purpose}.`);

  // Live, read-only checks against Meta.
  const meta: Record<string, unknown> = {};
  if (token && phoneNumberId) {
    meta.phone_number = await metaGet(
      `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,name_status,code_verification_status,messaging_limit_tier`,
      token);
  } else meta.phone_number = { ok: false, error: "WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID not set" };

  const wanted = new Set(settings.filter((s) => s.name.endsWith("TEMPLATE_NAME")).map((s) => s.value));
  if (token && wabaId) {
    // "Not found" is only meaningful if WHATSAPP_WABA_ID is the business
    // account the sending number belongs to, so report both facts alongside:
    // how many templates that account holds in total, and whether the sending
    // number is one of its phone numbers.
    const [t, nums] = await Promise.all([
      metaGet(`${wabaId}/message_templates?fields=name,status,language,category&limit=200`, token),
      metaGet(`${wabaId}/phone_numbers?fields=id,display_phone_number`, token),
    ]);
    const all = t.ok ? (t.data?.data ?? []) : [];
    const numberInAccount = nums.ok ? (nums.data?.data ?? []).some((n: any) => String(n.id) === phoneNumberId) : null;
    meta.templates = t.ok
      ? {
        ok: true,
        data: all.filter((x: any) => wanted.has(x.name)),
        missing: [...wanted].filter((n) => !all.some((x: any) => x.name === n)),
        account_template_count: all.length,
        account_template_names: all.map((x: any) => x.name).slice(0, 50),
        sending_number_in_account: numberInAccount,
        phone_numbers_error: nums.ok ? null : nums.error,
      }
      : t;
    if (numberInAccount === false) {
      warnings.push("WHATSAPP_WABA_ID is not the business account that owns WHATSAPP_PHONE_NUMBER_ID, so the template statuses shown are for a different account.");
    }
  } else meta.templates = { ok: false, error: "WHATSAPP_WABA_ID not set; template status cannot be read" };

  if (token && flowId) meta.flow = await metaGet(`${flowId}?fields=name,status,validation_errors`, token);
  else meta.flow = { ok: false, error: "WHATSAPP_FLOW_ID not set" };

  return json({
    ok: true,
    checked_at: new Date().toISOString(),
    read_only: true,
    webhook_url: `${SUPABASE_URL}/functions/v1/whatsapp-flow-webhook`,
    flow_endpoint_url: `${SUPABASE_URL}/functions/v1/whatsapp-flow-endpoint`,
    secrets,
    settings,
    warnings,
    meta,
  });
});
