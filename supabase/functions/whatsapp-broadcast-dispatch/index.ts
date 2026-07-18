// supabase/functions/whatsapp-broadcast-dispatch/index.ts
// Epic AA — AA3.1 / AA3.3
//
// Cron-driven broadcast dispatcher. Runs every 5 minutes via pg_cron.
// Processes broadcasts in status 'scheduled' or 'sending'.
//
// Rate limiting: respects Meta's 80 messages/second default limit.
// Batch size: 50 messages per cron invocation (conservative for new accounts).
// Retry: failed sends retried once after 60 seconds via status = 'sending' re-entry.
// Pause: on 429 from Meta, broadcast paused and rescheduled after retry-after interval.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const BATCH_SIZE = 50; // messages per invocation
const RATE_LIMIT_MS = 50; // 50ms between sends = ~20/second (conservative)
const SUPABASE_FUNCTIONS_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;
// Delivery channel (2026-07-08, post-flows pivot): "link" sends the plain-text
// message with the /s/<slug> share link via whatsapp-send-link; "flow" (default)
// keeps the legacy Flow card via whatsapp-send-flow. The dispatcher selects the
// target itself with CLEAN headers (content-type only) rather than hopping
// through whatsapp-send-router, whose internal Authorization: Bearer header is
// the gateway-rejected legacy class (same failure as the ugq-submit 07-08 fix).
// NOTE (Meta): plain text delivers only inside a 24h customer-service window;
// cold-number broadcasts require an approved template regardless of this flag.
const SEND_MODE = (Deno.env.get("WHATSAPP_SEND_MODE") ?? "flow").toLowerCase();
const SEND_FN = SEND_MODE === "link" ? "whatsapp-send-link" : "whatsapp-send-flow";
serve(async (req)=>{
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    // ── Find broadcasts ready to process ─────────────────────────────────
    const now = new Date().toISOString();
    const { data: broadcasts, error: broadcastError } = await supabase.from("whatsapp_broadcasts").select("*").or(`status.eq.sending,and(status.eq.scheduled,scheduled_at.lte.${now})`).order("created_at", {
      ascending: true
    }).limit(3); // process up to 3 broadcasts per invocation
    if (broadcastError) {
      console.error("Error fetching broadcasts:", broadcastError.message);
      return new Response(JSON.stringify({
        error: broadcastError.message
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    if (!broadcasts || broadcasts.length === 0) {
      return new Response(JSON.stringify({
        processed: 0,
        message: "No broadcasts to process"
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      });
    }
    const results = [];
    for (const broadcast of broadcasts){
      const result = await processBroadcast(supabase, broadcast);
      results.push(result);
    }
    return new Response(JSON.stringify({
      processed: results.length,
      results
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("Broadcast dispatch error:", err);
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
});
// ─── Process a single broadcast ───────────────────────────────────────────────
async function processBroadcast(supabase, broadcast) {
  const broadcastId = broadcast.id;
  const questionId = broadcast.question_id;
  console.log(`Processing broadcast ${broadcastId}, status: ${broadcast.status}`);
  // ── Mark as sending if scheduled ───────────────────────────────────────
  if (broadcast.status === "scheduled") {
    await supabase.from("whatsapp_broadcasts").update({
      status: "sending",
      sent_at: new Date().toISOString()
    }).eq("id", broadcastId);
  }
  // ── Fetch question details ──────────────────────────────────────────────
  const { data: question } = await supabase.from("questions").select("question, summary, context_summary").eq("id", questionId).maybeSingle();
  if (!question) {
    console.error(`Question ${questionId} not found`);
    await supabase.from("whatsapp_broadcasts").update({
      status: "cancelled"
    }).eq("id", broadcastId);
    return {
      broadcast_id: broadcastId,
      status: "cancelled",
      reason: "question_not_found"
    };
  }
  // ── Fetch pending phone numbers from contact list ───────────────────────
  // Phone numbers stored in whatsapp_contact_list_numbers table
  // Only fetch numbers not yet in delivery log for this broadcast
  const { data: pendingNumbers, error: numbersError } = await supabase.from("whatsapp_contact_list_numbers").select("phone_number").eq("contact_list_id", broadcast.contact_list_id).not("phone_number", "in", `(SELECT phone_number FROM whatsapp_delivery_log_numbers WHERE broadcast_id = '${broadcastId}')`).limit(BATCH_SIZE);
  // Fallback: use delivery log to find un-sent numbers
  // Get all phone hashes already sent for this broadcast
  const { data: sentLogs } = await supabase.from("whatsapp_delivery_log").select("phone_hash").eq("broadcast_id", broadcastId);
  const sentHashes = new Set((sentLogs ?? []).map((l)=>l.phone_hash));
  // ── Get pending numbers from contact list ───────────────────────────────
  const { data: allNumbers } = await supabase.from("whatsapp_contact_list_numbers").select("phone_number, phone_hash").eq("contact_list_id", broadcast.contact_list_id).limit(BATCH_SIZE + sentHashes.size);
  const pending = (allNumbers ?? []).filter((n)=>!sentHashes.has(n.phone_hash)).slice(0, BATCH_SIZE);
  if (pending.length === 0) {
    // All numbers processed — mark complete
    const hasFailures = broadcast.total_failed > 0;
    await supabase.from("whatsapp_broadcasts").update({
      status: hasFailures ? "partially_failed" : "completed",
      completed_at: new Date().toISOString()
    }).eq("id", broadcastId);
    console.log(`Broadcast ${broadcastId} completed`);
    return {
      broadcast_id: broadcastId,
      status: "completed",
      sent_this_batch: 0
    };
  }
  // ── Send messages in rate-limited batches ───────────────────────────────
  let sentCount = 0;
  let failedCount = 0;
  let rateLimited = false;
  for (const numberRow of pending){
    const phoneNumber = numberRow.phone_number;
    // Check opt-out before sending
    const { data: optOut } = await supabase.from("whatsapp_optouts").select("is_active").eq("phone_hash", numberRow.phone_hash).eq("is_active", true).maybeSingle();
    if (optOut) {
      // Log as opted_out — counts as processed
      await supabase.from("whatsapp_delivery_log").insert({
        broadcast_id: broadcastId,
        phone_hash: numberRow.phone_hash,
        status: "opted_out"
      });
      continue;
    }
    // ── Call the mode-selected send function (see SEND_MODE above) ────────
    try {
      const sendResponse = await fetch(`${SUPABASE_FUNCTIONS_URL}/${SEND_FN}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone_number: phoneNumber,
          question_id: questionId,
          question_text: question.question,
          question_summary: question.context_summary || question.summary || "",
          broadcast_id: broadcastId
        })
      });
      const sendData = await sendResponse.json();
      if (sendData.sent) {
        sentCount++;
      } else if (sendData.reason === "meta_api_error" && sendData.detail?.includes("429")) {
        // Rate limited — pause broadcast and reschedule
        console.warn(`Rate limited on broadcast ${broadcastId} — pausing`);
        await supabase.from("whatsapp_broadcasts").update({
          status: "scheduled",
          scheduled_at: new Date(Date.now() + 60_000).toISOString()
        }).eq("id", broadcastId);
        rateLimited = true;
        break;
      } else {
        failedCount++;
        console.error(`Send failed for ${phoneNumber}: ${sendData.reason}`);
      }
    } catch (sendErr) {
      failedCount++;
      console.error(`Send error for ${phoneNumber}:`, sendErr);
    }
    // ── Rate limit delay between sends ────────────────────────────────────
    await new Promise((resolve)=>setTimeout(resolve, RATE_LIMIT_MS));
  }
  // ── Update broadcast counters ───────────────────────────────────────────
  if (!rateLimited) {
    await supabase.from("whatsapp_broadcasts").update({
      total_sent: broadcast.total_sent + sentCount,
      total_failed: broadcast.total_failed + failedCount
    }).eq("id", broadcastId);
  }
  console.log(`Broadcast ${broadcastId}: sent=${sentCount}, failed=${failedCount}, rate_limited=${rateLimited}`);
  return {
    broadcast_id: broadcastId,
    sent_this_batch: sentCount,
    failed: failedCount,
    rate_limited: rateLimited
  };
}
