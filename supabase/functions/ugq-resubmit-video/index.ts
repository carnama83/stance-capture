// supabase/functions/ugq-resubmit-video/index.ts
// Sep 2026, NEW — lets a proposer resubmit a video proposal that came back
// with status='resubmit_requested' (ugq-screen's leading-framing gate on
// video_raw_transcript — see that file's header). UNLIKE ugq-submit, this
// does NOT create a new proposal row: video_resubmit_count already existed
// on user_question_proposals before this function did, tracking resubmits
// IN PLACE on the same row — this endpoint is what actually drives that.
//
// Editing raw_question (the caption) alone can never clear a leading-
// framing verdict — the gate checks video_raw_transcript, the UNEDITED
// audio transcript, not the caption, precisely because a reworded caption
// can't undo what a respondent hears if they play the original clip. The
// only real fix is a brand-new recording, so this endpoint requires a full
// replacement video + its own fresh transcript, exactly like an original
// submission — it just reuses the existing proposal_id/row instead of
// creating a new one, and skips ugq-submit's rate-limit/cooldown/dedup
// checks (this isn't a new proposal, and video_resubmit_count is the
// existing, deliberately uncapped tracking for this — see decision log).
//
// Client flow: VideoRecorderPanel's resubmitProposalId prop records a new
// video, uploads it via the EXISTING ugq-upload-video (unchanged),
// transcribes via the EXISTING transcribeAudio flow (unchanged), then
// calls THIS endpoint instead of ugq-submit with that same proposal_id.
//
// Auth: user JWT required. Verifies the caller owns the proposal AND that
// it's actually a video proposal currently awaiting a resubmit — this
// endpoint refuses to touch a proposal in any other status.
//
// Anonymous-video feature (NEW): a resubmission is a brand-new RECORDING,
// so it independently re-snapshots the caller's CURRENT display_handle_mode
// into video_recorded_anonymous — it does NOT inherit whatever the original
// submission snapshotted. This matches the product rule "a video reflects
// whatever mode you were in when THAT clip was recorded" for the resubmit
// path too: if the proposer switched from random_id to username between
// their first attempt and this resubmission, the resubmitted clip is
// treated as an identified recording, not an anonymous one, and vice versa.
// video_raw_archival_path is accepted from the client (set only when the
// resubmission was itself recorded anonymously — see VideoRecorderPanel.tsx)
// and overwrites whatever the row had before, same "in place" treatment as
// every other video field here.

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
    const rawQuestion = typeof body.raw_question === "string" ? body.raw_question.trim() : "";
    const videoRecordingPath = typeof body.video_recording_path === "string" ? body.video_recording_path.trim() : "";
    const videoRawTranscript = typeof body.video_raw_transcript === "string" ? body.video_raw_transcript.trim() : "";
    const videoDurationSeconds = Number.isFinite(body.video_duration_seconds)
      ? Math.max(0, Math.min(600, Math.round(body.video_duration_seconds))) : null;
    // Anonymous-video feature, NEW: set only when this resubmission's
    // recording was itself captured while the proposer was anonymous — see
    // VideoRecorderPanel.tsx. Absent/null for an identified resubmission.
    const videoRawArchivalPath = typeof body.video_raw_archival_path === "string" && body.video_raw_archival_path.trim()
      ? body.video_raw_archival_path.trim().slice(0, 500) : null;

    if (!proposalId || !rawQuestion || !videoRecordingPath || !videoRawTranscript) {
      return json(400, { ok: false, error: "MISSING_FIELDS" });
    }
    if (rawQuestion.length < 20 || rawQuestion.length > 1000) {
      return json(400, { ok: false, error: "INVALID_QUESTION", message: "Question must be between 20 and 1000 characters" });
    }

    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: proposal } = await adminSb.from("user_question_proposals")
      .select("id, user_id, status, input_mode")
      .eq("id", proposalId).maybeSingle();
    if (!proposal) return json(404, { ok: false, error: "NOT_FOUND" });
    if (proposal.user_id !== user.id) {
      return json(403, { ok: false, error: "FORBIDDEN", message: "You can only resubmit your own proposals." });
    }
    if (proposal.input_mode !== "video") {
      return json(409, { ok: false, error: "NOT_VIDEO", message: "Only video proposals can be resubmitted here." });
    }
    if (proposal.status !== "resubmit_requested") {
      return json(409, {
        ok: false, error: "NOT_AWAITING_RESUBMIT",
        message: `Proposal is '${proposal.status}' — nothing to resubmit.`,
      });
    }

    // Anonymous-video feature, NEW: re-snapshot the CALLER'S CURRENT
    // display_handle_mode — independent of whatever the original submission
    // snapshotted. See header note.
    const { data: profile } = await adminSb.from("profiles")
      .select("display_handle_mode").eq("user_id", user.id).maybeSingle();
    const videoRecordedAnonymous = profile?.display_handle_mode === "random_id";

    // Overwrite the video fields IN PLACE with the new recording, and reset
    // status to 'proposed' so ugq-screen's fresh-screen flow (which
    // requires status='proposed' — see its precondition check) runs again
    // exactly as it did on the original submission.
    await adminSb.from("user_question_proposals").update({
      raw_question: rawQuestion,
      video_recording_path: videoRecordingPath,
      video_duration_seconds: videoDurationSeconds,
      video_raw_transcript: videoRawTranscript,
      video_recorded_anonymous: videoRecordedAnonymous,
      video_raw_archival_path: videoRawArchivalPath,
      status: "proposed",
    }).eq("id", proposalId);

    // ── Invoke Gate 1 (ugq-screen) — same pattern/timeout as ugq-submit. ────
    let finalStatus = "proposed";
    let previewReframe: Record<string, unknown> | null = null;
    let published = false;
    let publishedQuestionId: string | null = null;
    let framingFlagReason: string | null = null;
    let derogatoryFlagReason: string | null = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const screenResp = await fetch(`${SUPABASE_URL}/functions/v1/ugq-screen`, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-cron-secret": CRON_SECRET },
        body: JSON.stringify({ proposal_id: proposalId }),
      }).finally(() => clearTimeout(t));
      const screenJson = await screenResp.json().catch(() => ({}));
      if (screenResp.ok && typeof screenJson.status === "string") {
        finalStatus = screenJson.status;
        if (screenJson.preview_reframe && typeof screenJson.preview_reframe === "object") {
          previewReframe = screenJson.preview_reframe as Record<string, unknown>;
        }
        published = screenJson.published === true;
        publishedQuestionId = typeof screenJson.question_id === "string" ? screenJson.question_id : null;
        framingFlagReason = typeof screenJson.framing_flag_reason === "string" ? screenJson.framing_flag_reason : null;
        derogatoryFlagReason = typeof screenJson.derogatory_flag_reason === "string" ? screenJson.derogatory_flag_reason : null;
      } else {
        console.error(`[ugq-resubmit-video] inline screen failed: HTTP ${screenResp.status} body=${JSON.stringify(screenJson).slice(0, 300)} — proposal stays 'proposed'`);
      }
    } catch (e) {
      console.error("[ugq-resubmit-video] inline screen threw:", (e as Error).message);
    }

    const userMessage = finalStatus === "resubmit_requested"
      ? framingFlagReason ?? "Please re-record — try asking this more neutrally, without suggesting an answer."
      : finalStatus === "rejected"
      ? "Your question wasn't published. You can try rephrasing."
      : published
      ? "Your question is live! Our team will also give it a quick review shortly."
      : previewReframe
      ? "Your question is under review. Here's roughly how it might look once it's polished and approved."
      : "Your question is under review. We'll notify you when it goes live.";

    return json(200, {
      ok: true,
      proposal_id: proposalId,
      status: finalStatus,
      message: userMessage,
      preview_reframe: previewReframe,
      published,
      question_id: publishedQuestionId,
      framing_flag_reason: framingFlagReason,
      derogatory_flag_reason: derogatoryFlagReason,
    });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
