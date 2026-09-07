// supabase/functions/admin-ugq-raw-video-url/index.ts
// Anonymous-video feature — NEW function.
//
// The ONLY path by which the true, unmasked recording behind an anonymous
// video submission can ever be revealed. Everywhere else in the app,
// ugq-video-url signs and serves whatever sits at video_recording_path —
// which, for a video recorded while the proposer was anonymous, is the
// rendered avatar clip, never the raw camera feed (see VideoRecorderPanel.tsx
// and the anonymous-video migration for the full design). The raw feed
// instead lives at video_raw_archival_path, in a SEPARATE, structurally
// distinct private bucket (ugq-video-recordings-raw) that no public-facing
// function ever reads from.
//
// This function exists purely for trust & safety: if an anonymous video is
// reported for abuse, a moderator needs a way to see who's actually behind
// it. Gated the same way the rest of the admin surface is — the caller must
// pass the is_moderator() RPC check (see AdminIdentifiers.tsx for the same
// pattern used client-side) — and is never called from any public-facing
// component.
//
// Accepts EITHER question_id (a published question) or proposal_id (a
// not-yet-published proposal, for pre-publish moderation review) — exactly
// one of the two, matching where video_raw_archival_path actually lives on
// each table.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Short-lived — this is a sensitive, moderation-only artifact, not a normal
// playback URL. A moderator reviewing a report needs one viewing session,
// not a durable link.
const SIGNED_URL_TTL_SECONDS = 300;

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
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ── Identity + moderator check ──────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "UNAUTHORIZED" });
    const userSb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userSb.auth.getUser();
    if (!user) return json(401, { ok: false, error: "UNAUTHORIZED" });

    const { data: isModerator, error: modErr } = await userSb.rpc("is_moderator");
    if (modErr || !isModerator) {
      return json(403, { ok: false, error: "FORBIDDEN", message: "Moderator access required." });
    }

    const body = await req.json().catch(() => ({}));
    const questionId = typeof body.question_id === "string" ? body.question_id : "";
    const proposalId = typeof body.proposal_id === "string" ? body.proposal_id : "";
    if ((!questionId && !proposalId) || (questionId && proposalId)) {
      return json(400, { ok: false, error: "INVALID_INPUT", message: "Pass exactly one of question_id or proposal_id." });
    }
    if ((questionId && !UUID_RE.test(questionId)) || (proposalId && !UUID_RE.test(proposalId))) {
      return json(400, { ok: false, error: "INVALID_ID" });
    }

    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);
    const archivalPath = questionId
      ? (await adminSb.from("questions")
          .select("video_raw_archival_path")
          .eq("id", questionId).maybeSingle()).data?.video_raw_archival_path
      : (await adminSb.from("user_question_proposals")
          .select("video_raw_archival_path")
          .eq("id", proposalId).maybeSingle()).data?.video_raw_archival_path;

    if (!archivalPath) {
      return json(404, {
        ok: false, error: "NOT_FOUND",
        message: "No raw archival recording exists for this item — it wasn't recorded anonymously, or has none on file.",
      });
    }

    const { data: signed, error: signErr } = await adminSb.storage
      .from("ugq-video-recordings-raw")
      .createSignedUrl(archivalPath, SIGNED_URL_TTL_SECONDS);

    if (signErr || !signed?.signedUrl) {
      return json(500, {
        ok: false, error: "SIGN_FAILED",
        message: signErr?.message ?? "Could not create a playable link.",
      });
    }

    console.log(JSON.stringify({
      tag: "admin-ugq-raw-video-url.accessed",
      moderator_id: user.id,
      question_id: questionId || null,
      proposal_id: proposalId || null,
    }));

    return json(200, { ok: true, video_url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message ?? "Unexpected error" });
  }
});
