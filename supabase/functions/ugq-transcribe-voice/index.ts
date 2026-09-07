// supabase/functions/ugq-transcribe-voice/index.ts
// Epic UGQ — voice recording input (Aug 2026, NEW).
//
// Lets a proposer record their question by voice instead of typing it.
// Called DIRECTLY from ProposeQuestionModal (client-side, pre-submit) after
// the person stops recording and taps "Use this recording" — NOT part of
// the ugq-submit/ugq-screen pipeline. This function only transcribes +
// stores the audio; the resulting text is shown back to the proposer to
// review/edit in the SAME textarea the typed flow already uses, and THEY
// submit it via the existing handleSubmit/ugq-submit path exactly like any
// typed question. That's deliberate: voice is purely an alternate way to
// produce raw_question text, so nothing downstream (ugq-screen's Gate 1,
// preview generation, refine, publish) needs to know or care how the text
// originated. Also used by VideoRecorderPanel.tsx for its separate
// audio-only track (see ProposeQuestionModal's transcribeAudioForVideo) —
// so a script fix here benefits both voice and video capture.
//
// Design notes (scoped in a prior session, Aug 23 2026):
//   - Client-side review before submit catches STT errors and keeps the
//     existing text-based moderation pipeline completely untouched — the
//     transcript is just a starting draft the proposer can edit, same as if
//     they'd typed something and then revised it.
//   - Audio retention: kept, but ONLY for admin/moderation trust-signal
//     purposes (a human voice is harder to fake at scale than typed text) —
//     never surfaced in the respondent-facing experience. Playing back tone/
//     inflection to respondents would be a nudge vector, in direct tension
//     with the platform's Mirror Rule on neutral framing. The storage
//     bucket (ugq-voice-recordings) is private with no client-side Storage
//     access at all — this function is the only writer (service role), and
//     a future admin-side function will be the only reader (signed URLs,
//     service role) — see voice-input-migration.sql for the bucket setup.
//   - MediaRecorder's actual output format varies by browser (webm/opus
//     almost everywhere, mp4/aac on iOS Safari which doesn't support
//     webm/opus at all) — this function doesn't care which; both are
//     directly accepted by OpenAI's transcription endpoint with no
//     client-side transcoding needed.
//
// Sep 2026, NEW — Devanagari script fix for code-switched Hindi-English
// speech: Whisper's language auto-detection is kept (a user's spoken
// language and their UI language setting aren't guaranteed to match, so
// hardcoding based on a UI toggle would be wrong) — the actual bug is a
// known Whisper behavior where Hindi speech containing English words/names
// biases the model toward transliterating the WHOLE utterance into Latin
// script ("phonetic Hindi") instead of Devanagari. Two independent fixes:
//   1. WHISPER_SCRIPT_BIAS_PROMPT — a short Devanagari seed string passed as
//      Whisper's `prompt` param. Whisper conditions on the prompt's script
//      when the audio itself doesn't unambiguously commit to one script,
//      which measurably reduces (not eliminates) the phonetic-Hindi failure
//      mode. Applied unconditionally — harmless for genuinely English audio,
//      since a few Devanagari conditioning tokens don't bias English speech
//      toward Hindi.
//   2. normalizeTranscriptScript() — a Claude pass (temp 0) run AFTER
//      Whisper, as a backstop for whatever the prompt bias alone doesn't
//      catch: if the transcript is phonetic Hindi written in Latin
//      characters, rewrite it in Devanagari, preserving meaning — but
//      leaving genuine English words/loanwords/brand names as-is in Latin
//      script inline, since that's how real Hindi text is actually written.
//      If the transcript is genuinely English, it's returned unchanged.
//      Fails open to the raw Whisper output on any error — this is a
//      quality improvement, never a reason to block a proposer over an
//      LLM hiccup.
//
// Auth: user JWT required (called directly from the browser, unlike the
// x-cron-secret-gated internal functions). No ownership check needed here
// since this doesn't touch any proposal row yet — proposal_id doesn't exist
// until the proposer actually submits afterward.

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

// Defense-in-depth only — the real duration limit (60–90s) is enforced
// client-side by auto-stopping the recording. This is a generous byte
// ceiling (well above what even a high-bitrate 90s clip produces) meant
// purely to reject abusive/oversized uploads, not to police normal use.
const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // 8MB

