// supabase/functions/whatsapp-send-flow/index.ts
// Epic AA — AA2.1 / AA3.1 / AA2.2
//
// Sends a single WhatsApp Flow template message to a phone number.
// Called by:
//   - ShareButton (user-initiated share → Flow delivery)
//   - whatsapp-broadcast-dispatch (bulk broadcast)
//   - Admin WhatsApp Settings (test connection)
//   - SettingsProfile (phone verification — verification_mode: true)
//
// Returns:
//   { sent: true,  message_id: string }                          — standard send
//   { sent: true,  message_id: string, verification_token: uuid } — verification mode
//   { sent: false, reason: string }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
// ─── Hash wa_id with salt (SHA-256) ──────────────────────────────────────────
// BUG FIX: isValidE164() below requires a leading "+" — that's what makes
// it E.164-compliant. But Meta's own webhook payload (message.from /
// message.recipient_id, see whatsapp-flow-webhook) NEVER has a "+" — just
// digits. Hashing this function's E.164-with-+ input directly against
// hashPhoneNumber(), while whatsapp-flow-webhook hashes Meta's no-+
// wa_id, produced two DIFFERENT hashes for the exact same real phone
// number — confirmed live via the phone-recovery sign-in flow reporting
// "no account found" for a number that genuinely had one. Any account
// linked via SettingsProfile.tsx's manual verify flow (which calls this
// same function) has the same mismatch against anything hashed from a
// wa_id — normalizing to digits-only here, matching Meta's own format,
// fixes both paths going forward. Existing already-stored hashes computed
// the old way can't be retroactively repaired — there's nothing to
// re-hash from, since the raw number was never stored (that's the whole
// privacy design) — only re-verifying fixes an already-affected account.
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
// ─── Generate a 6-digit OTP ───────────────────────────────────────────────────
function generateOtp() {
  const digits = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(digits).map((d)=>d % 10).join("");
}
// ─── Validate E.164 format ────────────────────────────────────────────────────
function isValidE164(phone) {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: CORS_HEADERS
    });
  }
  try {
    const { phone_number, question_id, question_text, question_summary, broadcast_id, verification_mode, forward_chain_id, test_draft } = await req.json();
    // ── Input validation ────────────────────────────────────────────────────
    if (!phone_number) {
      return new Response(JSON.stringify({
        sent: false,
        reason: "missing_required_fields"
      }), {
        status: 400,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });
    }
    if (!isValidE164(phone_number)) {
      return new Response(JSON.stringify({
        sent: false,
        reason: "invalid_phone_format"
      }), {
        status: 400,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });
    }
    // ── Load env vars ───────────────────────────────────────────────────────
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const PHONE_HASH_SALT = Deno.env.get("WHATSAPP_PHONE_HASH_SALT");
    const ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
    const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const TEMPLATE_NAME = Deno.env.get("WHATSAPP_TEMPLATE_NAME") ?? "stance_question_flow";
    const OTP_TEMPLATE_NAME = Deno.env.get("WHATSAPP_OTP_TEMPLATE_NAME") ?? "web_optin_otp";
    const OTP_TEMPLATE_LANGUAGE = Deno.env.get("WHATSAPP_OTP_TEMPLATE_LANGUAGE") ?? "en";
    const FLOW_ID = Deno.env.get("WHATSAPP_FLOW_ID") ?? "";
    if (!PHONE_HASH_SALT || !ACCESS_TOKEN || !PHONE_NUMBER_ID) {
      return new Response(JSON.stringify({
        sent: false,
        reason: "missing_server_configuration"
      }), {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });
    }
    // ── Hash phone number — never store raw ────────────────────────────────
    const phoneHash = await hashPhoneNumber(phone_number, PHONE_HASH_SALT);
    // ── Service role client ─────────────────────────────────────────────────
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // ── Check opt-out (skip for verification mode) ──────────────────────────
    if (!verification_mode) {
      const { data: optOut } = await supabase.from("whatsapp_optouts").select("is_active").eq("phone_hash", phoneHash).eq("is_active", true).maybeSingle();
      if (optOut) {
        return new Response(JSON.stringify({
          sent: false,
          reason: "opted_out"
        }), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json"
          }
        });
      }
    }
    // ── AA2.2: Verification mode — generate and store OTP ──────────────────
    let verificationToken = null;
    if (verification_mode) {
      const otp = generateOtp();
      // Store OTP in verification table
      const { data: verRow, error: verError } = await supabase.from("whatsapp_phone_verifications").insert({
        phone_hash: phoneHash,
        otp_code: otp
      }).select("verification_token").single();
      if (verError || !verRow) {
        console.error("Failed to store OTP:", verError?.message);
        return new Response(JSON.stringify({
          sent: false,
          reason: "otp_storage_failed"
        }), {
          status: 500,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json"
          }
        });
      }
      verificationToken = verRow.verification_token;
      // FIX (2026-09-09): previously sent the unapproved "hello_world" sample
      // template, then a SEPARATE free-form text message carrying the actual
      // OTP whose result was never checked or logged — WhatsApp only opens a
      // 24h free-form window when the CUSTOMER messages first, so a
      // business-initiated template does not grant permission to follow up
      // with free text. That second send silently failed every time, so the
      // OTP itself never reached the user even though the function reported
      // sent:true. Now uses the approved Authentication-category template
      // (web_optin_otp, an actual "one-time passcode" template with the OTP
      // as its single body parameter) in ONE message, and the response is
      // checked like every other send path in this file.
      const otpPayload = {
        messaging_product: "whatsapp",
        to: phone_number,
        type: "template",
        template: {
          name: OTP_TEMPLATE_NAME,
          language: {
            code: OTP_TEMPLATE_LANGUAGE
          },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: otp }
              ]
            },
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [
                { type: "text", text: otp }
              ]
            }
          ]
        }
      };
      const metaRes = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(otpPayload)
      });
      const metaData = await metaRes.json();
      if (!metaRes.ok) {
        console.error("Meta API error (OTP template send):", JSON.stringify(metaData));
        return new Response(JSON.stringify({
          sent: false,
          reason: "meta_api_error",
          detail: metaData?.error?.message
        }), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json"
          }
        });
      }
      return new Response(JSON.stringify({
        sent: true,
        message_id: metaData?.messages?.[0]?.id ?? null,
        verification_token: verificationToken
      }), {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });
    }
    // ── Standard message send ───────────────────────────────────────────────
    if (!question_id || !question_text) {
      return new Response(JSON.stringify({
        sent: false,
        reason: "missing_required_fields"
      }), {
        status: 400,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });
    }
    const truncatedText = question_text.length > 300 ? question_text.substring(0, 297) + "..." : question_text;
    const truncatedSummary = question_summary && question_summary.length > 150 ? question_summary.substring(0, 147) + "..." : question_summary ?? "";

    // ── Option B: build the 5 stance options from the question's context poles ──
    const { data: qRow } = await supabase
      .from("questions")
      .select("slider_low_label, slider_high_label")
      .eq("id", question_id)
      .maybeSingle();
    const lowLabel = (qRow?.slider_low_label || "Not delivered").slice(0, 30);
    const highLabel = (qRow?.slider_high_label || "Fully delivered").slice(0, 30);
    const stanceOptions = [
      { id: "2", title: highLabel },
      { id: "1", title: "Mostly yes" },
      { id: "0", title: "Mixed / unsure" },
      { id: "-1", title: "Mostly no" },
      { id: "-2", title: lowLabel },
    ];

    // ── Option B: per-send flow_token so whatsapp-flow-endpoint can correlate ──
    // the encrypted submission back to this question + (hashed) recipient.
    const flowToken = `sess_${crypto.randomUUID()}`;
    await supabase.from("whatsapp_flow_sessions").insert({
      flow_token: flowToken,
      question_id,
      phone_hash: phoneHash,
      broadcast_id: broadcast_id ?? null,
      forward_chain_id: forward_chain_id ?? null,
    });

    // Two send modes:
    //  - test_draft=true: interactive Flow message in mode:"draft" — lets you
    //    test the UNPUBLISHED flow with your own number (requires an open 24h
    //    window: message your business number first). No template/publish needed.
    //  - default: the approved `stance_question_flow` template (needs a PUBLISHED flow).
    // Either way flow_token = the per-send session token created above, and
    // flow_action_data / payload preloads the Flow's first screen.
    const messagePayload = test_draft ? {
      messaging_product: "whatsapp",
      to: phone_number,
      type: "interactive",
      interactive: {
        type: "flow",
        body: { text: truncatedText },
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: flowToken,
            flow_id: FLOW_ID,
            flow_cta: "Take a Stance",
            mode: "draft",
            flow_action: "navigate",
            flow_action_payload: {
              screen: "STANCE_INPUT",
              data: {
                question_text: truncatedText,
                question_summary: truncatedSummary,
                stance_options: stanceOptions
              }
            }
          }
        }
      }
    } : {
      messaging_product: "whatsapp",
      to: phone_number,
      type: "template",
      template: {
        name: TEMPLATE_NAME,
        language: {
          code: "en_US"
        },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: truncatedText },
              { type: "text", text: truncatedSummary }
            ]
          },
          ...(FLOW_ID ? [{
            type: "button",
            sub_type: "flow",
            index: "0",
            parameters: [{
              type: "action",
              action: {
                flow_token: flowToken,
                flow_action_data: {
                  question_text: truncatedText,
                  question_summary: truncatedSummary,
                  stance_options: stanceOptions
                }
              }
            }]
          }] : [])
        ]
      }
    };
    const metaResponse = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(messagePayload)
    });
    const metaData = await metaResponse.json();
    if (!metaResponse.ok) {
      console.error("Meta API error:", JSON.stringify(metaData));
      if (broadcast_id) {
        await supabase.from("whatsapp_delivery_log").insert({
          broadcast_id,
          phone_hash: phoneHash,
          status: "failed",
          failure_reason: metaData?.error?.message ?? "meta_api_error"
        });
      }
      return new Response(JSON.stringify({
        sent: false,
        reason: "meta_api_error",
        detail: metaData?.error?.message
      }), {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json"
        }
      });
    }
    const messageId = metaData?.messages?.[0]?.id ?? null;
    if (broadcast_id) {
      await supabase.from("whatsapp_delivery_log").insert({
        broadcast_id,
        phone_hash: phoneHash,
        status: "sent"
      });
    }
    return new Response(JSON.stringify({
      sent: true,
      message_id: messageId
    }), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("whatsapp-send-flow error:", err);
    return new Response(JSON.stringify({
      sent: false,
      reason: "internal_error"
    }), {
      status: 500,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json"
      }
    });
  }
});
