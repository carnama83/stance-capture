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
      .select("flow_token, question_id, phone_hash, broadcast_id, forward_chain_id, expires_at")
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
    const { data: q } = await supabase
      .from("questions")
      .select("question, summary, context_summary, slider_low_label, slider_high_label")
      .eq("id", session.question_id)
      .maybeSingle();
    const qText = (q?.question ?? "").slice(0, 300);
    const qSummary = (q?.context_summary || q?.summary || "").slice(0, 150);
    return new Response(
      await encryptResponse({
        version: FLOW_DATA_API_VERSION,
        screen: "STANCE_INPUT",
        data: {
          question_text: qText,
          question_summary: qSummary,
          stance_options: buildStanceOptions(q?.slider_low_label, q?.slider_high_label),
        },
      }, aesKey, iv),
      { status: 200, headers: { "Content-Type": "text/plain" } },
    );
  }

  // ── data_exchange → store stance, return live confirmation ──────────────
  if (action === "data_exchange") {
    const fallbackConfirmation = async (msg: string) =>
      new Response(
        await encryptResponse({
          version: FLOW_DATA_API_VERSION,
          screen: "CONFIRMATION",
          data: {
            headline: "Your stance has been recorded.",
            distribution_line: msg,
            forward_line: "See the full community view at stancecapture.com",
            subscription_prompt: "Reply YES to get updates when community stance shifts.",
          },
        }, aesKey, iv),
        { status: 200, headers: { "Content-Type": "text/plain" } },
      );

    try {
      if (!session) return fallbackConfirmation("Visit stancecapture.com to see the community view.");

      // Opt-out guard
      const { data: optOut } = await supabase
        .from("whatsapp_optouts").select("is_active")
        .eq("phone_hash", session.phone_hash).eq("is_active", true).maybeSingle();
      if (optOut) return fallbackConfirmation("Visit stancecapture.com to see the community view.");

      const stanceValue = parseInt(payload?.data?.stance_value, 10);
      const questionId = session.question_id;
      if (isNaN(stanceValue) || stanceValue < -2 || stanceValue > 2) {
        return fallbackConfirmation("Visit stancecapture.com to see the community view.");
      }

      // AA4.2 — attribute to a verified Stance Capture account if the phone matches
      let userId: string | null = null;
      const { data: profile } = await supabase
        .from("profiles").select("id").eq("verified_phone_hash", session.phone_hash).maybeSingle();
      if (profile) userId = profile.id;

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

      // Upsert the stance (dedup per phone_hash + question via session correlation)
      await supabase.from("question_stances").upsert({
        question_id: questionId,
        user_id: userId,
        whatsapp_phone_hash: session.phone_hash,
        score: stanceValue,
        source: "whatsapp_flow",
        forward_chain_id: forwardChainId,
      }, { onConflict: "whatsapp_phone_hash,question_id" });

      // AA7 — open a short session so a later "YES" subscribes to this question
      await supabase.from("whatsapp_active_sessions").upsert({
        whatsapp_phone_hash: session.phone_hash,
        last_question_id: questionId,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }, { onConflict: "whatsapp_phone_hash" });

      // Broadcast counter
      if (session.broadcast_id) {
        await supabase.rpc("increment_broadcast_counter", {
          p_broadcast_id: session.broadcast_id, p_column: "total_stances",
        });
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
      return fallbackConfirmation("Visit stancecapture.com to see the community view.");
    }
  }

  // Unknown action
  return new Response(await encryptResponse({ data: { acknowledged: true } }, aesKey, iv), {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
});
