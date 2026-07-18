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
async function hashPhoneNumber(phoneNumber, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(phoneNumber + salt);
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
serve(async (req)=>{
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET");
  const PHONE_HASH_SALT = Deno.env.get("WHATSAPP_PHONE_HASH_SALT");
  const VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "stancecapture_webhook_verify";
  const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
  const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
  // ── GET — Meta webhook verification challenge ──────────────────────────
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
  // ── HMAC signature verification ────────────────────────────────────────
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
        // ── Status events: delivery receipts ────────────────────────────
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
              // Track when Flow was opened (first 'read' event = user opened message)
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
        // ── Message events ───────────────────────────────────────────────
        const messages = value?.messages ?? [];
        for (const message of messages){
          const waId = message?.from;
          const msgType = message?.type;
          if (!waId) continue;
          const phoneHash = await hashPhoneNumber(waId, PHONE_HASH_SALT);
          // ── Text messages: STOP / START / YES / SUBSCRIBE ───────────────
          if (msgType === "text") {
            const body = (message?.text?.body ?? "").trim().toUpperCase();
            if (body === "STOP") {
              // Opt out
              await supabase.from("whatsapp_optouts").upsert({
                phone_hash: phoneHash,
                opted_out_at: new Date().toISOString(),
                is_active: true
              }, {
                onConflict: "phone_hash"
              });
              // AA7: Cancel all active subscriptions
              await supabase.from("whatsapp_question_subscriptions").update({
                is_active: false
              }).eq("whatsapp_phone_hash", phoneHash).eq("is_active", true);
              // Track 2: also deactivate global click-to-chat subscription
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
            // ── Track 2: SUBSCRIBE — click-to-chat global opt-in ──────────
            if (body === "SUBSCRIBE") {
              await supabase.from("whatsapp_global_subscribers").upsert({
                phone_hash: phoneHash,
                subscribed_at: new Date().toISOString(),
                source: "click_to_chat",
                is_active: true,
                unsubscribed_at: null
              }, {
                onConflict: "phone_hash"
              });
              // Make sure a prior STOP doesn't keep them suppressed.
              await supabase.from("whatsapp_optouts").update({
                is_active: false,
                opted_in_at: new Date().toISOString()
              }).eq("phone_hash", phoneHash);
              if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
                await sendTextMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, waId, "You're subscribed to Stance Capture updates. We'll message you when there's something worth weighing in on. Reply STOP anytime to unsubscribe.");
              }
              console.log("SUBSCRIBE received — global opt-in recorded:", phoneHash.substring(0, 8));
              continue;
            }
            // ── AA7: YES subscription ────────────────────────────────────
            if (body === "YES") {
              // Look up active session to find the question this YES is for
              const { data: session } = await supabase.from("whatsapp_active_sessions").select("last_question_id, expires_at").eq("whatsapp_phone_hash", phoneHash).maybeSingle();
              if (!session || !session.last_question_id || new Date(session.expires_at) < new Date()) {
                // Session expired or not found
                if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
                  await sendTextMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, waId, "Sorry, we couldn't find your recent question. Please answer a Stance Capture question first to subscribe to updates.");
                }
                continue;
              }
              // Upsert subscription
              await supabase.from("whatsapp_question_subscriptions").upsert({
                whatsapp_phone_hash: phoneHash,
                question_id: session.last_question_id,
                subscribed_at: new Date().toISOString(),
                is_active: true
              }, {
                onConflict: "whatsapp_phone_hash,question_id"
              });
              // Confirmation message
              if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
                await sendTextMessage(PHONE_NUMBER_ID, ACCESS_TOKEN, waId, "You'll receive an update when community stance on this question shifts. Reply STOP to unsubscribe.");
              }
              console.log("YES subscription created:", phoneHash.substring(0, 8), session.last_question_id);
            }
            continue;
          }
          // ── Flow submission: nfm_reply ───────────────────────────────────
          // RETIRED (Option B): stance capture now happens in
          // whatsapp-flow-endpoint at the encrypted data_exchange step, which
          // stores the stance, resolves forward chains, and serves the live
          // confirmation screen. Meta still delivers an nfm_reply here when the
          // Flow completes, but its payload is intentionally empty — we simply
          // ignore it to avoid double-handling. Do NOT re-add stance storage here.
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
