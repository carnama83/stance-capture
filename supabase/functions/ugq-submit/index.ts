// supabase/functions/ugq-submit/index.ts
// Epic UGQ — Build Step 2 of 8: Gate 1 entry point.
//
// Receives a user's question proposal from the browser, enforces admin-imposed
// rate limits (flagged / rate_limited_until), inserts the proposal (status
// 'proposed'), then invokes ugq-screen (Gate 1 AI pre-screen) to resolve it
// to a terminal state.
//
// Conventions mirrored from embed-submit/index.ts:
//   - std `serve`, dual Supabase clients (service-role for writes, anon+JWT for identity)
//   - jsonError(status, code, message) shape
// Auth: a valid Supabase user JWT is REQUIRED (this is a user-facing endpoint).
//
// Aug 2026: ugq-screen now also generates a fast, unverified "preview reframe"
// in parallel with Gate 1 screening (adds ~0 latency — see ugq-screen for
// details) so the proposer can see roughly how their raw text might read as a
// polished stance question right on submit. Timeout bumped 9s → 12s to give
// that parallel call a little more headroom; on timeout the proposal still
// stays 'proposed' for later re-screening exactly as before, this just makes
// the "resolve immediately" happy path slightly less trigger-happy to abort.
//
// Aug 2026 (later same week): ugq-screen may now go further and PUBLISH that
// preview immediately (status becomes "published", not "in_review") — see
// ugq-screen's AUTO-PUBLISH section. This function just relays whatever
// ugq-screen decided; no logic here needs to know why.
//
// Aug 2026 (voice recording, NEW): accepts optional input_mode/
// voice_recording_path from ProposeQuestionModal — set when the proposer
// recorded their question instead of typing it (see ugq-transcribe-voice).
// The client transcribes and lets the proposer review/edit BEFORE this
// endpoint is ever called, so raw_question is real, proposer-reviewed text
// either way. These two fields are pure metadata, persisted only for the
// admin queue's trust-signal badge/playback — nothing in the Gate 1 /
// preview / publish pipeline downstream reads or cares about them.
//
// Epic X (video, NEW): input_mode also accepts "video". UNLIKE voice,
// video_recording_path is NOT just trust-signal metadata — Epic X publishes
// the raw clip itself to respondents (see design discussion: raw video is
// the authenticity anchor, never rewritten). Two extra fields ride along:
//   - video_duration_seconds: pure metadata, same treatment as voice.
//   - video_raw_transcript: the UNEDITED transcript of the raw audio track,
//     captured client-side before the proposer reviews/edits raw_question.
//     This is intentionally DIFFERENT from raw_question — raw_question can
//     diverge once the proposer edits it (same review step voice already
//     has), but the audio track in the published clip can't be un-said.
//     ugq-screen's new framing gate checks THIS field, not raw_question,
//     because it's judging what respondents will actually hear if they
//     choose to play the raw video, not what ended up in the polished text.
//     Required when input_mode is "video" (rejected without it — the
//     framing gate has nothing to check otherwise).
//
// Sep 2026, REMOVED: the per-submission cooldown (TIER_LIMITS[tier].cooldownMs,
// e.g. 15 minutes for 'new' tier — "Please wait Ns before proposing again")
// was removed at the user's explicit request. The rolling-24h daily cap
// (TIER_LIMITS[tier].daily) and admin-imposed rate_limited_until were
// unaffected by that change — this only removed the fixed gap enforced
// between any two consecutive proposals.
//
// Sep 2026, REMOVED (later same week): the rolling-24h daily cap itself
// (TIER_LIMITS[tier].daily — 3/10/25 for new/trusted/verified) is now also
// gone, at the user's explicit request to make proposing unlimited.
// admin-imposed rate_limited_until and the flagged check are untouched —
// abuse response still exists, there's just no longer a blanket per-tier
// count ceiling.
//
// Anonymous-video feature (NEW): for a video submission, snapshots the
// caller's CURRENT profiles.display_handle_mode into
// video_recorded_anonymous at the moment of insert — a PERMANENT record of
// "was this proposer anonymous when THIS clip was recorded." Deliberately
// never re-evaluated later: switching display_handle_mode afterward must
// not change what a previously-recorded video shows (see
// VideoRecorderPanel.tsx and the anonymous-video migration for the full
// design). video_raw_archival_path rides along too, set only when the
// client recorded anonymously (points at the true, unmasked clip in the
// separate ugq-video-recordings-raw bucket — never the public path).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

    // ── Input validation (spec §3.1, §5.1) ────────────────────────
    const body = await req.json().catch(() => ({}));
    const rawQuestion = typeof body.raw_question === "string" ? body.raw_question.trim() : "";
    if (rawQuestion.length < 20 || rawQuestion.length > 1000) {
      return jsonError(400, "INVALID_QUESTION", "Question must be between 20 and 500 characters");
    }
    const sourceUrl = typeof body.source_url === "string" ? body.source_url.slice(0, 2048) : null;
    const sourceDescription = typeof body.source_description === "string" ? body.source_description.slice(0, 1000) : null;
    const locationLabel = typeof body.location_label === "string" ? body.location_label.slice(0, 200) : null;
    const suggestedTopicId = typeof body.suggested_topic_id === "string" && UUID_RE.test(body.suggested_topic_id) ? body.suggested_topic_id : null;
    const constituencyId = typeof body.constituency_id === "string" && UUID_RE.test(body.constituency_id) ? body.constituency_id : null;
    // Aug 2026, NEW: normalize defensively here too, matching the DB's
    // uqp_input_mode_check constraint — anything other than the literal
    // strings "voice"/"video" is treated as "text" rather than erroring,
    // since a malformed/missing value just means "assume typed", never a
    // reason to reject an otherwise-valid submission. voice_recording_path
    // is only honored when input_mode is actually "voice" (a stray path on
    // a text submission would be meaningless), capped at a generous length
    // since it's just a Storage object path, not user-facing content.
    const inputMode = body.input_mode === "voice" ? "voice" : body.input_mode === "video" ? "video" : "text";
    const voiceRecordingPath = inputMode === "voice" && typeof body.voice_recording_path === "string" && body.voice_recording_path.trim()
      ? body.voice_recording_path.trim().slice(0, 500)
      : null;
    // Epic X, NEW: video fields, same "only honored for the matching
    // input_mode" pattern as voice above. video_raw_transcript is required
    // for video submissions — without it the framing gate in ugq-screen has
    // nothing to check, so we reject rather than silently publishing a video
    // question that never got screened for leading framing.
    const videoRecordingPath = inputMode === "video" && typeof body.video_recording_path === "string" && body.video_recording_path.trim()
      ? body.video_recording_path.trim().slice(0, 500)
      : null;
    const videoDurationSeconds = inputMode === "video" && Number.isFinite(body.video_duration_seconds)
      ? Math.max(0, Math.min(600, Math.round(body.video_duration_seconds)))
      : null;
    const videoRawTranscript = inputMode === "video" && typeof body.video_raw_transcript === "string"
      ? body.video_raw_transcript.trim().slice(0, 2000)
      : null;
    if (inputMode === "video" && (!videoRecordingPath || !videoRawTranscript)) {
      return jsonError(400, "MISSING_VIDEO_FIELDS", "video_recording_path and video_raw_transcript are required for video submissions");
    }
    // Anonymous-video feature, NEW: set only when this video was recorded
    // while the proposer was anonymous — see VideoRecorderPanel.tsx. Points
    // at the true, unmasked clip in the separate ugq-video-recordings-raw
    // bucket; ignored for non-video submissions.
    const videoRawArchivalPath = inputMode === "video" && typeof body.video_raw_archival_path === "string" && body.video_raw_archival_path.trim()
      ? body.video_raw_archival_path.trim().slice(0, 500)
      : null;

    // Service-role client for all writes (bypasses RLS).
    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Anonymous-video feature, NEW: permanent snapshot — see header note.
    // Read once here, at insert time, and never revisited for this row.
    let videoRecordedAnonymous = false;
    if (inputMode === "video") {
      const { data: profile } = await adminSb.from("profiles")
        .select("display_handle_mode").eq("user_id", userId).maybeSingle();
      videoRecordedAnonymous = profile?.display_handle_mode === "random_id";
    }

    // ── Reputation row (ensure exists), then gate on flag / rate-limit ─────────
    await adminSb.from("user_proposal_reputation")
      .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });

    const { data: rep } = await adminSb.from("user_proposal_reputation")
      .select("flagged, rate_limited_until")
      .eq("user_id", userId).maybeSingle();

    if (rep?.flagged) {
      return jsonError(403, "PROPOSER_FLAGGED", "Your proposal privileges are currently restricted");
    }
    if (rep?.rate_limited_until && new Date(rep.rate_limited_until).getTime() > Date.now()) {
      return jsonError(429, "RATE_LIMITED", "You're temporarily limited from proposing. Try again later");
    }

    // ── Cheap exact-text dedup (spec §11 content hashing): block the same user
    //    re-submitting an identical, still-active proposal. Semantic dedup is
    //    handled by ugq-screen (Gate 1 AI). ─────────────────────
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

    // ── Insert proposal (status 'proposed') ────────────────────────
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
        input_mode: inputMode,
        voice_recording_path: voiceRecordingPath,
        video_recording_path: videoRecordingPath,
        video_duration_seconds: videoDurationSeconds,
        video_raw_transcript: videoRawTranscript,
        video_recorded_anonymous: videoRecordedAnonymous,
        video_raw_archival_path: videoRawArchivalPath,
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
    let previewReframe: Record<string, unknown> | null = null;
    let published = false;
    let publishedQuestionId: string | null = null;
    // Epic X, NEW: only meaningful when finalStatus === "resubmit_requested"
    // (see ugq-screen's framing gate) — plain-language reason to show the
    // proposer, distinct from the raw classifier output.
    let framingFlagReason: string | null = null;
    // Sep 2026, NEW: independent of finalStatus/framingFlagReason — see
    // ugq-screen's checkVideoFraming. Informational only, relayed straight
    // through so VideoPublishChoice.tsx can show it regardless of whether
    // the proposal also came back resubmit_requested.
    let derogatoryFlagReason: string | null = null;
    try {
      const ctrl = new AbortController();
      // 20s (was 12s, originally 9s): ugq-screen runs the Gate 1 screening
      // call and the preview-reframe call CONCURRENTLY (Promise.allSettled),
      // so total time is roughly the slower of the two rather than double —
      // but the preview call now also runs web search (Aug 2026, CONTEXT
      // feature: grounds the published text with real search results) which
      // adds a few real seconds of its own on top of generation time. Extra
      // headroom avoids aborting a request that's 90% of the way there.
      // Aborting here does NOT stop ugq-screen's own execution (Deno Deploy
      // invocations run independently of the caller's fetch) — it only means
      // we return 'proposed' to the browser and the DB write (correct status
      // + preview, possibly already published) lands a moment after this
      // response, invisible to this request only.
      const t = setTimeout(() => ctrl.abort(), 20000);
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
        if (screenJson.preview_reframe && typeof screenJson.preview_reframe === "object") {
          previewReframe = screenJson.preview_reframe as Record<string, unknown>;
        }
        // NEW (Aug 2026): ugq-screen may have auto-published this proposal
        // already (see ugq-screen's AUTO-PUBLISH section). When it has,
        // finalStatus === "published" and question_id points at the live row.
        published = screenJson.published === true;
        publishedQuestionId = typeof screenJson.question_id === "string" ? screenJson.question_id : null;
        framingFlagReason = typeof screenJson.framing_flag_reason === "string" ? screenJson.framing_flag_reason : null;
        derogatoryFlagReason = typeof screenJson.derogatory_flag_reason === "string" ? screenJson.derogatory_flag_reason : null;
      } else {
        console.error(`[ugq-submit] inline screen failed: HTTP ${screenResp.status} body=${JSON.stringify(screenJson).slice(0, 300)} — proposal stays 'proposed'`);
      }
    } catch (e) {
      // Screen failed/timed out — proposal remains 'proposed' for later re-screening.
      console.error("[ugq-submit] inline screen threw:", (e as Error).message);
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

    // In-app notification: submitted (skip if Gate 1 already rejected it, and
    // skip if it was auto-published — ugq-publish already sends its own
    // "Your question is live!" notification in that case).
    if (finalStatus !== "rejected" && finalStatus !== "resubmit_requested" && !published) {
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
      // Rough, UNVERIFIED preview only — null unless the proposal is headed to
      // in_review/approved/published. Frontend should label this clearly as a
      // preview (e.g. "Here's roughly how this might look — subject to
      // review"), not as the final published wording. Shape: { question,
      // slider_low_label, slider_high_label, quality_notes, model,
      // generated_at }.
      preview_reframe: previewReframe,
      // NEW (Aug 2026): true when this proposal was auto-published (see
      // ugq-screen). When true, question_id is real and /q/{question_id}
      // is live right now — frontend should offer a "View it live" link.
      published,
      question_id: publishedQuestionId,
      // Epic X, NEW: populated only when status === "resubmit_requested".
      framing_flag_reason: framingFlagReason,
      // Sep 2026, NEW: informational only, independent of status — see
      // ugq-screen's checkVideoFraming / VideoPublishChoice.tsx.
      derogatory_flag_reason: derogatoryFlagReason,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return jsonError(500, "INTERNAL_ERROR", (err as Error).message ?? "Unexpected error");
  }
});
