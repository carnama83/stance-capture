// supabase/functions/sync-campaign-results/index.ts
// Epic Y — Y4.1: Daily campaign results sync.
//
// Invoked by pg_cron at 06:00 UTC (admin.cron_sync_campaign_results) and
// manually by an admin. Pulls platform insights for each live campaign,
// upserts daily snapshots into campaign_results, rolls up lifetime totals and
// DB-side stance attribution onto campaigns, raises an 80%-budget alert, and
// marks finished campaigns completed.
//
// Auth (any one):
//   x-cron-secret == CRON_SECRET   (pg_cron path)
//   Authorization: Bearer <service_role>
//   Authorization: Bearer <admin user JWT>  (is_admin_me)
//
// LinkedIn campaigns are skipped for now (analytics wiring lands with
// create-linkedin-campaign) — logged, not errored.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//      CRON_SECRET, META_ADS_ACCESS_TOKEN, META_GRAPH_VERSION (default v21.0)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const FUNC = "sync-campaign-results";
const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, func: FUNC, msg, ...extra }));
}
function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function isAdminResult(v) {
  return v === true || v?.is_admin === true || (Array.isArray(v) && v[0]?.is_admin === true);
}
async function fetchWithRetry(url, init = {}, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(t);
      if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 500, 5000)));
        continue;
      }
      return res;
    } catch (err) {
      clearTimeout(t);
      lastErr = err;
      if (attempt < maxAttempts) { await new Promise((r) => setTimeout(r, Math.min(2 ** attempt * 500, 5000))); continue; }
    }
  }
  throw lastErr ?? new Error("request failed");
}
async function metaGet(path, params, token) {
  const q = new URLSearchParams({ ...params, access_token: token });
  const res = await fetchWithRetry(`${GRAPH}/${path}?${q.toString()}`, { method: "GET" });
  const text = await res.text();
  let body = {};
  try { body = JSON.parse(text); } catch { /* {} */ }
  if (!res.ok || body?.error) return { ok: false, status: res.status, error: body?.error ?? { message: `HTTP ${res.status}` } };
  return { ok: true, body };
}

