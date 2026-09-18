// supabase/functions/ugq-publish/index.ts
// Epic UGQ — Build Step 5: create the live question (spec §7.4).
//
// Internal endpoint invoked by:
//   - ugq-moderate, after admin approves via the fact-checked Stage A/B/C
//     reframe pipeline (existing path, unchanged) — auto_published stays false.
//   - ugq-screen (Aug 2026, NEW), immediately on Gate 1 clearing a proposal,
//     using the fast unverified preview reframe — auto_published=true, so
//     admin can review this specific question IN PARALLEL (confirm/edit/
//     unpublish via the new ugq-moderate actions) instead of gating on it.
//
// Inserts a row into questions with source='community' + proposed_by, links it
// back to the proposal, and awards the +10 / total_published reputation bump —
// identical either way; auto_published only changes which review queue the
// resulting question shows up in.
//
// Schema-verified (June 2026): questions requires only `question` + `topic_id`
// (NOT NULL, no default); status/state/tags/published_at default; and BEFORE
// INSERT triggers auto-populate slug, search_vector, dedup fields and audience.
// We generate the id client-side so no .select() is needed after insert
// (avoids holding a PgBouncer connection).
//
// Auth: internal only (x-cron-secret == CRON_SECRET or service-role Bearer).
//
// Epic X (video, NEW): carries video_recording_path/video_duration_seconds/
// video_publish_choice from the proposal through onto the published
// questions row, and sets content_type='video' when a video path is
// present. Callers of this endpoint (ugq-screen's auto-publish call, and
// ugq-confirm-publish for the normal user-confirmed path) need to pass
// these fields through in their request body — ugq-screen's call is updated
// alongside this file; ugq-confirm-publish was not in hand when this change
// was written and needs the same three fields added to its own call here.
//
// Note: a prior session added video_recorded_anonymous / video_raw_
// archival_path passthrough here for an anonymous-avatar video feature that
// was later rolled back (the client-side voice-disguise pipeline was
// unreliable). Removed — a proposer who records a video while anonymous now
// never uploads a video at all (routed client-side to submit as input_mode
// "voice" instead), so every video that reaches this function again belongs
// to an identified proposer, exactly as before that feature existed.
//
// Sep 2026: `question` (the `reframed` text below) must be ENGLISH. Under F2
// it is the denormalised mirror of the question's English semantic rendition —
// NOT "the real question", which is the proposer's own wording (see the F2
// note below). A guardrail rejects the publish if `reframed` contains
// non-English script: defence in depth against a prompt/model regression
// upstream (ugq-screen's preview prompt is what is actually supposed to
// guarantee English — see its LANGUAGE_HANDLING_INSTRUCTIONS). It refuses the
// PUBLISH only and leaves the proposal untouched for an admin to resolve; it
// never rejects the proposer's question, which would blame them for a fault
// in our own English generation. Applies to EVERY caller (ugq-moderate's admin
// path included), since an English mirror that is not English breaks the 28
// database functions and 39 src files that read this column.
//
// Sep 2026, F2 (§3 R15 rewritten): canonical_language now records the
// question's SOURCE language rather than asserting English. questions.question
// remains the English mirror and the non-English-script guardrail still
// protects it; what changed is that a non-English proposal now makes the
// proposer's own reviewed wording the question's ORIGINAL rendition (via
// adopt_proposer_source_wording), with the English left pending so it is
// generated FROM that source and verified rather than grandfathered in.
//
// Callers may optionally pass detected_language/question_native/
// slider_*_label_native/context_summary_native (ugq-screen's preview generates
// these when the proposer wrote in a non-English language — see PreviewReframe
// there). When present, that proposer-reviewed native text becomes the
// question's ORIGINAL rendition, published outright, so the proposer sees
// their own submission in their own language immediately rather than "still
// being prepared" — and so no other language is ever derived from an
// unverified English translation of it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PUBLISH_REWARD = 10; // spec §4.3

