// src/components/question/QuestionCoverImage.tsx
//
// Reusable cover image component for question cards.
// Reads cover_image_url; shows a blurred bg or left thumbnail.
// Falls back to a gradient placeholder with category color if no image.
//
// Smart focal point: detects image aspect ratio on load and sets
// object-position to "top center" for portrait/tall images (people, headshots)
// and "center center" for landscape/wide images. This prevents faces and
// subjects from being cropped out by object-cover.
//
// Usage:
//   <QuestionCoverImage imageUrl={q.cover_image_url} tags={q.tags} variant="banner" />
//   <QuestionCoverImage imageUrl={q.cover_image_url} tags={q.tags} variant="thumbnail" />

import * as React from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Variant =
  | "banner"     // full-width banner (homepage cards / question header)
  | "thumbnail"; // small square left-side thumbnail

interface QuestionCoverImageProps {
  imageUrl: string | null | undefined;
  tags?: string[] | null;
  variant?: Variant;
  className?: string;
  /** Height for banner variant (default: 120px) */
  bannerHeight?: number;
  /**
   * If true, renders a blurred background layer behind the sharp image.
   * Default: true (keeps existing "premium" look without blurring the actual cover).
   */
  blurBackground?: boolean;
}

// ─── Tag → gradient mapping ───────────────────────────────────────────────────

const TAG_GRADIENTS: Record<string, string> = {
  economy: "from-emerald-900 to-emerald-700",
  jobs: "from-emerald-900 to-emerald-700",
  healthcare: "from-rose-900 to-rose-700",
  health: "from-rose-900 to-rose-700",
  education: "from-sky-900 to-sky-700",
  environment: "from-green-900 to-green-700",
  climate: "from-green-900 to-green-700",
  immigration: "from-amber-900 to-amber-700",
  crime: "from-red-900 to-red-700",
  housing: "from-violet-900 to-violet-700",
  technology: "from-indigo-900 to-indigo-700",
  foreign: "from-blue-900 to-blue-700",
  defense: "from-slate-900 to-slate-700",
  energy: "from-orange-900 to-orange-700",
  infrastructure: "from-stone-900 to-stone-700",
  social: "from-pink-900 to-pink-700",
};

function getGradient(tags: string[] | null | undefined): string {
  if (!tags || tags.length === 0) return "from-slate-800 to-slate-600";
  for (const tag of tags) {
    const key = tag.toLowerCase().trim();
    for (const [k, v] of Object.entries(TAG_GRADIENTS)) {
      if (key.includes(k)) return v;
    }
  }
  return "from-slate-800 to-slate-600";
}

// ─── Smart focal point hook ───────────────────────────────────────────────────
//
// Loads the image in the background, measures its natural dimensions, and
// returns the best object-position value:
//
//   - Portrait / tall (ratio < 1.2):  "top center"
//     News images of people are almost always taller than wide. The subject's
//     face is in the upper third, so anchoring to the top keeps them in frame.
//
//   - Square-ish (1.2 – 1.6):        "center top"
//     Slight upward bias — square headshots/thumbnails still tend to have the
//     subject in the upper half.
//
//   - Wide / landscape (> 1.6):       "center center"
//     Panoramic or cinematic shots crop symmetrically from the center, which
//     is the standard and works well for scenery/action images.
//
// Falls back to "center center" if the image hasn't loaded yet.

type FocalPoint = "top center" | "center top" | "center center";

function useImageFocalPoint(imageUrl: string | null | undefined): FocalPoint {
  const [focalPoint, setFocalPoint] = React.useState<FocalPoint>("center center");

  React.useEffect(() => {
    if (!imageUrl) return;

    // Reset to default on URL change
    setFocalPoint("center center");

    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalWidth / img.naturalHeight;
      if (ratio < 1.2) {
        // Portrait — anchor top so face/subject stays visible
        setFocalPoint("top center");
      } else if (ratio < 1.6) {
        // Square-ish — slight upward bias
        setFocalPoint("center top");
      } else {
        // Wide/landscape — standard center crop
        setFocalPoint("center center");
      }
    };
    // On error, keep the default "center center"
    img.src = imageUrl;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [imageUrl]);

  return focalPoint;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function QuestionCoverImage({
  imageUrl,
  tags,
  variant = "banner",
  className = "",
  bannerHeight = 120,
  blurBackground = true,
}: QuestionCoverImageProps) {
  const [imgFailed, setImgFailed] = React.useState(false);
  const gradient = getGradient(tags);
  const hasImage = !!imageUrl && !imgFailed;

  // Smart focal point — portrait images anchor to top, landscape to center
  const focalPoint = useImageFocalPoint(hasImage ? imageUrl : null);

  // Reset failure state if imageUrl changes
  React.useEffect(() => {
    setImgFailed(false);
  }, [imageUrl]);

  if (variant === "thumbnail") {
    return (
      <div
        className={`
          relative flex-shrink-0 rounded-md overflow-hidden
          w-20 h-20 sm:w-24 sm:h-24
          ${className}
        `}
      >
        {hasImage ? (
          <img
            src={imageUrl!}
            alt=""
            role="presentation"
            className="w-full h-full object-cover"
            style={{ objectPosition: focalPoint }}
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div className={`w-full h-full bg-gradient-to-br ${gradient}`} />
        )}
      </div>
    );
  }

  // ── Banner variant ────────────────────────────────────────────────────────
  return (
    <div
      className={`relative w-full overflow-hidden rounded-t-lg ${className}`}
      style={{ height: bannerHeight }}
    >
      {hasImage ? (
        <>
          {/* Blurred background fill — always crops center, just for the blur fill */}
          {blurBackground && (
            <img
              src={imageUrl!}
              alt=""
              role="presentation"
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl"
              loading="lazy"
              decoding="async"
              // Don't mark failed here; foreground img handles the error state
            />
          )}

          {/* Dark gradient overlay — keeps text legible */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />

          {/* Sharp foreground — focal point positions subject correctly */}
          <img
            src={imageUrl!}
            alt=""
            role="presentation"
            className="relative z-10 w-full h-full object-cover"
            style={{ objectPosition: focalPoint }}
            loading="lazy"
            decoding="async"
            onError={() => setImgFailed(true)}
          />
        </>
      ) : (
        /* Gradient placeholder */
        <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`}>
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        </div>
      )}
    </div>
  );
}
