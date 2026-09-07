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
// Anonymous-video feature (NEW): pulled into this repo unchanged. This
// function does NOT need to know whether a given video was recorded
// anonymously — video_recording_path already points at whichever artifact
// (raw clip, or the rendered avatar clip) is meant to be public, decided
// once at capture/publish time (see ugq-submit / ugq-publish). The true raw
// recording for an anonymous submission lives at video_raw_archival_path in
// a SEPARATE, structurally distinct private bucket (ugq-video-recordings-raw)
// that this function never reads from — see admin-ugq-raw-video-url for the
// only path that can ever sign a URL into that bucket.

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
      .select("content_type, video_recording_path")
      .eq("id", questionId).maybeSingle();

    // Not found, not a video question, or (shouldn't happen for a real
    // content_type='video' row, but defensive) missing its path — same 404
    // either way, no need to distinguish for the caller.
    if (!question || question.content_type !== "video" || !question.video_recording_path) {
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
