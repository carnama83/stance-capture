// supabase/functions/ugq-screen/index.ts
// Epic UGQ — Build Step 2 of 8: Gate 1 AI pre-screen.
//
// Internal endpoint invoked by ugq-submit. Runs a single GPT-4o-mini pass that
// judges validity, safety, duplication (against live-question candidates from the
// existing full-text search_questions RPC) and a quality score, then writes a
// terminal status and updates proposer reputation.
//
// Auth: internal only — requires x-cron-secret == CRON_SECRET, or a service-role
// Bearer token. Never called directly by browsers.
//
// Design notes (verified against the live schema, June 2026):
//   - questions has NO embedding column; duplicate candidates come from the
//     full-text search_questions(p_query,...) RPC (live = state in
//     new/active/dormant AND status='active'). The LLM picks duplicate_question_id
//     ONLY from that candidate set, so the id is always real.
//   - auto_topic_id is left for admin assignment in Gate 2 (the model cannot mint
//     a valid topic uuid); a topic hint is stored in ai_screen_result instead.
//   - Notification writes are intentionally deferred to build step 8.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Reputation deltas (spec §4.3). Bonuses for 50/200 stances are awarded later by
// a pg_cron job (build step 7), not here.
const REP = { approvedPublish: 10, rejectLowQuality: -2, rejectSafety: -15 };

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

