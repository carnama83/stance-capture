// supabase/functions/whatsapp-flow-webhook/index.ts
// Epic AA — AA4.1 / AA4.2 / AA4.3 / AA5.1 / AA7.1 / AA8.1  (+ click-to-chat SUBSCRIBE)
//
// Receives inbound traffic from Meta WhatsApp Cloud API:
//   1. GET  — webhook verification challenge (Meta handshake)
//   2. POST — status events    (delivery receipts → whatsapp_delivery_log)
//   3. POST — text messages    (STOP/START opt-out + YES subscription + SUBSCRIBE global opt-in)
//
// NOTE (Option B): Flow stance submissions are NO LONGER handled here.
// Stance capture, forward-chain resolution, and the live confirmation screen
// now happen in whatsapp-flow-endpoint at the encrypted data_exchange step.
// The completion nfm_reply that still arrives here is acknowledged and ignored
// to avoid double-handling (see the interactive branch below).
//
// AA7:
//   - The stance write (in whatsapp-flow-endpoint) opens a whatsapp_active_sessions
//     row (phone_hash, question_id, 30-min TTL); this webhook reads it so an
//     inbound "YES" can be resolved to the right question and create a
//     subscription in whatsapp_question_subscriptions.
//   - STOP reply: cancels all subscriptions for phone_hash.
//
// Click-to-chat (Track 2):
//   - SUBSCRIBE reply: records a GLOBAL opt-in in whatsapp_global_subscribers.
//     The inbound message opens the 24h window and self-verifies the number —
//     no OTP, no authentication template.
//
// Security: HMAC-SHA256 signature verified on every POST before any processing.
// Privacy:  wa_id hashed with salt before any DB write — raw number never stored.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Independent of Supabase's project-wide magic-link expiry (which the
// existing email opt-in flow in WebOptInCard.tsx already relies on and
// shouldn't be affected by this) — this is the "shorter window" product
// decision for the WhatsApp sign-in link specifically. Adjust freely; it
// only governs whatsapp_signin_tokens rows minted below.
const SIGNIN_TOKEN_TTL_MINUTES = 15;

// ─── HMAC-SHA256 signature verification ──────────────────────────────────────
async function verifyHmacSignature(rawBody, signatureHeader, appSecret) {
  if (!signatureHeader) return false;
  const expected = signatureHeader.replace("sha256=", "");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), {
    name: "HMAC",
    hash: "SHA-256"
  }, false, [
    "sign"
  ]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(signature)).map((b)=>b.toString(16).padStart(2, "0")).join("");
  if (computed.length !== expected.length) return false;
  let mismatch = 0;
  for(let i = 0; i < computed.length; i++){
    mismatch |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
// ─── Hash wa_id with salt (SHA-256) ──────────────────────────────────────────
// Meta's wa_id (message.from / message.recipient_id) is already digits-only
// with no "+", so this normalization is a no-op here today — added purely
// so this function and whatsapp-send-flow's copy can never independently
// drift on what "the canonical phone string" means again. See
// whatsapp-send-flow's fix comment for the actual bug this class of
// mismatch caused: that function's E.164 validation requires a leading
// "+", producing a different hash than this one for the same real number.
function normalizePhoneForHash(raw) {
  return String(raw ?? "").replace(/[^\d]/g, "");
}
async function hashPhoneNumber(phoneNumber, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(normalizePhoneForHash(phoneNumber) + salt);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b)=>b.toString(16).padStart(2, "0")).join("");
}
// ─── Send a WhatsApp text message (for YES confirmation, STOP confirm) ───────
async function sendTextMessage(phoneNumberId, accessToken, toWaId, body) {
  await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toWaId,
      type: "text",
      text: {
        body
      }
    })
  });
}

// ─── Send a WhatsApp image message with a caption — used for the combined
// confirm+stats message when the primary question has a cover_image_url,
// same rationale as whatsapp-send-link's image path: renders immediately and
// consistently, not dependent on Meta's crawler unfurling a link in time. ──
async function sendImageMessage(phoneNumberId, accessToken, toWaId, imageUrl, caption) {
  await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toWaId,
      type: "image",
      image: { link: imageUrl, caption }
    })
  });
}

// ─── round() — used only for display in buildStatsMessage; null/NaN -> "0" ───
function round(n) {
  const v = Number(n);
  return Number.isFinite(v) ? String(Math.round(v)) : "0";
}

