// src/components/question/VideoThumbnailCard.tsx
// Epic X — homepage-card treatment for a published content_type='video'
// question (hero/featured/grid cards on Index.tsx).
//
// Sep 2026, NEW. A feed can render several of these at once, unlike
// QuestionDetailPage's RawVideoReveal (one video per page load, resolved
// eagerly on mount) — eagerly fetching a signed URL for every video card in
// a feed would mean N wasted ugq-video-url calls for videos most visitors
// will never press play on. So this stays poster-first: the question's own
// cover_image_url (or, absent that, a plain dark placeholder) with a large
// play-button overlay, unmistakably a video rather than a plain image —
// addresses the same "don't hide that this is a video" goal as
// RawVideoReveal's shift away from a text-only reveal link, just tuned for
// a feed instead of a single detail page. The signed URL, and the actual
// <video> element, are only fetched/mounted on click.
import { useCallback, useState } from "react";
import { SUPABASE_URL, getJwt, supabaseHeaders } from "@/lib/env";

type Props = {
  questionId: string;
  posterUrl?: string | null;
  className?: string;
};

type PlaybackState = "idle" | "loading" | "ready" | "error";

export function VideoThumbnailCard({ questionId, posterUrl, className }: Props) {
  const [playback, setPlayback] = useState<PlaybackState>("idle");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const handlePlay = useCallback(async () => {
    if (videoUrl) {
      setPlayback("ready");
      return;
    }
    setPlayback("loading");
    try {
      const jwt = getJwt(); // "" for anonymous viewers — supabaseHeaders falls back to the anon key
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
        autoPlay
        playsInline
        className={className ?? "aspect-video w-full rounded-lg bg-slate-900"}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // these cards are often wrapped in a click-to-open handler
        void handlePlay();
      }}
      disabled={playback === "loading"}
      aria-label="Play video"
      className={
        (className ?? "aspect-video w-full rounded-lg") +
        " relative flex items-center justify-center overflow-hidden bg-slate-900 bg-cover bg-center disabled:opacity-80"
      }
      style={posterUrl ? { backgroundImage: `url(${posterUrl})` } : undefined}
    >
      <span className="absolute inset-0 bg-black/20" aria-hidden />
      <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-md">
        {playback === "loading" ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
        ) : (
          <span className="ml-0.5 border-y-8 border-l-[14px] border-y-transparent border-l-slate-900" />
        )}
      </span>
      {playback === "error" && (
        <span className="absolute bottom-1.5 left-1.5 right-1.5 rounded bg-black/70 px-2 py-1 text-[11px] text-white">
          Couldn't load the video — tap to retry.
        </span>
      )}
    </button>
  );
}
