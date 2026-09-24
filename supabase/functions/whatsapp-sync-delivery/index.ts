// supabase/functions/whatsapp-sync-delivery/index.ts
// Epic AA — AA6.1
//
// Polls Meta Graph API for delivery and read receipts for recent broadcasts.
// Cron-triggered (recommended: every 30 minutes for first 24h, then hourly).
//
// For each broadcast in 'sending' or 'completed' status within the past 48h:
//   1. Fetches message statuses from Meta's message analytics endpoint
//   2. Updates whatsapp_delivery_log rows with delivered/read timestamps
//   3. Updates broadcast total_delivered, total_opened counters
//
// Note: Meta's Cloud API delivers status webhooks in near-real-time to
// whatsapp-flow-webhook. This function is a fallback sync for any receipts
// that were missed (webhook downtime, delivery failures, etc.).
//
// Env secrets required:
//   WHATSAPP_ACCESS_TOKEN        — Meta API access token
//   WHATSAPP_PHONE_NUMBER_ID     — Sending phone number ID
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_URL
//   CRON_SECRET                  — auth header for pg_cron calls
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const FUNC = "whatsapp-sync-delivery";
const LOOKBACK_HOURS = 48; // Only sync broadcasts from the last 48 hours
const BATCH_SIZE = 20; // Broadcasts to process per invocation
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: FUNC,
    msg,
    ...extra
  }));
}
// ─── Caller check (Epic AA-08 follow-up, 24 Sep 2026) ────────────────────────
// Scheduled through admin.cron_invoke_notification, which sends the project's
// service-role credential. The old check accepted only an EXACT match with this
// function's SUPABASE_SERVICE_ROLE_KEY (or CRON_SECRET), so on Prod, where the
// helper sends a legacy service-role JWT, the scheduled run got 401. It also
// skipped the check entirely whenever CRON_SECRET was unset, so it failed OPEN.
// Now it is the same check as whatsapp-broadcast-dispatch, and fails closed:
//   * Bearer CRON_SECRET, or
//   * an exact match with this project's service-role key, or
//   * a JWT whose role is service_role for this project. Trustworthy ONLY
//     because verify_jwt=true means the platform already verified the
//     signature; do NOT set verify_jwt to false on this function.
function isAuthorizedCaller(req) {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim());
  if (!m) return false;
  const token = m[1];
  const cron = Deno.env.get("CRON_SECRET") ?? "";
  if (cron && token === cron) return true;
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

serve(async (req)=>{
  if (!isAuthorizedCaller(req)) {
    return new Response("Unauthorized", {
      status: 401
    });
  }
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    log("warn", "WhatsApp credentials not configured — skipping sync");
    return new Response(JSON.stringify({
      skipped: true,
      reason: "not_configured"
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString();
  // Fetch recent broadcasts that may have unsynced receipts
  const { data: broadcasts, error: bcastErr } = await supabase.from("whatsapp_broadcasts").select("id, status, total_sent, total_delivered, total_opened").in("status", [
    "sending",
    "completed",
    "partially_failed"
  ]).gte("created_at", since).order("created_at", {
    ascending: false
  }).limit(BATCH_SIZE);
  if (bcastErr) {
    log("error", "Failed to fetch broadcasts", {
      error: bcastErr.message
    });
    return new Response(JSON.stringify({
      error: bcastErr.message
    }), {
      status: 500
    });
  }
  if (!broadcasts || broadcasts.length === 0) {
    log("info", "No recent broadcasts to sync");
    return new Response(JSON.stringify({
      synced: 0
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
  // Epic AA-11: this used to mark any 'sent' row older than an hour as
  // 'delivered' with no evidence (Meta offers no per-message status poll), and
  // wrote total_delivered from a stale snapshot. Deliveries now come only from
  // receipts (whatsapp-flow-webhook -> record_whatsapp_delivery_status). This
  // job reconciles: it recomputes the receipt and engagement counters from
  // whatsapp_delivery_log / question_stances, so any drift self-heals.
  let totalUpdated = 0;
  for (const broadcast of broadcasts){
    const { data: counters, error: refreshErr } = await supabase.rpc("refresh_whatsapp_broadcast_counters", {
      p_broadcast_id: broadcast.id
    });
    if (refreshErr) {
      log("warn", "Error refreshing broadcast counters", {
        broadcast_id: broadcast.id,
        error: refreshErr.message
      });
      continue;
    }
    totalUpdated++;
    log("info", "Broadcast counters refreshed", {
      broadcast_id: broadcast.id,
      ...counters
    });
  }
  log("info", "Sync complete", {
    broadcasts: broadcasts.length,
    records_updated: totalUpdated
  });
  return new Response(JSON.stringify({
    synced: broadcasts.length,
    records_updated: totalUpdated
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
});