// ─── buildStatsMessage — one text block covering up to 3 just-committed
// questions, plus the primary (first) question's cover image for the caller
// to send as an image message. Region tiers (country/state/city) below
// MIN_REGION_N are omitted rather than shown as a misleading "100% of your
// city" off one respondent — this threshold isn't specified anywhere else in
// the schema/app, it's a judgment call made here; easy to tune if 5 turns
// out wrong in practice.
//
// Returns { blocks, extra } — blocks is one {text, imageUrl} PER question
// (not combined into a single shared image+caption), so each answered
// question shows its own correctly-paired cover photo. The caller sends each
// block as its own message. extra is the count beyond MAX_QUESTIONS_DETAILED,
// reported as a short trailing note rather than every question in detail.
async function buildStatsMessage(supabase, committed) {
  const MIN_REGION_N = 5;
  const MAX_QUESTIONS_DETAILED = 3;

  const toDetail = committed.slice(0, MAX_QUESTIONS_DETAILED);
  const extra = committed.length - toDetail.length;
  const blocks = [];

  for (const { question_id } of toDetail) {
    const { data: q } = await supabase
      .from("questions")
      .select("question, share_headline, slider_low_label, slider_high_label, cover_image_url")
      .eq("id", question_id)
      .maybeSingle();
    if (!q) continue;

    const { data: regionRows } = await supabase
      .from("question_stance_stats_region")
      .select("region_scope, region_label, total_responses, pct_agree, pct_disagree")
      .eq("question_id", question_id)
      .in("region_scope", ["global", "country", "state", "city"]);
    if (!regionRows || regionRows.length === 0) continue; // nothing to report yet

    const byScope = Object.fromEntries(regionRows.map((r) => [r.region_scope, r]));
    const headline = (q.share_headline || q.question || "").trim();
    const highLabel = q.slider_high_label || "one side";
    const lowLabel = q.slider_low_label || "the other side";

    // Bolded headline (WhatsApp markdown, *text*) — part of the formatting
    // pass, matches the same treatment whatsapp-send-link now gives headlines.
    const lines = [`📊 *${headline}*`];
    const g = byScope.global;
    if (g && g.total_responses >= MIN_REGION_N) {
      lines.push(`🌍 Global (${g.total_responses}): ${round(g.pct_agree)}% toward "${highLabel}", ${round(g.pct_disagree)}% toward "${lowLabel}"`);
    } else if (g) {
      lines.push(`🌍 You're one of the first ${g.total_responses === 1 ? "to weigh in" : `${g.total_responses} to weigh in`} on this one — check back soon to see how the community leans.`);
    }
    for (const scope of ["country", "state", "city"]) {
      const r = byScope[scope];
      if (r && r.total_responses >= MIN_REGION_N) {
        lines.push(`• ${r.region_label} (${r.total_responses}): ${round(r.pct_agree)}% / ${round(r.pct_disagree)}%`);
      }
    }
    let imageUrl = q.cover_image_url || null;
    if (imageUrl) {
      try {
        const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
        const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        const cardResp = await fetch(
          `${SUPABASE_URL}/functions/v1/whatsapp-card?question_id=${question_id}&fresh=1`,
          { headers: { Authorization: `Bearer ${SERVICE_KEY}` }, signal: AbortSignal.timeout(20000) }
        );
        if (cardResp.ok) {
          const cardData = await cardResp.json();
          if (cardData?.image_url) imageUrl = cardData.image_url;
        }
      } catch (err) {
        console.error("whatsapp-card fetch failed, falling back to cover_image_url:", String(err));
      }
    }
    blocks.push({ text: lines.join("\n"), imageUrl });
  }

  return { blocks, extra };
}