// new (0-20) | trusted (21-75). 'verified' is admin-granted only (spec §4.3),
// so we never auto-promote into or out of 'verified' here.
function tierForScore(score: number, currentTier: string): string {
  if (currentTier === "verified") return "verified";
  return score >= 21 ? "trusted" : "new";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
  // Screening LLM is provider-configurable; defaults to Anthropic.
  //   UGQ_SCREEN_PROVIDER = "anthropic" (default) | "openai"
  //   UGQ_SCREEN_MODEL    = model id (defaults per provider)
  const SCREEN_PROVIDER =
    (Deno.env.get("UGQ_SCREEN_PROVIDER") ?? "anthropic").toLowerCase().trim() === "openai"
      ? "openai" : "anthropic";
  const MODEL = (Deno.env.get("UGQ_SCREEN_MODEL") ??
    (SCREEN_PROVIDER === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o-mini")).trim();
  const SCREEN_API_KEY = SCREEN_PROVIDER === "anthropic" ? ANTHROPIC_API_KEY : OPENAI_API_KEY;
  // Fast-track for Trusted/Verified proposers — OFF by default (safe for the
  // India beachhead). Flip to "true" to let clean proposals from trusted+
  // proposers skip admin review. The reframe→publish wiring lands in step 5.
  const FASTTRACK = (Deno.env.get("FEATURE_UGQ_FASTTRACK") ?? "false") === "true";

  // ── Internal auth ───────────────────────────────────────────────────────────
  const incomingCron = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const isCron = CRON_SECRET && incomingCron === CRON_SECRET;
  const isService = authHeader === `Bearer ${SERVICE_KEY}`;
  if (!isCron && !isService) return json(401, { ok: false, error: "UNAUTHORIZED" });

  const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id : "";
    if (!proposalId) return json(400, { ok: false, error: "MISSING_PROPOSAL_ID" });

    // Only screen freshly-submitted proposals; ignore anything already resolved.
    const { data: proposal } = await adminSb.from("user_question_proposals")
      .select("id, user_id, raw_question, status").eq("id", proposalId).maybeSingle();
    if (!proposal) return json(404, { ok: false, error: "NOT_FOUND" });
    if (proposal.status !== "proposed") {
      return json(200, { ok: true, skipped: true, status: proposal.status });
    }

    const raw = proposal.raw_question as string;
    const proposerId = proposal.user_id as string;

    // ── Retrieve live-question candidates for duplicate adjudication ────────────
    // Pass ALL params explicitly: this codebase's PostgREST setup can fail to
    // resolve RPCs when defaulted params are omitted.
    const { data: candidates } = await adminSb.rpc("search_questions", {
      p_query: raw, p_user_id: null, p_limit: 8, p_offset: 0,
    });
    const candList = (candidates ?? []).map((c: { question_id: string; question: string }) => ({
      id: c.question_id, question: c.question,
    }));

    // Proposer tier (for fast-track + final routing).
    const { data: rep } = await adminSb.from("user_proposal_reputation")
      .select("score, tier, total_published, total_rejected")
      .eq("user_id", proposerId).maybeSingle();
    const tier = rep?.tier ?? "new";

    // ── Gate 1 LLM pass ─────────────────────────────────────────────────────────
    let screen = {
      is_valid_question: true,
      is_duplicate: false,
      duplicate_question_id: null as string | null,
      safety_flag: "review" as "clean" | "review" | "reject",
      quality_score: 50,
      topic_suggestion: "",
      reason: "",
    };

    if (SCREEN_API_KEY) {
      const sys =
        "You screen user-submitted civic questions for a stance platform where users answer on a -2..+2 agree/disagree scale. " +
        "Return ONLY a JSON object with keys: is_valid_question (boolean — can this be answered on an agree/disagree spectrum, not a poll/factual lookup), " +
        "is_duplicate (boolean), duplicate_question_id (string id chosen ONLY from the provided candidates, or null), " +
        "safety_flag ('clean' | 'review' | 'reject' — 'reject' for hate speech, doxxing, personal attacks, incitement; 'review' if unsure), " +
        "quality_score (integer 0-100 — clarity, specificity, civic relevance), " +
        "topic_suggestion (short topic label, max 5 words), reason (one short sentence). No prose outside the JSON.";
      const usr =
        `Proposed question:\n"${raw}"\n\n` +
        `Existing live questions (candidates for duplicate match):\n` +
        (candList.length
          ? candList.map((c) => `- id=${c.id} :: ${c.question}`).join("\n")
          : "(none)") +
        `\n\nIf the proposed question is essentially the same as one candidate, set is_duplicate=true and duplicate_question_id to that candidate's id.`;

      try {
        let rawContent = "";
        if (SCREEN_PROVIDER === "anthropic") {
          const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": SCREEN_API_KEY,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: MODEL,
              max_tokens: 300,
              temperature: 0,
              system: sys,
              messages: [{ role: "user", content: usr }],
            }),
          });
          if (res.ok) {
            const data = await res.json();
            rawContent = data?.content?.[0]?.text ?? "";
          }
        } else {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SCREEN_API_KEY}` },
            body: JSON.stringify({
              model: MODEL,
              temperature: 0,
              max_tokens: 300,
              response_format: { type: "json_object" },
              messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
            }),
          });
          if (res.ok) {
            const data = await res.json();
            rawContent = data?.choices?.[0]?.message?.content ?? "";
          }
        }
        if (rawContent) {
          // Anthropic has no JSON mode and may wrap the object in prose/backticks;
          // strip code fences defensively before parsing.
          const cleaned = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          screen = {
            is_valid_question: parsed.is_valid_question !== false,
            is_duplicate: parsed.is_duplicate === true,
            duplicate_question_id: typeof parsed.duplicate_question_id === "string" ? parsed.duplicate_question_id : null,
            safety_flag: ["clean", "review", "reject"].includes(parsed.safety_flag) ? parsed.safety_flag : "review",
            quality_score: Math.max(0, Math.min(100, Number(parsed.quality_score ?? 50) | 0)),
            topic_suggestion: typeof parsed.topic_suggestion === "string" ? parsed.topic_suggestion.slice(0, 80) : "",
            reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "",
          };
        }
      } catch (_e) {
        // Leave default screen (valid + safety 'review') → routes to admin review.
      }
    }

    // Guard: only honour a duplicate id that is actually in the candidate set.
    const validDupId = screen.is_duplicate && screen.duplicate_question_id &&
      candList.some((c) => c.id === screen.duplicate_question_id)
      ? screen.duplicate_question_id : null;

    // ── Decide terminal status + reputation delta ──────────────────────────────
    let status = "in_review";
    let rejection_reason: string | null = null;
    let duplicate_of_question_id: string | null = null;
    let repDelta = 0;
    let rejectedInc = 0;

    if (screen.safety_flag === "reject") {
      status = "rejected"; rejection_reason = "safety"; repDelta = REP.rejectSafety; rejectedInc = 1;
    } else if (!screen.is_valid_question) {
      status = "rejected"; rejection_reason = "not_a_question"; repDelta = REP.rejectLowQuality; rejectedInc = 1;
    } else if (validDupId) {
      status = "rejected"; rejection_reason = "duplicate"; duplicate_of_question_id = validDupId; // +0, no penalty
    } else if (FASTTRACK && (tier === "trusted" || tier === "verified") && screen.safety_flag === "clean") {
      // Fast-track: clean proposals from trusted+ proposers skip admin review.
      // NOTE: reframe→publish wiring is build step 5; until then 'approved' parks
      // the proposal for the publish pipeline rather than going live immediately.
      status = "approved";
    } else {
      status = "in_review";
    }

    await adminSb.from("user_question_proposals").update({
      status,
      rejection_reason,
      duplicate_of_question_id,
      ai_screen_result: screen,
      quality_score: screen.quality_score,
    }).eq("id", proposalId);

    // ── Reputation update (read-modify-write, service role) ────────────────────
    if (repDelta !== 0 || rejectedInc !== 0) {
      const newScore = (rep?.score ?? 0) + repDelta;
      await adminSb.from("user_proposal_reputation").update({
        score: newScore,
        tier: tierForScore(newScore, tier),
        total_rejected: (rep?.total_rejected ?? 0) + rejectedInc,
      }).eq("user_id", proposerId);
    }

    // TODO(step 8): emit proposer notification for terminal states
    // (rejected → in-app; published handled in step 5).
    if (status === "rejected") {
      await adminSb.from("user_notifications").insert({
        user_id: proposerId,
        notification_type: "ugq_rejected",
        title: "Your question wasn't published",
        body: `Reason: ${rejection_reason}. You can try rephrasing.`,
        metadata: { proposal_id: proposalId, reason: rejection_reason },
      });
    }

    return json(200, {
      ok: true,
      proposal_id: proposalId,
      status,
      rejection_reason,
      quality_score: screen.quality_score,
      duplicate_of_question_id,
    });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
