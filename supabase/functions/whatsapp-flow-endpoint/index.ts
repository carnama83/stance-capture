// supabase/functions/whatsapp-flow-endpoint/index.ts
//
// Epic AA — Option B: ENCRYPTED Flow data-exchange endpoint.
//
// This is the server that drives the interactive Flow card *inside* WhatsApp.
// Unlike whatsapp-flow-webhook (which receives the post-close nfm_reply on the
// messages webhook), THIS endpoint is called by Meta mid-flow with encrypted
// payloads and returns the next screen — enabling the live community-stance
// confirmation screen the user sees the instant they submit.
//
// Flow lifecycle handled here:
//   action "ping"          -> health check (Meta validates the endpoint)
//   action "INIT"          -> serve STANCE_INPUT screen (question + 5 options)
//   action "data_exchange" -> store stance, compute live distribution,
//                             create forward chain, serve CONFIRMATION screen
//   action "BACK"          -> re-serve STANCE_INPUT
//
// Crypto (validated by sandbox round-trip):
//   - RSA-OAEP(SHA-256) unwrap of encrypted_aes_key with our PRIVATE key
//   - AES-128-GCM decrypt of encrypted_flow_data (last 16 bytes = auth tag)
//   - AES-128-GCM encrypt of the response with the SAME key + FLIPPED iv
//   - response returned as base64 text/plain (NOT json)
//
// F2 / UGQ-ML-C03: the session also carries the RENDITION that was sent, so the
// stance recorded here is attributed to the wording the recipient actually read
// rather than to whatever is published when they happen to reply.
//
// Correlation: flow_token (set per-send by whatsapp-send-flow) is looked up in
// whatsapp_flow_sessions to recover question_id + phone_hash + broadcast_id +
// inbound forward chain — Meta never sends the wa_id to a Flow endpoint.
//
// Required env:
//   WHATSAPP_FLOW_PRIVATE_KEY        PEM (PKCS#8). Newlines may be \n-escaped.
//   WHATSAPP_FLOW_KEY_PASSPHRASE     optional, if the private key is encrypted
//   WHATSAPP_APP_SECRET              optional; if set, x-hub-signature-256 is verified
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const FLOW_DATA_API_VERSION = "3.0";

// ─── Crypto: WebCrypto (crypto.subtle) — Deno-native, spec-correct ───────────
// node:crypto's RSA-OAEP / MGF1 handling differs under Deno's polyfill and
// fails to decrypt WhatsApp's payloads, so we use WebCrypto, which uses
// SHA-256 MGF1 for a SHA-256 key — matching WhatsApp's OAEPWithSHA-256AndMGF1.
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(buf: ArrayBuffer | Uint8Array): string {
  const a = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  return b64ToBytes(body);
}

// Requires a PKCS#8 private key ("-----BEGIN PRIVATE KEY-----"). If you
// generated with `openssl genrsa` (PKCS#1, "BEGIN RSA PRIVATE KEY"), convert:
//   openssl pkcs8 -topk8 -nocrypt -in flow_private.pem -out flow_private_pkcs8.pem
async function importPrivateKey(): Promise<CryptoKey> {
  let pem = Deno.env.get("WHATSAPP_FLOW_PRIVATE_KEY") ?? "";
  pem = pem.replace(/\\n/g, "\n").trim();
  if (!pem) throw new Error("WHATSAPP_FLOW_PRIVATE_KEY is not set");
  return await globalThis.crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

async function decryptRequest(body: any, privateKey: CryptoKey) {
  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = body;
  const aesRaw = new Uint8Array(
    await globalThis.crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      b64ToBytes(encrypted_aes_key),
    ),
  );
  const aesKey = await globalThis.crypto.subtle.importKey(
    "raw",
    aesRaw,
    { name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
  const iv = b64ToBytes(initial_vector);
  // WhatsApp appends the 16-byte GCM tag to the ciphertext; WebCrypto expects
  // exactly that layout, so the whole blob is passed through.
  const dec = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    aesKey,
    b64ToBytes(encrypted_flow_data),
  );
  return { aesKey, iv, payload: JSON.parse(new TextDecoder().decode(dec)) };
}

async function encryptResponse(responseObj: any, aesKey: CryptoKey, iv: Uint8Array): Promise<string> {
  const flippedIv = new Uint8Array(iv.length);
  for (let i = 0; i < iv.length; i++) flippedIv[i] = (~iv[i]) & 0xff;
  const data = new TextEncoder().encode(JSON.stringify(responseObj));
  const enc = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: flippedIv, tagLength: 128 },
    aesKey,
    data,
  );
  return bytesToB64(enc);
}