async function getOrCreateWhatsAppSigninLink(supabase, siteUrl, phoneHash, deviceId, questionId) {
  try {
    let effectiveQuestionId = questionId ?? null;
    if (!effectiveQuestionId) {
      const { data: session } = await supabase
        .from("whatsapp_active_sessions")
        .select("last_question_id, expires_at")
        .eq("whatsapp_phone_hash", phoneHash)
        .maybeSingle();
      if (session?.last_question_id && new Date(session.expires_at) > new Date()) {
        effectiveQuestionId = session.last_question_id;
      }
    }

    const { data: existing, error: lookupErr } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("verified_phone_hash", phoneHash)
      .maybeSingle();
    if (lookupErr) {
      console.error("[whatsapp-flow-webhook] verified_phone_hash lookup failed:", lookupErr.message);
      return null;
    }

    let userId = existing?.user_id ?? null;
    const isNewAccount = !userId;

    if (!userId) {
      const syntheticEmail = `wa-${crypto.randomUUID()}@phone.stancecapture.internal`;
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: syntheticEmail,
        email_confirm: true,
      });
      if (createErr || !created?.user?.id) {
        console.error("[whatsapp-flow-webhook] auth.admin.createUser failed:", createErr?.message ?? "no user returned");
        return null;
      }
      userId = created.user.id;

      const { error: bootstrapErr } = await supabase.rpc("bootstrap_whatsapp_account", {
        p_user_id: userId,
        p_phone_hash: phoneHash,
      });
      if (bootstrapErr) {
        console.error("[whatsapp-flow-webhook] bootstrap_whatsapp_account failed:", bootstrapErr.message);
        return null;
      }
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SIGNIN_TOKEN_TTL_MINUTES * 60_000).toISOString();
    const { error: tokenErr } = await supabase.from("whatsapp_signin_tokens").insert({
      token,
      user_id: userId,
      device_id: deviceId,
      question_id: effectiveQuestionId,
      expires_at: expiresAt,
    });
    if (tokenErr) {
      console.error("[whatsapp-flow-webhook] whatsapp_signin_tokens insert failed:", tokenErr.message);
      return null;
    }

    return {
      signinLink: `${siteUrl}/#/auth/whatsapp-signin?token=${encodeURIComponent(token)}`,
      isNewAccount,
    };
  } catch (err) {
    console.error("[whatsapp-flow-webhook] getOrCreateWhatsAppSigninLink error:", String(err));
    return null;
  }
}

