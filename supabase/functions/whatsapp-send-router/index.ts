// supabase/functions/whatsapp-send-router/index.ts
//
// The switch. Reads WHATSAPP_SEND_MODE and forwards the (verbatim) request body
// to whatsapp-send-flow and/or whatsapp-send-link. Lets you A/B both delivery
// styles by flipping one secret — no redeploy needed.
//
//   WHATSAPP_SEND_MODE = "flow"  -> Flow card only           (default)
//                      = "link"  -> web-link message only
//                      = "both"  -> sends BOTH to each recipient
//                                   (good for letting one tester experience both;
//                                    NOT for real broadcasts — it double-sends)
//
// broadcast-dispatch (and your test scripts) call THIS instead of send-flow.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const MODE = (Deno.env.get("WHATSAPP_SEND_MODE") ?? "flow").toLowerCase();
  const FN_BASE = `${SUPABASE_URL}/functions/v1/`;

  // Pass the body through unchanged so each send fn sees its normal payload.
  const bodyText = await req.text();

  const targets =
    MODE === "link" ? ["whatsapp-send-link"] :
    MODE === "both" ? ["whatsapp-send-flow", "whatsapp-send-link"] :
    ["whatsapp-send-flow"]; // "flow" / anything else -> default

  const results: Record<string, unknown> = {};
  for (const fn of targets) {
    try {
      const r = await fetch(FN_BASE + fn, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" },
        body: bodyText,
      });
      results[fn] = await r.json();
    } catch (e) {
      results[fn] = { sent: false, reason: "router_dispatch_error", detail: String(e) };
    }
  }

  const anySent = Object.values(results).some((x) => x && (x as { sent?: boolean }).sent);
  return new Response(JSON.stringify({ mode: MODE, sent: anySent, results }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
