// supabase/functions/ugq-publish/index.ts
// Epic UGQ — Build Step 5: create the live question (spec §7.4).
//
// Internal endpoint invoked by ugq-moderate after a clean reframe. Inserts a row
// into questions with source='community' + proposed_by, links it back to the
// proposal, and awards the +10 / total_published reputation bump.
//
// Schema-verified (June 2026): questions requires only `question` + `topic_id`
// (NOT NULL, no default); status/state/tags/published_at default; and BEFORE
// INSERT triggers auto-populate slug, search_vector, dedup fields and audience.
// We generate the id client-side so no .select() is needed after insert
// (avoids holding a PgBouncer connection).
//
// Auth: internal only (x-cron-secret == CRON_SECRET or service-role Bearer).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PUBLISH_REWARD = 10; // spec §4.3

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function tierForScore(score: number, currentTier: string): string {
  if (currentTier === "verified") return "verified";
  return score >= 21 ? "trusted" : "new";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "";
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

  // Internal auth.
  const incomingCron = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const isCron = CRON_SECRET && incomingCron === CRON_SECRET;
  const isService = authHeader === `Bearer ${SERVICE_KEY}`;
  if (!isCron && !isService) return json(401, { ok: false, error: "UNAUTHORIZED" });

  const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id : "";
    const reframed = typeof body.reframed_question === "string" ? body.reframed_question.trim() : "";
    const topicId = typeof body.topic_id === "string" ? body.topic_id : "";
    if (!proposalId || !reframed || !topicId) return json(400, { ok: false, error: "MISSING_FIELDS" });

    const { data: proposal } = await adminSb.from("user_question_proposals")
      .select("id, user_id, location_label, status").eq("id", proposalId).maybeSingle();
    if (!proposal) return json(404, { ok: false, error: "NOT_FOUND" });
    if (proposal.status === "published") {
      return json(200, { ok: true, skipped: true });
    }

    // Generate id client-side so we don't need .select() after insert.
    const questionId = crypto.randomUUID();
    const sliderLow = typeof body.slider_low_label === "string" ? body.slider_low_label : null;
    const sliderHigh = typeof body.slider_high_label === "string" ? body.slider_high_label : null;

    const { error: insErr } = await adminSb.from("questions").insert({
      id: questionId,
      question: reframed,
      topic_id: topicId,
      source: "community",
      proposed_by: proposal.user_id,
      location_label: proposal.location_label,
      slider_low_label: sliderLow,
      slider_high_label: sliderHigh,
      // status/state/tags/published_at default; slug/search_vector/dedup/audience
      // are set by BEFORE INSERT triggers.
    });
    if (insErr) {
      // Roll the proposal back to 'approved' so the admin can retry.
      await adminSb.from("user_question_proposals").update({ status: "approved" }).eq("id", proposalId);
      return json(500, { ok: false, error: "INSERT_FAILED", message: insErr.message });
    }

    // Link the proposal to the new live question.
    await adminSb.from("user_question_proposals").update({
      status: "published", reframed_question_id: questionId,
    }).eq("id", proposalId);

    // Reward the proposer (+10, total_published +1).
    const { data: rep } = await adminSb.from("user_proposal_reputation")
      .select("score, tier, total_published").eq("user_id", proposal.user_id).maybeSingle();
    const newScore = (rep?.score ?? 0) + PUBLISH_REWARD;
    await adminSb.from("user_proposal_reputation").upsert({
      user_id: proposal.user_id,
      score: newScore,
      tier: tierForScore(newScore, rep?.tier ?? "new"),
      total_published: (rep?.total_published ?? 0) + 1,
    }, { onConflict: "user_id" });

    // TODO(step 8): notify proposer "Your question is live!".
    await adminSb.from("user_notifications").insert({
      user_id: proposal.user_id,
      notification_type: "ugq_published",
      title: "Your question is live! \uD83C\uDF89",
      body: "See how the community responds.",
      question_id: questionId,
      href: `/q/${questionId}`,
    });

    return json(200, { ok: true, question_id: questionId });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