// Sep 2026, NEW — see header note. Small vetted map of script-name ->
// Unicode range, keyed off languages.script (confirmed live values: 'en'
// has script='Latin', 'hi' has script='Devanagari'). Unicode blocks are a
// fixed, bounded set (unlike free-text place names), so a maintained map is
// the right level of generalization here — unlike text_mentions_india()'s
// keyword list, this doesn't need per-language custom logic, just one more
// entry when a language with a genuinely new script is added. Covers every
// major Indic script so Tamil/Telugu/etc. are already handled the moment a
// languages row for them exists with is_active_for_ugq=true, with zero code
// change here.
const SCRIPT_RANGES: Record<string, RegExp> = {
  Devanagari: /[ऀ-ॿ]/,
  Bengali: /[ঀ-৿]/,
  Gurmukhi: /[਀-੿]/,
  Gujarati: /[઀-૿]/,
  Odia: /[଀-୿]/,
  Tamil: /[஀-௿]/,
  Telugu: /[ఀ-౿]/,
  Kannada: /[ಀ-೿]/,
  Malayalam: /[ഀ-ൿ]/,
};

// Builds a single combined regex from whichever non-English, UGQ-active
// languages' scripts are actually registered right now — data-driven, not a
// fixed single-script check. Falls back to just Devanagari (today's exact
// behavior) if the query fails or nothing matches, so an outage here never
// makes this guardrail silently permissive.
async function nonEnglishScriptRegex(adminSb: ReturnType<typeof createClient>): Promise<RegExp> {
  try {
    const { data } = await adminSb.from("languages")
      .select("script").eq("is_active_for_ugq", true).neq("language_code", "en");
    const ranges = (data ?? [])
      .map((r) => SCRIPT_RANGES[r.script as string])
      .filter((r): r is RegExp => !!r);
    if (ranges.length === 0) return SCRIPT_RANGES.Devanagari;
    const combined = ranges.map((r) => r.source.slice(1, -1)).join("");
    return new RegExp(`[${combined}]`);
  } catch {
    return SCRIPT_RANGES.Devanagari;
  }
}

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
    // NEW: distinguishes the Gate-1-only instant-publish path (ugq-screen)
    // from the admin fact-checked path (ugq-moderate). Defaults false so
    // every existing caller/behavior is unchanged unless explicitly opted in.
    const autoPublished = body.auto_published === true;
    if (!proposalId || !reframed || !topicId) return json(400, { ok: false, error: "MISSING_FIELDS" });

    // Sep 2026, NEW — see header note. Fails closed: refuses to let
    // non-English text become canonical rather than silently publishing it.
    // The proposal itself is untouched (still 'in_review'/'approved'), so
    // an admin can resolve this via ugq-moderate same as any other publish
    // failure — this is not meant to be common once ugq-screen's prompt fix
    // is live, just a safety net for if it ever regresses.
    const nonEnglishRe = await nonEnglishScriptRegex(adminSb);
    if (nonEnglishRe.test(reframed)) {
      console.error(JSON.stringify({
        tag: "ugq-publish.non_english_canonical_rejected", proposal_id: proposalId,
      }));
      return json(422, {
        ok: false, error: "NON_ENGLISH_CANONICAL",
        message: "The reframed question must be in English — it contains non-English script.",
      });
    }

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
    // CONTEXT (Aug 2026): optional grounding added by ugq-screen's preview
    // web-search pass — same columns editorial/news-sourced questions already
    // use (context_summary, supporting_links), so QuestionDetailPage's
    // existing conventions apply. Absent for admin-fact-checked publishes
    // (ugq-moderate doesn't send these — that path has its own, richer
    // fact_sheet in reframe_result instead).
    const contextSummary = typeof body.context_summary === "string" && body.context_summary.trim()
      ? body.context_summary.trim() : null;
    const supportingLinks = Array.isArray(body.supporting_links)
      ? body.supporting_links.filter((u: unknown): u is string => typeof u === "string" && u.trim().length > 0).slice(0, 3)
      : [];
    // Aug 2026: cover image, extracted by ugq-confirm-publish from the same
    // supporting_links (og:image/twitter:image scrape) — direct external
    // URL, not mirrored to storage (see ugq-confirm-publish for why). Basic
    // shape validation only — the real extraction/validation already
    // happened upstream; this is just a defensive re-check before writing.
    const coverImageUrl = typeof body.cover_image_url === "string" && /^https?:\/\//i.test(body.cover_image_url)
      ? body.cover_image_url : null;
    // Epic X, NEW: defensive re-check here too, same spirit as coverImageUrl
    // just above — the real validation already happened in ugq-submit at
    // capture time; this is just guarding what gets written.
    const videoRecordingPath = typeof body.video_recording_path === "string" && body.video_recording_path.trim()
      ? body.video_recording_path.trim().slice(0, 500) : null;
    const videoDurationSeconds = Number.isFinite(body.video_duration_seconds)
      ? Math.max(0, Math.min(600, Math.round(body.video_duration_seconds))) : null;
    // Sep 2026: "raw_plus_avatar" dropped — no TTS/avatar synthesis backend
    // exists, so it was never a real choice. Revisit if that infra is built.
    const videoPublishChoice = ["raw_only", "raw_plus_overlay"].includes(body.video_publish_choice)
      ? body.video_publish_choice as string : null;

    // Sep 2026, NEW — see header note. Proposer's own-language text, already
    // reviewed by them in ugq-screen's preview; used below to seed the
    // rendition stub_question_renditions() creates on insert. Only trusted
    // when detected_language is a real non-English code — a missing/"en"
    // value means there's nothing to seed (either an English proposal, or
    // an older proposal screened before this field existed).
    const detectedLanguage = typeof body.detected_language === "string" && body.detected_language.trim()
      ? body.detected_language.trim().toLowerCase().slice(0, 10) : null;
    const questionNative = typeof body.question_native === "string" && body.question_native.trim()
      ? body.question_native.trim() : null;
    const sliderLowNative = typeof body.slider_low_label_native === "string" && body.slider_low_label_native.trim()
      ? body.slider_low_label_native.trim() : null;
    const sliderHighNative = typeof body.slider_high_label_native === "string" && body.slider_high_label_native.trim()
      ? body.slider_high_label_native.trim() : null;
    // Sep 2026, NEW: same treatment as questionNative/slider*Native above,
    // but for the "Background" section — was previously omitted entirely
    // from this seed, leaving question_renditions.context_summary null on a
    // rendition that's about to be marked 'published' (so the async
    // generate-question-renditions translator, which DOES backfill
    // context_summary, never gets a chance to since this row is no longer
    // 'pending'). get_question_localized then fell back to the English
    // questions.context_summary forever for that specific rendition.
    const contextSummaryNative = typeof body.context_summary_native === "string" && body.context_summary_native.trim()
      ? body.context_summary_native.trim() : null;

    const { error: insErr } = await adminSb.from("questions").insert({
      id: questionId,
      question: reframed,
      topic_id: topicId,
      source: "community",
      proposed_by: proposal.user_id,
      location_label: proposal.location_label,
      slider_low_label: sliderLow,
      slider_high_label: sliderHigh,
      context_summary: contextSummary,
      supporting_links: supportingLinks,
      cover_image_url: coverImageUrl,
      auto_published: autoPublished,
      // `reframed` is guaranteed English by this point (the guardrail above
      // already rejected anything else), so questions.question is always the
      // English mirror.
      //
      // F2 (§3 R15 rewritten): this column records the question's SOURCE
      // language, not "the canonical language is English".
      // stub_question_renditions() reads it to decide which language the
      // question's ORIGINAL rendition is created in, so hardcoding 'en' made a
      // non-English proposer's own words a mere translation -- and any third
      // language would then have been derived from an unverified English
      // translation, the single point of semantic failure invariant 4 exists
      // to close.
      //
      // questions.question stays the ENGLISH mirror either way, and the
      // non-English-script guardrail above still protects it. Only claimed
      // when we actually have the proposer's native text to adopt as the
      // original; without it we would be tagging English text with a
      // non-English language code.
      canonical_language: (detectedLanguage && detectedLanguage !== "en" && questionNative)
        ? detectedLanguage
        : "en",
      // Epic X, NEW: content_type only overridden to 'video' when a video
      // path is actually present — an admin-fact-checked publish of a
      // proposal that happened to start as a video capture but has no
      // recording path for some reason falls back to the existing
      // 'general' default rather than claiming to be video content it
      // doesn't have.
      ...(videoRecordingPath ? {
        content_type: "video",
        video_recording_path: videoRecordingPath,
        video_duration_seconds: videoDurationSeconds,
        video_publish_choice: videoPublishChoice,
      } : {}),
      // admin_reviewed_at/admin_reviewed_by stay NULL until an admin acts —
      // that's what makes an auto-published question show up in the parallel
      // review queue. Admin-approved publishes (auto_published=false) simply
      // never need review, so those columns being NULL there is a non-event.
      // status/state/tags/published_at default; slug/search_vector/dedup/audience
      // are set by BEFORE INSERT triggers.
    });
    if (insErr) {
      // Roll the proposal back to 'approved' so the admin can retry.
      await adminSb.from("user_question_proposals").update({ status: "approved" }).eq("id", proposalId);
      return json(500, { ok: false, error: "INSERT_FAILED", message: insErr.message });
    }

    // Best-effort, and fail-open like ugq-confirm-publish's authority and
    // rendition steps: never blocks or fails the publish. If this does not
    // run, the question is still live and answerable — its original just
    // carries the English mirror text instead of the proposer's own words,
    // which an admin can correct through the rendition review queue.
    if (detectedLanguage && detectedLanguage !== "en" && questionNative) {
      try {
        // F2: make the proposer's own reviewed wording the question's ORIGINAL.
        // stub_question_renditions() has already created an original in the
        // right LANGUAGE but carrying the English mirror text (it only has
        // questions.question to work from); this swaps in the real source
        // wording server-side, in one transaction.
        //
        // The English rendition is deliberately left PENDING rather than
        // seeded from the reframe: generate-question-renditions then produces
        // it FROM the proposer's own words and puts it through the equivalence
        // check, which is invariant 4 actually happening instead of an
        // unverified English being grandfathered in because it arrived first.
        // The question is therefore absent from the English feed until that
        // check passes -- by design. The proposer still sees their own
        // language immediately, because the original above is published
        // outright and needs no verification: it IS the source.
        const { error: adoptErr } = await adminSb.rpc("adopt_proposer_source_wording", {
          p_question_id: questionId,
          p_source_language: detectedLanguage,
          p_text: questionNative,
          p_slider_low: sliderLowNative,
          p_slider_high: sliderHighNative,
          p_context_summary: contextSummaryNative,
        });
        if (adoptErr) {
          console.error(JSON.stringify({ tag: "ugq-publish.adopt_source_wording_failed", message: adoptErr.message }));
        }
      } catch (e) {
        console.error(JSON.stringify({ tag: "ugq-publish.adopt_source_wording_exception", message: (e as Error).message }));
      }
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

    await adminSb.from("user_notifications").insert({
      user_id: proposal.user_id,
      notification_type: "ugq_published",
      title: "Your question is live! 🎉",
      body: autoPublished
        ? "It's live now — our team will also give it a quick review shortly."
        : "See how the community responds.",
      question_id: questionId,
      href: `/q/${questionId}`,
    });

    return json(200, { ok: true, question_id: questionId, auto_published: autoPublished });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
