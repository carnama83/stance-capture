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
//
// =============================================================================
// Sep 2026 hardening (backported from Prod W-01..W-04).
//
// W-01 AUTH. There was NO authorization check of any kind and verify_jwt was false, so this
//   endpoint - which SENDS WHATSAPP MESSAGES - was reachable by anyone on the internet.
//   verify_jwt is now true and authCheck() requires this project's service_role identity.
//
//   PORTABLE CREDENTIAL CHECK. Supabase projects can hold the service-role credential in two
//   shapes and this codebase uses both:
//     * a LEGACY JWT (Prod's pg_cron sends private.get_secret('service_role_key'))
//     * a MODERN sb_secret_ key (UAT and Dev send Vault's service_role_key; on BOTH,
//       private.get_secret('service_role_key') is NULL - no JWT-format key exists there)
//   Verified live: a bare `Authorization: Bearer <sb_secret_...>` with NO apikey header returns
//   200 from a verify_jwt:true function, so the platform gate accepts both shapes. A
//   JWT-claims-only check would reject UAT's own caller outright. This accepts either:
//     Path A - exact match against this project's own SUPABASE_SERVICE_ROLE_KEY.
//     Path B - a service_role JWT, trustworthy ONLY because verify_jwt:true means the platform
//              already verified the signature. Do NOT set verify_jwt to false.
//   Fails CLOSED on anything else.
//
// W-02 FAIL-OPEN READS. Four reads discarded their `error` (`const { data } = await ...`), so a
//   transient failure silently produced a null/empty result that was acted on as truth:
//     * question   -> null => broadcast marked **cancelled**, destroying it permanently
//     * sentLogs   -> empty sentHashes => already-delivered numbers **re-sent** (duplicates)
//     * allNumbers -> empty pending    => broadcast marked **completed** before sending
//     * optOut     -> falsy            => message **sent to an opted-out recipient**
//   All four now capture the error and FAIL CLOSED: the run defers, leaving broadcast state
//   untouched so the next tick retries. On Prod ~45% of this runtime's reads were failing with a
//   gateway 504, which made every one of those outcomes likely rather than theoretical.
//
// W-03 RETRIES on the idempotent reads (3 attempts, 250/500ms). Independence of consecutive
//   failures within one invocation was never measured, so treat the improvement as indicative.
//
// W-04 DEAD QUERY removed: `.not("phone_number","in","(SELECT ...)")` passed a SQL SUBQUERY into
//   a PostgREST filter - PostgREST has no subquery support and returns 400. Same defect class as
//   H-06. Harmless only by accident: its result was never read.
// =============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const BATCH_SIZE = 50; // messages per invocation
const RATE_LIMIT_MS = 50; // 50ms between sends = ~20/second (conservative)
const READ_ATTEMPTS = 3;
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
// W-01: see the header note. Accepts either service-role credential shape. Fails closed.
function authCheck(req) {
  const deny = ()=>new Response(JSON.stringify({
      error: "Unauthorized"
    }), {
      status: 401,
      headers: {
        "Content-Type": "application/json"
      }
    });
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return deny();
  const token = m[1];
  const envKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (envKey && token === envKey) return null;
  try {
    const seg = token.split(".")[1];
    if (!seg) return deny();
    const norm = seg.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(norm + "=".repeat((4 - norm.length % 4) % 4)));
    if (claims?.role !== "service_role") return deny();
    const expectedRef = (Deno.env.get("SUPABASE_URL") ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
    if (expectedRef && claims?.ref && claims.ref !== expectedRef) return deny();
    return null;
  } catch  {
    return deny();
  }
}
// W-03: retry wrapper for IDEMPOTENT reads only. Never wrap a write in this.
async function readWithRetry(label, run, attempts = READ_ATTEMPTS) {
  let lastErr = null;
  for(let i = 0; i < attempts; i++){
    const { data, error } = await run();
    if (!error) return {
      data,
      error: null
    };
    lastErr = error;
    console.warn(`[read] ${label} attempt ${i + 1}/${attempts} failed: ${error.message}`);
    if (i < attempts - 1) await new Promise((r)=>setTimeout(r, 250 * Math.pow(2, i)));
  }
  return {
    data: null,
    error: lastErr
  };
}
serve(async (req)=>{
  const authErr = authCheck(req);
  if (authErr) return authErr;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    // ── Find broadcasts ready to process ─────────────────────────────────
    const now = new Date().toISOString();
    const { data: broadcasts, error: broadcastError } = await readWithRetry("broadcasts", ()=>supabase.from("whatsapp_broadcasts").select("*").or(`status.eq.sending,and(status.eq.scheduled,scheduled_at.lte.${now})`).order("created_at", {
        ascending: true
      }).limit(3));
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
// ─── Process a single broadcast ──────────────────────────────────────────
async function processBroadcast(supabase, broadcast) {
  const broadcastId = broadcast.id;
  const questionId = broadcast.question_id;
  console.log(`Processing broadcast ${broadcastId}, status: ${broadcast.status}`);
  // W-02: a deferred run leaves broadcast state untouched; the next tick retries.
  const defer = (stage, err)=>{
    console.warn(`Deferring broadcast ${broadcastId}: ${stage} read failed: ${err?.message ?? err}`);
    return {
      broadcast_id: broadcastId,
      status: "deferred",
      reason: `${stage}_read_failed`
    };
  };
  // ── Mark as sending if scheduled ──────────────────────────────────
  if (broadcast.status === "scheduled") {
    await supabase.from("whatsapp_broadcasts").update({
      status: "sending",
      sent_at: new Date().toISOString()
    }).eq("id", broadcastId);
  }
  // ── Fetch question details ─────────────────────────────────────────
  // W-02: distinguish "read failed" (transient -> defer) from "read succeeded, no such
  // question" (genuine -> cancel). The old code conflated them and cancelled on both.
  const { data: question, error: questionError } = await readWithRetry("question", ()=>supabase.from("questions").select("question, summary, context_summary").eq("id", questionId).maybeSingle());
  if (questionError) return defer("question", questionError);
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
  // ── Which numbers have already been delivered for this broadcast ─────────────
  // W-02: on failure this MUST defer - an empty sentHashes set means re-sending to
  // everyone who already received the message.
  const { data: sentLogs, error: sentLogsError } = await readWithRetry("delivery_log", ()=>supabase.from("whatsapp_delivery_log").select("phone_hash").eq("broadcast_id", broadcastId));
  if (sentLogsError) return defer("delivery_log", sentLogsError);
  const sentHashes = new Set((sentLogs ?? []).map((l)=>l.phone_hash));
  // ── Get pending numbers from contact list ──────────────────────────────
  // W-02: on failure this MUST defer - an empty list would be read as "all done" below
  // and mark the broadcast completed without sending anything.
  const { data: allNumbers, error: allNumbersError } = await readWithRetry("contact_numbers", ()=>supabase.from("whatsapp_contact_list_numbers").select("phone_number, phone_hash").eq("contact_list_id", broadcast.contact_list_id).limit(BATCH_SIZE + sentHashes.size));
  if (allNumbersError) return defer("contact_numbers", allNumbersError);
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
  // ── Send messages in rate-limited batches ──────────────────────────────
  let sentCount = 0;
  let failedCount = 0;
  let deferredCount = 0;
  let rateLimited = false;
  for (const numberRow of pending){
    const phoneNumber = numberRow.phone_number;
    // ── Opt-out check — MUST fail closed ────────────────────────────────
    // W-02: previously `const { data: optOut } = ...` discarded the error, so a transient
    // read failure produced optOut = null and the message was SENT to a recipient who may
    // have opted out. Now: skip the number and leave it pending (no delivery_log row), so
    // the next tick retries it. Never send on doubt.
    const { data: optOut, error: optOutError } = await readWithRetry(`optout:${numberRow.phone_hash}`, ()=>supabase.from("whatsapp_optouts").select("is_active").eq("phone_hash", numberRow.phone_hash).eq("is_active", true).maybeSingle());
    if (optOutError) {
      deferredCount++;
      console.warn(`Opt-out check failed for ${numberRow.phone_hash} — skipping (fail closed)`);
      continue;
    }
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
    // ── Rate limit delay between sends ──────────────────────────────────
    await new Promise((resolve)=>setTimeout(resolve, RATE_LIMIT_MS));
  }
  // ── Update broadcast counters ────────────────────────────────────────
  if (!rateLimited) {
    await supabase.from("whatsapp_broadcasts").update({
      total_sent: broadcast.total_sent + sentCount,
      total_failed: broadcast.total_failed + failedCount
    }).eq("id", broadcastId);
  }
  console.log(`Broadcast ${broadcastId}: sent=${sentCount}, failed=${failedCount}, deferred=${deferredCount}, rate_limited=${rateLimited}`);
  return {
    broadcast_id: broadcastId,
    sent_this_batch: sentCount,
    failed: failedCount,
    deferred: deferredCount,
    rate_limited: rateLimited
  };
}
