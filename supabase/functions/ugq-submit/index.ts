// supabase/functions/ugq-submit/index.ts
// Epic UGQ — Build Step 2 of 8: Gate 1 entry point.
//
// Receives a user's question proposal from the browser, enforces tier-based
// rate limits + cooldowns, inserts the proposal (status 'proposed'), then
// invokes ugq-screen (Gate 1 AI pre-screen) to resolve it to a terminal state.
//
// Conventions mirrored from embed-submit/index.ts:
//   - std `serve`, dual Supabase clients (service-role for writes, anon+JWT for identity)
//   - jsonError(status, code, message) shape
// Auth: a valid Supabase user JWT is REQUIRED (this is a user-facing endpoint).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Tier → { dailyLimit, cooldownMs }. Mirrors spec §11.
const TIER_LIMITS: Record<string, { daily: number; cooldownMs: number }> = {
  new:      { daily: 3,  cooldownMs: 15 * 60 * 1000 },
  trusted:  { daily: 10, cooldownMs: 5 * 60 * 1000 },
  verified: { daily: 25, cooldownMs: 0 },
};

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ ok: false, error: code, message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed");

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

    // ── Identity ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonError(401, "UNAUTHORIZED", "Sign in to propose a question");
    }
    const userSb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userSb.auth.getUser();
    if (!user) return jsonError(401, "UNAUTHORIZED", "Sign in to propose a question");
    const userId = user.id;

    // ── Input validation (spec §3.1, §5.1) ─────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const rawQuestion = typeof body.raw_question === "string" ? body.raw_question.trim() : "";
    if (rawQuestion.length < 20 || rawQuestion.length > 500) {
      return jsonError(400, "INVALID_QUESTION", "Question must be between 20 and 500 characters");
    }
    const sourceUrl = typeof body.source_url === "string" ? body.source_url.slice(0, 2048) : null;
    const sourceDescription = typeof body.source_description === "string" ? body.source_description.slice(0, 1000) : null;
    const locationLabel = typeof body.location_label === "string" ? body.location_label.slice(0, 200) : null;
    const suggestedTopicId = typeof body.suggested_topic_id === "string" && UUID_RE.test(body.suggested_topic_id) ? body.suggested_topic_id : null;
    const constituencyId = typeof body.constituency_id === "string" && UUID_RE.test(body.constituency_id) ? body.constituency_id : null;

    // Service-role client for all writes (bypasses RLS).
    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Reputation row (ensure exists), then gate on flag / rate-limit ─────────
    await adminSb.from("user_proposal_reputation")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });

    const { data: rep } = await adminSb.from("user_proposal_reputation")
      .select("tier, flagged, rate_limited_until")
      .eq("user_id", userId).maybeSingle();

    const tier = rep?.tier ?? "new";
    if (rep?.flagged) {
      return jsonError(403, "PROPOSER_FLAGGED", "Your proposal privileges are currently restricted");
    }
    if (rep?.rate_limited_until && new Date(rep.rate_limited_until).getTime() > Date.now()) {
      return jsonError(429, "RATE_LIMITED", "You're temporarily limited from proposing. Try again later");
    }

    const limits = TIER_LIMITS[tier] ?? TIER_LIMITS.new;

    // ── Daily limit (rolling 24h) + cooldown (spec §11) ────────────────────────
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: dayCount } = await adminSb.from("user_question_proposals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).gte("created_at", since24h);
    if ((dayCount ?? 0) >= limits.daily) {
      return jsonError(429, "DAILY_LIMIT", `You've reached your daily limit of ${limits.daily} proposals`);
    }

    if (limits.cooldownMs > 0) {
      const { data: last } = await adminSb.from("user_question_proposals")
        .select("created_at").eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (last?.created_at) {
        const elapsed = Date.now() - new Date(last.created_at).getTime();
        if (elapsed < limits.cooldownMs) {
          const waitS = Math.ceil((limits.cooldownMs - elapsed) / 1000);
          return jsonError(429, "COOLDOWN", `Please wait ${waitS}s before proposing again`);
        }
      }
    }

    // ── Cheap exact-text dedup (spec §11 content hashing): block the same user
    //    re-submitting an identical, still-active proposal. Semantic dedup is
    //    handled by ugq-screen (Gate 1 AI). ──────────────────────────────────────
    const normalized = normalizeText(rawQuestion);
    const { data: recentMine } = await adminSb.from("user_question_proposals")
      .select("id, raw_question")
      .eq("user_id", userId)
      .not("status", "in", "(withdrawn,rejected)")
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(50);
    if ((recentMine ?? []).some((r) => normalizeText(r.raw_question) === normalized)) {
      return jsonError(409, "ALREADY_PROPOSED", "You've already proposed this question");
    }

    // ── Insert proposal (status 'proposed') ────────────────────────────────────
    const { data: inserted, error: insErr } = await adminSb.from("user_question_proposals")
      .insert({
        user_id: userId,
        raw_question: rawQuestion,
        source_url: sourceUrl,
        source_description: sourceDescription,
        suggested_topic_id: suggestedTopicId,
        location_label: locationLabel,
        constituency_id: constituencyId,
        status: "proposed",
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      return jsonError(500, "INSERT_FAILED", insErr?.message ?? "Could not save proposal");
    }
    const proposalId = inserted.id;

    // total_proposed += 1 (read-modify-write under service role; low contention).
    const { data: repCount } = await adminSb.from("user_proposal_reputation")
      .select("total_proposed").eq("user_id", userId).maybeSingle();
    await adminSb.from("user_proposal_reputation")
      .update({ total_proposed: (repCount?.total_proposed ?? 0) + 1 })
      .eq("user_id", userId);

    // ── Invoke Gate 1 (ugq-screen). Awaited with a timeout so we can return the
    //    resolved status; on timeout/error the row stays 'proposed' (re-screenable). ─
    let finalStatus = "proposed";
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const screenResp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-screen`, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "content-type": "application/json",
          // Internal edge-to-edge auth: x-cron-secret ONLY. Legacy
          // Authorization/apikey headers are rejected at the platform gateway
          // on this project (root cause of every submission sticking at
          // 'proposed' — same class as the ugq-moderate v3 fix, 2026-07-06).
          // ugq-screen is deployed verify_jwt=false and checks the secret.
          "x-cron-secret": CRON_SECRET,
        },
        body: JSON.stringify({ proposal_id: proposalId }),
      }).finally(() => clearTimeout(t));
      const screenJson = await screenResp.json().catch(() => ({}));
      if (screenResp.ok && typeof screenJson.status === "string") {
        finalStatus = screenJson.status;
      } else {
        console.error(`[ugq-submit] inline screen failed: HTTP ${screenResp.status} body=${JSON.stringify(screenJson).slice(0, 300)} — proposal stays 'proposed'`);
      }
    } catch (e) {
      // Screen failed/timed out — proposal remains 'proposed' for later re-screening.
      console.error("[ugq-submit] inline screen threw:", (e as Error).message);
    }

    const userMessage = finalStatus === "rejected"
      ? "Your question wasn't published. You can try rephrasing."
      : "Your question is under review. We'll notify you when it goes live.";

    // In-app notification: submitted (skip if Gate 1 already rejected it).
    if (finalStatus !== "rejected") {
      await adminSb.from("user_notifications").insert({
        user_id: userId,
        notification_type: "ugq_submitted",
        title: "Your question is under review",
        body: "We'll notify you when it goes live.",
        metadata: { proposal_id: proposalId },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      proposal_id: proposalId,
      status: finalStatus,
      message: userMessage,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return jsonError(500, "INTERNAL_ERROR", (err as Error).message ?? "Unexpected error");
  }
});