// ─── Optional HMAC-SHA256 request signature verification ─────────────────────
async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header) return false;
  const expected = header.replace("sha256=", "");
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computed = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (computed.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) mismatch |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

function formatNumber(n: number): string {
  return Number(n || 0).toLocaleString("en-US");
}

const CHAIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function generateChainId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes).map((b) => CHAIN_CHARS[b % CHAIN_CHARS.length]).join("");
}

// ─── Build the 5 stance options from the question's context-driven poles ─────
function buildStanceOptions(lowLabel: string, highLabel: string) {
  const low = (lowLabel || "Not delivered").slice(0, 30);
  const high = (highLabel || "Fully delivered").slice(0, 30);
  return [
    { id: "2", title: high },
    { id: "1", title: "Mostly yes" },
    { id: "0", title: "Mixed / unsure" },
    { id: "-1", title: "Mostly no" },
    { id: "-2", title: low },
  ];
}

serve(async (req) => {
  // Health-check / non-POST
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET") ?? "";
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const rawBody = await req.text();

  // Signature check (only enforced if APP_SECRET configured)
  if (APP_SECRET) {
    const ok = await verifySignature(rawBody, req.headers.get("x-hub-signature-256"), APP_SECRET);
    if (!ok) return new Response("", { status: 432 }); // Meta: signature mismatch
  }

  let aesKey: CryptoKey, iv: Uint8Array, payload: any;
  try {
    const privateKey = await importPrivateKey();
    const parsed = JSON.parse(rawBody);
    ({ aesKey, iv, payload } = await decryptRequest(parsed, privateKey));
  } catch (e) {
    console.error("decrypt_failed", String(e));
    // 421 tells Meta to refresh the public key and retry
    return new Response("", { status: 421 });
  }

  const action = payload?.action;
  const flowToken = payload?.flow_token ?? "";

  // ── Health check ────────────────────────────────────────────────────────
  if (action === "ping") {
    return new Response(await encryptResponse({ data: { status: "active" } }, aesKey, iv), {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // ── Client error acknowledgement ────────────────────────────────────────
  if (payload?.data?.error_message || action === "error_notification") {
    console.error("flow_client_error", JSON.stringify(payload?.data ?? {}));
    return new Response(await encryptResponse({ data: { acknowledged: true } }, aesKey, iv), {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  // Resolve the send session from flow_token
  let session: any = null;
  if (flowToken) {
    const { data } = await supabase
      .from("whatsapp_flow_sessions")
      .select("flow_token, question_id, phone_hash, broadcast_id, forward_chain_id, expires_at, rendition_id")
      .eq("flow_token", flowToken)
      .maybeSingle();
    session = data;
  }

  // ── INIT / BACK → serve the stance-input screen ─────────────────────────
  if (action === "INIT" || action === "BACK") {
    if (!session) {
      return new Response(
        await encryptResponse({
          version: FLOW_DATA_API_VERSION,
          screen: "STANCE_INPUT",
          data: {
            question_text: "This question is no longer available.",
            question_summary: "",
            stance_options: buildStanceOptions("Not delivered", "Fully delivered"),
          },
        }, aesKey, iv),
        { status: 200, headers: { "Content-Type": "text/plain" } },
      );
    }
    // Epic AA-11: INIT is the recipient actually opening the Flow — the real
    // "Flows opened" signal (read receipts were being counted before). Counted
    // once per recipient per broadcast; never blocks the screen.
    if (action === "INIT" && session.broadcast_id) {
      const { error: openErr } = await supabase.rpc("record_whatsapp_flow_event", {
        p_broadcast_id: session.broadcast_id, p_phone_hash: session.phone_hash, p_event: "opened",
      });
      if (openErr) console.error("record_whatsapp_flow_event(opened) failed:", openErr.message);
    }
    // F2 / UGQ-ML-C03: re-serve the wording this recipient was actually SENT.
    // Reading questions.question here would show them the English on BACK even
    // though their card arrived in another language -- and worse, would show
    // current wording after a correction, so the screen and the recorded
    // provenance would disagree.
    let renditionRow: any = null;
    if (session.rendition_id) {
      const { data } = await supabase
        .from("question_renditions")
        .select("rendered_text, slider_low_label, slider_high_label, context_summary")
        .eq("id", session.rendition_id)
        .maybeSingle();
      renditionRow = data;
    }
    // Sessions created before C03 have no bound rendition; fall back to the
    // question so an in-flight card from before this shipped still works.
    const { data: q } = renditionRow ? { data: null } : await supabase
      .from("questions")
      .select("question, summary, context_summary, slider_low_label, slider_high_label")
      .eq("id", session.question_id)
      .maybeSingle();
    const qText = (renditionRow?.rendered_text ?? q?.question ?? "").slice(0, 300);
    const qSummary = (renditionRow?.context_summary || q?.context_summary || q?.summary || "").slice(0, 150);
    return new Response(
      await encryptResponse({
        version: FLOW_DATA_API_VERSION,
        screen: "STANCE_INPUT",
        data: {
          question_text: qText,
          question_summary: qSummary,
          stance_options: buildStanceOptions(
            renditionRow?.slider_low_label ?? q?.slider_low_label,
            renditionRow?.slider_high_label ?? q?.slider_high_label,
          ),
        },
      }, aesKey, iv),
      { status: 200, headers: { "Content-Type": "text/plain" } },
    );
  }

  // ── data_exchange → store stance, return live confirmation ──────────────
  if (action === "data_exchange") {
    // Epic AA-01: every path through this helper is one where NOTHING was
    // stored. It used to be headed "Your stance has been recorded." — which is
    // how a stance write that failed on every call went unnoticed.
    const notRecordedConfirmation = async (msg: string) =>
      new Response(
        await encryptResponse({
          version: FLOW_DATA_API_VERSION,
          screen: "CONFIRMATION",
          data: {
            headline: "We couldn't record your stance just now.",
            distribution_line: msg,
            forward_line: "See the full community view at stancecapture.com",
            subscription_prompt: "",
          },
        }, aesKey, iv),
        { status: 200, headers: { "Content-Type": "text/plain" } },
      );
    const TRY_AGAIN = "Please try again later, or answer at stancecapture.com.";
    let recorded = false; // set once upsert_whatsapp_stance has succeeded

    // Logged without phone data (AA5.2): the question and the error only.
    const logWriteError = async (errorType: string, detail: string) => {
      const { error } = await supabase.from("whatsapp_webhook_errors").insert({
        error_type: errorType,
        payload_preview: detail.substring(0, 200),
      });
      if (error) console.error("whatsapp_webhook_errors insert failed:", error.message);
    };

    try {
      if (!session) return notRecordedConfirmation("This question is no longer available. Answer at stancecapture.com.");

      // Opt-out guard
      const { data: optOut } = await supabase
        .from("whatsapp_optouts").select("is_active")
        .eq("phone_hash", session.phone_hash).eq("is_active", true).maybeSingle();
      if (optOut) return notRecordedConfirmation("You've opted out of Stance Capture on WhatsApp. Reply START to opt back in.");

      const stanceValue = parseInt(payload?.data?.stance_value, 10);
      const questionId = session.question_id;
      if (isNaN(stanceValue) || stanceValue < -2 || stanceValue > 2) {
        await logWriteError("invalid_flow_payload", `question ${questionId}: stance_value out of range`);
        return notRecordedConfirmation(TRY_AGAIN);
      }

      // ── D4 / PR 2b.6 — reject a reply whose instrument was withdrawn ──────
      //
      // The card this person tapped was bound to a rendition at send time
      // (f2_13). If that wording has since been invalidated, the answer they
      // just gave is an answer to a question we already know was defective.
      // "Accept and quarantine" is not defensible here: unlike a reply that
      // was valid when sent and invalidated afterwards, at THIS moment the
      // defect is already known. So the reply is not recorded, and they are
      // asked again against current wording.
      //
      // On validity timing: the brief says to judge this on the provider's
      // inbound message timestamp. Meta does not supply one in the encrypted
      // Flow data_exchange, and this exchange is a synchronous round trip
      // rather than a queued webhook — so receipt time differs from submission
      // by request latency, not queue time, and the delay the rule guards
      // against does not arise on this channel. See pr2b_04.
      const { data: replyValid } = await supabase.rpc("whatsapp_response_is_valid", {
        p_rendition_id: session.rendition_id,
      });

      if (replyValid === false) {
        // Re-point the session at the wording we are about to show, so the
        // re-answer is attributed to what they actually read this time.
        const { data: oldRend } = await supabase
          .from("question_renditions")
          .select("language_code")
          .eq("id", session.rendition_id)
          .maybeSingle();

        const { data: currentRid } = await supabase.rpc("select_rendition_to_display", {
          p_question_id: questionId,
          p_language_code: oldRend?.language_code ?? "en",
        });

        let newRend: any = null;
        if (currentRid) {
          const { data } = await supabase
            .from("question_renditions")
            .select("rendered_text, slider_low_label, slider_high_label, context_summary")
            .eq("id", currentRid)
            .maybeSingle();
          newRend = data;
        }

        await supabase
          .from("whatsapp_flow_sessions")
          .update({
            rendition_id: currentRid ?? null,
            responded_at: new Date().toISOString(),
            response_outcome: "rejected_invalidated",
          })
          .eq("flow_token", flowToken);

        // MIRROR RULE (2b.7): states only that a newer version exists. It must
        // not say the previous wording was wrong or imply a correction —
        // telling someone that immediately before re-asking primes them to
        // read the replacement as a fix for something.
        const reaskNotice = (oldRend?.language_code ?? "en") === "hi"
          ? "इस प्रश्न का नया संस्करण उपलब्ध है। कृपया नीचे दिए गए प्रश्न को पढ़कर अपना रुख फिर से बताएं।"
          : "A newer version of this question is available. Please read it below and give your stance again.";

        return new Response(
          await encryptResponse({
            version: FLOW_DATA_API_VERSION,
            screen: "STANCE_INPUT",
            data: {
              question_text: (newRend?.rendered_text ?? "").slice(0, 300),
              question_summary: reaskNotice.slice(0, 150),
              stance_options: buildStanceOptions(
                newRend?.slider_low_label,
                newRend?.slider_high_label,
              ),
            },
          }, aesKey, iv),
          { status: 200, headers: { "Content-Type": "text/plain" } },
        );
      }

      // AA4.2 — account attribution now happens inside upsert_whatsapp_stance
      // (Epic AA-02: this used to select profiles.id, a column that does not
      // exist, so every stance was stored anonymous).

      // AA8 — resolve inbound forward chain and mint this respondent's child chain
      let forwardChainId: string | null = null;
      if (session.forward_chain_id) {
        const { data: parentChain } = await supabase
          .from("whatsapp_forward_chains").select("depth, child_stance_count")
          .eq("id", session.forward_chain_id).maybeSingle();
        if (parentChain && parentChain.depth < 10 && parentChain.child_stance_count < 500) {
          const childId = generateChainId();
          await supabase.from("whatsapp_forward_chains").insert({
            id: childId, question_id: questionId, root_phone_hash: session.phone_hash,
            parent_forward_chain_id: session.forward_chain_id, depth: parentChain.depth + 1,
          });
          await supabase.from("whatsapp_forward_chains").update({
            child_stance_count: parentChain.child_stance_count + 1,
          }).eq("id", session.forward_chain_id);
          forwardChainId = childId;
        }
      }
      // Every respondent gets a fresh chain token to forward onward
      const outboundChainId = generateChainId();
      await supabase.from("whatsapp_forward_chains").insert({
        id: outboundChainId, question_id: questionId, root_phone_hash: session.phone_hash, depth: 0,
      });

      // F2 / UGQ-ML-C03: attribute the stance to the rendition bound when the
      // card was SENT. Re-resolving here would attribute the answer to whatever
      // wording is current at reply time, so a correction made in between would
      // make it look as though this recipient had seen the corrected text.
      //
      // The fallback covers only sessions created before C03 shipped, where no
      // rendition was captured and the best available answer is the current one.
      let waRenditionId: string | null = session.rendition_id ?? null;
      if (!waRenditionId) {
        // PR 2a: renamed from resolve_response_rendition. Reached only for
        // sessions created before f2_13 bound a rendition at send time; every
        // new session carries session.rendition_id and never lands here.
        const { data: resolved } = await supabase.rpc("select_rendition_to_display", {
          p_question_id: questionId,
          p_language_code: "en",
        });
        waRenditionId = resolved ?? null;
      }
      if (!waRenditionId) {
        console.error("[whatsapp-flow] no published wording for question", questionId);
        await logWriteError("no_published_wording", `question ${questionId}`);
        return notRecordedConfirmation(TRY_AGAIN);
      }

      // Epic AA-01: the stance write. This used to be a PostgREST upsert with
      // onConflict "whatsapp_phone_hash,question_id"; the matching unique index
      // is PARTIAL, so every call raised 42P10 and — because the result was
      // never checked — the user was still told their stance was in.
      // upsert_whatsapp_stance does the write atomically without ON CONFLICT,
      // resolves the account (AA-02), and applies one-stance-per-person,
      // latest-answer-wins. Its result is checked: nothing below runs unless
      // the stance really exists.
      const { data: written, error: writeErr } = await supabase.rpc("upsert_whatsapp_stance", {
        p_question_id: questionId,
        p_phone_hash: session.phone_hash,
        p_score: stanceValue,
        p_rendition_id: waRenditionId,
        p_broadcast_id: session.broadcast_id ?? null,
        p_forward_chain_id: forwardChainId,
      });
      if (writeErr || !written?.stance_id) {
        console.error("[whatsapp-flow] stance write failed", questionId, writeErr?.message);
        await logWriteError("stance_write_failed", `question ${questionId}: ${writeErr?.code ?? ""} ${writeErr?.message ?? "no stance_id returned"}`);
        return notRecordedConfirmation(TRY_AGAIN);
      }
      recorded = true;

      // PR 2b.6 — record the disposition of this reply. Every inbound
      // response now ends in exactly one of two states, so a rejected
      // re-ask can be told apart from a reply that never arrived.
      //
      // provider_timestamp is deliberately left NULL: Meta sends none in the
      // Flow data_exchange. responded_at is the authoritative time for this
      // channel because the exchange is synchronous — see pr2b_04.
      await supabase
        .from("whatsapp_flow_sessions")
        .update({
          responded_at: new Date().toISOString(),
          response_outcome: "recorded",
        })
        .eq("flow_token", flowToken);

      // AA7 — open a short session so a later "YES" subscribes to this question
      await supabase.from("whatsapp_active_sessions").upsert({
        whatsapp_phone_hash: session.phone_hash,
        last_question_id: questionId,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }, { onConflict: "whatsapp_phone_hash" });

      // Broadcast counter — a new stance only; a re-answer is not a second stance.
      if (session.broadcast_id && written.action === "inserted") {
        await supabase.rpc("increment_broadcast_counter", {
          p_broadcast_id: session.broadcast_id, p_column: "total_stances",
        });
      }
      // Epic AA-11: the Flow was completed (flow_completed_at was never written
      // before, so "Flows completed" was always 0). Counted once per recipient.
      if (session.broadcast_id) {
        const { error: doneErr } = await supabase.rpc("record_whatsapp_flow_event", {
          p_broadcast_id: session.broadcast_id, p_phone_hash: session.phone_hash, p_event: "completed",
        });
        if (doneErr) console.error("record_whatsapp_flow_event(completed) failed:", doneErr.message);
      }

      // Live distribution INCLUDING the just-cast vote
      const { data: distRows } = await supabase.rpc("get_question_distribution", { p_question_id: questionId });
      const dist = distRows?.[0];
      const pctAgree = dist ? `${Math.round(Number(dist.support_pct))}%` : "—";
      const pctNeutral = dist ? `${Math.round(Number(dist.neutral_pct))}%` : "—";
      const pctDisagree = dist ? `${Math.round(Number(dist.oppose_pct))}%` : "—";
      const totalResp = dist ? formatNumber(Number(dist.responses)) : "—";

      const { data: qData } = await supabase.from("questions").select("slug").eq("id", questionId).maybeSingle();
      const slug = qData?.slug ?? questionId;
      const forwardLink = `stancecapture.com/q/${slug}?ref=${outboundChainId}`;

      return new Response(
        await encryptResponse({
          version: FLOW_DATA_API_VERSION,
          screen: "CONFIRMATION",
          data: {
            headline: "Your stance is in 🎯",
            pct_agree: pctAgree,
            pct_neutral: pctNeutral,
            pct_disagree: pctDisagree,
            total_responses: totalResp,
            distribution_line: `${pctAgree} high · ${pctNeutral} middle · ${pctDisagree} low — ${totalResp} responses`,
            forward_line: `Forward this question: ${forwardLink}`,
            forward_link: forwardLink,
            subscription_prompt: "Reply YES to get updates when community stance shifts.",
          },
        }, aesKey, iv),
        { status: 200, headers: { "Content-Type": "text/plain" } },
      );
    } catch (e) {
      console.error("data_exchange_error", String(e));
      if (recorded) {
        // The stance IS stored; only the follow-up (distribution, links) failed.
        return new Response(
          await encryptResponse({
            version: FLOW_DATA_API_VERSION,
            screen: "CONFIRMATION",
            data: {
              headline: "Your stance has been recorded.",
              distribution_line: "Visit stancecapture.com to see the community view.",
              forward_line: "See the full community view at stancecapture.com",
              subscription_prompt: "Reply YES to get updates when community stance shifts.",
            },
          }, aesKey, iv),
          { status: 200, headers: { "Content-Type": "text/plain" } },
        );
      }
      await logWriteError("processing_error", String(e));
      return notRecordedConfirmation(TRY_AGAIN);
    }
  }

  // Unknown action
  return new Response(await encryptResponse({ data: { acknowledged: true } }, aesKey, iv), {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
});
