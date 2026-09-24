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
// Epic AA-09 (24 Sep 2026): this used to log "Would dispatch update" and mark
// the subscriber notified without sending, because only the phone hash was
// stored. A YES subscription now carries the number, AES-256-GCM encrypted by
// whatsapp-flow-webhook (see its encryptWaId), and this function decrypts it,
// checks it still hashes to the row's phone hash, and really sends. A
// subscription is marked notified ONLY when Meta accepts the message.
// First evaluation after YES records the baseline silently (no message minutes
// after subscribing); the weekly digest counts from subscribed_at.
//
// Env secrets required:
//   WHATSAPP_ACCESS_TOKEN
//   WHATSAPP_PHONE_NUMBER_ID
//   WHATSAPP_NUMBER_KEY            (same key as whatsapp-flow-webhook)
//   WHATSAPP_PHONE_HASH_SALT
//   WHATSAPP_UPDATE_TEMPLATE_NAME  (default: stance_update_notification)
//   WHATSAPP_UPDATE_TEMPLATE_LANG  (default: en_US)
//   PUBLIC_SITE_URL                (default: https://www.stancecapture.com)
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_URL
//   CRON_SECRET (optional)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const FUNC = "whatsapp-send-update";
const SHIFT_THRESHOLD = 5; // pp shift triggers notification
const MAX_PER_Q_24H = 1; // max notifications per question per day
const MAX_PER_WEEK = 3; // max notifications per subscriber per week
const PAGE_SIZE = 100; // subscriptions fetched per page
const MAX_PER_RUN = 1000; // subscriptions evaluated per invocation
const OUTSIDE_WINDOW = 131047; // Meta: re-engagement needed (24h window closed)
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
// ─── Caller check (same as whatsapp-broadcast-dispatch, W-01 / AA-05) ───────
// Fails closed: Bearer CRON_SECRET, an exact match with this project's
// service-role key, or a JWT whose role is service_role for this project
// (trustworthy only because verify_jwt=true; do not turn that off).
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
// ─── Number decryption (format written by whatsapp-flow-webhook) ─────────────
async function importNumberKey() {
  try {
    const raw = Uint8Array.from(atob(Deno.env.get("WHATSAPP_NUMBER_KEY") ?? ""), (c)=>c.charCodeAt(0));
    if (raw.length !== 32) return null;
    return await crypto.subtle.importKey("raw", raw, {
      name: "AES-GCM"
    }, false, [
      "decrypt"
    ]);
  } catch  {
    return null;
  }
}
async function decryptWaId(key, enc, phoneHash) {
  const parts = String(enc ?? "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  try {
    const iv = Uint8Array.from(atob(parts[1]), (c)=>c.charCodeAt(0));
    const ct = Uint8Array.from(atob(parts[2]), (c)=>c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(phoneHash)
    }, key, ct);
    return new TextDecoder().decode(pt);
  } catch  {
    return null;
  }
}
// Same hash as whatsapp-flow-webhook / whatsapp-send-flow: a decrypted number
// is used only if it still hashes to the subscription's phone hash.
async function hashPhoneNumber(phoneNumber, salt) {
  const data = new TextEncoder().encode(String(phoneNumber ?? "").replace(/[^\d]/g, "") + salt);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
async function sendToMeta(phoneNumberId, accessToken, payload) {
  try {
    const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(()=>({}));
    const messageId = json?.messages?.[0]?.id ?? null;
    if (res.ok && messageId) return {
      ok: true,
      messageId
    };
    return {
      ok: false,
      code: json?.error?.code ?? res.status,
      reason: String(json?.error?.message ?? `HTTP ${res.status}`).slice(0, 200)
    };
  } catch (err) {
    return {
      ok: false,
      code: null,
      reason: String(err).slice(0, 200)
    };
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
  const UPDATE_TEMPLATE = Deno.env.get("WHATSAPP_UPDATE_TEMPLATE_NAME") ?? "stance_update_notification";
  const TEMPLATE_LANG = Deno.env.get("WHATSAPP_UPDATE_TEMPLATE_LANG") ?? "en_US";
  const SITE = Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.stancecapture.com";
  const PHONE_HASH_SALT = Deno.env.get("WHATSAPP_PHONE_HASH_SALT") ?? "";
  const numberKey = await importNumberKey();
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID || !numberKey || !PHONE_HASH_SALT) {
    log("warn", "WhatsApp credentials, WHATSAPP_NUMBER_KEY or WHATSAPP_PHONE_HASH_SALT not configured — skipping update dispatch", {
      has_token: !!ACCESS_TOKEN,
      has_phone_number_id: !!PHONE_NUMBER_ID,
      has_number_key: !!numberKey,
      has_salt: !!PHONE_HASH_SALT
    });
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
  // Fetch active subscriptions that carry a number and were not notified in the
  // last 24h (per-question guard). Paginated so rows that are evaluated but not
  // triggered cannot starve the rest.
  const subscriptions = [];
  for(let from = 0; from < MAX_PER_RUN; from += PAGE_SIZE){
    const { data: page, error: subErr } = await supabase.from("whatsapp_question_subscriptions").select("id, whatsapp_phone_hash, question_id, subscribed_at, last_inbound_at, wa_id_enc, last_notified_at, last_agree_pct, last_disagree_pct, last_neutral_pct, last_response_count, notification_count, last_weekly_digest_at").eq("is_active", true).not("wa_id_enc", "is", null).or(`last_notified_at.is.null,last_notified_at.lt.${now24hAgo}`).order("id").range(from, from + PAGE_SIZE - 1);
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
    subscriptions.push(...page ?? []);
    if (!page || page.length < PAGE_SIZE) break;
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
  // Opted-out numbers (STOP) are never messaged, even if a subscription row
  // were somehow still active.
  const hashes = [
    ...new Set(subscriptions.map((s)=>s.whatsapp_phone_hash))
  ];
  const optedOut = new Set();
  for(let i = 0; i < hashes.length; i += 100){
    const { data: rows } = await supabase.from("whatsapp_optouts").select("phone_hash").eq("is_active", true).in("phone_hash", hashes.slice(i, i + 100));
    for (const r of rows ?? [])optedOut.add(r.phone_hash);
  }
  let dispatched = 0;
  let skipped = 0;
  let baselined = 0;
  let failed = 0;
  for (const sub of subscriptions){
    try {
      // Weekly cap check
      if (optedOut.has(sub.whatsapp_phone_hash) || (phoneHashWeeklyCounts[sub.whatsapp_phone_hash] ?? 0) >= MAX_PER_WEEK) {
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
      // First evaluation after YES: record the baseline without messaging, so
      // a person is not sent an "update" minutes after subscribing.
      if (sub.last_agree_pct === null) {
        await supabase.from("whatsapp_question_subscriptions").update({
          last_agree_pct: agreeNow,
          last_disagree_pct: disagreeNow,
          last_neutral_pct: neutralNow,
          last_response_count: countNow
        }).eq("id", sub.id);
        baselined++;
        continue;
      }
      // ── Evaluate trigger conditions ──────────────────────────────────
      const agreeDelta = sub.last_agree_pct !== null ? Math.abs(agreeNow - sub.last_agree_pct) : 0;
      const disagreeDelta = sub.last_disagree_pct !== null ? Math.abs(disagreeNow - sub.last_disagree_pct) : 0;
      const neutralDelta = sub.last_neutral_pct !== null ? Math.abs(neutralNow - sub.last_neutral_pct) : 0;
      const shiftTriggered = agreeDelta >= SHIFT_THRESHOLD || disagreeDelta >= SHIFT_THRESHOLD || neutralDelta >= SHIFT_THRESHOLD;
      const milestoneTriggered = sub.last_response_count !== null && MILESTONES.some((m)=>countNow >= m && (sub.last_response_count ?? 0) < m);
      const weeklyTriggered = new Date(sub.last_weekly_digest_at ?? sub.subscribed_at) < new Date(now7dAgo);
      const shouldNotify = shiftTriggered || milestoneTriggered || weeklyTriggered;
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
      const forwardLink = `${SITE}/s/${qData.slug ?? sub.question_id}`;
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
      const waId = await decryptWaId(numberKey, sub.wa_id_enc, sub.whatsapp_phone_hash);
      if (!waId || await hashPhoneNumber(waId, PHONE_HASH_SALT) !== sub.whatsapp_phone_hash) {
        log("warn", "Stored number unusable (wrong key, tampered, or hash mismatch); skipping", {
          subscription_id: sub.id
        });
        failed++;
        continue;
      }
      // Meta's 24-hour customer-service window: open if the subscriber messaged
      // us (the YES, or a Flow answer) within 24h. If Meta says it is closed
      // anyway, fall back to the approved template.
      const { data: session } = await supabase.from("whatsapp_active_sessions").select("updated_at").eq("whatsapp_phone_hash", sub.whatsapp_phone_hash).maybeSingle();
      const lastInbound = Math.max(sub.last_inbound_at ? Date.parse(sub.last_inbound_at) : 0, session?.updated_at ? Date.parse(session.updated_at) : 0);
      const withinWindow = lastInbound > Date.parse(now24hAgo);
      const templatePayload = {
        messaging_product: "whatsapp",
        to: waId,
        type: "template",
        template: {
          name: UPDATE_TEMPLATE,
          language: {
            code: TEMPLATE_LANG
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
      let result;
      let via = "template";
      if (withinWindow) {
        via = "text";
        result = await sendToMeta(PHONE_NUMBER_ID, ACCESS_TOKEN, {
          messaging_product: "whatsapp",
          to: waId,
          type: "text",
          text: {
            body: messageBody
          }
        });
        if (!result.ok && result.code === OUTSIDE_WINDOW) {
          via = "template";
          result = await sendToMeta(PHONE_NUMBER_ID, ACCESS_TOKEN, templatePayload);
        }
      } else {
        result = await sendToMeta(PHONE_NUMBER_ID, ACCESS_TOKEN, templatePayload);
      }
      if (!result.ok) {
        // Not marked notified: it will be retried on the next run.
        log("warn", "Update send failed", {
          subscription_id: sub.id,
          via,
          code: result.code,
          reason: result.reason
        });
        failed++;
        continue;
      }
      log("info", "Update sent", {
        hash: sub.whatsapp_phone_hash.substring(0, 8),
        question_id: sub.question_id,
        trigger: shiftTriggered ? "shift" : milestoneTriggered ? "milestone" : "weekly",
        via,
        message_id: result.messageId
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
    evaluated: subscriptions.length,
    dispatched,
    baselined,
    skipped,
    failed
  });
  return new Response(JSON.stringify({
    evaluated: subscriptions.length,
    dispatched,
    baselined,
    skipped,
    failed
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
});
