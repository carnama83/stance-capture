// supabase/functions/ugq-video-url/index.ts
// Epic X — issues a short-lived signed URL for a published video question's
// raw clip. video_recording_path lives in a private bucket
// (ugq-video-recordings, same private/no-RLS pattern as
// ugq-voice-recordings — see the Epic X migration) so respondents can never
// hit the storage object directly; this is the only path to a playable URL.
//
// Public and unauthenticated on purpose: this app supports anonymous
// browsing (see nav.anonymousModeTitle), and a published video question is
// public content by definition — the same content anyone can already see
// the AI-generated overlay title/question text for. The only thing gating
// access is knowing question_id, which is exactly as public as any other
// route in this app (/q/{question_id}).
//
// Deliberately takes ONLY question_id, never a raw storage path — the path
// itself is looked up server-side from a real row, so there is no way to
// probe or guess at another user's UNPUBLISHED video via this endpoint (a
// proposal's video_recording_path lives on user_question_proposals, not
// questions, until it's actually published).
//
// Sep 2026, FIXED (defect UGQ-D4): "published video question" now actually
// means published. This endpoint used to check only content_type='video'
// and the presence of a path, never questions.status — so an admin
// take-down (ugq-moderate action 'unpublish', which sets status='archived'
// plus archived_at/archive_reason) removed the question from every feed and
// from search, but left the raw clip fully playable to anyone still holding
// the question id. That is precisely the content most likely to need
// removing: the raw video is the one thing a neutral overlay cannot undo.
// A moderation take-down has to reach the artifact, not just the listing.
//
// Only status is checked, deliberately NOT state: 'dormant'/'new' are
// normal lifecycle states for a live question that still renders at
// /q/{id}, so filtering on state would break playback for perfectly
// legitimate questions. status='active' vs 'archived' is the take-down
// axis, and it is the same filter get_for_you_feed and
// get_trending_questions_homepage use.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 1 hour — long enough for a single viewing session (including re-buffering
// on a slow connection), short enough that a cached/leaked URL doesn't stay
// valid indefinitely. Fixed rather than env-configurable — no product
// requirement yet for a different window, and a constant keeps this
// function simple.
const SIGNED_URL_TTL_SECONDS = 3600;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const body = await req.json().catch(() => ({}));
    const questionId = typeof body.question_id === "string" ? body.question_id : "";
    if (!questionId || !UUID_RE.test(questionId)) {
      return json(400, { ok: false, error: "INVALID_QUESTION_ID" });
    }

    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: question } = await adminSb.from("questions")
      .select("content_type, video_recording_path, status")
      .eq("id", questionId).maybeSingle();

    // Not found, not a video question, archived by an admin take-down, or
    // (shouldn't happen for a real content_type='video' row, but defensive)
    // missing its path — same 404 either way. Deliberately NOT distinguished
    // for the caller: telling an anonymous requester "this one exists but was
    // taken down" is strictly more information than they need, and the
    // take-down reason is moderator-only.
    if (
      !question ||
      question.content_type !== "video" ||
      !question.video_recording_path ||
      question.status !== "active"
    ) {
      return json(404, { ok: false, error: "NOT_FOUND", message: "No video found for this question." });
    }

    const { data: signed, error: signErr } = await adminSb.storage
      .from("ugq-video-recordings")
      .createSignedUrl(question.video_recording_path, SIGNED_URL_TTL_SECONDS);

    if (signErr || !signed?.signedUrl) {
      return json(500, {
        ok: false, error: "SIGN_FAILED",
        message: signErr?.message ?? "Could not create a playable link.",
      });
    }

    return json(200, { ok: true, video_url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message ?? "Unexpected error" });
  }
});
