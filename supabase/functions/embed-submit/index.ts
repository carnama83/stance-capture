// supabase/functions/embed-submit/index.ts
// Epic T — T6: Embed Submit Edge Function
//
// Receives stance submissions from the embedded widget.
// Handles rate limiting, deduplication, session detection,
// and returns updated community stats in the response.
//
// F-08 FIX: embedded_stances.device_fingerprint now stores the RAW fingerprint
// (not sha256(fp)) so that merge_embedded_stances() and get_pending_merge_count()
// can match it against the value stored in localStorage on the frontend.
// sha256(fp) continues to be used ONLY for embed_rate_limits keys, where it
// acts as a privacy-safe opaque identifier — it is never used for merge matching.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-device-fingerprint",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({
      error: "Method not allowed"
    }), {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  }
  try {
    const body = await req.json();
    const { question_id, stance_value, device_fingerprint, publisher_ref, campaign_id } = body;
    // ── Input validation ──────────────────────────────────────────────────────
    if (!question_id || typeof question_id !== "string") {
      return jsonError(400, "INVALID_INPUT", "question_id is required");
    }
    if (stance_value === undefined || ![
      -2,
      -1,
      0,
      1,
      2
    ].includes(Number(stance_value))) {
      return jsonError(400, "INVALID_STANCE", "stance_value must be -2, -1, 0, 1, or 2");
    }
    if (!device_fingerprint || typeof device_fingerprint !== "string" || device_fingerprint.length > 128) {
      return jsonError(400, "INVALID_FINGERPRINT", "device_fingerprint is required (max 128 chars)");
    }
    // ── Supabase clients ──────────────────────────────────────────────────────
    // Service role for writes (bypasses RLS)
    const adminSb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    // User client for session detection
    const authHeader = req.headers.get("Authorization");
    const userSb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY"), authHeader ? {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    } : {});
    // ── Check if question is active ──────────────────────────────────────────
    const { data: question, error: qErr } = await adminSb.from("questions").select("id, state").eq("id", question_id).single();
    if (qErr || !question) {
      return jsonError(404, "QUESTION_NOT_FOUND", "Question not found");
    }
    if (question.state === "archived") {
      return jsonError(400, "QUESTION_ARCHIVED", "This question is no longer accepting responses");
    }
    // ── Rate limiting ─────────────────────────────────────────────────────────
    const ipRaw = req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "unknown";
    const ip = ipRaw.split(",")[0].trim();
    const ipHash = await sha256(ip + Deno.env.get("IP_HASH_SALT", "sc_salt"));
    // fpHash is used ONLY for rate-limit keys — a privacy-safe opaque identifier.
    // It is NOT stored in embedded_stances.device_fingerprint (see F-08 fix below).
    const fpHash = await sha256(device_fingerprint);
    const now = new Date();
    const hourWindow = new Date(now);
    hourWindow.setMinutes(0, 0, 0);
    const dayWindow = new Date(now);
    dayWindow.setHours(0, 0, 0, 0);
    // Check device+question rate limit (3 per 24h)
    const deviceKey = await sha256(`${fpHash}:${question_id}`);
    const { data: deviceLimit } = await adminSb.from("embed_rate_limits").select("count").eq("key", deviceKey).eq("limit_type", "device_question").gte("window_start", dayWindow.toISOString()).single();
    if (deviceLimit && deviceLimit.count >= 3) {
      return jsonError(429, "RATE_LIMITED", "You have already answered this question today");
    }
    // Check IP hourly rate limit (10 per hour)
    const { data: ipLimit } = await adminSb.from("embed_rate_limits").select("count").eq("key", ipHash).eq("limit_type", "ip_hourly").gte("window_start", hourWindow.toISOString()).single();
    if (ipLimit && ipLimit.count >= 10) {
      return jsonError(429, "RATE_LIMITED_IP", "Too many submissions. Please try again later.");
    }
    // ── Detect authenticated session ──────────────────────────────────────────
    const { data: { user } } = await userSb.auth.getUser();
    if (user) {
      // Authenticated path: write directly to question_stances.
      //
      // F-11: set_question_stance() cannot be used here because it relies on
      // auth.uid() internally, which returns null when called from a service-role
      // Edge Function context. The raw upsert is intentional and safe because:
      //   - Input validation above already enforces stance_value in [-2,-1,0,1,2]
      //   - The DB CHECK constraint on score is a second enforcement layer
      //   - source='embed' correctly identifies the origin of this stance
      //
      // If set_question_stance() gains additional logic in future, mirror it here.
      const score = Number(stance_value);
      if (score < -2 || score > 2 || !Number.isInteger(score)) {
        return jsonError(400, "INVALID_STANCE", "stance_value must be an integer between -2 and 2");
      }
      const { error: stanceErr } = await adminSb.from("question_stances").upsert({
        user_id: user.id,
        question_id,
        score,
        source: "embed",
        campaign_id: campaign_id ?? null,
        updated_at: now.toISOString()
      }, {
        onConflict: "user_id,question_id"
      });
      if (stanceErr) {
        console.error("[embed-submit] Authenticated stance insert failed:", stanceErr);
        return jsonError(500, "SAVE_FAILED", "Failed to save your stance");
      }
    } else {
      // Anonymous path: write to embedded_stances.
      //
      // F-08 FIX: Store the raw device_fingerprint (not fpHash) so that
      // merge_embedded_stances() and get_pending_merge_count() — which both
      // match on the raw value from localStorage — can find these rows.
      // The unique index embedded_stances_device_question_unique on
      // (device_fingerprint, question_id) continues to enforce deduplication
      // correctly with the raw value.
      //
      // ip_hash remains sha256(ip) — it is never used for merge matching and
      // hashing protects user privacy in the DB.
      const { error: insertErr } = await adminSb.from("embedded_stances").insert({
        question_id,
        stance_value: Number(stance_value),
        device_fingerprint: device_fingerprint,
        ip_hash: ipHash,
        publisher_ref: publisher_ref ?? null,
        campaign_id: campaign_id ?? null
      });
      if (insertErr) {
        // Unique constraint violation = duplicate submission
        if (insertErr.code === "23505") {
          return jsonError(409, "DUPLICATE", "You have already answered this question");
        }
        console.error("[embed-submit] Embedded stance insert failed:", insertErr);
        return jsonError(500, "SAVE_FAILED", "Failed to save your stance");
      }
    }
    // ── Update rate limit counters ────────────────────────────────────────────
    const dayExpiry = new Date(dayWindow);
    dayExpiry.setDate(dayExpiry.getDate() + 1);
    await adminSb.from("embed_rate_limits").upsert({
      key: deviceKey,
      limit_type: "device_question",
      count: (deviceLimit?.count ?? 0) + 1,
      window_start: dayWindow.toISOString(),
      expires_at: dayExpiry.toISOString()
    }, {
      onConflict: "key,limit_type,window_start"
    });
    const hourExpiry = new Date(hourWindow);
    hourExpiry.setHours(hourExpiry.getHours() + 1);
    await adminSb.from("embed_rate_limits").upsert({
      key: ipHash,
      limit_type: "ip_hourly",
      count: (ipLimit?.count ?? 0) + 1,
      window_start: hourWindow.toISOString(),
      expires_at: hourExpiry.toISOString()
    }, {
      onConflict: "key,limit_type,window_start"
    });
    // ── Fetch updated community stats ─────────────────────────────────────────
    const { data: stats } = await adminSb.rpc("get_embed_community_stats", {
      p_question_id: question_id
    });
    return new Response(JSON.stringify({
      success: true,
      stance_value: Number(stance_value),
      attributed: !!user,
      community_stats: stats ?? null
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    console.error("[embed-submit] Unexpected error:", err);
    return jsonError(500, "INTERNAL_ERROR", "An unexpected error occurred");
  }
});
function jsonError(status, error_code, message) {
  return new Response(JSON.stringify({
    success: false,
    error_code,
    message
  }), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
