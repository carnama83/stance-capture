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
// Oct 2026, REPLACES the Sep 2026 Devanagari script fix — language
// resolution for Hindi, English and Hinglish speech. The Sep fix seeded
// Whisper with a fixed Devanagari `prompt` on EVERY recording. Whisper
// conditions on the prompt's language/script, so plain English speech came
// back transliterated into Devanagari or loosely translated into Hindi (and
// short clips sometimes came back as the seed sentence itself) — the bug
// reported 1 Oct 2026. Now:
//   1. Whisper runs with NO prompt and no `language` param — pure
//      auto-detect, so nothing biases it toward either language.
//   2. resolveTranscriptLanguage() — a Claude pass (temp 0) that counts the
//      words SPOKEN in Hindi vs English (by language, not by the script
//      Whisper happened to write them in) and renders the utterance in
//      both languages. The code, not the model, then picks the output:
//        - English words >= Hindi words → English (Hindi bits translated)
//        - Hindi words  >  English words → Hindi in Devanagari (English bits
//          translated, or transliterated when they're everyday loanwords)
//      Ties go to English, the platform's canonical language. Pure English
//      or pure Devanagari Hindi input is returned untouched. Product rule
//      set by the owner (1 Oct 2026): a Hinglish question always comes back
//      in ONE language — whichever the speaker used more.
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

type TranscriptLanguage = "en" | "hi";

const DEVANAGARI_RE = /[ऀ-ॿ]/;
const LATIN_RE = /[A-Za-z]/;

// Oct 2026, NEW: Hindi / English / Hinglish resolution — see file header.
// Returns the raw transcript unchanged (language null) on ANY failure
// (missing key, API error, unparseable response) rather than throwing; the
// caller never needs its own try/catch around this.
async function resolveTranscriptLanguage(
  rawTranscript: string,
  anthropicApiKey: string,
): Promise<{ transcript: string; language: TranscriptLanguage | null }> {
  const failOpen = { transcript: rawTranscript, language: null };
  if (!anthropicApiKey || !rawTranscript.trim()) return failOpen;
  try {
    const sys =
      "You receive a speech-to-text transcript of someone asking a question. They may have spoken English, Hindi, " +
      "or Hinglish (a mix of both). The transcriber may have written Hindi words in Devanagari, in Roman letters " +
      "(phonetic Hindi, e.g. 'kya aap sochte hain'), or occasionally in Urdu script, and may have written English " +
      "words in Devanagari. Judge every word by the LANGUAGE it was spoken in, never by the script it is written in.\n\n" +
      "Do three things:\n" +
      "1. Count the words spoken in Hindi and the words spoken in English. English loanwords used inside a Hindi " +
      "sentence (traffic, school, road, police) count as English. Do not count proper nouns (people, places, " +
      "organisations), acronyms, numbers or brand names for either side.\n" +
      "2. english_text: the whole question as natural, fluent English. Translate the Hindi parts; keep the English " +
      "parts exactly as spoken. If the input is already entirely English, copy it exactly.\n" +
      "3. hindi_text: the whole question as natural Hindi written entirely in Devanagari. Translate the English parts " +
      "into Hindi, except everyday loanwords Hindi speakers normally use as-is (write those in Devanagari, e.g. " +
      "ट्रैफिक, स्कूल). Keep proper nouns, acronyms and brand names as they are. If the input is already entirely " +
      "Hindi in Devanagari, copy it exactly.\n\n" +
      "Preserve the exact meaning and the speaker's framing. Do not rephrase, soften, answer, or add anything; " +
      "fix only the language/script. Return ONLY a JSON object, no markdown fences:\n" +
      "{\"hindi_word_count\": <integer>, \"english_word_count\": <integer>, " +
      "\"english_text\": \"...\", \"hindi_text\": \"...\"}";
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        temperature: 0,
        system: sys,
        messages: [{ role: "user", content: rawTranscript }],
      }),
    });
    if (!res.ok) {
      console.error(JSON.stringify({ tag: "ugq-transcribe-voice.resolve_http_error", status: res.status }));
      return failOpen;
    }
    const data = await res.json();
    const blocks: Array<{ type?: string; text?: string }> = Array.isArray(data?.content) ? data.content : [];
    const text = blocks.filter((b) => b?.type === "text").map((b) => b?.text ?? "").join("\n").trim();
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd <= jsonStart) {
      console.error(JSON.stringify({ tag: "ugq-transcribe-voice.resolve_unparseable" }));
      return failOpen;
    }
    const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    const hindiCount = Number.isFinite(parsed?.hindi_word_count) ? Math.max(0, Math.floor(parsed.hindi_word_count)) : 0;
    const englishCount = Number.isFinite(parsed?.english_word_count) ? Math.max(0, Math.floor(parsed.english_word_count)) : 0;
    const englishText = typeof parsed?.english_text === "string" ? parsed.english_text.trim() : "";
    const hindiText = typeof parsed?.hindi_text === "string" ? parsed.hindi_text.trim() : "";

    // The owner's rule (1 Oct 2026): whichever language was spoken more wins;
    // a tie goes to English.
    const language: TranscriptLanguage = hindiCount > englishCount ? "hi" : "en";

    console.log(JSON.stringify({
      tag: "ugq-transcribe-voice.resolve", hindi_words: hindiCount, english_words: englishCount, language,
    }));

    // Already clean single-language input: hand back exactly what Whisper
    // heard rather than a model re-rendering of it.
    if (language === "en" && hindiCount === 0 && !DEVANAGARI_RE.test(rawTranscript)) {
      return { transcript: rawTranscript, language };
    }
    if (language === "hi" && englishCount === 0 && !LATIN_RE.test(rawTranscript) && DEVANAGARI_RE.test(rawTranscript)) {
      return { transcript: rawTranscript, language };
    }

    const chosen = language === "hi" ? hindiText : englishText;
    if (!chosen) return failOpen;
    return { transcript: chosen, language };
  } catch (e) {
    console.error(JSON.stringify({ tag: "ugq-transcribe-voice.resolve_exception", message: (e as Error).message }));
    return failOpen;
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
      // No `prompt` and no `language` param — deliberately. A prompt biases
      // Whisper toward its own language/script (that was the Oct 2026 bug),
      // and a user's spoken language and UI language setting aren't
      // guaranteed to match. Language is resolved afterwards instead — see
      // resolveTranscriptLanguage.

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

    // Oct 2026: Hindi/English/Hinglish resolution — see
    // resolveTranscriptLanguage's comment. Runs before the transcript is
    // shown in the editable "Here's what we heard" box, so whatever it
    // produces is what the proposer reviews/edits, not something applied
    // invisibly after the fact.
    const resolved = await resolveTranscriptLanguage(transcript, ANTHROPIC_API_KEY);
    transcript = resolved.transcript;

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
      language: resolved.language,
    }));

    return json(200, {
      ok: true, transcript, transcript_language: resolved.language, voice_recording_path: voiceRecordingPath,
    });
  } catch (err) {
    return json(500, { ok: false, error: "INTERNAL_ERROR", message: (err as Error).message });
  }
});