async function commitAndFollowUp(supabase, phoneNumberId, accessToken, waId, phoneHash, committed) {
  if (!phoneNumberId || !accessToken || !committed || committed.length === 0) return;
  try {
    const { blocks, extra } = await buildStatsMessage(supabase, committed);
    let anyStatsWasImage = false;
    for (const block of blocks) {
      if (block.imageUrl) {
        const caption = block.text.length > 1024 ? block.text.slice(0, 1023).trimEnd() + "…" : block.text;
        await sendImageMessage(phoneNumberId, accessToken, waId, block.imageUrl, caption);
        anyStatsWasImage = true;
      } else {
        await sendTextMessage(phoneNumberId, accessToken, waId, block.text);
      }
    }
    if (extra > 0) {
      await sendTextMessage(phoneNumberId, accessToken, waId, `+${extra} more you weighed in on — see them at stancecapture.com`);
    }

    if (anyStatsWasImage) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    const justAnswered = committed.map((c) => c.question_id);
    const { data: nextId } = await supabase.rpc("pick_next_whatsapp_question", {
      p_phone_hash: phoneHash,
      p_exclude_question_ids: justAnswered
    });
    if (nextId) {
      await sendTextMessage(phoneNumberId, accessToken, waId, "Here's a question a lot of people are weighing in on right now:");
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send-link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ phone_number: `+${waId}`, question_id: nextId })
      }).catch((e) => console.error("next-question send failed:", String(e)));
    }
  } catch (err) {
    console.error("commitAndFollowUp error:", String(err));
  }
}
serve(async (req)=>{
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET");
  const PHONE_HASH_SALT = Deno.env.get("WHATSAPP_PHONE_HASH_SALT");
  const VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "stancecapture_webhook_verify";
  const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
  const SITE = Deno.env.get("PUBLIC_SITE_URL") ?? "https://www.stancecapture.com";
  const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge, {
        status: 200
      });
    }
    return new Response("Forbidden", {
      status: 403
    });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405
    });
  }
  const rawBody = await req.text();
  const signatureHeader = req.headers.get("x-hub-signature-256");
  const isValid = await verifyHmacSignature(rawBody, signatureHeader, APP_SECRET);
  if (!isValid) {
    console.error("HMAC verification failed");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    await supabase.from("whatsapp_webhook_errors").insert({
      error_type: "invalid_signature",
      payload_preview: rawBody.substring(0, 200)
    });
    return new Response("Forbidden", {
      status: 400
    });
  }
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch  {
    return new Response("Bad Request", {
      status: 400
    });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const entries = payload?.entry ?? [];
    for (const entry of entries){
      const changes = entry?.changes ?? [];
      for (const change of changes){
        const value = change?.value ?? {};
        if (value?.statuses) {
          const statuses = value.statuses;
          for (const status of statuses){
            const waId = status?.recipient_id;
            const msgStatus = status?.status;
            if (!waId || !msgStatus) continue;
            const phoneHash = await hashPhoneNumber(waId, PHONE_HASH_SALT);
            const statusMap = {
              sent: "sent",
              delivered: "delivered",
              read: "delivered",
              failed: "failed"
            };
            const mappedStatus = statusMap[msgStatus];
            if (!mappedStatus) continue;
            const { data: logRow } = await supabase.from("whatsapp_delivery_log").select("id, broadcast_id").eq("phone_hash", phoneHash).order("sent_at", {
              ascending: false
            }).limit(1).maybeSingle();
            if (logRow?.id) {
              const updateData = {
                status: mappedStatus
              };
              if (msgStatus === "read") {
                updateData.flow_opened_at = new Date().toISOString();
              }
              await supabase.from("whatsapp_delivery_log").update(updateData).eq("id", logRow.id);
              if (mappedStatus === "delivered" && logRow.broadcast_id) {
                await supabase.rpc("increment_broadcast_counter", {
                  p_broadcast_id: logRow.broadcast_id,
                  p_column: "total_delivered"
                });
              }
              if (msgStatus === "read" && logRow.broadcast_id) {
                await supabase.rpc("increment_broadcast_counter", {
                  p_broadcast_id: logRow.broadcast_id,
                  p_column: "total_opened"
                });
              }
            }
          }
          continue;
        }
        const messages = value?.messages ?? [];
        for (const message of messages){
          const waId = message?.from;
          const msgType = message?.type;
          if (!waId) continue;
          const phoneHash = await hashPhoneNumber(waId, PHONE_HASH_SALT);
          if (msgType === "text") {
            const rawBody = (message?.text?.body ?? "").trim();
            const body = rawBody.toUpperCase();
            if (body === "STOP") {
              await supabase.from("whatsapp_optouts").upsert({
                phone_hash: phoneHash,
                opted_out_at: new Date().toISOString(),
                is_active: true
              }, {
                onConflict: "phone_hash"
              });
              await supabase.from("whatsapp_question_subscriptions").update({
                is_active: false
              }).eq("whatsapp_phone_hash", phoneHash).eq("is_active", true);
              await supabase.from("whatsapp_global_subscribers").update({
                is_active: false,
                unsubscribed_at: new Date().toISOString()
              }).eq("phone_hash", phoneHash);
              console.log("STOP received — opted out and subscriptions cancelled:", phoneHash.substring(0, 8));
            }
            if (body === "START") {
              await supabase.from("whatsapp_optouts").update({
                is_active: false,
                opted_in_at: new Date().toISOString()
              }).eq("phone_hash", phoneHash);
              if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
                await sendTextMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, waId, "You've re-enabled Stance Capture questions on WhatsApp. Reply STOP at any time to opt out again.");
              }
            }
            if (body === "SUBSCRIBE" || body.startsWith("SUBSCRIBE ")) {
              const deviceId = rawBody.slice("SUBSCRIBE".length).trim() || null;
              await supabase.from("whatsapp_global_subscribers").upsert({
                phone_hash: phoneHash,
                subscribed_at: new Date().toISOString(),
                source: "click_to_chat",
                is_active: true,
                unsubscribed_at: null
              }, {
                onConflict: "phone_hash"
              });
              await supabase.from("whatsapp_optouts").update({
                is_active: false,
                opted_in_at: new Date().toISOString()
              }).eq("phone_hash", phoneHash);
              console.log("SUBSCRIBE received — global opt-in recorded:", phoneHash.substring(0, 8));

              const committed = deviceId
                ? await (async () => {
                    const { data, error } = await supabase.rpc("commit_staged_stances_for_device", {
                      p_device_id: deviceId,
                      p_phone_hash: phoneHash,
                    });
                    if (error) {
                      console.error("commit_staged_stances_for_device error:", error.message);
                      return null;
                    }
                    return data;
                  })()
                : null;
              const primaryQuestionId = committed?.[0]?.question_id ?? null;

              const signinResult = await getOrCreateWhatsAppSigninLink(supabase, SITE, phoneHash, deviceId, primaryQuestionId);
              const signinLink = signinResult?.signinLink ?? null;
              const isNewAccount = signinResult?.isNewAccount ?? false;
              const responseSaved = !!(committed && committed.length > 0);

              // Distinct from "no deviceId at all" (bare SUBSCRIBE, nothing
              // was ever staged): if a deviceId WAS supplied but
              // commit_staged_stances_for_device returned nothing, this
              // browser's most recent staged answer has already been
              // committed elsewhere — either earlier under this same
              // account, or (the common case when testing with multiple
              // numbers on one browser) by a DIFFERENT phone number that
              // shares this device_id. commit_staged_stances_for_device
              // scopes purely by device_id + committed=false, so either way
              // there's genuinely nothing new for THIS SUBSCRIBE to report.
              // Confirmed live: a person tapping "Add your voice via
              // WhatsApp" then SUBSCRIBE reasonably expects a stats reply;
              // silently sending none reads as broken, not as "nothing to
              // do" — say so explicitly instead.
              const deviceHadNothingNewToCommit = !!deviceId && !responseSaved;

              if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
                let baseText;
                if (isNewAccount && responseSaved) {
                  baseText = "You're subscribed to Stance Capture updates. Your response is saved and your account is ready";
                } else if (isNewAccount) {
                  baseText = "You're subscribed to Stance Capture updates. Your account is ready";
                } else if (responseSaved) {
                  baseText = "Welcome back to Stance Capture. Your response is saved";
                } else {
                  baseText = "Welcome back to Stance Capture";
                }
                const recoveryExplainer = isNewAccount
                  ? "\n\nLost this link or signing in on a new device later? Just text SUBSCRIBE here anytime and we'll send a fresh one — that's how you sign back in, no password needed."
                  : "";
                const staleDeviceNote = deviceHadNothingNewToCommit
                  ? "\n\n(No new stats this time — the last answer from this browser was already recorded, possibly under a different number. Answer a new question on stancecapture.com to get a fresh update.)"
                  : "";
                const confirmationText = signinLink
                  ? `${baseText} — sign in here (link expires in ${SIGNIN_TOKEN_TTL_MINUTES} min): ${signinLink}${recoveryExplainer}${staleDeviceNote}\n\nWe'll message you when there's something worth weighing in on. Reply STOP anytime to unsubscribe.`
                  : "You're subscribed to Stance Capture updates. We'll message you when there's something worth weighing in on. Reply STOP anytime to unsubscribe.";
                await sendTextMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, waId, confirmationText);
                if (committed && committed.length > 0) {
                  await commitAndFollowUp(supabase, PHONE_NUMBER_ID, ACCESS_TOKEN, waId, phoneHash, committed);
                }
              }
              continue;
            }
            if (body === "YES") {
              const { data: session } = await supabase.from("whatsapp_active_sessions").select("last_question_id, expires_at").eq("whatsapp_phone_hash", phoneHash).maybeSingle();
              if (!session || !session.last_question_id || new Date(session.expires_at) < new Date()) {
                if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
                  await sendTextMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, waId, "Sorry, we couldn't find your recent question. Please answer a Stance Capture question first to subscribe to updates.");
                }
                continue;
              }
              await supabase.from("whatsapp_question_subscriptions").upsert({
                whatsapp_phone_hash: phoneHash,
                question_id: session.last_question_id,
                subscribed_at: new Date().toISOString(),
                is_active: true
              }, {
                onConflict: "whatsapp_phone_hash,question_id"
              });
              if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
                await sendTextMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, waId, "You'll receive an update when community stance on this question shifts. Reply STOP to unsubscribe.");
              }
              console.log("YES subscription created:", phoneHash.substring(0, 8), session.last_question_id);
            }
            continue;
          }
          if (msgType === "interactive") {
            continue;
          }
        }
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
    await supabase.from("whatsapp_webhook_errors").insert({
      error_type: "processing_error",
      payload_preview: String(err).substring(0, 200)
    });
  }
  return new Response(JSON.stringify({
    status: "ok"
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json"
    }
  });
});
