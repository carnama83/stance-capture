// src/components/question/RawVideoReveal.tsx
// Epic X — respondent-facing raw-video playback for a published
// content_type='video' question.
//
// Sep 2026, NEW: supersedes VideoStanceCard.tsx, which built this same
// playback behavior but bundled it with its own duplicate stance slider and
// title/question text — all of which QuestionDetailPage already renders
// itself via the shared QuestionStanceSlider (with its full feature set: AI
// "what this means" tip, regional alignment, language-aware output, etc.).
// VideoStanceCard was also never actually imported anywhere, so none of that
// mattered in practice — this component is scoped to just the video itself,
// dropped into QuestionDetailPage alongside the existing slider rather than
// replacing it.
//
// Sep 2026, UPDATED: shows the player inline immediately (resolves the
// signed URL eagerly on mount) instead of collapsing it behind a "reveal"
// button — a video question is a distinct, supported way to propose a
// question, and hiding the clip behind an extra click made that invisible.
// This is still consistent with the original neutrality goal below: the
// player is never set to autoplay and the stance slider is never gated on
// watching it, so nobody is forced to watch before answering — showing the
// player itself just means they don't have to hunt for it first.
//
// Deliberately does NOT gate the stance slider on watching the video first:
// a UGQ raw video can contain leading tone/framing even after it clears the
// framing gate (which only blocks the worst cases), so forcing every
// respondent to watch before answering would mean the platform itself is
// choosing to expose people to that framing before they've had a chance to
// answer neutrally.
//
// video_recording_path lives in a private bucket (ugq-video-recordings) —
// resolved to a signed URL via ugq-video-url, keyed by questionId only
// (never the raw path — see that function's header for why). Eager-fetching
// on mount is fine here (one video per question-detail page load); a feed
// rendering many video cards at once should NOT copy this pattern verbatim —
// see VideoThumbnailCard for the lazier, poster-first treatment used there.

import { useEffect, useState } from "react";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type Props = {
  questionId: string;
  posterUrl?: string | null;
};

type PlaybackState = "loading" | "ready" | "error";

export function RawVideoReveal({ questionId, posterUrl }: Props) {
  const [playback, setPlayback] = useState<PlaybackState>("loading");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlayback("loading");
    setVideoUrl(null);

    (async () => {
      try {
        const jwt = getJwt(); // "" for anonymous viewers — supabaseHeaders falls back to the anon key, which is all this public endpoint needs
        const res = await fetch(`${SUPABASE_URL}/functions/v1/ugq-video-url`, {
          method: "POST",
          headers: supabaseHeaders(jwt),
          body: JSON.stringify({ question_id: questionId }),
        });
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !json?.ok || typeof json.video_url !== "string") {
          setPlayback("error");
          return;
        }
        setVideoUrl(json.video_url);
        setPlayback("ready");
      } catch {
        if (!cancelled) setPlayback("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [questionId]);

  if (playback === "ready" && videoUrl) {
    return (
      <video
        src={videoUrl}
        controls
        playsInline
        poster={posterUrl ?? undefined}
        className="aspect-video w-full rounded-lg bg-slate-900"
      />
    );
  }

  if (playback === "error") {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg bg-slate-900 text-sm text-slate-300">
        <p>Couldn't load the video.</p>
        <button
          type="button"
          onClick={() => setPlayback("loading")}
          className="underline underline-offset-2 text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  // Loading — same aspect-ratio placeholder so the layout doesn't jump once
  // the real player mounts, with the cover image showing through if we have
  // one so this reads as "video loading", not a blank box.
  return (
    <div
      className="flex aspect-video w-full items-center justify-center rounded-lg bg-slate-900 bg-cover bg-center text-sm text-slate-300"
      style={posterUrl ? { backgroundImage: `url(${posterUrl})` } : undefined}
    >
      <span className="rounded bg-black/50 px-2 py-1">Loading video…</span>
    </div>
  );
}
