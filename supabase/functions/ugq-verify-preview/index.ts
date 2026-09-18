// supabase/functions/ugq-verify-preview/index.ts
// Epic X (Sep 2026, NEW) — synchronous fact-check for voice/video UGQ.
//
// Voice/video submissions clear Gate 1 via ugq-screen exactly as before
// (safety/duplicate/quality/topic-match + the video framing gate), which
// also produces a fast, UNVERIFIED preview via generatePreviewOnce — that
// part is completely unchanged. This endpoint is called by the CLIENT right
// after that resolves to 'in_review', to upgrade the preview to the real,
// fact-checked Stage A/B/C pipeline (fact_extraction → question_reframing →
// question_verification) that admin-authored content already goes through
// via ugq-moderate's "approve" action — see that file for the pipeline
// itself, which is entirely UNCHANGED and REUSED here rather than
// duplicated. This wrapper does the user-facing validation (ownership,
// status, topic resolution) the same way ugq-confirm-publish/
// ugq-refine-preview already do for their own calls, then invokes
// ugq-moderate server-to-server with the narrow x-cron-secret path added
// there specifically for this (action="approve" only — nothing else).
//
// Deliberately does NOT make Stage A/B/C a hard requirement: if it fails or
// times out for any reason (LLM outage, malformed JSON, taking longer than
// this function is willing to wait), the proposal's existing fast/
// unverified preview_reframe (already written by ugq-screen) is left
// exactly as-is and this returns verified:false rather than an error — the
// proposer can still publish on the unverified preview rather than being
// blocked by an infra hiccup. This is the same "fail open, never block the
// proposer" posture used everywhere else in this pipeline (safety_flag,
// the video framing gate, cover-image scraping, etc.) — Stage A/B/C is a
// quality upgrade over the fast preview, not a replacement gate.
//
// Sep 2026, FIXED (defect UGQ-D3): this mapping used to null out
// cover_image_url and context_summary. Both losses reached the published
// question, because ugq-confirm-publish reads exactly these fields off
// preview_reframe — and its cover-image fallback is keyed on whether the
// cover_image_url KEY is present, not whether it has a value, so writing an
// explicit null here also suppressed the fallback scrape that would
// otherwise have recovered an image. Net effect on Dev: the one proposal
// that went through this endpoint published with no cover image and no
// background, against 10/12 and 12/12 for every other community question.
//
// The fix is to carry forward what Stage A/B/C does not itself replace.
// What is carried, and why each is still valid after the rewrite:
//   - cover_image_url  — an illustrative image scraped from the proposer's
//     own source link / search results for THIS proposal. Nothing about
//     re-writing the question text invalidates it.
//   - context_summary (+ context_summary_native) and the supporting_links
//     that grounded it — background about the same real-world subject, not
//     a restatement of the question. Carried as a PAIR so the blurb and its
//     citations stay coherent; Stage A's own sources are used for
//     supporting_links only when there is no carried blurb to contradict.
//   - detected_language — a fact about the proposer, not about the text.
//
// What is deliberately NOT carried: question_native and the native slider
// labels. Those are the proposer's own-language rendering of the OLD fast
// preview, and Stage B has just replaced the English question they were a
// translation of. Carrying them would seed question_renditions with text
// that no longer matches the canonical question — worse than leaving the
// rendition 'pending' for the async translator, which is what now happens
// (ugq-publish only seeds when question_native is present).
//
// Still true: Stage A/B/C's fact sheet is a structured per-case JSON object,
// not the short prose paragraph context_summary is designed to hold, so this
// endpoint still does not synthesize a NEW blurb — it preserves the existing
// one. The UI continues to treat context_summary as optional.
//
// Auth: user JWT required. Verifies the caller owns the proposal (same
// ownership check ugq-confirm-publish/ugq-refine-preview use).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Stage A (web search, up to 5 queries by default) + Stage B + Stage C, with
// a possible single retry of B+C, can genuinely take 30-90+ seconds.
// Generous but bounded so this function's own execution stays under the
// platform's wall-clock ceiling. Aborting here does NOT stop ugq-moderate's
// own execution (Deno Deploy invocations run independently of the caller's
// fetch, same as every other internal call in this pipeline) — it only
// means THIS function gives up waiting and falls back to the existing fast
// preview; a very slow approve call may still finish and write
// reframe_result/status='reframed' to the DB afterward, just with nothing
// left here to translate that into preview_reframe. Accepted as a rare
// tail case rather than building a second catch-up mechanism for it.
const APPROVE_TIMEOUT_MS = 120_000;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

  try {
    // ── Identity ─────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "UNAUTHORIZED" });
    const userSb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userSb.auth.getUser();
    if (!user) return json(401, { ok: false, error: "UNAUTHORIZED" });

    const body = await req.json().catch(() => ({}));
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id : "";
    if (!proposalId) return json(400, { ok: false, error: "MISSING_PROPOSAL_ID" });

    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: proposal } = await adminSb.from("user_question_proposals")
      .select("id, user_id, status, auto_topic_id, input_mode, preview_reframe")
      .eq("id", proposalId).maybeSingle();
    if (!proposal) return json(404, { ok: false, error: "NOT_FOUND" });
    if (proposal.user_id !== user.id) {
      return json(403, { ok: false, error: "FORBIDDEN", message: "You can only verify your own proposals." });
    }
    if (proposal.status !== "in_review") {
      return json(200, { ok: true, verified: false, message: `Proposal is '${proposal.status}' — nothing to verify.` });
    }
    if (!proposal.auto_topic_id) {
      console.error(JSON.stringify({ tag: "ugq-verify-preview.no_topic", proposal_id: proposalId }));
      return json(200, { ok: true, verified: false, message: "No topic resolved yet — showing the unverified preview." });
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), APPROVE_TIMEOUT_MS);
    let approveJson: Record<string, unknown> = {};
    let approveOk = false;
    try {
      const approveResp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-moderate`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-cron-secret": CRON_SECRET },
        body: JSON.stringify({ proposal_id: proposalId, action: "approve", topic_id: proposal.auto_topic_id }),
      });
      approveJson = await approveResp.json().catch(() => ({}));
      approveOk = approveResp.ok && approveJson?.ok === true && approveJson?.status === "reframed";
    } catch (e) {
      console.error(JSON.stringify({ tag: "ugq-verify-preview.approve_threw", message: (e as Error).message }));
    } finally {
      clearTimeout(t);
    }

    if (!approveOk) {
      console.error(JSON.stringify({
        tag: "ugq-verify-preview.approve_failed",
        proposal_id: proposalId,
        error: approveJson?.error ?? "unknown",
        message: approveJson?.message ?? null,
      }));
      return json(200, {
        ok: true, verified: false,
        message: "Couldn't finish fact-checking just now — showing the unverified preview instead.",
      });
    }

    const question = typeof approveJson.question === "string" ? approveJson.question.trim() : "";
    if (!question) {
      console.error(JSON.stringify({ tag: "ugq-verify-preview.empty_question", proposal_id: proposalId }));
      return json(200, { ok: true, verified: false, message: "Fact-checked result was empty — showing the unverified preview instead." });
    }
    // Sep 2026 (defect UGQ-D3) — see header. Everything the fact-check does
    // not itself produce is carried over from the fast preview rather than
    // nulled out.
    const prior = (proposal.preview_reframe ?? null) as Record<string, unknown> | null;
    const priorStr = (key: string): string | null => {
      const v = prior?.[key];
      return typeof v === "string" && v.trim() ? v.trim() : null;
    };
    const carriedContext = priorStr("context_summary");
    const carriedLinks = Array.isArray(prior?.supporting_links)
      ? (prior.supporting_links as unknown[]).filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      : [];
    const stageASources = Array.isArray(approveJson.sources)
      ? (approveJson.sources as unknown[]).filter((u): u is string => typeof u === "string")
      : [];

    const previewReframe = {
      question,
      slider_low_label: typeof approveJson.slider_low_label === "string" ? approveJson.slider_low_label : null,
      slider_high_label: typeof approveJson.slider_high_label === "string" ? approveJson.slider_high_label : null,
      context_summary: carriedContext,
      context_summary_native: priorStr("context_summary_native"),
      // Keep the blurb and its citations together: if a carried blurb exists
      // and has its own links, those are the sources that actually back it.
      // Otherwise fall back to Stage A's fact-sheet sources, which is the
      // previous behavior and still correct when there is no blurb.
      supporting_links: (carriedContext && carriedLinks.length ? carriedLinks : stageASources).slice(0, 3),
      quality_notes: typeof approveJson.quality_notes === "string" ? approveJson.quality_notes : null,
      cover_image_url: priorStr("cover_image_url"),
      detected_language: priorStr("detected_language"),
      // question_native / slider_*_native intentionally omitted — see header.
      model: typeof approveJson.model === "string" ? approveJson.model : null,
      generated_at: new Date().toISOString(),
      verified: true,
    };

    await adminSb.from("user_question_proposals").update({
      status: "in_review",
      preview_reframe: previewReframe,
    }).eq("id", proposalId);

    console.log(JSON.stringify({ tag: "ugq-verify-preview.ok", proposal_id: proposalId }));
    return json(200, { ok: true, verified: true, preview_reframe: previewReframe });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
