// supabase/functions/pause-campaign/index.ts
// Epic Y — Y3.1: Pause or resume a live campaign.
//
// Admin-only. Body: { campaign_id, action: "pause" | "resume" }.
//   pause  → sets the Meta campaign PAUSED, our status → 'paused'
//   resume → sets the Meta campaign ACTIVE, our status → 'active'
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//      META_ADS_ACCESS_TOKEN, META_GRAPH_VERSION (default v21.0)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const FUNC = "pause-campaign";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

function log(level, msg, extra = {}) { console.log(JSON.stringify({ ts: new Date().toISOString(), level, func: FUNC, msg, ...extra })); }
function json(status, payload) { return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function isAdminResult(v) { return v === true || v?.is_admin === true || (Array.isArray(v) && v[0]?.is_admin === true); }

async function metaSetStatus(campaignId, status, token) {
  const form = new URLSearchParams({ status, access_token: token });
  const res = await fetch(`${GRAPH}/${campaignId}`, { method: "POST", body: form });
  const text = await res.text();
  let b = {}; try { b = JSON.parse(text); } catch { /* {} */ }
  if (!res.ok || b?.error) return { ok: false, error: b?.error ?? { message: `HTTP ${res.status}` } };
  return { ok: true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) return json(500, { ok: false, error: "Missing Supabase env" });

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "Missing Authorization header" });
  const userSb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: adminCheck, error: adminErr } = await userSb.rpc("is_admin_me");
  if (adminErr || !isAdminResult(adminCheck)) return json(403, { ok: false, error: "Forbidden – admin only" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let body = {}; try { body = await req.json(); } catch { body = {}; }
  const campaignId = body?.campaign_id;
  const action = body?.action;
  if (!campaignId) return json(400, { ok: false, error: "campaign_id is required" });
  if (action !== "pause" && action !== "resume") return json(400, { ok: false, error: "action must be 'pause' or 'resume'" });

  try {
    const { data: campaign, error } = await admin
      .from("campaigns")
      .select("id, name, platform, platform_campaign_id, status, ad_account_id")
      .eq("id", campaignId)
      .single();
    if (error || !campaign) return json(404, { ok: false, error: "Campaign not found" });
    if (!campaign.platform_campaign_id) return json(400, { ok: false, error: "Campaign has not been launched to a platform" });

    if (action === "pause" && campaign.status !== "active") return json(400, { ok: false, error: `Only active campaigns can be paused (current: ${campaign.status})` });
    if (action === "resume" && campaign.status !== "paused") return json(400, { ok: false, error: `Only paused campaigns can be resumed (current: ${campaign.status})` });

    if (campaign.platform === "linkedin") return json(400, { ok: false, error: "LinkedIn pause/resume arrives with create-linkedin-campaign." });

    // Resolve token.
    let token = Deno.env.get("META_ADS_ACCESS_TOKEN");
    if (campaign.ad_account_id) {
      const { data: acct } = await admin.from("ad_account_connections").select("credentials").eq("id", campaign.ad_account_id).single();
      if (acct?.credentials?.access_token) token = acct.credentials.access_token;
    }
    if (!token) return json(500, { ok: false, error: "No Meta token available" });

    const metaStatus = action === "pause" ? "PAUSED" : "ACTIVE";
    const res = await metaSetStatus(campaign.platform_campaign_id, metaStatus, token);
    if (!res.ok) { log("error", "meta_status_failed", { err: res.error }); return json(502, { ok: false, error: `Meta ${action} failed: ${res.error?.message}`, meta_error: res.error }); }

    const newStatus = action === "pause" ? "paused" : "active";
    await admin.from("campaigns").update({ status: newStatus }).eq("id", campaign.id);
    return json(200, { ok: true, status: newStatus });
  } catch (err) {
    log("error", "unexpected", { err: String(err) });
    return json(500, { ok: false, error: "An unexpected error occurred" });
  }
});
