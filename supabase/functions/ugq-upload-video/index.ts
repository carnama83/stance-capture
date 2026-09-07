// supabase/functions/ugq-upload-video/index.ts
// Epic X — NEW function (no prior version existed).
//
// Uploads a raw video recording to the ugq-video-recordings bucket and
// returns its storage path. Deliberately does ONLY the upload — audio
// transcription reuses the EXISTING voice pipeline (ugq-transcribe-voice)
// unchanged, via a second, audio-only MediaRecorder track captured in
// parallel on the client (see VideoRecorderPanel.tsx). Splitting it this
// way avoids needing any server-side audio extraction from video (nontrivial
// in a Deno edge function without ffmpeg) and avoids duplicating
// ugq-transcribe-voice's transcription logic, which was not available to
// read/modify in this session — this function does not depend on it at all.
//
// Auth: user JWT required (this is a user-facing endpoint, called directly
// from the browser during video capture, before ugq-submit).
//
// Conventions mirrored from ugq-submit/index.ts: std `serve`, dual Supabase
// clients (anon+JWT for identity, service-role for the actual storage
// write), jsonError(status, code, message) shape.
//
// Anonymous-video feature (NEW): accepts an optional `kind` field —
// "public" (default) writes to the existing ugq-video-recordings bucket,
// exactly as before. "raw_archival" writes to a SEPARATE, structurally
// distinct private bucket (ugq-video-recordings-raw) used ONLY for the true,
// unmasked recording of a video that was captured while the proposer was
// anonymous — see VideoRecorderPanel.tsx and the anonymous-video migration.
// The client uploads twice in that case (once per artifact); this function
// stays agnostic about WHY a given upload is public vs. archival, it just
// routes the bytes to the right bucket. No public-facing function ever
// reads from the archival bucket — see admin-ugq-raw-video-url, the only
// reader, gated to moderation/admin use.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Generous but bounded — a stance-question video should be short by design
// (this is a question prompt, not a vlog). Adjust if product requirements
// call for something different; not derived from a spec doc, just a
// reasonable starting ceiling.
const MAX_VIDEO_BYTES = 75 * 1024 * 1024; // 75MB
const MAX_DURATION_SECONDS = 120;
const ALLOWED_CONTENT_TYPES = ["video/webm", "video/mp4"];

const BUCKET_BY_KIND: Record<string, string> = {
  public: "ugq-video-recordings",
  raw_archival: "ugq-video-recordings-raw",
};

function jsonError(status: number, code: string, message: string) {
  return new Response(JSON.stringify({ ok: false, error: code, message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonError(405, "METHOD_NOT_ALLOWED", "Method not allowed");

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ── Identity ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonError(401, "UNAUTHORIZED", "Sign in to upload a video");
    }
    const userSb = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userSb.auth.getUser();
    if (!user) return jsonError(401, "UNAUTHORIZED", "Sign in to upload a video");

    // ── Parse multipart form ─────────────────────────────────────
    // Expects: video (File/Blob), duration_seconds (string, optional),
    // kind (string, optional — "public" default or "raw_archival").
    const form = await req.formData().catch(() => null);
    if (!form) return jsonError(400, "INVALID_FORM", "Expected multipart/form-data");

    const file = form.get("video");
    if (!(file instanceof File)) {
      return jsonError(400, "MISSING_VIDEO", "No video file provided");
    }
    if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
      return jsonError(400, "UNSUPPORTED_TYPE", `Unsupported video type: ${file.type || "(none)"}`);
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return jsonError(400, "FILE_TOO_LARGE", `Video must be under ${Math.floor(MAX_VIDEO_BYTES / 1024 / 1024)}MB`);
    }

    const kindRaw = typeof form.get("kind") === "string" ? String(form.get("kind")) : "public";
    const bucket = BUCKET_BY_KIND[kindRaw];
    if (!bucket) {
      return jsonError(400, "INVALID_KIND", `kind must be one of: ${Object.keys(BUCKET_BY_KIND).join(", ")}`);
    }

    const durationRaw = form.get("duration_seconds");
    const durationSeconds = typeof durationRaw === "string" && Number.isFinite(Number(durationRaw))
      ? Math.max(0, Math.min(MAX_DURATION_SECONDS, Math.round(Number(durationRaw))))
      : null;
    if (durationSeconds !== null && durationSeconds >= MAX_DURATION_SECONDS) {
      return jsonError(400, "TOO_LONG", `Video must be under ${MAX_DURATION_SECONDS} seconds`);
    }

    const ext = file.type === "video/mp4" ? "mp4" : "webm";
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { error: uploadErr } = await adminSb.storage
      .from(bucket)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadErr) {
      return jsonError(500, "UPLOAD_FAILED", uploadErr.message);
    }

    return new Response(JSON.stringify({
      ok: true,
      video_recording_path: path,
      video_duration_seconds: durationSeconds,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return jsonError(500, "INTERNAL_ERROR", (err as Error).message ?? "Unexpected error");
  }
});
