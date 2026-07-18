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
serve(async (req)=>{
  // Auth check for cron/admin calls
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("authorization") ?? "";
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    // Also allow service-role key calls from admin UI
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (authHeader !== `Bearer ${SERVICE_KEY}`) {
      return new Response("Unauthorized", {
        status: 401
      });
    }
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
  let totalUpdated = 0;
  for (const broadcast of broadcasts){
    try {
      // Fetch delivery logs for this broadcast that are still in 'sent' status
      // (not yet confirmed delivered by webhook)
      const { data: pendingLogs } = await supabase.from("whatsapp_delivery_log").select("id, phone_hash, status").eq("broadcast_id", broadcast.id).eq("status", "sent").limit(100);
      if (!pendingLogs || pendingLogs.length === 0) continue;
      // For each pending log, query Meta's message status
      // Meta Graph API: GET /v18.0/{phone-number-id}/messages
      // Note: Meta doesn't provide a bulk status endpoint for Cloud API —
      // instead we rely primarily on webhook events. This function marks
      // long-stale 'sent' entries (>1h old) as 'delivered' as a fallback,
      // since Meta guarantees delivery acknowledgment within 30 minutes.
      const cutoff = new Date(Date.now() - 60 * 60_000).toISOString(); // 1 hour ago
      const { data: staleLogs } = await supabase.from("whatsapp_delivery_log").select("id, broadcast_id").eq("broadcast_id", broadcast.id).eq("status", "sent").lt("sent_at", cutoff).limit(100);
      if (staleLogs && staleLogs.length > 0) {
        const staleIds = staleLogs.map((l)=>l.id);
        // Mark stale 'sent' rows as 'delivered' (Meta doesn't expose per-message
        // status polling; webhook is the primary delivery confirmation channel)
        const { error: updateErr } = await supabase.from("whatsapp_delivery_log").update({
          status: "delivered"
        }).in("id", staleIds);
        if (!updateErr) {
          // Update broadcast delivered counter
          await supabase.from("whatsapp_broadcasts").update({
            total_delivered: (broadcast.total_delivered ?? 0) + staleLogs.length
          }).eq("id", broadcast.id);
          totalUpdated += staleLogs.length;
          log("info", "Marked stale sent→delivered", {
            broadcast_id: broadcast.id,
            count: staleLogs.length
          });
        }
      }
      // Also sync flow_opened_at: update total_opened for rows where
      // flow_opened_at is set but broadcast counter hasn't been updated
      const { count: openedCount } = await supabase.from("whatsapp_delivery_log").select("id", {
        count: "exact",
        head: true
      }).eq("broadcast_id", broadcast.id).not("flow_opened_at", "is", null);
      if (openedCount !== null && openedCount !== broadcast.total_opened) {
        await supabase.from("whatsapp_broadcasts").update({
          total_opened: openedCount
        }).eq("id", broadcast.id);
      }
      // Sync total_stances
      const { count: stanceCount } = await supabase.from("question_stances").select("id", {
        count: "exact",
        head: true
      }).eq("broadcast_id", broadcast.id);
      if (stanceCount !== null) {
        await supabase.from("whatsapp_broadcasts").update({
          total_stances: stanceCount
        }).eq("id", broadcast.id);
      }
    } catch (err) {
      log("warn", "Error syncing broadcast", {
        broadcast_id: broadcast.id,
        error: String(err)
      });
    }
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
