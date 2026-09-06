// src/components/question/VideoStanceCard.tsx
// Epic X — respondent-facing display for a published content_type='video'
// question.
//
// Deliberately does NOT reuse Epic X's AI-generated-card watch-to-unlock
// gating: that pattern (persistent slider from frame 1, unlock at 60%
// watched) is fine for AI-generated cards, which are neutral by
// construction. It is NOT fine here — a UGQ raw video can contain leading
// tone/framing even after it clears the framing gate (which only blocks the
// worst cases), so forcing every respondent to watch before answering would
// mean the platform itself is choosing to expose people to that framing
// before they've had a chance to answer neutrally. The slider here is
// interactable immediately; the raw clip is optional, user-initiated
// context, closer to "hear how this was originally asked" than a
// mandatory intro.
//
// Sep 2026, NEW: video_recording_path lives in a private bucket
// (ugq-video-recordings) — this component resolves it to a signed URL
// itself via ugq-video-url, keyed by questionId only (never the raw path;
// see that function's header for why). Resolved LAZILY, on the first click
// of "Hear how this was originally asked" rather than on mount — a feed can
// render many of these cards at once, and most respondents will never click
// play, so eager-fetching every card's URL up front would mostly be wasted
// signed-URL calls. The resolved URL is cached in state for the rest of
// this card's lifetime (a fresh signed URL is only needed again after a
// full remount, well past the 1h TTL ugq-video-url issues).

import { useCallback, useState } from "react";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type Props = {
  questionId: string;
  title: string;
  question: string;
  sliderLowLabel: string;
  sliderHighLabel: string;
  publishChoice: "raw_only" | "raw_plus_overlay";
  value: number; // -2..2
  onChange: (value: number) => void;
};

type PlaybackState = "idle" | "loading" | "ready" | "error";

export function VideoStanceCard({
  questionId,
  title,
  question,
  sliderLowLabel,
  sliderHighLabel,
  publishChoice,
  value,
  onChange,
}: Props) {
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

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4">
      {publishChoice !== "raw_only" && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{title}</p>
          <p className="mt-1 text-base font-medium text-neutral-900">{question}</p>
        </div>
      )}

      {/* Raw video: always opt-in, never autoplayed, never required before
          the slider below can be used. */}
      {playback === "ready" && videoUrl ? (
        <video src={videoUrl} controls playsInline className="aspect-video w-full rounded-md bg-neutral-900" />
      ) : (
        <div className="flex flex-col gap-1.5 self-start">
          <button
            type="button"
            onClick={handleShowRawVideo}
            disabled={playback === "loading"}
            className="flex items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-700 disabled:opacity-60"
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
      )}

      {/* Slider: interactable immediately regardless of whether the raw
          video has been played. */}
      <div className="flex flex-col gap-2">
        <div className="flex justify-between text-xs text-neutral-500">
          <span>{sliderLowLabel}</span>
          <span>{sliderHighLabel}</span>
        </div>
        <input
          type="range"
          min={-2}
          max={2}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full"
          aria-label={question}
        />
      </div>
    </div>
  );
}