// Group ISO timestamps → { 'YYYY-MM-DD': count }
function countByDay(rows) {
  const out = {};
  for (const r of rows) {
    const d = (r.created_at ?? "").slice(0, 10);
    if (!d) continue;
    out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

async function syncMetaCampaign(admin, campaign, token) {
  const pcid = campaign.platform_campaign_id;

  // Lifetime totals.
  const life = await metaGet(`${pcid}/insights`, { fields: "impressions,reach,clicks,spend", date_preset: "maximum" }, token);
  // Recent daily rows (upsert-safe; backfills last 30 days).
  const daily = await metaGet(`${pcid}/insights`, { fields: "impressions,reach,clicks,spend", time_increment: "1", date_preset: "last_30d" }, token);
  // Effective status → completion detection.
  const meta = await metaGet(`${pcid}`, { fields: "effective_status,name" }, token);

  if (!life.ok && !daily.ok) {
    return { campaign_id: campaign.id, ok: false, error: life.error?.message ?? daily.error?.message };
  }

  // Stance attribution from our own tables (source of truth).
  const [{ data: qs }, { data: es }] = await Promise.all([
    admin.from("question_stances").select("created_at").eq("campaign_id", campaign.id),
    admin.from("embedded_stances").select("created_at").eq("campaign_id", campaign.id),
  ]);
  const qsRows = qs ?? [];
  const esRows = es ?? [];
  const totalStances = qsRows.length + esRows.length;
  const stancesByDay = countByDay([...qsRows, ...esRows]);

  // Upsert daily snapshots.
  let snapshots = 0;
  if (daily.ok && Array.isArray(daily.body.data)) {
    const rows = daily.body.data.map((d) => ({
      campaign_id: campaign.id,
      snapshot_date: d.date_start,
      impressions: Number(d.impressions ?? 0),
      reach: Number(d.reach ?? 0),
      clicks: Number(d.clicks ?? 0),
      spend: Number(d.spend ?? 0),
      stances_attributed: stancesByDay[d.date_start] ?? 0,
      synced_at: new Date().toISOString(),
    }));
    if (rows.length) {
      const { error } = await admin.from("campaign_results").upsert(rows, { onConflict: "campaign_id,snapshot_date" });
      if (error) log("warn", "snapshot_upsert_failed", { campaign: campaign.id, err: error.message });
      else snapshots = rows.length;
    }
  }

  // Lifetime rollup onto the campaign row.
  const lifeRow = life.ok && Array.isArray(life.body.data) && life.body.data[0] ? life.body.data[0] : null;
  const patch = { stances_attributed: totalStances };
  if (lifeRow) {
    patch.total_impressions = Number(lifeRow.impressions ?? 0);
    patch.total_clicks = Number(lifeRow.clicks ?? 0);
    patch.total_spend = Number(lifeRow.spend ?? 0);
  }

  // Completion: Meta says finished, or end_date has passed.
  const effStatus = meta.ok ? String(meta.body.effective_status ?? "") : "";
  const ended = campaign.end_date && new Date(campaign.end_date) < new Date();
  if (effStatus === "CAMPAIGN_PAUSED" && campaign.status === "active") {
    // left as-is; platform pause is reflected via pause-campaign, not here
  }
  if ((effStatus === "COMPLETED" || ended) && ["active", "pending_review", "paused"].includes(campaign.status)) {
    patch.status = "completed";
  }

  await admin.from("campaigns").update(patch).eq("id", campaign.id);

  // 80% budget alert (total-budget campaigns), once per campaign.
  const spend = patch.total_spend ?? campaign.total_spend ?? 0;
  if (campaign.budget_type === "total" && campaign.budget_amount > 0 &&
      spend >= 0.8 * Number(campaign.budget_amount) && campaign.created_by) {
    const { data: existing } = await admin
      .from("user_notifications")
      .select("id")
      .eq("notification_type", "campaign_budget_alert")
      .contains("metadata", { campaign_id: campaign.id })
      .limit(1);
    if (!existing || existing.length === 0) {
      await admin.from("user_notifications").insert({
        user_id: campaign.created_by,
        notification_type: "campaign_budget_alert",
        title: "Campaign nearing budget",
        body: `“${campaign.name}” has spent ${Math.round((spend / Number(campaign.budget_amount)) * 100)}% of its budget.`,
        href: "/admin/campaigns",
        metadata: { campaign_id: campaign.id },
      });
    }
  }

  return { campaign_id: campaign.id, ok: true, snapshots, total_stances: totalStances, spend: patch.total_spend ?? null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, error: "Missing Supabase env" });

  // ── Auth: cron secret OR service role OR admin JWT ──────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  let authorized = false;
  if (CRON_SECRET && cronHeader === CRON_SECRET) authorized = true;
  else if (authHeader === `Bearer ${SERVICE_KEY}`) authorized = true;
  else if (authHeader.startsWith("Bearer ") && ANON_KEY) {
    try {
      const userSb = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
      });
      const { data } = await userSb.rpc("is_admin_me");
      if (isAdminResult(data)) authorized = true;
    } catch { /* fall through */ }
  }
  if (!authorized) return json(401, { ok: false, error: "Unauthorized" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const singleId = body?.campaign_id ?? null;

  try {
    // Which campaigns to sync: those launched and not terminal.
    let query = admin
      .from("campaigns")
      .select("id, name, platform, platform_campaign_id, status, budget_type, budget_amount, end_date, total_spend, created_by, ad_account_id")
      .not("platform_campaign_id", "is", null)
      .in("status", ["active", "pending_review", "paused"]);
    if (singleId) query = admin
      .from("campaigns")
      .select("id, name, platform, platform_campaign_id, status, budget_type, budget_amount, end_date, total_spend, created_by, ad_account_id")
      .eq("id", singleId);

    const { data: campaigns, error: cErr } = await query;
    if (cErr) { log("error", "load_campaigns_failed", { err: cErr.message }); return json(500, { ok: false, error: "Failed to load campaigns" }); }

    const results = [];
    for (const campaign of campaigns ?? []) {
      if (!campaign.platform_campaign_id) continue;
      if (campaign.platform === "linkedin") {
        log("info", "linkedin_sync_skipped", { campaign: campaign.id });
        results.push({ campaign_id: campaign.id, ok: true, skipped: "linkedin" });
        continue;
      }
      // Resolve the Meta token for this campaign's ad account.
      let token = Deno.env.get("META_ADS_ACCESS_TOKEN");
      if (campaign.ad_account_id) {
        const { data: acct } = await admin
          .from("ad_account_connections")
          .select("credentials")
          .eq("id", campaign.ad_account_id)
          .single();
        if (acct?.credentials?.access_token) token = acct.credentials.access_token;
      }
      if (!token) { results.push({ campaign_id: campaign.id, ok: false, error: "No Meta token" }); continue; }
      try {
        results.push(await syncMetaCampaign(admin, campaign, token));
      } catch (err) {
        log("error", "campaign_sync_error", { campaign: campaign.id, err: String(err) });
        results.push({ campaign_id: campaign.id, ok: false, error: String(err) });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    log("info", "sync_complete", { total: results.length, ok: okCount });
    return json(200, { ok: true, synced: results.length, succeeded: okCount, results });
  } catch (err) {
    log("error", "unexpected", { err: String(err) });
    return json(500, { ok: false, error: "An unexpected error occurred" });
  }
});
