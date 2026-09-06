// src/components/question/RawVideoReveal.tsx
// Epic X — respondent-facing raw-video playback for a published
// content_type='video' question.
//
// Sep 2026, NEW: supersedes VideoStanceCard.tsx, which built this same
// reveal-and-play behavior but bundled it with its own duplicate stance
// slider and title/question text — all of which QuestionDetailPage already
// renders itself via the shared QuestionStanceSlider (with its full feature
// set: AI "what this means" tip, regional alignment, language-aware output,
// etc.). VideoStanceCard was also never actually imported anywhere, so none
// of that mattered in practice — this component is scoped to just the video
// itself, dropped into QuestionDetailPage alongside the existing slider
// rather than replacing it.
//
// Deliberately does NOT gate the stance slider on watching the video first:
// a UGQ raw video can contain leading tone/framing even after it clears the
// framing gate (which only blocks the worst cases), so forcing every
// respondent to watch before answering would mean the platform itself is
// choosing to expose people to that framing before they've had a chance to
// answer neutrally. The clip is optional, user-initiated context — closer to
// "hear how this was originally asked" than a mandatory intro.
//
// video_recording_path lives in a private bucket (ugq-video-recordings) —
// resolved to a signed URL via ugq-video-url, keyed by questionId only
// (never the raw path — see that function's header for why), and only on
// first click of the reveal button rather than on mount, since most
// respondents will never click play.

import { useCallback, useState } from "react";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type Props = {
  questionId: string;
};

type PlaybackState = "idle" | "loading" | "ready" | "error";

export function RawVideoReveal({ questionId }: Props) {
  const [playback, setPlayback] = useState<PlaybackState>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const handleShowRawVideo = useCallback(async () => {
    if (videoUrl) {
      setPlayback("ready"); // already resolved this session — no need to re-fetch
      return;
    }
    setPlayback("loading");
    try {
      const jwt = getJwt(); // "" for anonymous viewers — supabaseHeaders falls back to the anon key, which is all this public endpoint needs
      const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-video-url`, {
        method: "POST",
        headers: supabaseHeaders(jwt),
        body: JSON.stringify({ question_id: questionId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok || typeof json.video_url !== "string") {
        setPlayback("error");
        return;
      }
      setVideoUrl(json.video_url);
      setPlayback("ready");
    } catch {
      setPlayback("error");
    }
  }, [questionId, videoUrl]);

  if (playback === "ready" && videoUrl) {
    return (
      <video
        src={videoUrl}
        controls
        playsInline
        className="aspect-video w-full rounded-lg bg-slate-900"
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5 self-start">
      <button
        type="button"
        onClick={handleShowRawVideo}
        disabled={playback === "loading"}
        className="flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {playback === "loading" ? "Loading…" : "▶ Hear how this was originally asked"}
      </button>
      {playback === "error" && (
        <p className="text-xs text-red-600">
          Couldn't load the video.{" "}
          <button type="button" onClick={handleShowRawVideo} className="underline underline-offset-2">
            Try again
          </button>
        </p>
      )}
    </div>
  );
}