// Sep 2026, NEW: short, neutral Devanagari seed for Whisper's `prompt`
// param — biases script selection for code-switched speech without
// asserting anything about the actual content. Deliberately generic
// (translates to "This is a question in mixed Hindi and English.") rather
// than topical, so it can't leak a specific claim/fact into the transcript.
const WHISPER_SCRIPT_BIAS_PROMPT = "यह हिंदी और अंग्रेज़ी में मिश्रित एक प्रश्न है।";

// Browsers' FileReader.readAsDataURL naturally produces a "data:mime;base64,"
// prefix — strip it defensively so this works whether the client sends that
// or raw base64.
function stripDataUrlPrefix(b64: string): string {
  const commaIdx = b64.indexOf(",");
  if (b64.startsWith("data:") && commaIdx !== -1) return b64.slice(commaIdx + 1);
  return b64;
}

function extensionForMimeType(mimeType: string): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base === "audio/mp4") return "mp4";
  if (base === "audio/mpeg") return "mp3";
  if (base === "audio/wav" || base === "audio/x-wav") return "wav";
  if (base === "audio/ogg") return "ogg";
  return "webm"; // covers audio/webm and audio/webm;codecs=opus (already stripped above)
}

// Sep 2026, NEW: backstop script-normalization pass — see file header.
// Returns the raw transcript unchanged on ANY failure (missing key, API
// error, empty response) rather than throwing; the caller never needs its
// own try/catch around this.
async function normalizeTranscriptScript(rawTranscript: string, anthropicApiKey: string): Promise<string> {
  if (!anthropicApiKey || !rawTranscript.trim()) return rawTranscript;
  try {
    const sys =
      "You fix a specific, known speech-to-text bug: Hindi speech that also contains English words or names " +
      "sometimes gets transcribed ENTIRELY in Latin/Roman letters (phonetic Hindi, e.g. 'kya aap iske baare mein sochte hain') " +
      "instead of proper Devanagari script (क्या आप इसके बारे में सोचते हैं). Your job: " +
      "if the input is phonetic Hindi written in Latin characters, rewrite it in correct Devanagari script, " +
      "preserving the exact meaning — but keep genuine English words, loanwords, brand names, and technical terms " +
      "in Latin script inline exactly as spoken, since that is how real written Hindi normally handles them (mixing " +
      "scripts inline is correct, not an error to fix). If the input is already in Devanagari, or is genuinely " +
      "English (not transliterated Hindi), return it EXACTLY unchanged — do not translate, rephrase, correct grammar, " +
      "or fix punctuation beyond the script issue itself. " +
      "Return ONLY the corrected text, nothing else — no quotes, no explanation, no markdown.";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        temperature: 0,
        system: sys,
        messages: [{ role: "user", content: rawTranscript }],
      }),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ tag: "ugq-transcribe-voice.normalize_http_error", status: res.status }));
      return rawTranscript;
    }
    const data = await res.json();
    const blocks: Array<{ type?: string; text?: string }> = Array.isArray(data?.content) ? data.content : [];
    const text = blocks.filter((b) => b?.type === "text").map((b) => b?.text ?? "").join("\n").trim();
    return text || rawTranscript;
  } catch (e) {
    console.error(JSON.stringify({ tag: "ugq-transcribe-voice.normalize_exception", message: (e as Error).message }));
    return rawTranscript;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "METHOD_NOT_ALLOWED" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  // Kept configurable, same convention as UGQ_SCREEN_MODEL elsewhere — swap
  // to a newer OpenAI transcription model later without a code change.
  const TRANSCRIBE_MODEL = (Deno.env.get("UGQ_TRANSCRIBE_MODEL") ?? "whisper-1").trim();

  try {
    // ── Identity ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json(401, { ok: false, error: "UNAUTHORIZED" });
    const userSb = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userSb.auth.getUser();
    if (!user) return json(401, { ok: false, error: "UNAUTHORIZED" });

    if (!OPENAI_API_KEY) {
      console.error(JSON.stringify({ tag: "ugq-transcribe-voice.no_api_key" }));
      return json(500, { ok: false, error: "TRANSCRIPTION_UNAVAILABLE", message: "Voice transcription isn't available right now — please type your question instead." });
    }

    const body = await req.json().catch(() => ({}));
    const audioB64Raw = typeof body.audio_base64 === "string" ? body.audio_base64 : "";
    const mimeType = typeof body.mime_type === "string" && body.mime_type.trim() ? body.mime_type.trim() : "audio/webm";
    if (!audioB64Raw) return json(400, { ok: false, error: "MISSING_AUDIO" });

    let audioBytes: Uint8Array;
    try {
      const cleaned = stripDataUrlPrefix(audioB64Raw);
      audioBytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
    } catch (e) {
      console.error(JSON.stringify({ tag: "ugq-transcribe-voice.decode_error", message: (e as Error).message }));
      return json(400, { ok: false, error: "INVALID_AUDIO", message: "Couldn't read that recording. Please try recording again." });
    }
    if (audioBytes.length === 0) return json(400, { ok: false, error: "EMPTY_AUDIO" });
    if (audioBytes.length > MAX_AUDIO_BYTES) {
      return json(400, { ok: false, error: "AUDIO_TOO_LARGE", message: "That recording is too long. Please keep it under 90 seconds." });
    }

    const ext = extensionForMimeType(mimeType);

    // ── Transcribe via OpenAI Whisper ─────────────────────────────────
    let transcript = "";
    try {
      const openaiForm = new FormData();
      openaiForm.append("file", new Blob([audioBytes as BlobPart], { type: mimeType }), `recording.${ext}`);
      openaiForm.append("model", TRANSCRIBE_MODEL);
      // Sep 2026, NEW: script-bias seed — see WHISPER_SCRIPT_BIAS_PROMPT's
      // comment. Still no `language` param — auto-detect stays on, since a
      // user's spoken language and their UI language setting aren't
      // guaranteed to match.
      openaiForm.append("prompt", WHISPER_SCRIPT_BIAS_PROMPT);

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
        body: openaiForm,
      });

      if (!whisperRes.ok) {
        const errBody = await whisperRes.text().catch(() => "");
        console.error(JSON.stringify({
          tag: "ugq-transcribe-voice.whisper_error", status: whisperRes.status, body: errBody.slice(0, 500),
        }));
        return json(502, {
          ok: false, error: "TRANSCRIPTION_FAILED",
          message: "Couldn't transcribe that recording. Please try again, or type your question instead.",
        });
      }

      const whisperJson = await whisperRes.json().catch(() => ({}));
      transcript = typeof whisperJson.text === "string" ? whisperJson.text.trim() : "";
    } catch (e) {
      console.error(JSON.stringify({ tag: "ugq-transcribe-voice.whisper_exception", message: (e as Error).message }));
      return json(502, {
        ok: false, error: "TRANSCRIPTION_FAILED",
        message: "Couldn't transcribe that recording. Please try again, or type your question instead.",
      });
    }

    if (!transcript) {
      return json(200, {
        ok: false, error: "EMPTY_TRANSCRIPT",
        message: "Didn't catch any speech in that recording. Please try again, speaking clearly, or type your question instead.",
      });
    }

    // Sep 2026, NEW: Devanagari backstop pass — see normalizeTranscriptScript's
    // comment. Runs before the transcript is shown in the editable "Here's
    // what we heard" box, so any script fix is what the proposer reviews/
    // edits, not something applied invisibly after the fact.
    transcript = await normalizeTranscriptScript(transcript, ANTHROPIC_API_KEY);

    // ── Store the original audio (best-effort — trust-signal only, never
    //    blocks the proposer from proceeding with their transcript) ───────
    const adminSb = createClient(SUPABASE_URL, SERVICE_KEY);
    const storagePath = `${user.id}/${crypto.randomUUID()}.${ext}`;
    let voiceRecordingPath: string | null = null;
    try {
      const { error: uploadErr } = await adminSb.storage
        .from("ugq-voice-recordings")
        .upload(storagePath, audioBytes, { contentType: mimeType, upsert: false });
      if (uploadErr) {
        console.error(JSON.stringify({ tag: "ugq-transcribe-voice.storage_upload_error", message: uploadErr.message }));
      } else {
        voiceRecordingPath = storagePath;
      }
    } catch (e) {
      console.error(JSON.stringify({ tag: "ugq-transcribe-voice.storage_upload_exception", message: (e as Error).message }));
      // Transcript is still returned below even if storage failed — losing
      // the admin trust-signal audio is a lesser problem than blocking the
      // proposer over a Storage hiccup.
    }

    console.log(JSON.stringify({
      tag: "ugq-transcribe-voice.ok",
      transcript_length: transcript.length,
      audio_bytes: audioBytes.length,
      stored: !!voiceRecordingPath,
    }));

    return json(200, { ok: true, transcript, voice_recording_path: voiceRecordingPath });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
