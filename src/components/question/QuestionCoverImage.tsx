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

// ─── Smart image layout hook ─────────────────────────────────────────────────
//
// Loads the image in the background, measures natural dimensions, and returns
// the best rendering strategy:
//
//   Portrait (ratio < 1.2):
//     → object-contain + blurred background fill
//     The banner height (120–160px) is too short to crop a tall portrait image
//     without cutting the subject's face. object-contain shows the full image
//     and the blurred fill hides the empty side areas.
//
//   Square-ish (1.2 – 1.6):
//     → object-cover + "center top" position
//     Slight upward bias keeps subjects in frame for near-square images.
//
//   Wide / landscape (> 1.6):
//     → object-cover + "center center"
//     Standard center crop — correct for scenery, crowds, action shots.

type ImageLayout = {
  objectFit: "cover" | "contain";
  objectPosition: string;
};

function useImageLayout(imageUrl: string | null | undefined): ImageLayout {
  const [layout, setLayout] = React.useState<ImageLayout>({
    objectFit: "cover",
    objectPosition: "center 20%",
  });

  React.useEffect(() => {
    if (!imageUrl) return;

    // Reset on URL change — default to top bias immediately
    setLayout({ objectFit: "cover", objectPosition: "center 20%" });

    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalWidth / img.naturalHeight;

      if (ratio < 1.0) {
        // True portrait (taller than wide) — contain to show full subject
        setLayout({ objectFit: "contain", objectPosition: "center center" });
      } else if (ratio < 2.2) {
        // Landscape AND square-ish news photos (the vast majority of wire images)
        // Subjects (faces, people) are almost always in the upper 30–40% of frame.
        // "center 20%" means the vertical anchor is at 20% from the top —
        // aggressively top-biased, keeps heads and faces visible.
        setLayout({ objectFit: "cover", objectPosition: "center 20%" });
      } else {
        // Ultra-wide / panoramic (ratio > 2.2) — true cinematic crop
        // Center is correct here (landscapes, crowds, skylines)
        setLayout({ objectFit: "cover", objectPosition: "center center" });
      }
    };
    img.src = imageUrl;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [imageUrl]);

  return layout;
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

  // Smart layout — portrait images use contain, landscape use cover
  const layout = useImageLayout(hasImage ? imageUrl : null);

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
            className="w-full h-full"
            style={{ objectFit: layout.objectFit, objectPosition: layout.objectPosition }}
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
          {/* Blurred background fill — always object-cover for the fill layer,
              this is what fills the sides when the foreground uses contain */}
          {blurBackground && (
            <img
              src={imageUrl!}
              alt=""
              role="presentation"
              aria-hidden="true"
              className="absolute inset-0 w-full h-full object-cover scale-110 blur-2xl"
              loading="lazy"
              decoding="async"
            />
          )}

          {/* Dark gradient overlay — keeps text legible */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />

          {/* Sharp foreground — layout.objectFit switches between cover/contain
              based on image aspect ratio detected by useImageLayout */}
          <img
            src={imageUrl!}
            alt=""
            role="presentation"
            className="relative z-10 w-full h-full"
            style={{ objectFit: layout.objectFit, objectPosition: layout.objectPosition }}
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
