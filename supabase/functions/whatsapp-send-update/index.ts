// supabase/functions/whatsapp-send-update/index.ts
// Epic AA — AA7.2
//
// Cron-triggered every 15 minutes.
// Scans whatsapp_question_subscriptions for subscribers whose question
// distribution has shifted ≥5pp, crossed a response milestone, or passed
// the weekly digest threshold (7 days with no notification).
//
// Spam guards:
//   - Max 1 notification per subscriber per question per 24 hours
//   - Max 3 notifications per subscriber per week across all questions
//
// Meta 24-hour window:
//   - If subscriber messaged Stance Capture within 24h: use free-form text
//   - If outside 24h: use approved stance_update_notification template
//
// Env secrets required:
//   WHATSAPP_ACCESS_TOKEN
//   WHATSAPP_PHONE_NUMBER_ID
//   WHATSAPP_UPDATE_TEMPLATE_NAME  (default: stance_update_notification)
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_URL
//   CRON_SECRET
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const FUNC = "whatsapp-send-update";
const SHIFT_THRESHOLD = 5; // pp shift triggers notification
const MAX_PER_Q_24H = 1; // max notifications per question per day
const MAX_PER_WEEK = 3; // max notifications per subscriber per week
const BATCH_SIZE = 100; // subscriptions to evaluate per invocation
const MILESTONES = [
  100,
  500,
  1000,
  5000,
  10000
];
function log(level, msg, extra = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    func: FUNC,
    msg,
    ...extra
  }));
}
function formatPct(n) {
  return `${Math.round(n)}%`;
}
function formatDelta(now, last) {
  if (last === null) return "";
  const delta = Math.round(now - last);
  if (delta === 0) return "";
  return delta > 0 ? ` (+${delta}pp)` : ` (${delta}pp)`;
}
serve(async (req)=>{
  const CRON_SECRET = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("authorization") ?? "";
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
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
  const UPDATE_TEMPLATE = Deno.env.get("WHATSAPP_UPDATE_TEMPLATE_NAME") ?? "stance_update_notification";
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    log("warn", "WhatsApp credentials not configured — skipping update dispatch");
    return new Response(JSON.stringify({
      skipped: true
    }), {
      status: 200
    });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const now = new Date();
  const now24hAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const now7dAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  // Fetch active subscriptions not notified in the last 24h (per-question guard)
  const { data: subscriptions, error: subErr } = await supabase.from("whatsapp_question_subscriptions").select("id, whatsapp_phone_hash, question_id, last_notified_at, last_agree_pct, last_disagree_pct, last_neutral_pct, last_response_count, notification_count, last_weekly_digest_at").eq("is_active", true).or(`last_notified_at.is.null,last_notified_at.lt.${now24hAgo}`).limit(BATCH_SIZE);
  if (subErr) {
    log("error", "Failed to fetch subscriptions", {
      error: subErr.message
    });
    return new Response(JSON.stringify({
      error: subErr.message
    }), {
      status: 500
    });
  }
  if (!subscriptions || subscriptions.length === 0) {
    log("info", "No subscriptions eligible for notification");
    return new Response(JSON.stringify({
      dispatched: 0
    }), {
      status: 200
    });
  }
  // Build per-subscriber week totals to enforce max-3-per-week
  const phoneHashWeeklyCounts = {};
  for (const sub of subscriptions){
    if (!phoneHashWeeklyCounts[sub.whatsapp_phone_hash]) {
      // Count how many notifications this subscriber got in last 7 days
      const { count } = await supabase.from("whatsapp_question_subscriptions").select("id", {
        count: "exact",
        head: true
      }).eq("whatsapp_phone_hash", sub.whatsapp_phone_hash).gte("last_notified_at", now7dAgo);
      phoneHashWeeklyCounts[sub.whatsapp_phone_hash] = count ?? 0;
    }
  }
  let dispatched = 0;
  let skipped = 0;
  for (const sub of subscriptions){
    try {
      // Weekly cap check
      if ((phoneHashWeeklyCounts[sub.whatsapp_phone_hash] ?? 0) >= MAX_PER_WEEK) {
        skipped++;
        continue;
      }
      // Fetch current distribution
      const { data: distRows } = await supabase.rpc("get_question_distribution", {
        p_question_id: sub.question_id
      });
      const dist = distRows?.[0];
      if (!dist) {
        skipped++;
        continue;
      }
      const agreeNow = Number(dist.support_pct);
      const disagreeNow = Number(dist.oppose_pct);
      const neutralNow = Number(dist.neutral_pct);
      const countNow = Number(dist.responses);
      // ── Evaluate trigger conditions ──────────────────────────────────
      const agreeDelta = sub.last_agree_pct !== null ? Math.abs(agreeNow - sub.last_agree_pct) : 0;
      const disagreeDelta = sub.last_disagree_pct !== null ? Math.abs(disagreeNow - sub.last_disagree_pct) : 0;
      const neutralDelta = sub.last_neutral_pct !== null ? Math.abs(neutralNow - sub.last_neutral_pct) : 0;
      const shiftTriggered = agreeDelta >= SHIFT_THRESHOLD || disagreeDelta >= SHIFT_THRESHOLD || neutralDelta >= SHIFT_THRESHOLD;
      const milestoneTriggered = sub.last_response_count !== null && MILESTONES.some((m)=>countNow >= m && (sub.last_response_count ?? 0) < m);
      const weeklyTriggered = !sub.last_weekly_digest_at || new Date(sub.last_weekly_digest_at) < new Date(now7dAgo);
      const isFirstNotif = sub.last_notified_at === null;
      const shouldNotify = isFirstNotif || shiftTriggered || milestoneTriggered || weeklyTriggered;
      if (!shouldNotify) {
        skipped++;
        continue;
      }
      // Fetch question details
      const { data: qData } = await supabase.from("questions").select("question, slug").eq("id", sub.question_id).maybeSingle();
      if (!qData) {
        skipped++;
        continue;
      }
      const questionText = qData.question.length > 100 ? qData.question.slice(0, 97) + "…" : qData.question;
      const forwardLink = `stancecapture.com/q/${qData.slug ?? sub.question_id}`;
      // ── Build message body ─────────────────────────────────────────────
      const distSummary = [
        `Agree: ${formatPct(agreeNow)}${formatDelta(agreeNow, sub.last_agree_pct)}`,
        `Neutral: ${formatPct(neutralNow)}${formatDelta(neutralNow, sub.last_neutral_pct)}`,
        `Disagree: ${formatPct(disagreeNow)}${formatDelta(disagreeNow, sub.last_disagree_pct)}`
      ].join(" · ");
      let triggerLine = "";
      if (shiftTriggered) triggerLine = "Community stance has shifted on a question you answered.";
      else if (milestoneTriggered) triggerLine = `This question just crossed ${MILESTONES.find((m)=>countNow >= m && (sub.last_response_count ?? 0) < m).toLocaleString()} responses!`;
      else triggerLine = "Weekly update on a question you answered.";
      const messageBody = [
        triggerLine,
        `"${questionText}"`,
        "",
        distSummary,
        `${countNow.toLocaleString()} responses`,
        "",
        `See more: ${forwardLink}`,
        "Reply STOP to unsubscribe."
      ].join("\n");
      // ── Send via Meta API ──────────────────────────────────────────────
      // Determine if we're within the 24-hour session window
      // (simplified: check if they messaged us in last 24h via active_sessions updated_at)
      const { data: session } = await supabase.from("whatsapp_active_sessions").select("updated_at").eq("whatsapp_phone_hash", sub.whatsapp_phone_hash).maybeSingle();
      const withinWindow = session?.updated_at && new Date(session.updated_at) > new Date(now24hAgo);
      let metaPayload;
      if (withinWindow) {
        // Free-form text within 24h session window
        metaPayload = {
          messaging_product: "whatsapp",
          to: sub.whatsapp_phone_hash,
          // the webhook would need to resolve back to the wa_id via a secure lookup.
          // For now this field is a placeholder — see implementation note below.
          type: "text",
          text: {
            body: messageBody
          }
        };
      } else {
        // Template message outside 24h window
        metaPayload = {
          messaging_product: "whatsapp",
          to: sub.whatsapp_phone_hash,
          type: "template",
          template: {
            name: UPDATE_TEMPLATE,
            language: {
              code: "en_US"
            },
            components: [
              {
                type: "body",
                parameters: [
                  {
                    type: "text",
                    text: questionText
                  },
                  {
                    type: "text",
                    text: distSummary
                  },
                  {
                    type: "text",
                    text: forwardLink
                  }
                ]
              }
            ]
          }
        };
      }
      // NOTE: In production, `to` must be the raw wa_id (E.164 phone number),
      // not the hash. Since we store only hashes, the send workflow would require
      // a secure lookup mechanism. The current schema stores only hashes by design
      // (AA5.2). When the Meta template is approved and the send pipeline is live,
      // this function dispatches via whatsapp-send-flow using the phone hash to
      // look up the original number in a secure server-side mapping table.
      // For now, we log the intent and update the subscription record.
      //
      // TODO: Implement secure wa_id retrieval once the operational model is confirmed.
      // Options: (a) store encrypted wa_id in whatsapp_question_subscriptions with
      // server-side decryption key in Vault, or (b) use Meta's user_identity_id to
      // initiate template messages without storing the raw number.
      log("info", "Would dispatch update", {
        hash: sub.whatsapp_phone_hash.substring(0, 8),
        question_id: sub.question_id,
        trigger: shiftTriggered ? "shift" : milestoneTriggered ? "milestone" : "weekly",
        within_window: withinWindow
      });
      // ── Update subscription record ─────────────────────────────────────
      const updateData = {
        last_notified_at: now.toISOString(),
        last_agree_pct: agreeNow,
        last_disagree_pct: disagreeNow,
        last_neutral_pct: neutralNow,
        last_response_count: countNow,
        notification_count: sub.notification_count + 1
      };
      if (weeklyTriggered) {
        updateData.last_weekly_digest_at = now.toISOString();
      }
      await supabase.from("whatsapp_question_subscriptions").update(updateData).eq("id", sub.id);
      phoneHashWeeklyCounts[sub.whatsapp_phone_hash] = (phoneHashWeeklyCounts[sub.whatsapp_phone_hash] ?? 0) + 1;
      dispatched++;
    } catch (err) {
      log("warn", "Error processing subscription", {
        subscription_id: sub.id,
        error: String(err)
      });
      skipped++;
    }
  }
  log("info", "Update dispatch complete", {
    dispatched,
    skipped
  });
  return new Response(JSON.stringify({
    dispatched,
    skipped
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
});
